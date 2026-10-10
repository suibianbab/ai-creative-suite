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
import {
  ImageProjectAssetError,
  ImageProjectConflictError,
  ImageProjectStore,
  ImageProjectValidationError,
} from "./image-project-store.js";

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

const schema = `project_test_${randomUUID().replaceAll("-", "")}`;
const organizationA = randomUUID();
const organizationB = randomUUID();
const workspaceA = randomUUID();
const workspaceB = randomUUID();
const workspaceC = randomUUID();
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
  for (const file of ["0001_asset_foundation.sql", "0002_image_projects.sql"]) {
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
  await db.query(
    "INSERT INTO workspaces (id,organization_id,name) VALUES ($1,$2,'C')",
    [workspaceC, organizationA],
  );
  const scopeA = { organizationId: organizationA, workspaceId: workspaceA };
  const scopeB = { organizationId: organizationB, workspaceId: workspaceB };
  const scopeC = { organizationId: organizationA, workspaceId: workspaceC };
  const assets = new AssetFoundation(db, s3, bucket);
  const store = new ImageProjectStore(db);
  const assetA = await assets.createOriginal(scopeA, {
    idempotencyKey: "asset-a",
    displayName: "A.png",
    kind: "IMAGE",
    source: "USER_UPLOAD",
    contentType: "image/png",
    bytes: Buffer.from("image-a"),
  });
  const assetB = await assets.createOriginal(scopeB, {
    idempotencyKey: "asset-b",
    displayName: "B.png",
    kind: "IMAGE",
    source: "USER_UPLOAD",
    contentType: "image/png",
    bytes: Buffer.from("image-b"),
  });
  const projectId = randomUUID();
  const baseDocument = applyImageOperation(createImageDocument(projectId), {
    type: "addImage",
    layer: {
      id: randomUUID(),
      kind: "image",
      name: "A",
      assetId: assetA.id,
      sourceWidth: 100,
      sourceHeight: 100,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
    },
  });
  const document = applyImageOperation(baseDocument, {
    type: "setAdjustments",
    layerId: baseDocument.layers[0]!.id,
    patch: { brightness: 20, contrast: 15, saturation: 25, exposure: 0.5 },
  });
  const [first, replay] = await Promise.all([
    store.save(scopeA, "Project", document, 0, "create-1"),
    store.save(scopeA, "Project", document, 0, "create-1"),
  ]);
  assert.equal(first.version, 1);
  assert.equal(replay.version, 1);
  const storedProject = await store.get(scopeA, projectId);
  assert.equal(storedProject?.document.layers[0]?.kind, "image");
  assert.deepEqual(
    storedProject?.document.layers[0]?.kind === "image"
      ? storedProject.document.layers[0].adjustments
      : undefined,
    { brightness: 20, contrast: 15, saturation: 25, exposure: 0.5 },
  );
  assert.equal(await store.get(scopeB, projectId), null);
  assert.equal(await store.get(scopeC, projectId), null);
  await assert.rejects(
    store.save(scopeB, "Wrong tenant", document, 0, "cross"),
    ImageProjectConflictError,
  );
  await assert.rejects(
    store.save(scopeC, "Wrong workspace", document, 0, "cross"),
    ImageProjectConflictError,
  );
  await assert.rejects(
    store.save(scopeA, "Changed", document, 0, "create-1"),
    ImageProjectConflictError,
  );
  await assert.rejects(
    store.save(scopeA, "Stale", document, 0, "stale"),
    ImageProjectConflictError,
  );

  const next = applyImageOperation(document, {
    type: "addText",
    layer: {
      id: randomUUID(),
      kind: "text",
      name: "Title",
      text: "Product",
      fontSize: 64,
      color: "#000000",
      fontFamily: "Arial",
      x: 10,
      y: 10,
      width: 300,
      height: 80,
      rotation: 0,
      opacity: 1,
    },
  });
  assert.equal(
    (await store.save(scopeA, "Project 2", next, 1, "update-1")).version,
    2,
  );
  assert.equal((await store.get(scopeA, projectId))?.version, 2);
  assert.equal(
    (await store.save(scopeA, "Project", document, 0, "create-1")).version,
    1,
  );
  await assert.rejects(
    db.query(
      "UPDATE image_project_versions SET document = '{}'::jsonb WHERE project_id = $1",
      [projectId],
    ),
  );
  await assert.rejects(
    db.query("DELETE FROM image_project_asset_refs WHERE project_id = $1", [
      projectId,
    ]),
  );
  await assert.rejects(
    db.query(
      "INSERT INTO image_project_asset_refs (organization_id,workspace_id,project_id,version,asset_id) VALUES ($1,$2,$3,1,$4)",
      [organizationA, workspaceA, projectId, assetB.id],
    ),
  );

  const foreignDocument = {
    ...next,
    id: randomUUID(),
    layers: next.layers.map((layer) =>
      layer.kind === "image" ? { ...layer, assetId: assetB.id } : layer,
    ),
  };
  await assert.rejects(
    store.save(scopeA, "Foreign", foreignDocument, 0, "foreign"),
    ImageProjectAssetError,
  );
  await assert.rejects(
    store.save(
      scopeC,
      "Foreign workspace",
      { ...document, id: randomUUID() },
      0,
      "foreign-workspace",
    ),
    ImageProjectAssetError,
  );
  assert.equal(await store.get(scopeA, foreignDocument.id), null);
  await assert.rejects(
    store.save(
      scopeA,
      "Invalid",
      { ...document, productIdentityLock: false },
      0,
      "invalid",
    ),
    ImageProjectValidationError,
  );
  console.log(
    "PASS: versioned project save, idempotency, stale write rejection, tenant and asset isolation, immutable history",
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
