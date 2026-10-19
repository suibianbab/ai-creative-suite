// P2.5-T2 GET 文件路由：形状门 400、original 命中 200、proxy 回退、404、
// Range 206。params 是 Promise（Next 16），直接构造 ctx。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ingestMediaFile } from "@acs/media-store";
import { GET } from "./route";

const WORK = mkdtempSync(path.join(tmpdir(), "acs-get-test-"));

async function get(
  storeKey: string,
  headers?: Record<string, string>,
): Promise<Response> {
  return GET(
    new Request(`http://localhost:3210/api/media/file/${storeKey}`, {
      headers,
    }),
    {
      params: Promise.resolve({ storeKey }),
    },
  );
}

test("形状非法 storeKey → 400；合法形状但仓内无文件 → 404", async () => {
  assert.equal((await get("../evil.mp4")).status, 400);
  assert.equal((await get("cccccccccccccccc.mp4")).status, 404);
});

test("original 命中 → 200 正确 Content-Type 与字节一致；Range → 206 分片；proxy 回退命中", async () => {
  const previousStore = process.env.ACS_MEDIA_STORE;
  const store = mkdtempSync(path.join(tmpdir(), "acs-get-store-"));
  process.env.ACS_MEDIA_STORE = store;
  try {
    const file = path.join(WORK, "src.mp4");
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
    const result = await ingestMediaFile({
      bytes: readFileSync(file),
      fileName: "src.mp4",
      root: store,
    });
    assert.ok(result.ok);
    const storeKey = result.asset.original.storeKey;

    const full = await get(storeKey);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("content-type"), "video/mp4");
    assert.equal(full.headers.get("accept-ranges"), "bytes");
    const disk = readFileSync(path.join(store, "original", storeKey));
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), disk);

    const partial = await get(storeKey, { range: "bytes=0-99" });
    assert.equal(partial.status, 206);
    assert.equal(
      partial.headers.get("content-range"),
      `bytes 0-99/${disk.byteLength}`,
    );
    assert.equal((await partial.arrayBuffer()).byteLength, 100);

    // proxy 回退：删掉 original，仅留 proxy → 仍 200（T3 预览素材缺失降级依赖）
    rmSync(path.join(store, "original", storeKey));
    mkdirSync(path.join(store, "proxy"), { recursive: true });
    writeFileSync(
      path.join(store, "proxy", `${storeKey.slice(0, 16)}.proxy.mp4`),
      Buffer.from("proxy-bytes"),
    );
    const fallback = await get(storeKey);
    assert.equal(fallback.status, 200);
    assert.deepEqual(
      Buffer.from(await fallback.arrayBuffer()),
      Buffer.from("proxy-bytes"),
    );
  } finally {
    if (previousStore === undefined) delete process.env.ACS_MEDIA_STORE;
    else process.env.ACS_MEDIA_STORE = previousStore;
  }
});

// —— P2.5-T3 P5：?variant=proxy 代理优先（预览 src 用，≤1280 浏览器安全 codec）——

async function getWithQuery(
  storeKey: string,
  query: string,
): Promise<Response> {
  return GET(
    new Request(`http://localhost:3210/api/media/file/${storeKey}${query}`),
    { params: Promise.resolve({ storeKey }) },
  );
}

test("P5：variant=proxy → proxy 优先命中；proxy 文件被删 → 回退 original 200（不是 404）；缺省行为不变", async () => {
  const previousStore = process.env.ACS_MEDIA_STORE;
  const store = mkdtempSync(path.join(tmpdir(), "acs-get-proxy-variant-"));
  process.env.ACS_MEDIA_STORE = store;
  try {
    const file = path.join(WORK, "src.mp4");
    if (!existsSync(file)) {
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
    }
    const result = await ingestMediaFile({
      bytes: readFileSync(file),
      fileName: "src.mp4",
      root: store,
    });
    assert.ok(result.ok);
    const storeKey = result.asset.original.storeKey;
    mkdirSync(path.join(store, "proxy"), { recursive: true });
    const proxyFile = path.join(
      store,
      "proxy",
      `${storeKey.slice(0, 16)}.proxy.mp4`,
    );
    writeFileSync(proxyFile, Buffer.from("proxy-bytes"));

    const byVariant = await getWithQuery(storeKey, "?variant=proxy");
    assert.equal(byVariant.status, 200);
    assert.equal(byVariant.headers.get("content-type"), "video/mp4");
    assert.deepEqual(
      Buffer.from(await byVariant.arrayBuffer()),
      Buffer.from("proxy-bytes"),
    );

    // 缺省（无 variant）→ original 优先不变（X：既有行为逐字节保持）
    const byDefault = await getWithQuery(storeKey, "");
    assert.deepEqual(
      Buffer.from(await byDefault.arrayBuffer()),
      readFileSync(path.join(store, "original", storeKey)),
    );

    // proxy 被删 → variant 回退 original 200（Review Focus #1）
    rmSync(proxyFile);
    const fallback = await getWithQuery(storeKey, "?variant=proxy");
    assert.equal(fallback.status, 200);
    assert.deepEqual(
      Buffer.from(await fallback.arrayBuffer()),
      readFileSync(path.join(store, "original", storeKey)),
    );
  } finally {
    if (previousStore === undefined) delete process.env.ACS_MEDIA_STORE;
    else process.env.ACS_MEDIA_STORE = previousStore;
  }
});
