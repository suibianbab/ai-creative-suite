import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import { applyImageOperation, createImageDocument } from "@acs/image-document";
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import pg from "pg";
import { AssetFoundation } from "../assets/asset-foundation.js";
import {
  AccessContextResolver,
  JwtAuthProvider,
} from "../auth/access-context.js";
import {
  ImageProjectHttpController,
  ImageProjectHttpGuard,
} from "./image-project-http.controller.js";
import { ImageProjectHttpService } from "./image-project-http.service.js";
import { ImageProjectStore } from "./image-project-store.js";
import { LocalImageImportService } from "./local-image-import.js";

const databaseUrl = process.env.DATABASE_URL;
const endpoint = process.env.S3_ENDPOINT;
const bucket = process.env.S3_BUCKET;
const accessKeyId = process.env.S3_ACCESS_KEY;
const secretAccessKey = process.env.S3_SECRET_KEY;
if (!databaseUrl || !endpoint || !bucket || !accessKeyId || !secretAccessKey) {
  throw new Error("Integration test requires DATABASE_URL and S3_* variables");
}
const schema = `http_test_${randomUUID().replaceAll("-", "")}`;
const organizationA = randomUUID();
const organizationB = randomUUID();
const workspaceA = randomUUID();
const workspaceB = randomUUID();
const userId = randomUUID();
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
let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;

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
  await db.query(
    "INSERT INTO users (id,display_name) VALUES ($1,'HTTP tester')",
    [userId],
  );
  await db.query(
    "INSERT INTO auth_identities (issuer,subject,user_id) VALUES ($1,'http-tester',$2)",
    ["https://issuer.example", userId],
  );
  await db.query(
    "INSERT INTO organization_memberships (organization_id,user_id,role) VALUES ($1,$2,'MEMBER')",
    [organizationA, userId],
  );
  await db.query(
    "INSERT INTO workspace_memberships (organization_id,workspace_id,user_id,role) VALUES ($1,$2,$3,'EDITOR')",
    [organizationA, workspaceA, userId],
  );
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "http-key";
  const provider = JwtAuthProvider.local(
    {
      issuer: "https://issuer.example",
      audience: "acs-api",
      algorithms: ["RS256"],
      maxTokenAgeSeconds: 3600,
    },
    { keys: [jwk] },
  );
  const access = new AccessContextResolver(db, provider);
  const assets = new AssetFoundation(db, s3, bucket);
  const projects = new ImageProjectStore(db);
  const projectServices = {
    db,
    s3,
    access,
    assets,
    projects,
    imports: new LocalImageImportService(db, assets, projects),
  };
  @Module({
    controllers: [ImageProjectHttpController],
    providers: [
      ImageProjectHttpGuard,
      {
        provide: ImageProjectHttpService,
        useValue: { get: () => projectServices },
      },
    ],
  })
  class HttpTestModule {}
  app = await NestFactory.create(HttpTestModule, { logger: false });
  await app.listen(0, "127.0.0.1");
  const base = `${await app.getUrl()}/workspaces/${workspaceA}/image-projects`;
  const forbiddenBase = `${await app.getUrl()}/workspaces/${workspaceB}/image-projects`;
  const token = await new SignJWT({ role: "OWNER", workspaceId: workspaceB })
    .setProtectedHeader({ alg: "RS256", kid: "http-key" })
    .setIssuer("https://issuer.example")
    .setAudience("acs-api")
    .setSubject("http-tester")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);
  const headers = { authorization: `Bearer ${token}` };
  const oversizedStatus = await new Promise<number>(
    (resolveStatus, rejectStatus) => {
      const port = Number(new URL(base).port);
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.setTimeout(3000);
      socket.once("connect", () => {
        socket.write(
          `POST /workspaces/${workspaceA}/image-projects/imports HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${token}\r\nContent-Type: multipart/form-data; boundary=test\r\nContent-Length: 120000000\r\nConnection: close\r\n\r\n`,
        );
      });
      socket.once("data", (data) => {
        socket.destroy();
        resolveStatus(
          Number(/^HTTP\/1\.1 (\d{3})/.exec(data.toString("ascii"))?.[1]),
        );
      });
      socket.once("timeout", () => {
        socket.destroy();
        rejectStatus(
          new Error("Oversized request did not receive an early response"),
        );
      });
      socket.once("error", rejectStatus);
    },
  );
  assert.equal(oversizedStatus, 413);
  const localId = randomUUID();
  const document = applyImageOperation(createImageDocument(randomUUID()), {
    type: "addImage",
    layer: {
      id: randomUUID(),
      kind: "image",
      name: "Sample",
      assetId: localId,
      sourceWidth: 1,
      sourceHeight: 1,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      rotation: 0,
      opacity: 1,
    },
  });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLytQAAAABJRU5ErkJggg==",
    "base64",
  );
  function upload() {
    const form = new FormData();
    form.set("title", "HTTP project");
    form.set("requestKey", "same-import");
    form.set("document", JSON.stringify(document));
    form.set(localId, new Blob([png], { type: "image/png" }), "sample.png");
    return form;
  }
  assert.equal(
    (await fetch(`${base}/imports`, { method: "POST", body: upload() })).status,
    401,
  );
  assert.equal(
    (
      await fetch(`${forbiddenBase}/imports`, {
        method: "POST",
        headers,
        body: upload(),
      })
    ).status,
    403,
  );
  const first = await fetch(`${base}/imports`, {
    method: "POST",
    headers,
    body: upload(),
  });
  assert.equal(
    first.status,
    201,
    first.status === 201 ? undefined : await first.text(),
  );
  const imported = (await first.json()) as {
    project: { id: string; version: number; document: typeof document };
    assetIdMap: Record<string, string>;
  };
  assert.equal(imported.project.version, 1);
  assert.equal(imported.project.document.layers[0]?.kind, "image");
  assert.equal(
    (imported.project.document.layers[0] as { assetId: string }).assetId,
    imported.assetIdMap[localId],
  );
  const replay = await fetch(`${base}/imports`, {
    method: "POST",
    headers,
    body: upload(),
  });
  assert.equal(replay.status, 201);
  assert.equal(
    ((await replay.json()) as typeof imported).project.id,
    imported.project.id,
  );
  const list = await fetch(base, { headers });
  assert.equal(list.status, 200);
  assert.equal(
    ((await list.json()) as Array<{ id: string }>)[0]?.id,
    imported.project.id,
  );
  const projectUrl = `${base}/${imported.project.id}`;
  const loaded = await fetch(projectUrl, { headers });
  assert.equal(loaded.status, 200);
  assert.equal(((await loaded.json()) as { version: number }).version, 1);
  const original = await fetch(
    `${projectUrl}/assets/${imported.assetIdMap[localId]}`,
    { headers },
  );
  assert.equal(original.status, 200);
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), png);
  assert.equal(
    (await fetch(`${projectUrl}/assets/${randomUUID()}`, { headers })).status,
    404,
  );
  assert.equal(
    (await fetch(`${forbiddenBase}/${imported.project.id}`, { headers }))
      .status,
    403,
  );
  const nextLocalId = randomUUID();
  const assetForm = () => {
    const form = new FormData();
    form.set("requestKey", `project-${imported.project.id}-${nextLocalId}`);
    form.set("original", new Blob([png], { type: "image/png" }), "new.png");
    return form;
  };
  assert.equal(
    (await fetch(`${projectUrl}/assets`, { method: "POST", body: assetForm() }))
      .status,
    401,
  );
  const uploaded = await fetch(`${projectUrl}/assets`, {
    method: "POST",
    headers,
    body: assetForm(),
  });
  assert.equal(uploaded.status, 201);
  const uploadedId = ((await uploaded.json()) as { id: string }).id;
  const uploadedReplay = await fetch(`${projectUrl}/assets`, {
    method: "POST",
    headers,
    body: assetForm(),
  });
  assert.equal(
    ((await uploadedReplay.json()) as { id: string }).id,
    uploadedId,
  );
  const updated = {
    ...imported.project.document,
    canvas: { ...imported.project.document.canvas, background: "#eeeeee" },
    layers: [
      ...imported.project.document.layers,
      {
        id: randomUUID(),
        kind: "image" as const,
        name: "New",
        assetId: uploadedId,
        sourceWidth: 1,
        sourceHeight: 1,
        x: 1,
        y: 1,
        width: 1,
        height: 1,
        rotation: 0,
        opacity: 1,
      },
    ],
  };
  const save = (expectedVersion: number, requestKey: string) =>
    fetch(projectUrl, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        title: "HTTP project",
        document: updated,
        expectedVersion,
        requestKey,
      }),
    });
  assert.equal((await save(1, "save-2")).status, 200);
  assert.equal((await save(1, "stale-save")).status, 409);
  await db.query(
    "UPDATE workspace_memberships SET role = 'VIEWER' WHERE workspace_id = $1 AND user_id = $2",
    [workspaceA, userId],
  );
  assert.equal((await fetch(projectUrl, { headers })).status, 200);
  assert.equal((await save(2, "viewer-save")).status, 403);
  await db.query(
    "UPDATE workspace_memberships SET active = false WHERE workspace_id = $1 AND user_id = $2",
    [workspaceA, userId],
  );
  assert.equal((await fetch(projectUrl, { headers })).status, 403);
  console.log(
    "PASS: HTTP auth before upload, early size rejection, tenant scope, import replay, original bytes, incremental asset upload, list/load, read-only role, stale write and revocation",
  );
} finally {
  await app?.close();
  await db.end();
  if (adminConnected) {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
  await removeObjects(`org/${organizationA}/`);
  await removeObjects(`org/${organizationB}/`);
  s3.destroy();
}
