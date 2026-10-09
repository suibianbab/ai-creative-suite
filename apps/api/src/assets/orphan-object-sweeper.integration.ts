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
import { AssetFoundation } from "./asset-foundation.js";
import { OrphanObjectSweeper } from "./orphan-object-sweeper.js";

const databaseUrl = process.env.DATABASE_URL;
const endpoint = process.env.S3_ENDPOINT;
const bucket = process.env.S3_BUCKET;
const accessKeyId = process.env.S3_ACCESS_KEY;
const secretAccessKey = process.env.S3_SECRET_KEY;
if (!databaseUrl || !endpoint || !bucket || !accessKeyId || !secretAccessKey) {
  throw new Error("Integration test requires DATABASE_URL and S3_* variables");
}

const schema = `orphan_test_${randomUUID().replaceAll("-", "")}`;
const organizationId = randomUUID();
const workspaceId = randomUUID();
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
const prefix = `org/${organizationId}/`;

async function listTestKeys(): Promise<string[]> {
  const page = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }),
  );
  return (page.Contents ?? []).flatMap((item) => (item.Key ? [item.Key] : []));
}

try {
  await admin.connect();
  adminConnected = true;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await db.query(
    await readFile(
      resolve(process.cwd(), "migrations/0001_asset_foundation.sql"),
      "utf8",
    ),
  );
  await db.query(
    "INSERT INTO organizations (id, slug, name) VALUES ($1,$2,'Sweeper test')",
    [organizationId, `sweeper-${organizationId}`],
  );
  await db.query(
    "INSERT INTO workspaces (id, organization_id, name) VALUES ($1,$2,'Test')",
    [workspaceId, organizationId],
  );
  const asset = await new AssetFoundation(db, s3, bucket).createOriginal(
    { organizationId, workspaceId },
    {
      idempotencyKey: "referenced-object",
      displayName: "referenced.png",
      kind: "IMAGE",
      source: "USER_UPLOAD",
      contentType: "image/png",
      bytes: Buffer.from("referenced-object"),
    },
  );
  const orphanKey = `${prefix}${randomUUID()}/${randomUUID()}`;
  const malformedKey = `${prefix}unmanaged.txt`;
  for (const key of [orphanKey, malformedKey]) {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: Buffer.from("test-only"),
        IfNoneMatch: "*",
      }),
    );
  }
  const sweeper = new OrphanObjectSweeper(db, s3, bucket);
  const current = await sweeper.sweep(organizationId);
  assert.equal(current.deleted.length, 0);
  assert.equal(current.tooRecent, 2);
  assert.equal(current.invalid, 1);
  await assert.rejects(() =>
    sweeper.sweep(organizationId, { minimumAgeDays: 1, execute: true }),
  );

  // Advance only the test's decision clock; all objects live under a random test org.
  const future = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
  const preview = await sweeper.sweep(organizationId, { now: future });
  assert.deepEqual(preview.candidates, [orphanKey]);
  assert.equal(preview.referenced, 1);
  assert.equal(preview.invalid, 1);
  assert.equal((await listTestKeys()).length, 3);

  const result = await sweeper.sweep(organizationId, {
    now: future,
    execute: true,
  });
  assert.deepEqual(result.deleted, [orphanKey]);
  assert.deepEqual(
    (await listTestKeys()).sort(),
    [asset.storageKey, malformedKey].sort(),
  );
  console.log(
    "PASS: dry run, minimum age, exact key scope, referenced-original protection, conditional orphan delete",
  );
} finally {
  await db.end();
  if (adminConnected) {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
  for (const key of await listTestKeys()) {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }
  s3.destroy();
}
