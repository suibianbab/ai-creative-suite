// P2.5-T2 路由：直接调 POST handler（绕过 Next 服务器）。NODE_ENV 门、
// formData、错误映射（reasonCode → HTTP 码）。仓/临时用 tmp。
// NODE_ENV 只读绕行与 Uint8Array 构 File 沿 image-local-edit 测试先例。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { POST } from "./route";

const WORK = mkdtempSync(path.join(tmpdir(), "acs-route-test-"));
const mutableEnv = process.env as {
  NODE_ENV?: string;
  ACS_MEDIA_STORE?: string;
};

function makeVideoBytes(name: string): Uint8Array<ArrayBuffer> {
  const file = path.join(WORK, name);
  const spawned = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=duration=2:size=640x360:rate=24",
      "-pix_fmt",
      "yuv420p",
      file,
    ],
    { encoding: "utf8" },
  );
  assert.equal(spawned.status, 0, spawned.stderr);
  // 定长拷贝得 ArrayBuffer 背衬（Buffer 是 ArrayBufferLike，不合 BlobPart）
  const bytes = readFileSync(file);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

async function post(file: File): Promise<Response> {
  const form = new FormData();
  form.append("file", file);
  return await POST(
    new Request("http://localhost:3210/api/media/ingest", {
      method: "POST",
      body: form,
    }),
  );
}

test("NODE_ENV 门：非 development → 503", async () => {
  const previous = mutableEnv.NODE_ENV;
  mutableEnv.NODE_ENV = "production";
  try {
    const response = await post(
      new File([makeVideoBytes("gate.mp4")], "gate.mp4", { type: "video/mp4" }),
    );
    assert.equal(response.status, 503);
  } finally {
    if (previous === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previous;
  }
});

test("成功：development + 有效文件 → 200 {asset}；坏扩展 → 415；坏内容 → 422", async () => {
  const previousEnv = mutableEnv.NODE_ENV;
  const previousStore = mutableEnv.ACS_MEDIA_STORE;
  const store = mkdtempSync(path.join(tmpdir(), "acs-route-store-"));
  mutableEnv.NODE_ENV = "development";
  mutableEnv.ACS_MEDIA_STORE = store;
  try {
    const ok = await post(
      new File([makeVideoBytes("ok.mp4")], "ok.mp4", { type: "video/mp4" }),
    );
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as {
      asset: { assetId: string; original: { storeKey: string } };
    };
    assert.match(body.asset.assetId, /^[0-9a-f-]{36}$/);
    assert.match(body.asset.original.storeKey, /^[0-9a-f]{16}\.mp4$/);

    const badExt = await post(
      new File([new TextEncoder().encode("x")], "clip.gif", {
        type: "application/octet-stream",
      }),
    );
    assert.equal(badExt.status, 415);

    const badContent = await post(
      new File([new TextEncoder().encode("这不是视频")], "fake.mp4", {
        type: "video/mp4",
      }),
    );
    assert.equal(badContent.status, 422);
    // 失败两例不得新增仓文件：original/ 里只有成功用例的那一个文件
    assert.equal(
      readdirSync(path.join(store, "original")).length,
      1,
      "失败不得写仓",
    );
  } finally {
    if (previousEnv === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previousEnv;
    if (previousStore === undefined) delete mutableEnv.ACS_MEDIA_STORE;
    else mutableEnv.ACS_MEDIA_STORE = previousStore;
  }
});

test("缺 file 字段 → 400", async () => {
  const previous = mutableEnv.NODE_ENV;
  mutableEnv.NODE_ENV = "development";
  try {
    const form = new FormData();
    form.append("notfile", "x");
    const response = await POST(
      new Request("http://localhost:3210/api/media/ingest", {
        method: "POST",
        body: form,
      }),
    );
    assert.equal(response.status, 400);
  } finally {
    if (previous === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previous;
  }
});

test("origin 异源 → 403；content-length 超限 → 413（spec §4.11 全码位）", async () => {
  const previous = mutableEnv.NODE_ENV;
  mutableEnv.NODE_ENV = "development";
  try {
    const crossSiteForm = new FormData();
    crossSiteForm.append(
      "file",
      new File([new TextEncoder().encode("x")], "clip.mp4", {
        type: "video/mp4",
      }),
    );
    const crossSite = await POST(
      new Request("http://localhost:3210/api/media/ingest", {
        method: "POST",
        body: crossSiteForm,
        headers: { origin: "http://evil.example" },
      }),
    );
    assert.equal(crossSite.status, 403);

    const oversized = await POST(
      new Request("http://localhost:3210/api/media/ingest", {
        method: "POST",
        body: "x",
        headers: { "content-length": "500000001" },
      }),
    );
    assert.equal(oversized.status, 413);
  } finally {
    if (previous === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previous;
  }
});
