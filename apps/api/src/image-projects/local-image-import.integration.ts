import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { applyImageOperation, createImageDocument } from "@acs/image-document";
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import pg from "pg";
import { AssetFoundation } from "../assets/asset-foundation.js";
import { ImageProjectStore } from "./image-project-store.js";
import {
  LocalImageImportConflictError,
  LocalImageImportService,
  LocalImageImportValidationError,
} from "./local-image-import.js";

const databaseUrl = process.env.DATABASE_URL;
const endpoint = process.env.S3_ENDPOINT;
const bucket = process.env.S3_BUCKET;
const accessKeyId = process.env.S3_ACCESS_KEY;
const secretAccessKey = process.env.S3_SECRET_KEY;
if (!databaseUrl || !endpoint || !bucket || !accessKeyId || !secretAccessKey) {
  throw new Error(
    "Integration test requires DATABASE_URL and S3_* environment variables",
  );
}

const schema = `import_test_${randomUUID().replaceAll("-", "")}`;
const organizationA = randomUUID();
const organizationB = randomUUID();
const workspaceA = randomUUID();
const workspaceB = randomUUID();
const admin = new pg.Client({ connectionString: databaseUrl });
const db = new pg.Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schema}`,
  max: 3,
});
const s3 = new S3Client({
  endpoint,
  region: "us-east-1",
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});
let adminConnected = false;

async function removeObjects(prefix: string): Promise<void> {
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const object of page.Contents ?? []) {
      if (object.Key)
        await s3.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }),
        );
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}

try {
  await admin.connect();
  adminConnected = true;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  for (const file of [
    "0001_asset_foundation.sql",
    "0002_image_projects.sql",
    "0003_identity_memberships.sql",
    "0004_local_image_imports.sql",
  ]) {
    await db.query(
      await readFile(resolve(process.cwd(), "migrations", file), "utf8"),
    );
  }
  await db.query(
    "INSERT INTO organizations (id,slug,name) VALUES ($1,$2,'A'),($3,$4,'B')",
    [
      organizationA,
      `test-${organizationA}`,
      organizationB,
      `test-${organizationB}`,
    ],
  );
  await db.query(
    "INSERT INTO workspaces (id,organization_id,name) VALUES ($1,$2,'A'),($3,$4,'B')",
    [workspaceA, organizationA, workspaceB, organizationB],
  );
  const scopeA = { organizationId: organizationA, workspaceId: workspaceA };
  const scopeB = { organizationId: organizationB, workspaceId: workspaceB };
  const assets = new AssetFoundation(db, s3, bucket);
  const projectStore = new ImageProjectStore(db);
  const importService = new LocalImageImportService(db, assets, projectStore);
  const imageId = randomUUID();
  const maskId = randomUUID();
  const document = applyImageOperation(createImageDocument(randomUUID()), {
    type: "addImage",
    layer: {
      id: randomUUID(),
      kind: "image",
      name: "Product",
      assetId: imageId,
      sourceWidth: 100,
      sourceHeight: 100,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      mask: { assetId: maskId, strokes: [] },
    },
  });
  const originals = new Map([
    [
      imageId,
      {
        displayName: "product.png",
        contentType: "image/png",
        bytes: Buffer.from("original-product"),
      },
    ],
    [
      maskId,
      {
        displayName: "mask.png",
        contentType: "image/png",
        bytes: Buffer.from("original-mask"),
      },
    ],
  ]);

  class FlakyProjectStore extends ImageProjectStore {
    private failOnce = true;
    override async save(
      ...args: Parameters<ImageProjectStore["save"]>
    ): ReturnType<ImageProjectStore["save"]> {
      if (this.failOnce) {
        this.failOnce = false;
        throw new Error("simulated failure after original uploads");
      }
      return super.save(...args);
    }
  }
  const flaky = new LocalImageImportService(
    db,
    assets,
    new FlakyProjectStore(db),
  );
  await assert.rejects(
    flaky.import(scopeA, "Local project", document, originals, "import-1"),
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS count FROM assets WHERE organization_id = $1",
        [organizationA],
      )
    ).rows[0]?.count,
    2,
  );
  const imported = await flaky.import(
    scopeA,
    "Local project",
    document,
    originals,
    "import-1",
  );
  assert.equal(imported.project.version, 1);
  assert.notEqual(imported.project.id, document.id);
  assert.notEqual(imported.assetIdMap.get(imageId), imageId);
  assert.notEqual(imported.assetIdMap.get(maskId), maskId);
  const imageLayer = imported.project.document.layers[0];
  assert.equal(imageLayer?.kind, "image");
  if (imageLayer?.kind !== "image") throw new Error("Expected image layer");
  assert.equal(imageLayer.assetId, imported.assetIdMap.get(imageId));
  assert.equal(imageLayer.mask?.assetId, imported.assetIdMap.get(maskId));
  assert.deepEqual(
    (await assets.readOriginal(scopeA, imageLayer.assetId))?.bytes,
    originals.get(imageId)?.bytes,
  );
  assert.deepEqual(
    (await assets.readOriginal(scopeA, imageLayer.mask!.assetId))?.bytes,
    originals.get(maskId)?.bytes,
  );

  const replay = await importService.import(
    scopeA,
    "Local project",
    document,
    originals,
    "import-1",
  );
  assert.equal(replay.project.id, imported.project.id);
  assert.equal(
    replay.assetIdMap.get(imageId),
    imported.assetIdMap.get(imageId),
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS count FROM assets WHERE organization_id = $1",
        [organizationA],
      )
    ).rows[0]?.count,
    2,
  );
  await assert.rejects(
    importService.import(scopeA, "Changed", document, originals, "import-1"),
    LocalImageImportConflictError,
  );
  await assert.rejects(
    importService.import(
      scopeA,
      "Local project",
      document,
      new Map([[imageId, originals.get(imageId)!]]),
      "missing",
    ),
    LocalImageImportValidationError,
  );
  const separate = await importService.import(
    scopeB,
    "Local project",
    document,
    originals,
    "import-1",
  );
  assert.notEqual(separate.project.id, imported.project.id);
  assert.equal(await projectStore.get(scopeB, imported.project.id), null);
  assert.equal(
    await assets.get(scopeB, imported.assetIdMap.get(imageId)!),
    null,
  );
  await assert.rejects(
    db.query(
      "UPDATE local_image_imports SET destination_project_id = $1 WHERE organization_id = $2",
      [randomUUID(), organizationA],
    ),
  );
  await assert.rejects(
    db.query("DELETE FROM local_image_imports WHERE organization_id = $1", [
      organizationA,
    ]),
  );
  console.log(
    "PASS: local asset mapping, original integrity, failure retry, scope isolation, immutable import identity",
  );
} finally {
  await db.end();
  if (adminConnected) {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
  await removeObjects(`org/${organizationA}/`);
  await removeObjects(`org/${organizationB}/`);
  s3.destroy();
}
