// 任务 1（2026-10-28）图片入账测试：真实 ffmpeg 夹具（PNG/JPEG），
// 夹具做法与 ingest.test.ts 一致。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ingestMediaFile } from "./ingest.js";

const WORK = mkdtempSync(path.join(tmpdir(), "acs-ingest-img-"));

function fixture(name: string, args: string[]): Buffer {
  const file = path.join(WORK, name);
  const spawned = spawnSync(
    "ffmpeg",
    ["-v", "error", "-y", ...args, file],
    { encoding: "utf8" },
  );
  assert.equal(spawned.status, 0, spawned.stderr);
  return readFileSync(file);
}

function makePng(): Buffer {
  return fixture("fx.png", [
    "-f", "lavfi", "-i", "color=c=0x3f7f5f:s=320x240:d=1:r=24",
    "-frames:v", "1",
  ]);
}

function makeJpeg(): Buffer {
  return fixture("fx.jpg", [
    "-f", "lavfi", "-i", "color=c=0x7f3f5f:s=240x320:d=1:r=24",
    "-frames:v", "1",
  ]);
}

function storeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "acs-store-img-"));
  mkdirSync(path.join(root, "original"), { recursive: true });
  return root;
}

test("任务1：PNG 入账 → kind=image 资产（无视频字段，storeKey .png，仓内字节一致）", async () => {
  const bytes = makePng();
  const root = storeRoot();
  const result = await ingestMediaFile({
    bytes,
    fileName: "product.png",
    root,
  });
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  if (!result.ok) return;
  const o = result.asset.original as Record<string, unknown>;
  assert.equal(o.kind, "image");
  assert.equal(o.format, "png");
  assert.equal(o.width, 320);
  assert.equal(o.height, 240);
  assert.equal(o.durationMs, undefined);
  assert.equal(o.fps, undefined);
  assert.equal(o.codec, undefined);
  assert.equal(o.hasAudio, undefined);
  const sha = createHash("sha256").update(bytes).digest("hex");
  assert.equal(o.storeKey, `${sha.slice(0, 16)}.png`);
  const stored = readFileSync(path.join(root, "original", String(o.storeKey)));
  assert.equal(stored.byteLength, bytes.byteLength);
});

test("任务1：jpeg 文件名 → format=jpeg、storeKey 归一 .jpg", async () => {
  const bytes = makeJpeg();
  const root = storeRoot();
  const result = await ingestMediaFile({
    bytes,
    fileName: "photo.jpeg",
    root,
  });
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  if (!result.ok) return;
  const o = result.asset.original as Record<string, unknown>;
  assert.equal(o.format, "jpeg");
  assert.match(String(o.storeKey), /^[0-9a-f]{16}\.jpg$/);
});

test("任务1：损坏图片（PNG 魔数+垃圾）→ 明确拒绝且仓内无残留", async () => {
  const fake = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 1),
  ]);
  const root = storeRoot();
  const result = await ingestMediaFile({
    bytes: fake,
    fileName: "fake.png",
    root,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /解码|探测|损坏|无法/);
  assert.equal(readdirSync(path.join(root, "original")).length, 0);
});

test("任务1：gif 扩展 → 扩展名门拒绝（当前仅 png/jpg/webp + 视频系）", async () => {
  const root = storeRoot();
  const result = await ingestMediaFile({
    bytes: Buffer.alloc(32),
    fileName: "anim.gif",
    root,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /支持的媒体格式|仅支持/);
});
