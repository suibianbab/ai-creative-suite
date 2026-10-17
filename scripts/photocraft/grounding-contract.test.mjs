// codex 第四轮 B 验收：用本地模拟服务注入缺高度、负宽框、越界/NaN、非法
// 轮廓、合法 no-regions、429 与非 2xx —— 前四类必须判坏响应，合法空候选
// 纳入评测分母，服务失败非零退出由 runner 的 errors→exitCode 承担（此处钉
// 死 fetchCandidates 的错误返回）。fixture 钉死测试直接读仓库真实标注集，
// 评测集被误删/改坏时这里先红。口径与 runner 共用 grounding-contract.mjs，
// 不存在第二套校验。
// 第六轮 C 项：候选必带真实像素蒙版 mask_png_b64（严格 base64 → 8bit 灰度
// PNG → IHDR 宽高==返回图），缺失/坏结构/尺寸漂移一律坏响应——否则
// IMG-053 会对「mask 被剥掉」的回归放行。

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { join, resolve } from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import {
  fetchCandidates,
  parseGrayscalePngHeader,
  parseImageSize,
  validateAnnotations,
  validateCandidatesResponse,
} from "./grounding-contract.mjs";
import { evaluateGrounding } from "./grounding-metrics.mjs";

// ---- 最小 PNG 构造（node zlib + CRC32，无外部依赖）------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/**
 * 构造最小灰度 PNG（全零像素）：签名 + IHDR(8bit) + 单 IDAT + IEND。
 * colorType 可覆写用于构造非法头（如 RGB=2）。
 */
function makeMaskPng(width, height, colorType = 0) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth；压缩/滤波/隔行保持 0
  ihdr[9] = colorType;
  const channels = colorType === 2 ? 3 : 1;
  const raw = Buffer.alloc(height * (1 + width * channels));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const maskPngB64 = (width, height, colorType) =>
  makeMaskPng(width, height, colorType).toString("base64");

const GOOD_CANDIDATE = {
  index: 1,
  score: 0.62,
  clip_score: 0.31,
  bounds: [100, 80, 220, 160],
  outline: [
    [100, 80],
    [200, 80],
    [200, 240],
    [100, 240],
  ],
  mask_png_b64: maskPngB64(1024, 768),
  area_ratio: 0.05,
};
const GOOD_RESPONSE = {
  phrase: "屋顶",
  width: 1024,
  height: 768,
  candidates: [GOOD_CANDIDATE],
  took_ms: 1234,
};

test("validateCandidatesResponse: 正常响应通过", () => {
  const verdict = validateCandidatesResponse(GOOD_RESPONSE);
  assert.equal(verdict.ok, true);
});

test("validateCandidatesResponse: 合法 no-regions（宽高 + 空候选）通过，且只认这种空", () => {
  const verdict = validateCandidatesResponse({
    candidates: [],
    reason: "no-regions",
    width: 1024,
    height: 768,
    took_ms: 50,
  });
  assert.equal(verdict.ok, true);
  // no-regions 但候选非空 / 未知 reason → 坏响应
  assert.equal(
    validateCandidatesResponse({
      ...GOOD_RESPONSE,
      reason: "no-regions",
    }).ok,
    false,
  );
  assert.equal(
    validateCandidatesResponse({ ...GOOD_RESPONSE, reason: "other" }).ok,
    false,
  );
});

test("validateCandidatesResponse: 缺 height / 缺 width → 坏响应（不再静默变空候选）", () => {
  const { height, ...noHeight } = GOOD_RESPONSE;
  assert.equal(height, 768);
  const v1 = validateCandidatesResponse(noHeight);
  assert.equal(v1.ok, false);
  assert.match(v1.error, /height/);
  const { width, ...noWidth } = GOOD_RESPONSE;
  const v2 = validateCandidatesResponse(noWidth);
  assert.equal(v2.ok, false);
  assert.match(v2.error, /width/);
});

test("validateCandidatesResponse: 负宽框 / 越界框 → 坏响应", () => {
  const negative = validateCandidatesResponse({
    ...GOOD_RESPONSE,
    candidates: [{ ...GOOD_CANDIDATE, bounds: [100, 80, -220, 160] }],
  });
  assert.equal(negative.ok, false);
  assert.match(negative.error, /宽高须为正/);
  const beyond = validateCandidatesResponse({
    ...GOOD_RESPONSE,
    candidates: [{ ...GOOD_CANDIDATE, bounds: [900, 700, 220, 160] }],
  });
  assert.equal(beyond.ok, false);
  assert.match(beyond.error, /超出返回图尺寸/);
});

test("validateCandidatesResponse: score 缺失 / 越界 / 非数值 → 坏响应", () => {
  const { score, ...noScore } = GOOD_CANDIDATE;
  for (const badScore of [undefined, 1.5, -0.1, "0.6"]) {
    const verdict = validateCandidatesResponse({
      ...GOOD_RESPONSE,
      candidates: [
        { ...noScore, ...(badScore === undefined ? {} : { score: badScore }) },
      ],
    });
    assert.equal(verdict.ok, false, `score=${badScore} 应判坏`);
    assert.match(verdict.error, /score/);
  }
});

test("validateCandidatesResponse: 非法 outline（短点/越界点/缺 outline）→ 坏响应", () => {
  const shortPoint = validateCandidatesResponse({
    ...GOOD_RESPONSE,
    candidates: [{ ...GOOD_CANDIDATE, outline: [[100, 80], [200]] }],
  });
  assert.equal(shortPoint.ok, false);
  assert.match(shortPoint.error, /outline/);
  const beyondPoint = validateCandidatesResponse({
    ...GOOD_RESPONSE,
    candidates: [
      {
        ...GOOD_CANDIDATE,
        outline: [
          [100, 80],
          [2000, 80],
        ],
      },
    ],
  });
  assert.equal(beyondPoint.ok, false);
  assert.match(beyondPoint.error, /outline/);
  const { outline, ...noOutline } = GOOD_CANDIDATE;
  assert.equal(outline.length, 4);
  const missing = validateCandidatesResponse({
    ...GOOD_RESPONSE,
    candidates: [noOutline],
  });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /outline/);
});

test("validateCandidatesResponse: mask_png_b64 合法（8bit 灰度 PNG 且 IHDR==返回图）→ 通过", () => {
  const verdict = validateCandidatesResponse(GOOD_RESPONSE);
  assert.equal(verdict.ok, true);
  assert.deepEqual(
    parseGrayscalePngHeader(Buffer.from(GOOD_CANDIDATE.mask_png_b64, "base64")),
    { width: 1024, height: 768 },
  );
});

test("validateCandidatesResponse: mask 缺失 → 坏响应（正常候选必带真实像素蒙版）", () => {
  const { mask_png_b64, ...noMask } = GOOD_CANDIDATE;
  assert.equal(typeof mask_png_b64, "string");
  const verdict = validateCandidatesResponse({
    ...GOOD_RESPONSE,
    candidates: [noMask],
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.error, /mask_png_b64 缺失/);
});

test("validateCandidatesResponse: mask IHDR 尺寸与返回图不一致 → 坏响应", () => {
  const verdict = validateCandidatesResponse({
    ...GOOD_RESPONSE,
    candidates: [{ ...GOOD_CANDIDATE, mask_png_b64: maskPngB64(512, 768) }],
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.error, /不一致/);
});

test("validateCandidatesResponse: 合法 base64 但不是 PNG → 坏响应", () => {
  const verdict = validateCandidatesResponse({
    ...GOOD_RESPONSE,
    candidates: [
      {
        ...GOOD_CANDIDATE,
        mask_png_b64: Buffer.from("not-a-png").toString("base64"),
      },
    ],
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.error, /不是 8bit 灰度 PNG/);
});

test("validateCandidatesResponse: 非法 base64 字符 → 坏响应（Buffer.from 会宽容丢弃，正则先拦）", () => {
  const verdict = validateCandidatesResponse({
    ...GOOD_RESPONSE,
    candidates: [{ ...GOOD_CANDIDATE, mask_png_b64: "!!!not-base64!!!" }],
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.error, /不是合法 base64/);
});

test("validateCandidatesResponse: RGB PNG（color type 2）→ 坏响应（契约只认单通道灰度）", () => {
  const rgb = makeMaskPng(1024, 768, 2);
  assert.equal(parseGrayscalePngHeader(rgb), null);
  const verdict = validateCandidatesResponse({
    ...GOOD_RESPONSE,
    candidates: [{ ...GOOD_CANDIDATE, mask_png_b64: rgb.toString("base64") }],
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.error, /不是 8bit 灰度 PNG/);
});

test("validateCandidatesResponse: 合法 no-regions 不带 mask 字段仍通过（无候选可带）", () => {
  const verdict = validateCandidatesResponse({
    candidates: [],
    reason: "no-regions",
    width: 1024,
    height: 768,
    took_ms: 50,
  });
  assert.equal(verdict.ok, true);
});

// ---- 本地模拟服务注入 ------------------------------------------------------

function startMockServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolveServer) =>
    server.listen(0, "127.0.0.1", () =>
      resolveServer({
        server,
        base: `http://127.0.0.1:${server.address().port}`,
      }),
    ),
  );
}

function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    ...headers,
  });
  res.end(body);
}

async function withMock(handler, fn) {
  const { server, base } = await startMockServer(handler);
  try {
    return await fn(base);
  } finally {
    await new Promise((closed) => server.close(closed));
  }
}

const POST_ARGS = {
  imageBytes: Buffer.from("fake-image"),
  contentType: "image/png",
  phrase: "屋顶",
};

test("fetchCandidates: 正常响应 → 返回 response", async () => {
  await withMock(
    (req, res) => json(res, 200, GOOD_RESPONSE),
    async (base) => {
      const result = await fetchCandidates({ base, ...POST_ARGS });
      assert.equal(result.error, undefined);
      assert.equal(result.response.width, 1024);
      assert.equal(result.response.candidates.length, 1);
    },
  );
});

test("fetchCandidates: 缺 height 的 200 响应 → 错误（而非静默空候选 + exit 0）", async () => {
  const { height, ...noHeight } = GOOD_RESPONSE;
  assert.equal(height, 768);
  await withMock(
    (req, res) => json(res, 200, noHeight),
    async (base) => {
      const result = await fetchCandidates({ base, ...POST_ARGS });
      assert.match(result.error, /响应不合规.*height/);
    },
  );
});

test("fetchCandidates: 负宽框 / score 越界 / 非法轮廓 / mask 缺失 → 错误", async () => {
  const { mask_png_b64, ...noMask } = GOOD_CANDIDATE;
  assert.equal(typeof mask_png_b64, "string");
  const cases = [
    [{ ...GOOD_CANDIDATE, bounds: [100, 80, -220, 160] }, /宽高须为正/],
    [{ ...GOOD_CANDIDATE, score: 1.2 }, /score/],
    [{ ...GOOD_CANDIDATE, outline: [[100, 80], [200]] }, /outline/],
    [noMask, /mask_png_b64 缺失/],
  ];
  for (const [candidate, pattern] of cases) {
    await withMock(
      (req, res) =>
        json(res, 200, { ...GOOD_RESPONSE, candidates: [candidate] }),
      async (base) => {
        const result = await fetchCandidates({ base, ...POST_ARGS });
        assert.match(result.error, pattern);
      },
    );
  }
});

test("fetchCandidates: 合法 no-regions → 成功返回空候选，且计入评测分母", async () => {
  await withMock(
    (req, res) =>
      json(res, 200, {
        candidates: [],
        reason: "no-regions",
        width: 1024,
        height: 768,
        took_ms: 12,
      }),
    async (base) => {
      const result = await fetchCandidates({ base, ...POST_ARGS });
      assert.equal(result.error, undefined);
      assert.equal(result.response.reason, "no-regions");
      // 合法空候选进分母：无候选率按 1/1 计，而不是把目标剔除
      const report = evaluateGrounding([
        {
          image: "x.jpg",
          domain: "pet",
          phrase: "猫",
          gtBoxes: [[0.3, 0.3, 0.4, 0.4]],
          candidates: [],
        },
      ]);
      assert.equal(report.total, 1);
      assert.equal(report.overall.noCandidateRate, 1);
    },
  );
});

test("fetchCandidates: 429 按 Retry-After 退避后成功", async () => {
  let calls = 0;
  await withMock(
    (req, res) => {
      calls += 1;
      if (calls === 1) {
        json(res, 429, { error: "busy" }, { "retry-after": "0" });
        return;
      }
      json(res, 200, GOOD_RESPONSE);
    },
    async (base) => {
      const result = await fetchCandidates({ base, ...POST_ARGS });
      assert.equal(result.error, undefined);
      assert.equal(calls, 2);
    },
  );
});

test("fetchCandidates: 持续 429 → 错误；非 2xx → 错误；坏 JSON → 错误", async () => {
  await withMock(
    (req, res) => json(res, 429, { error: "busy" }, { "retry-after": "0" }),
    async (base) => {
      const result = await fetchCandidates({ base, ...POST_ARGS });
      assert.match(result.error, /429|繁忙/);
    },
  );
  await withMock(
    (req, res) => json(res, 500, { error: "boom" }),
    async (base) => {
      const result = await fetchCandidates({ base, ...POST_ARGS });
      assert.match(result.error, /500/);
    },
  );
  await withMock(
    (req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("not-json{");
    },
    async (base) => {
      const result = await fetchCandidates({ base, ...POST_ARGS });
      assert.match(result.error, /JSON/);
    },
  );
});

// ---- fixture 完整性钉死（读仓库真实标注集）--------------------------------

const FIXTURE_DIR = resolve(
  import.meta.dirname,
  "../../qa/fixtures/photocraft-grounding",
);

test("validateAnnotations: 仓库真实标注集完整（11 图 / 36 目标 / 37 框 / 来源全覆盖）", async () => {
  const annotations = JSON.parse(
    await readFile(join(FIXTURE_DIR, "annotations.json"), "utf8"),
  );
  const provenance = JSON.parse(
    await readFile(join(FIXTURE_DIR, "provenance.json"), "utf8"),
  );
  const verdict = validateAnnotations(annotations, provenance);
  assert.deepEqual(verdict.errors, []);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.images, 11);
  assert.equal(verdict.targets, 36);
  assert.equal(verdict.boxes, 37);
});

test("validateAnnotations: 框越界 / 尺寸非法 / 来源缺失 / 评测集为空 → 失败", () => {
  const base = {
    schemaVersion: 1,
    hitIoUThreshold: 0.5,
    domains: { pet: "宠物" },
    images: [
      {
        image: "cat.jpg",
        domain: "pet",
        width: 100,
        height: 100,
        targets: [{ phrase: "猫", boxes: [[0.2, 0.2, 0.7, 0.7]] }],
      },
    ],
  };
  const ok = validateAnnotations(base, { "cat.jpg": {} });
  assert.equal(ok.ok, true);
  const beyond = validateAnnotations(
    {
      ...base,
      images: [
        {
          ...base.images[0],
          targets: [{ phrase: "猫", boxes: [[0.5, 0.5, 0.8, 0.8]] }],
        },
      ],
    },
    { "cat.jpg": {} },
  );
  assert.equal(beyond.ok, false);
  assert.match(beyond.errors[0], /超出归一化范围/);
  const noProvenance = validateAnnotations(base, {});
  assert.equal(noProvenance.ok, false);
  assert.match(noProvenance.errors[0], /provenance 缺来源记录/);
  const badDims = validateAnnotations(
    {
      ...base,
      images: [{ ...base.images[0], width: 0 }],
    },
    { "cat.jpg": {} },
  );
  assert.equal(badDims.ok, false);
  assert.match(badDims.errors[0], /宽高非法/);
  const empty = validateAnnotations({ ...base, images: [] }, {});
  assert.equal(empty.ok, false);
  assert.match(empty.errors[0], /images 为空/);
});

test("parseImageSize: PNG IHDR / JPEG SOFn 宽高", () => {
  const png = Buffer.alloc(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  png.writeUInt32BE(13, 8);
  png.write("IHDR", 12, "ascii");
  png.writeUInt32BE(1280, 16);
  png.writeUInt32BE(960, 20);
  assert.deepEqual(parseImageSize(png), { width: 1280, height: 960 });
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x08, 0x08, 0x03, 0xc0, 0x05, 0x00,
  ]);
  assert.deepEqual(parseImageSize(jpeg), { width: 1280, height: 960 });
  assert.equal(parseImageSize(Buffer.from([0x00, 0x01])), null);
});

test("validateCandidatesResponse: sam_score 合法通过 / 越界或非数值 → 坏响应", () => {
  const withSam = {
    ...GOOD_RESPONSE,
    candidates: [{ ...GOOD_CANDIDATE, sam_score: 0.8731 }],
  };
  assert.equal(validateCandidatesResponse(withSam).ok, true);
  for (const bad of [1.5, -0.1, "0.8", null]) {
    const verdict = validateCandidatesResponse({
      ...GOOD_RESPONSE,
      candidates: [{ ...GOOD_CANDIDATE, sam_score: bad }],
    });
    assert.equal(verdict.ok, false, `sam_score=${JSON.stringify(bad)}`);
    assert.match(verdict.error, /sam_score/);
  }
});

test("validateCandidatesResponse: rank 声明 clip/ensemble 通过 / 其它值 → 坏响应", () => {
  assert.equal(
    validateCandidatesResponse({ ...GOOD_RESPONSE, rank: "ensemble" }).ok,
    true,
  );
  assert.equal(
    validateCandidatesResponse({ ...GOOD_RESPONSE, rank: "clip" }).ok,
    true,
  );
  const verdict = validateCandidatesResponse({
    ...GOOD_RESPONSE,
    rank: "weighted",
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.error, /rank/);
});

test("fetchCandidates: 剔除点与重排序头按参数携带，缺省不携带", async () => {
  await withMock(
    (req, res) => {
      const captured = {
        exclude: req.headers["x-acs-exclude-points"],
        rank: req.headers["x-acs-rank"],
        box: req.headers["x-acs-prompt-box"],
      };
      json(res, 200, { ...GOOD_RESPONSE, rank: "ensemble", captured });
    },
    async (base) => {
      const withArgs = await fetchCandidates({
        base,
        ...POST_ARGS,
        promptBox: [0.1, 0.1, 0.6, 0.6],
        excludePoints: [
          [0.3, 0.4],
          [0.35, 0.42],
        ],
        rank: "ensemble",
      });
      assert.equal(withArgs.error, undefined);
      const sent = withArgs.response.captured;
      assert.equal(sent.rank, "ensemble");
      assert.equal(sent.box, JSON.stringify([0.1, 0.1, 0.6, 0.6]));
      assert.equal(
        sent.exclude,
        JSON.stringify([
          [0.3, 0.4],
          [0.35, 0.42],
        ]),
      );

      const without = await fetchCandidates({ base, ...POST_ARGS });
      assert.equal(without.error, undefined);
      const omitted = without.response.captured;
      assert.equal(omitted.exclude, undefined);
      assert.equal(omitted.rank, undefined);
      assert.equal(omitted.box, undefined);
    },
  );
});
