import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import pg from "pg";
import {
  AssetConflictError,
  AssetFoundation,
  AssetScopeError,
} from "./asset-foundation.js";

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

const schema = `asset_test_${randomUUID().replaceAll("-", "")}`;
const organizationA = randomUUID();
const organizationB = randomUUID();
const workspaceA = randomUUID();
const workspaceB = randomUUID();
const admin = new pg.Client({ connectionString: databaseUrl });
const db = new pg.Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schema}`,
  max: 2,
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
  const sql = await readFile(
    resolve(process.cwd(), "migrations/0001_asset_foundation.sql"),
    "utf8",
  );
  await db.query(sql);
  await db.query(
    "INSERT INTO organizations (id, slug, name) VALUES ($1,$2,'A'),($3,$4,'B')",
    [
      organizationA,
      `test-${organizationA}`,
      organizationB,
      `test-${organizationB}`,
    ],
  );
  await db.query(
    "INSERT INTO workspaces (id, organization_id, name) VALUES ($1,$2,'A'),($3,$4,'B')",
    [workspaceA, organizationA, workspaceB, organizationB],
  );

  const service = new AssetFoundation(db, s3, bucket);
  const scopeA = { organizationId: organizationA, workspaceId: workspaceA };
  const scopeB = { organizationId: organizationB, workspaceId: workspaceB };
  const bytes = Buffer.from("asset-foundation-golden-original");
  const input = {
    idempotencyKey: "test-original",
    displayName: "Test original.png",
    kind: "IMAGE" as const,
    source: "USER_UPLOAD" as const,
    contentType: "image/png",
    bytes,
  };

  const original = await service.createOriginal(scopeA, input);
  assert.equal(original.organizationId, organizationA);
  assert.equal(original.workspaceId, workspaceA);
  assert.deepEqual(
    (await service.readOriginal(scopeA, original.id))?.bytes,
    bytes,
  );
  assert.equal((await service.createOriginal(scopeA, input)).id, original.id);
  await assert.rejects(
    service.createOriginal(scopeA, {
      ...input,
      bytes: Buffer.from("different"),
    }),
    AssetConflictError,
  );
  assert.equal(await service.get(scopeB, original.id), null);
  assert.equal(await service.readOriginal(scopeB, original.id), null);
  await assert.rejects(
    service.createOriginal(
      { organizationId: organizationA, workspaceId: workspaceB },
      input,
    ),
    AssetScopeError,
  );
  await assert.rejects(
    service.createOriginal(scopeA, {
      ...input,
      idempotencyKey: "bad-kind",
      kind: "UNRECOGNIZED" as never,
    }),
    AssetConflictError,
  );

  await assert.rejects(
    db.query("UPDATE asset_blobs SET sha256 = repeat('0',64) WHERE id = $1", [
      original.originalBlobId,
    ]),
  );
  await assert.rejects(
    db.query("DELETE FROM asset_blobs WHERE id = $1", [
      original.originalBlobId,
    ]),
  );
  await assert.rejects(
    db.query("UPDATE assets SET workspace_id = $1 WHERE id = $2", [
      workspaceB,
      original.id,
    ]),
  );
  await assert.rejects(
    db.query("UPDATE assets SET original_blob_id = $1 WHERE id = $2", [
      randomUUID(),
      original.id,
    ]),
  );
  await assert.rejects(
    db.query(
      "INSERT INTO assets (id,organization_id,workspace_id,kind,source,display_name,idempotency_key,request_fingerprint,original_blob_id) VALUES ($1,$2,$3,'IMAGE','USER_UPLOAD','bad','cross',repeat('0',64),$4)",
      [randomUUID(), organizationA, workspaceB, randomUUID()],
    ),
  );

  await assert.rejects(
    s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: original.storageKey,
        Body: Buffer.from("overwrite"),
        IfNoneMatch: "*",
      }),
    ),
  );
  assert.deepEqual(
    (await service.readOriginal(scopeA, original.id))?.bytes,
    bytes,
  );

  const concurrentInput = { ...input, idempotencyKey: "concurrent" };
  const [first, second] = await Promise.all([
    service.createOriginal(scopeA, concurrentInput),
    service.createOriginal(scopeA, concurrentInput),
  ]);
  assert.equal(first.id, second.id);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS count FROM assets WHERE organization_id = $1",
        [organizationA],
      )
    ).rows[0]?.count,
    2,
  );
  console.log(
    "PASS: tenant isolation, immutable originals, idempotency, concurrent creation, S3 conditional write, byte integrity",
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
