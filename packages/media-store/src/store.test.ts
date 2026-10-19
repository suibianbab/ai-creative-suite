// P2.5-T2 S 表：仓布局推导、storeKey 形状门（防穿越）、env 门、原子落盘幂等。
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  originalPath,
  proxyPath,
  resolveStoreRoot,
  storeKeyFor,
  writeAtomically,
} from "./store.js";

const SHA = "a".repeat(64);
const ROOT = mkdtempSync(path.join(tmpdir(), "acs-store-test-"));

test("storeKeyFor 取 sha256 前 16 位 + 扩展名", () => {
  assert.equal(storeKeyFor(SHA, "mp4"), "aaaaaaaaaaaaaaaa.mp4");
  assert.equal(storeKeyFor(SHA, "webm"), "aaaaaaaaaaaaaaaa.webm");
});

test("originalPath/proxyPath 布局：original/<storeKey> 与 proxy/<stem>.proxy.mp4", () => {
  const key = storeKeyFor(SHA, "mp4");
  assert.equal(
    originalPath(ROOT, key),
    path.join(ROOT, "original", "aaaaaaaaaaaaaaaa.mp4"),
  );
  assert.equal(
    proxyPath(ROOT, key),
    path.join(ROOT, "proxy", "aaaaaaaaaaaaaaaa.proxy.mp4"),
  );
});

test("storeKey 形状门：穿越与非法形状 throw（S4 前置）", () => {
  for (const bad of [
    "../aaaaaaaaaaaaaaaa.mp4",
    "..\\aaaaaaaaaaaaaaaa.mp4",
    "aaaaaaaaaaaaaaaA.mp4", // 大写 hex
    "aaaaaaaaaaaaaaaa.mp4x",
    "aaaaaaaaaaaaaaaa.gif",
    "aaaaaaaaaaaaaaaa",
    "",
  ]) {
    assert.throws(() => originalPath(ROOT, bad), /storeKey 形状非法/);
    assert.throws(() => proxyPath(ROOT, bad), /storeKey 形状非法/);
  }
});

test("resolveStoreRoot：env 绝对路径生效；相对路径大声拒绝（S2）；未设走默认", () => {
  const previous = process.env.ACS_MEDIA_STORE;
  try {
    process.env.ACS_MEDIA_STORE = path.join(ROOT, "env-store");
    assert.equal(resolveStoreRoot(), path.join(ROOT, "env-store"));
    process.env.ACS_MEDIA_STORE = "relative/dir";
    assert.throws(() => resolveStoreRoot(), /ACS_MEDIA_STORE 须为绝对路径/);
    delete process.env.ACS_MEDIA_STORE;
    const fallback = resolveStoreRoot();
    assert.ok(path.isAbsolute(fallback) && fallback.includes("media-store"));
  } finally {
    if (previous === undefined) delete process.env.ACS_MEDIA_STORE;
    else process.env.ACS_MEDIA_STORE = previous;
  }
});

test("writeAtomically：首写 written；同大小 reused 且文件未被重写；异大小大声失败（S3）", () => {
  const dest = originalPath(ROOT, storeKeyFor(SHA, "mp4"));
  const first = Buffer.from("content-addressed-bytes");
  assert.equal(writeAtomically(dest, first), "written");
  const mtimeBefore = statSync(dest).mtimeMs;
  assert.equal(writeAtomically(dest, first), "reused");
  assert.equal(statSync(dest).mtimeMs, mtimeBefore);
  assert.throws(
    () => writeAtomically(dest, Buffer.from("different-size")),
    /内容寻址冲突/,
  );
  assert.equal(readFileSync(dest).toString(), "content-addressed-bytes");
});

test("writeAtomically：写后无 .tmp 残留（目录内只有目标文件）", () => {
  const dir = path.join(ROOT, "residue-check");
  const dest = path.join(dir, "bbbbbbbbbbbbbbbb.mp4");
  writeAtomically(dest, Buffer.from("x"));
  assert.deepEqual(
    readdirSync(dir).filter((name) => name.endsWith(".tmp")),
    [],
  );
  assert.ok(existsSync(dest));
});
