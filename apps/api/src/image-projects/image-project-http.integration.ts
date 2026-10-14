import "reflect-metadata";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
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
import sharp from "sharp";
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
import { PhotoCraftCreditHttpController } from "./photocraft-credit-http.controller.js";
import { PhotoCraftEditJobHttpController } from "./photocraft-edit-job-http.controller.js";
import { PhotoCraftEditJobStore } from "./photocraft-edit-jobs.js";
import { executePhotoCraftJob } from "./photocraft-edit-worker.js";
import { PhotoCraftProjectHttpController } from "./photocraft-project-http.controller.js";
import { PhotoCraftProjectStore } from "./photocraft-project-store.js";
import { PhotoCraftQualityReviewHttpController } from "./photocraft-quality-review-http.controller.js";
import { PhotoCraftQualityReviewStore } from "./photocraft-quality-reviews.js";

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
    "0005_photocraft_projects.sql",
    "0006_photocraft_edit_jobs.sql",
    "0007_photocraft_quality_reviews.sql",
    "0008_photocraft_layer_jobs.sql",
    "0009_photocraft_adjustment_jobs.sql",
    "0010_photocraft_masked_adjustment_jobs.sql",
    "0011_photocraft_generation_credits.sql",
    "0012_immutable_credit_ledger.sql",
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
  const photocraftProjects = new PhotoCraftProjectStore(db, assets);
  const photocraftJobs = new PhotoCraftEditJobStore(db);
  const photocraftReviews = new PhotoCraftQualityReviewStore(db);
  const projectServices = {
    db,
    s3,
    access,
    assets,
    projects,
    imports: new LocalImageImportService(db, assets, projects),
    photocraftProjects,
    photocraftJobs,
    photocraftReviews,
  };
  @Module({
    controllers: [
      ImageProjectHttpController,
      PhotoCraftProjectHttpController,
      PhotoCraftEditJobHttpController,
      PhotoCraftCreditHttpController,
      PhotoCraftQualityReviewHttpController,
    ],
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

  const photoId = randomUUID();
  const photoBase = `${await app.getUrl()}/workspaces/${workspaceA}/photocraft-projects`;
  const photoSource = await readFile(
    resolve(process.cwd(), "../../qa/fixtures/photocraft-tiny.pcraft"),
  );
  const photoOriginal = await readFile(
    resolve(process.cwd(), "../../qa/fixtures/photocraft-tiny.png"),
  );
  const photoForm = (version: number, key: string, includeOriginal = false) => {
    const form = new FormData();
    form.set("id", photoId);
    form.set("title", "PhotoCraft editable");
    form.set("expectedVersion", String(version));
    form.set("requestKey", key);
    form.set(
      "source",
      new Blob([photoSource], { type: "application/x-photocraft" }),
      "source.pcraft",
    );
    if (includeOriginal)
      form.set(
        "original",
        new Blob([photoOriginal], { type: "image/png" }),
        "original.png",
      );
    return form;
  };
  assert.equal(
    (
      await fetch(photoBase, {
        method: "POST",
        body: photoForm(0, "pc-first", true),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(
        `${await app.getUrl()}/workspaces/${workspaceB}/photocraft-projects`,
        {
          method: "POST",
          headers,
          body: photoForm(0, "pc-first", true),
        },
      )
    ).status,
    403,
  );
  const photoCreated = await fetch(photoBase, {
    method: "POST",
    headers,
    body: photoForm(0, "pc-first", true),
  });
  assert.equal(
    photoCreated.status,
    201,
    photoCreated.status === 201 ? undefined : await photoCreated.text(),
  );
  const photoProject = (await photoCreated.json()) as {
    id: string;
    version: number;
    originalAssetId: string;
  };
  assert.equal(photoProject.version, 1);
  assert.ok(photoProject.originalAssetId);
  const photoReplay = await fetch(photoBase, {
    method: "POST",
    headers,
    body: photoForm(0, "pc-first", true),
  });
  assert.equal(photoReplay.status, 201);
  assert.equal(((await photoReplay.json()) as { version: number }).version, 1);
  const downloaded = await fetch(`${photoBase}/${photoId}/source`, { headers });
  assert.equal(downloaded.status, 200);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), photoSource);
  assert.equal((await fetch(`${photoBase}/${photoId}/source`)).status, 401);
  assert.equal(
    (
      await fetch(
        `${await app.getUrl()}/workspaces/${workspaceB}/photocraft-projects/${photoId}/source`,
        { headers },
      )
    ).status,
    403,
  );
  const photoV2 = await fetch(`${photoBase}/${photoId}`, {
    method: "PUT",
    headers,
    body: photoForm(1, "pc-second"),
  });
  assert.equal(
    photoV2.status,
    200,
    photoV2.status === 200 ? undefined : await photoV2.text(),
  );
  assert.equal(((await photoV2.json()) as { version: number }).version, 2);
  const reviewUrl = `${photoBase}/${photoId}/reviews/2`;
  const reviewBody = {
    requestKey: "review-v2-first",
    grade: "manual",
    note: "右侧边缘需要人工修整",
    checks: [true, false, true, true],
    criteria: ["颜色", "边缘", "纹理", "背景"],
  };
  assert.equal((await fetch(reviewUrl)).status, 401);
  assert.equal(
    (
      await fetch(reviewUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reviewBody),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(
        `${await app.getUrl()}/workspaces/${workspaceB}/photocraft-projects/${photoId}/reviews/2`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify(reviewBody),
        },
      )
    ).status,
    403,
  );
  const reviewed = await fetch(reviewUrl, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(reviewBody),
  });
  assert.equal(
    reviewed.status,
    201,
    reviewed.status === 201 ? undefined : await reviewed.text(),
  );
  const reviewId = ((await reviewed.json()) as { id: string }).id;
  const reviewedAgain = await fetch(reviewUrl, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(reviewBody),
  });
  assert.equal(((await reviewedAgain.json()) as { id: string }).id, reviewId);
  assert.equal(
    (
      await fetch(reviewUrl, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ ...reviewBody, grade: "minor" }),
      })
    ).status,
    409,
  );
  const reviews = await fetch(reviewUrl, { headers });
  assert.equal(reviews.status, 200);
  assert.equal(((await reviews.json()) as { id: string }[])[0]?.id, reviewId);
  const oldReplay = await fetch(photoBase, {
    method: "POST",
    headers,
    body: photoForm(0, "pc-first", true),
  });
  assert.equal(oldReplay.status, 201);
  assert.equal(((await oldReplay.json()) as { version: number }).version, 1);
  assert.equal(
    (
      await fetch(`${photoBase}/${photoId}`, {
        method: "PUT",
        headers,
        body: photoForm(1, "pc-stale"),
      })
    ).status,
    409,
  );
  const immutableOriginal = await db.query<{ original_asset_id: string }>(
    "SELECT original_asset_id FROM photocraft_projects WHERE id=$1",
    [photoId],
  );
  assert.equal(
    immutableOriginal.rows[0]?.original_asset_id,
    photoProject.originalAssetId,
  );

  const jobProjectId = randomUUID();
  const cliPath =
    process.env.PHOTOCRAFT_CLI_PATH ??
    resolve(
      process.cwd(),
      "../../.tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe",
    );
  let jobSource = photoSource;
  let jobFixtureDir: string | null = null;
  if (existsSync(cliPath)) {
    jobFixtureDir = await mkdtemp(join(tmpdir(), "acs-pc-http-test-"));
    const fixturePath = join(jobFixtureDir, "hat.pcraft");
    execFileSync(
      cliPath,
      [
        "convert",
        resolve(process.cwd(), "../../qa/fixtures/photocraft-hat-teal.png"),
        fixturePath,
      ],
      { windowsHide: true, timeout: 120_000 },
    );
    jobSource = await readFile(fixturePath);
  }
  const jobForm = new FormData();
  jobForm.set("id", jobProjectId);
  jobForm.set("title", "Worker integration fixture");
  jobForm.set("expectedVersion", "0");
  jobForm.set("requestKey", "worker-fixture-source");
  jobForm.set(
    "source",
    new Blob([jobSource], { type: "application/x-photocraft" }),
    "source.pcraft",
  );
  const workerCreated = await fetch(photoBase, {
    method: "POST",
    headers,
    body: jobForm,
  });
  assert.equal(workerCreated.status, 201, await workerCreated.text());
  const jobUrl = `${photoBase}/${jobProjectId}/jobs`;
  const jobBody = JSON.stringify({
    expectedVersion: 1,
    operation: "rotate-cw",
    requestKey: "rotate-qa",
  });
  assert.equal(
    (
      await fetch(jobUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: jobBody,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(
        `${await app.getUrl()}/workspaces/${workspaceB}/photocraft-projects/${jobProjectId}/jobs`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: jobBody,
        },
      )
    ).status,
    403,
  );
  const submit = () =>
    fetch(jobUrl, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: jobBody,
    });
  const submitted = await submit();
  assert.equal(
    submitted.status,
    201,
    submitted.status === 201 ? undefined : await submitted.text(),
  );
  const queued = (await submitted.json()) as {
    id: string;
    status: string;
    expectedVersion: number;
  };
  assert.equal(queued.status, "queued");
  assert.equal(
    ((await (await submit()).json()) as { id: string }).id,
    queued.id,
  );
  assert.equal(
    (await fetch(`${jobUrl}/${queued.id}`, { headers })).status,
    200,
  );
  assert.equal(
    (await fetch(`${photoBase}/${photoId}/jobs/${queued.id}`, { headers }))
      .status,
    404,
  );
  assert.equal(
    (
      await fetch(jobUrl, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          expectedVersion: 1,
          operation: "flip-horizontal",
          requestKey: "rotate-qa",
        }),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await fetch(jobUrl, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          expectedVersion: 1,
          operation: "run arbitrary",
          requestKey: "invalid-operation",
        }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(jobUrl, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          expectedVersion: 1,
          operation: "levels",
          params: { inBlack: 235, inWhite: 20, gamma: 1.2 },
          requestKey: "invalid-levels",
        }),
      })
    ).status,
    400,
  );
  if (existsSync(cliPath)) {
    const claimed = await photocraftJobs.claimNext();
    assert.equal(claimed?.id, queued.id);
    await executePhotoCraftJob(claimed!, {
      assets,
      projects: photocraftProjects,
      jobs: photocraftJobs,
      cli: cliPath,
      workDir: tmpdir(),
    });
    const done = await photocraftJobs.get(
      { organizationId: organizationA, workspaceId: workspaceA },
      jobProjectId,
      queued.id,
    );
    assert.equal(done?.status, "succeeded", done?.errorCode ?? undefined);
    assert.equal(done.outputVersion, 2);
    assert.equal(
      (
        await photocraftProjects.get(
          { organizationId: organizationA, workspaceId: workspaceA },
          jobProjectId,
        )
      )?.version,
      2,
    );
    assert.notDeepEqual(
      await photocraftProjects.readSource(
        { organizationId: organizationA, workspaceId: workspaceA },
        jobProjectId,
      ),
      jobSource,
    );
    for (const [operation, expectedVersion, targetLayers] of [
      ["duplicate-layer", 2, 2],
      ["hide-layer", 3, 2],
      ["show-layer", 4, 2],
    ] as const) {
      const response = await fetch(jobUrl, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          expectedVersion,
          operation,
          requestKey: `worker-${operation}`,
        }),
      });
      assert.equal(response.status, 201, await response.text());
      const next = await photocraftJobs.claimNext();
      assert.equal(next?.operation, operation);
      await executePhotoCraftJob(next!, {
        assets,
        projects: photocraftProjects,
        jobs: photocraftJobs,
        cli: cliPath,
        workDir: tmpdir(),
      });
      const result = await photocraftJobs.get(
        { organizationId: organizationA, workspaceId: workspaceA },
        jobProjectId,
        next!.id,
      );
      assert.equal(result?.status, "succeeded", result?.errorCode ?? undefined);
      assert.equal(result?.outputVersion, expectedVersion + 1);
      const source = await photocraftProjects.readSource(
        { organizationId: organizationA, workspaceId: workspaceA },
        jobProjectId,
      );
      const checkPath = join(jobFixtureDir!, `check-${operation}.pcraft`);
      await writeFile(checkPath, source!);
      const info = JSON.parse(
        execFileSync(cliPath, ["info", checkPath, "--compact"], {
          encoding: "utf8",
          windowsHide: true,
          timeout: 120_000,
        }),
      ) as {
        activeLayer: number;
        layers: { id: number; visible: boolean }[];
      };
      assert.equal(info.layers.length, targetLayers);
      if (operation !== "duplicate-layer")
        assert.equal(
          info.layers.find((layer) => layer.id === info.activeLayer)?.visible,
          operation === "show-layer",
        );
    }
    const adjustments = [
      ["levels", { inBlack: 20, inWhite: 235, gamma: 1.2 }],
      ["adjust-brightness", { amount: 15 }],
      ["adjust-contrast", { amount: -12 }],
      ["adjust-saturation", { amount: 18 }],
      ["adjust-exposure", { amount: 20 }],
      ["adjust-vibrance", { amount: 16 }],
      ["adjust-shadows", { amount: 10 }],
      ["adjust-highlights", { amount: -10 }],
    ] as const;
    for (const [index, [operation, params]] of adjustments.entries()) {
      const expectedVersion = 5 + index;
      const response = await fetch(jobUrl, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          expectedVersion,
          operation,
          params,
          requestKey: `worker-${operation}`,
        }),
      });
      assert.equal(response.status, 201, await response.text());
      const next = await photocraftJobs.claimNext();
      assert.equal(next?.operation, operation);
      assert.deepEqual(next?.params, params);
      await executePhotoCraftJob(next!, {
        assets,
        projects: photocraftProjects,
        jobs: photocraftJobs,
        cli: cliPath,
        workDir: tmpdir(),
      });
      const result = await photocraftJobs.get(
        { organizationId: organizationA, workspaceId: workspaceA },
        jobProjectId,
        next!.id,
      );
      assert.equal(
        result?.status,
        "succeeded",
        `${operation}: ${result?.errorCode ?? "missing result"}`,
      );
      assert.equal(result?.outputVersion, expectedVersion + 1);
      const source = await photocraftProjects.readSource(
        { organizationId: organizationA, workspaceId: workspaceA },
        jobProjectId,
      );
      const checkPath = join(jobFixtureDir!, `check-${operation}.pcraft`);
      await writeFile(checkPath, source!);
      const info = JSON.parse(
        execFileSync(cliPath, ["info", checkPath, "--compact"], {
          encoding: "utf8",
          windowsHide: true,
          timeout: 120_000,
        }),
      ) as {
        layers: { kind: string; hasMask: boolean }[];
      };
      assert.equal(info.layers.length, 3 + index);
      assert.equal(info.layers[0]?.kind, "Adjustment");
      assert.equal(info.layers[0]?.hasMask, true);
    }
    const maskedParams = {
      amount: 18,
      selection: { kind: "rect", rect: [80, 80, 180, 180] },
      edgeShift: 0,
      edgeFeather: 0,
      patches: [],
    };
    const maskedResponse = await fetch(jobUrl, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        expectedVersion: 13,
        operation: "masked-adjust-brightness",
        params: maskedParams,
        requestKey: "worker-masked-brightness",
      }),
    });
    assert.equal(maskedResponse.status, 201, await maskedResponse.text());
    const masked = await photocraftJobs.claimNext();
    assert.equal(masked?.operation, "masked-adjust-brightness");
    await executePhotoCraftJob(masked!, {
      assets,
      projects: photocraftProjects,
      jobs: photocraftJobs,
      cli: cliPath,
      workDir: tmpdir(),
    });
    const maskedResult = await photocraftJobs.get(
      { organizationId: organizationA, workspaceId: workspaceA },
      jobProjectId,
      masked!.id,
    );
    assert.equal(
      maskedResult?.status,
      "succeeded",
      maskedResult?.errorCode ?? undefined,
    );
    assert.equal(maskedResult.outputVersion, 14);
    const maskedSource = await photocraftProjects.readSource(
      { organizationId: organizationA, workspaceId: workspaceA },
      jobProjectId,
    );
    const maskedPath = join(jobFixtureDir!, "check-masked.pcraft");
    await writeFile(maskedPath, maskedSource!);
    const maskedInfo = JSON.parse(
      execFileSync(cliPath, ["info", maskedPath, "--compact"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 120_000,
      }),
    ) as {
      selectionBounds: number[] | null;
      layers: { kind: string; hasMask: boolean }[];
    };
    assert.equal(maskedInfo.layers.length, 11);
    assert.equal(maskedInfo.layers[0]?.kind, "Adjustment");
    assert.equal(maskedInfo.layers[0]?.hasMask, true);
    assert.deepEqual(maskedInfo.selectionBounds, [80, 80, 180, 180]);
    const lassoResponse = await fetch(jobUrl, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        expectedVersion: 14,
        operation: "masked-adjust-saturation",
        requestKey: "worker-masked-lasso",
        params: {
          amount: -15,
          selection: {
            kind: "lasso",
            points: [
              [100, 100],
              [280, 100],
              [280, 280],
              [100, 280],
            ],
          },
          edgeShift: 0,
          edgeFeather: 1,
          patches: [],
          protectRect: [130, 130, 40, 40],
        },
      }),
    });
    assert.equal(lassoResponse.status, 201, await lassoResponse.text());
    const lasso = await photocraftJobs.claimNext();
    await executePhotoCraftJob(lasso!, {
      assets,
      projects: photocraftProjects,
      jobs: photocraftJobs,
      cli: cliPath,
      workDir: tmpdir(),
    });
    const lassoResult = await photocraftJobs.get(
      { organizationId: organizationA, workspaceId: workspaceA },
      jobProjectId,
      lasso!.id,
    );
    assert.equal(
      lassoResult?.status,
      "succeeded",
      lassoResult?.errorCode ?? undefined,
    );
    assert.equal(lassoResult.outputVersion, 15);
    const existingResponse = await fetch(jobUrl, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        expectedVersion: 15,
        operation: "masked-adjust-exposure",
        requestKey: "worker-masked-existing",
        params: { amount: 10, selection: { kind: "existing" } },
      }),
    });
    assert.equal(existingResponse.status, 201, await existingResponse.text());
    const existing = await photocraftJobs.claimNext();
    await executePhotoCraftJob(existing!, {
      assets,
      projects: photocraftProjects,
      jobs: photocraftJobs,
      cli: cliPath,
      workDir: tmpdir(),
    });
    const existingResult = await photocraftJobs.get(
      { organizationId: organizationA, workspaceId: workspaceA },
      jobProjectId,
      existing!.id,
    );
    assert.equal(
      existingResult?.status,
      "succeeded",
      existingResult?.errorCode ?? undefined,
    );
    assert.equal(existingResult.outputVersion, 16);
    const creditScope = {
      organizationId: organizationA,
      workspaceId: workspaceA,
    };
    const creditUrl = `${await app.getUrl()}/workspaces/${workspaceA}/photocraft-credits`;
    assert.equal((await fetch(creditUrl)).status, 401);
    assert.equal((await fetch(creditUrl, { headers })).status, 200);
    assert.equal(
      (
        await fetch(
          `${await app.getUrl()}/workspaces/${workspaceB}/photocraft-credits`,
          { headers },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        (await (await fetch(creditUrl, { headers })).json()) as {
          available: number;
        }
      ).available,
      0,
    );
    const generationInput = (key: string) =>
      JSON.stringify({
        expectedVersion: 16,
        operation: "generate-local",
        requestKey: key,
        params: {
          prompt: "Change this selected area to deep blue",
          selection: { kind: "existing" },
          edgeFeather: 3,
        },
      });
    assert.equal(
      (
        await fetch(jobUrl, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: generationInput("gen-no-credit"),
        })
      ).status,
      402,
    );
    assert.equal(
      await photocraftJobs.grantCredits(creditScope, 2, "integration-grant"),
      2,
    );
    assert.equal(
      await photocraftJobs.grantCredits(creditScope, 2, "integration-grant"),
      2,
    );
    await assert.rejects(
      photocraftJobs.grantCredits(creditScope, 3, "integration-grant"),
      /Credit grant reference reused/,
    );
    await assert.rejects(
      db.query(
        `UPDATE workspace_credit_ledger SET amount=9 WHERE organization_id=$1 AND workspace_id=$2 AND kind='grant'`,
        [creditScope.organizationId, creditScope.workspaceId],
      ),
      /immutable/,
    );
    const badGenResponse = await fetch(jobUrl, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: generationInput("gen-bad-seam"),
    });
    assert.equal(
      badGenResponse.status,
      201,
      badGenResponse.status === 201 ? undefined : await badGenResponse.text(),
    );
    const badGen = (await badGenResponse.json()) as { id: string };
    assert.equal(await photocraftJobs.creditBalance(creditScope), 1);
    assert.equal(
      (
        (await (
          await fetch(jobUrl, {
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
            body: generationInput("gen-bad-seam"),
          })
        ).json()) as { id: string }
      ).id,
      badGen.id,
    );
    assert.equal(await photocraftJobs.creditBalance(creditScope), 1);
    const claimedBad = await photocraftJobs.claimNext();
    assert.equal(claimedBad?.id, badGen.id);
    await executePhotoCraftJob(claimedBad!, {
      assets,
      projects: photocraftProjects,
      jobs: photocraftJobs,
      cli: cliPath,
      workDir: tmpdir(),
      provider: {
        generate: async ({ image, rect }) => {
          const patch = await sharp({
            create: {
              width: rect[2],
              height: rect[3],
              channels: 3,
              background: "#061042",
            },
          })
            .png()
            .toBuffer();
          return await sharp(image)
            .composite([{ input: patch, left: rect[0], top: rect[1] }])
            .png()
            .toBuffer();
        },
      },
    });
    const rejected = await photocraftJobs.get(
      creditScope,
      jobProjectId,
      badGen.id,
    );
    assert.equal(rejected?.status, "failed", rejected?.errorCode ?? undefined);
    assert.equal(rejected.errorCode, "QUALITY_REJECTED");
    assert.equal(await photocraftJobs.creditBalance(creditScope), 2);
    assert.equal(
      (await photocraftProjects.get(creditScope, jobProjectId))?.version,
      16,
    );
    const goodGenResponse = await fetch(jobUrl, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: generationInput("gen-good-local"),
    });
    assert.equal(
      goodGenResponse.status,
      201,
      goodGenResponse.status === 201 ? undefined : await goodGenResponse.text(),
    );
    const claimedGood = await photocraftJobs.claimNext();
    assert.equal(claimedGood?.operation, "generate-local");
    await executePhotoCraftJob(claimedGood!, {
      assets,
      projects: photocraftProjects,
      jobs: photocraftJobs,
      cli: cliPath,
      workDir: tmpdir(),
      provider: {
        generate: async ({ image, rect, width, height }) => {
          const cx = rect[0] + Math.floor(rect[2] * 0.7),
            cy = rect[1] + Math.floor(rect[3] * 0.7);
          const overlay = Buffer.from(
            `<svg width="${width}" height="${height}"><ellipse cx="${cx}" cy="${cy}" rx="25" ry="22" fill="#061042"/></svg>`,
          );
          return await sharp(image)
            .composite([{ input: overlay, left: 0, top: 0 }])
            .png()
            .toBuffer();
        },
      },
    });
    const accepted = await photocraftJobs.get(
      creditScope,
      jobProjectId,
      claimedGood!.id,
    );
    assert.equal(
      accepted?.status,
      "succeeded",
      accepted?.errorCode ?? undefined,
    );
    assert.equal(accepted.outputVersion, 17);
    assert.equal(await photocraftJobs.creditBalance(creditScope), 1);
    const generatedSource = await photocraftProjects.readSource(
      creditScope,
      jobProjectId,
    );
    const generatedPath = join(jobFixtureDir!, "check-generated.pcraft");
    await writeFile(generatedPath, generatedSource!);
    const generatedInfo = JSON.parse(
      execFileSync(cliPath, ["info", generatedPath, "--compact"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 120_000,
      }),
    ) as {
      activeLayer: number;
      selectionBounds: number[] | null;
      layers: { id: number; hasMask: boolean }[];
    };
    assert.equal(generatedInfo.layers.length, 14);
    assert.equal(
      generatedInfo.layers.find(
        (layer) => layer.id === generatedInfo.activeLayer,
      )?.hasMask,
      true,
    );
    assert.ok(generatedInfo.selectionBounds);
    const ledger = await db.query<{ kind: string; amount: number }>(
      `SELECT kind,amount FROM workspace_credit_ledger WHERE job_id=$1 ORDER BY created_at`,
      [claimedGood!.id],
    );
    assert.deepEqual(ledger.rows.map((row) => row.kind).sort(), [
      "commit",
      "reserve",
    ]);
    const objectInput = JSON.stringify({
      expectedVersion: 17,
      operation: "generate-local",
      requestKey: "gen-object",
      params: {
        prompt: "Darken fabric",
        selection: { kind: "object", rect: [180, 180, 850, 850] },
        edgeFeather: 3,
      },
    });
    const objectResponse = await fetch(jobUrl, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: objectInput,
    });
    assert.equal(
      objectResponse.status,
      201,
      objectResponse.status === 201 ? undefined : await objectResponse.text(),
    );
    const objectJob = await photocraftJobs.claimNext();
    await executePhotoCraftJob(objectJob!, {
      assets,
      projects: photocraftProjects,
      jobs: photocraftJobs,
      cli: cliPath,
      workDir: tmpdir(),
      provider: {
        generate: async ({ image, rect, width, height }) => {
          const overlay = Buffer.from(
            `<svg width="${width}" height="${height}"><ellipse cx="${rect[0] + 420}" cy="${rect[1] + 420}" rx="100" ry="90" fill="#08163d"/></svg>`,
          );
          return await sharp(image)
            .composite([{ input: overlay, left: 0, top: 0 }])
            .png()
            .toBuffer();
        },
      },
    });
    const objectResult = await photocraftJobs.get(
      creditScope,
      jobProjectId,
      objectJob!.id,
    );
    assert.equal(
      objectResult?.status,
      "succeeded",
      objectResult?.errorCode ?? undefined,
    );
    assert.equal(objectResult.outputVersion, 18);
  }
  if (jobFixtureDir) {
    if (
      dirname(resolve(jobFixtureDir)) !== resolve(tmpdir()) ||
      !basename(jobFixtureDir).startsWith("acs-pc-http-test-")
    )
      throw new Error("Unsafe test fixture path");
    await rm(jobFixtureDir, { recursive: true, force: true });
  }

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
    "PASS: HTTP auth before upload, early size rejection, tenant scope, legacy import, PhotoCraft source/version/replay, edit job auth/idempotency and CLI worker (when installed), original immutability, read-only role, stale write and revocation",
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
