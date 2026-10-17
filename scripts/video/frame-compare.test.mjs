// ADR 0003 §2.5：确定性校验比较「解码后的帧」，不是容器字节——
// 容器元数据可能在逐帧等像素的两次渲染间不同。本测试钉死该口径：
//  1) 同像素、不同 PNG 元数据 → 解码哈希必须相等（旧口径=文件字节哈希会误报）；
//  2) 不同像素 → 解码哈希必须不等；
//  3) 解码失败要给出可读错误。

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { decodeFrameHash } from "./frame-compare.mjs";

const WORKDIR = mkdtempSync(path.join(tmpdir(), "acs-frame-compare-"));

test.after(() => rmSync(WORKDIR, { recursive: true, force: true }));

function fileByteHash(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

// 生成一张非平凡内容的 PNG（testsrc2 有渐变+彩条，避免纯色帧掩盖差异）。
// lavfi 语法：滤镜名与首个选项之间的分隔符必须是「=」，后续选项才用「:」。
function makePng(name, filter) {
  const target = path.join(WORKDIR, name);
  const result = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      filter,
      "-frames:v",
      "1",
      "-y",
      target,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    assert.fail(`生成测试 PNG 失败: ${result.stderr}`);
  }
  return target;
}

// PNG CRC-32（IEEE，reflected，与 zlib 同款）——插入 tEXt 块需要正确的 CRC。
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function pngCrc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// 在 IEND 前插入 tEXt 辅助块：像素数据不动，容器字节变化。
function withTextChunk(source, target, keyword, value) {
  const png = readFileSync(source);
  const iendOffset = png.lastIndexOf("IEND") - 4; // IEND 块从长度字段算起
  const type = Buffer.from("tEXt", "ascii");
  const data = Buffer.from(`${keyword}\0${value}`, "latin1");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc32(Buffer.concat([type, data])));
  const chunk = Buffer.concat([length, type, data, crc]);
  const variant = Buffer.concat([
    png.subarray(0, iendOffset),
    chunk,
    png.subarray(iendOffset),
  ]);
  writeFileSync(target, variant);
  return target;
}

test("同像素、不同 PNG 元数据 → 解码哈希相等，容器字节哈希不等", () => {
  const base = makePng("base.png", "testsrc2=size=64x48");
  const variant = withTextChunk(
    base,
    path.join(WORKDIR, "variant.png"),
    "Comment",
    "render-run-b",
  );
  assert.notEqual(fileByteHash(base), fileByteHash(variant)); // 旧口径会误报差异
  assert.equal(decodeFrameHash(base), decodeFrameHash(variant)); // 新口径：等像素
});

test("不同像素（同尺寸）→ 解码哈希不等", () => {
  const red = makePng("red.png", "color=c=0x992222:size=64x48");
  const blue = makePng("blue.png", "color=c=0x224499:size=64x48");
  assert.notEqual(decodeFrameHash(red), decodeFrameHash(blue));
});

test("解码失败给出含路径的可读错误", () => {
  const missing = path.join(WORKDIR, "no-such-frame.png");
  assert.throws(() => decodeFrameHash(missing), /no-such-frame|解码失败/);
});
