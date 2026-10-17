// C 项（第六轮整改）单测：候选像素蒙版的浏览器侧解码守卫。decodeMaskPng 在
// 确认候选 → 上传 /v1/selection-mask 之前执行：严格 base64、PNG 魔数、IHDR
// 宽高必须能读出且为正——任何结构可疑都返回 null，确认环退回轮廓套索，坏
// 蒙版不阻塞预览。MASK_THRESHOLD 与 provider 蒙版解码（红通道 ≥128）同口径。
import assert from "node:assert/strict";
import test from "node:test";
import zlib from "node:zlib";
import {
  binarizeMaskPixels,
  decodeMaskPng,
  MASK_THRESHOLD,
  shouldRetryCandidateMaskAsOutline,
} from "./candidate-mask";

// ---- 最小 PNG 构造（与 grounding-contract.test.mjs 同法：node zlib + CRC32）----

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const byte of bytes)
    c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function makeMaskPng(width: number, height: number) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth；压缩/滤波/隔行保持 0
  ihdr[9] = 0; // 灰度
  const raw = Buffer.alloc(height * (1 + width));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

test("decodeMaskPng: 合法灰度 PNG 往返（base64 → 字节 + IHDR 宽高）", () => {
  const decoded = decodeMaskPng(makeMaskPng(1024, 768).toString("base64"));
  assert.notEqual(decoded, null);
  assert.equal(decoded?.width, 1024);
  assert.equal(decoded?.height, 768);
  assert.equal(decoded?.bytes.length > 26, true);
});

test("decodeMaskPng: 非法 base64 字符 / 非 4 倍长 / 空串 → null", () => {
  assert.equal(decodeMaskPng("!!!not-base64!!!"), null);
  assert.equal(decodeMaskPng("abc"), null); // 长度非 4 的倍数
  assert.equal(decodeMaskPng(""), null);
  assert.equal(decodeMaskPng(undefined), null);
  assert.equal(decodeMaskPng(12345), null);
});

test("decodeMaskPng: 合法 base64 但不是 PNG / 头截断 → null", () => {
  assert.equal(
    decodeMaskPng(Buffer.from("not-a-png").toString("base64")),
    null,
  );
  const truncated = makeMaskPng(64, 32).subarray(0, 20);
  assert.equal(decodeMaskPng(truncated.toString("base64")), null);
});

test("decodeMaskPng: IHDR 宽高非法（0）→ null", () => {
  const png = makeMaskPng(16, 16);
  png.writeUInt32BE(0, 16); // 宽置 0
  assert.equal(decodeMaskPng(png.toString("base64")), null);
});

test("MASK_THRESHOLD: 与 provider 蒙版解码同口径（128）", () => {
  assert.equal(MASK_THRESHOLD, 128);
});

test("binarizeMaskPixels: 阈值两侧写回纯黑白且保持不透明", () => {
  const data = new Uint8ClampedArray([127, 127, 127, 255, 128, 128, 128, 255]);
  assert.equal(binarizeMaskPixels(data), 1);
  assert.deepEqual([...data], [0, 0, 0, 255, 255, 255, 255, 255]);
});

test("shouldRetryCandidateMaskAsOutline: 只对蒙版错误且轮廓有效时重试", () => {
  assert.equal(
    shouldRetryCandidateMaskAsOutline("候选蒙版尺寸与文档不一致", 3),
    true,
  );
  assert.equal(shouldRetryCandidateMaskAsOutline("候选蒙版已失效", 2), false);
  assert.equal(
    shouldRetryCandidateMaskAsOutline("编辑计划或选区参数无效", 3),
    false,
  );
});
