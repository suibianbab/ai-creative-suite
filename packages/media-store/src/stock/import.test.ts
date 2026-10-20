// P2.6-T5 P1-P6 下载核验编排单测：零网络、零 ffmpeg——fetchImpl 按调用序列
// 返回合成 JSON/字节流，ingest 用假实现返回构造好的 MediaAsset。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ReadableStream } from "node:stream/web";
import test from "node:test";
import type { MediaAsset } from "@acs/video-document";
import {
  type IngestReasonCode,
  type IngestResult,
  ingestMediaFile,
} from "../ingest.js";
import { originalPath, proxyPath, storeKeyFor } from "../store.js";
import { importStockCandidate } from "./import.js";
import { buildWikimediaVideoInfoUrl } from "./wikimedia.js";

const ORIGINAL_URL =
  "https://upload.wikimedia.org/wikipedia/commons/a/ab/Demo_clouds.webm";
const TRANSCODE_BASE =
  "https://upload.wikimedia.org/wikipedia/commons/transcoded/a/ab/Demo_clouds.webm";
const URL_720 = `${TRANSCODE_BASE}/Demo_clouds.webm.720p.vp9.webm`;
const PAGE_TITLE = "File:Demo clouds.webm";
const SOURCE_PAGE_URL =
  "https://commons.wikimedia.org/wiki/File:Demo_clouds.webm";
const FIXED_NOW = "2026-10-20T08:00:00.000Z";
const UA = "ACS-VideoStudio/0.1 (local development)";
const PAYLOAD = new TextEncoder().encode("FAKE-WEBM-PAYLOAD");
const PAYLOAD_KEY = storeKeyFor(
  createHash("sha256").update(PAYLOAD).digest("hex"),
  "webm",
);

type IngestInput = Parameters<typeof ingestMediaFile>[0];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// node:stream/web 的 ReadableStream 与 undici BodyInit 的泛型不变式在
// @types/node 22 下不兼容，运行时同物：此处只做类型桥接。
type ResponseBody = ConstructorParameters<typeof Response>[0];
function bodyOf(stream: ReadableStream<Uint8Array>): ResponseBody {
  return stream as unknown as ResponseBody;
}

function bytesResponse(
  chunks: Uint8Array[],
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(
    bodyOf(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
    ),
    { status, headers },
  );
}

// 每段延迟 delayMs 才产出；供空闲/总超时用例。
function slowResponse(chunks: Uint8Array[], delayMs: number): Response {
  let index = 0;
  return new Response(
    bodyOf(
      new ReadableStream<Uint8Array>({
        async pull(controller) {
          await sleep(delayMs);
          try {
            const chunk = chunks[index++];
            if (chunk === undefined) controller.close();
            else controller.enqueue(chunk);
          } catch {
            // 调用方已取消流：忽略
          }
        },
      }),
    ),
    { status: 200 },
  );
}

function videoInfo(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    size: 12_345_678,
    width: 1920,
    height: 1080,
    duration: 12.5,
    url: ORIGINAL_URL,
    descriptionurl: SOURCE_PAGE_URL,
    mime: "video/webm",
    extmetadata: {
      LicenseShortName: { value: "CC BY-SA 4.0" },
      Artist: {
        value:
          '<a href="//commons.wikimedia.org/wiki/User:Demo">Demo Author</a>',
      },
      LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" },
      AttributionRequired: { value: "true" },
    },
    derivatives: [
      {
        src: ORIGINAL_URL,
        type: 'video/webm; codecs="vp9, opus"',
        width: 1920,
        height: 1080,
        bandwidth: 2_000_000,
      },
      {
        src: URL_720,
        type: 'video/webm; codecs="vp9, opus"',
        transcodekey: "720p.vp9.webm",
        width: 1280,
        height: 720,
        bandwidth: 1_000_000,
      },
    ],
    ...overrides,
  };
}

function page(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    pageid: 1,
    ns: 6,
    title: PAGE_TITLE,
    videoinfo: [videoInfo()],
    ...overrides,
  };
}

function metadataResponse(pages: unknown[] = [page()]): Response {
  return json({ batchcomplete: "", query: { pages } });
}

function fetchSequence(factories: Array<() => Response | Promise<Response>>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    calls.push({ url, ...(init === undefined ? {} : { init }) });
    const factory = factories.shift();
    assert.ok(
      factory,
      `fetch 调用超出预期序列（第 ${calls.length} 次：${url}）`,
    );
    return factory();
  };
  return { fn, calls };
}

function assetFor(input: IngestInput): MediaAsset {
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  return {
    assetId: "11111111-2222-4333-8444-555555555555",
    createdAt: FIXED_NOW,
    origin: input.origin ?? {
      kind: "local-upload",
      fileName: input.fileName,
    },
    original: {
      sha256,
      bytes: input.bytes.byteLength,
      durationMs: 12_500,
      width: 1280,
      height: 720,
      fps: 25,
      codec: "vp9",
      hasAudio: false,
      storeKey: storeKeyFor(sha256, "webm"),
    },
  };
}

type IngestFake = {
  fn: typeof ingestMediaFile;
  calls: IngestInput[];
};

function makeIngest(
  options: {
    onCall?: (input: IngestInput) => void;
    mutateAsset?: (asset: MediaAsset) => MediaAsset;
  } = {},
): IngestFake {
  const calls: IngestInput[] = [];
  const fn: typeof ingestMediaFile = async (input) => {
    calls.push(input);
    options.onCall?.(input);
    const asset = assetFor(input);
    return {
      ok: true,
      asset: options.mutateAsset ? options.mutateAsset(asset) : asset,
    };
  };
  return { fn, calls };
}

function failingIngest(reasonCode: IngestReasonCode): typeof ingestMediaFile {
  return async () => ({
    ok: false,
    error: "假失败",
    reasonCode,
    cleanupDone: true,
  });
}

function tempParent(): string {
  return mkdtempSync(path.join(tmpdir(), "acs-stock-import-test-"));
}

function storeRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "acs-stock-import-root-"));
}

function downloadCalls(calls: Array<{ url: string }>): number {
  return calls.filter((call) => call.url === URL_720).length;
}

test("成功：重取元数据 → 下载 → ingest 收到 stock origin 与 .webm 文件名", async () => {
  const seq = fetchSequence([
    () => metadataResponse(),
    () => bytesResponse([PAYLOAD]),
  ]);
  const ingest = makeIngest();
  const parent = tempParent();
  const result = await importStockCandidate({
    pageTitle: PAGE_TITLE,
    derivativeUrl: URL_720,
    root: storeRoot(),
    fetchImpl: seq.fn,
    ingest: ingest.fn,
    now: () => FIXED_NOW,
    tempDir: parent,
  });

  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.equal(result.asset.assetId, "11111111-2222-4333-8444-555555555555");
  assert.equal(seq.calls.length, 2);
  const [metadataCall, downloadCall] = seq.calls;
  assert.ok(metadataCall);
  assert.ok(downloadCall);
  assert.equal(metadataCall.url, buildWikimediaVideoInfoUrl(PAGE_TITLE));
  assert.deepEqual(metadataCall.init?.headers, { "User-Agent": UA });
  assert.equal(downloadCall.url, URL_720);
  assert.equal(downloadCall.init?.redirect, "error");
  assert.deepEqual(downloadCall.init?.headers, { "User-Agent": UA });
  assert.ok(downloadCall.init?.signal);

  const [ingestCall] = ingest.calls;
  assert.ok(ingestCall);
  assert.deepEqual(ingestCall.origin, {
    kind: "stock-source",
    sourceId: "wikimedia",
    sourcePageUrl: SOURCE_PAGE_URL,
    license: {
      name: "CC BY-SA 4.0",
      author: "Demo Author",
      usageNote: "https://creativecommons.org/licenses/by-sa/4.0 · 须署名",
    },
    retrievedAt: FIXED_NOW,
  });
  assert.equal(ingestCall.fileName, "Demo clouds.webm");
  assert.deepEqual(Array.from(ingestCall.bytes), Array.from(PAYLOAD));
  // P6：临时工作目录已清理
  assert.deepEqual(readdirSync(parent), []);
});

test("非白名单 host：不触 fetch，unsupported 且消息含「素材来源无效」", async () => {
  const seq = fetchSequence([]);
  const result = await importStockCandidate({
    pageTitle: PAGE_TITLE,
    derivativeUrl: "https://evil.example.com/wikipedia/commons/x.webm",
    root: storeRoot(),
    fetchImpl: seq.fn,
    ingest: makeIngest().fn,
  });

  if (result.ok) assert.fail("应失败");
  assert.equal(result.reasonCode, "unsupported");
  assert.match(result.error, /素材来源无效/);
  assert.equal(result.cleanupDone, true);
  assert.equal(seq.calls.length, 0);
});

test("URL 不在重取档位中：只取一次元数据，unsupported 且消息含「该分辨率档位不属于此候选」", async () => {
  const seq = fetchSequence([() => metadataResponse()]);
  const result = await importStockCandidate({
    pageTitle: PAGE_TITLE,
    derivativeUrl: `${TRANSCODE_BASE}/Demo_clouds.webm.1080p.vp9.webm`,
    root: storeRoot(),
    fetchImpl: seq.fn,
    ingest: makeIngest().fn,
  });

  if (result.ok) assert.fail("应失败");
  assert.equal(result.reasonCode, "unsupported");
  assert.match(result.error, /该分辨率档位不属于此候选/);
  assert.equal(seq.calls.length, 1);
});

test("重取无许可：unlicensed，消息含「候选许可信息缺失」，不下载", async () => {
  const seq = fetchSequence([
    () =>
      metadataResponse([page({ videoinfo: [videoInfo({ extmetadata: {} })] })]),
  ]);
  const result = await importStockCandidate({
    pageTitle: PAGE_TITLE,
    derivativeUrl: URL_720,
    root: storeRoot(),
    fetchImpl: seq.fn,
    ingest: makeIngest().fn,
  });

  if (result.ok) assert.fail("应失败");
  assert.equal(result.reasonCode, "unlicensed");
  assert.match(result.error, /候选许可信息缺失/);
  assert.equal(result.cleanupDone, true);
  assert.equal(seq.calls.length, 1);
});

test("页面缺失（query.pages 空）：unsupported 且消息含「候选已不存在或不可用」", async () => {
  const seq = fetchSequence([() => metadataResponse([])]);
  const result = await importStockCandidate({
    pageTitle: PAGE_TITLE,
    derivativeUrl: URL_720,
    root: storeRoot(),
    fetchImpl: seq.fn,
    ingest: makeIngest().fn,
  });

  if (result.ok) assert.fail("应失败");
  assert.equal(result.reasonCode, "unsupported");
  assert.match(result.error, /候选已不存在或不可用/);
  assert.equal(seq.calls.length, 1);
});

test("Content-Length 超上限：too-large，临时目录已清理", async () => {
  const seq = fetchSequence([
    () => metadataResponse(),
    () => bytesResponse([PAYLOAD], 200, { "content-length": "2000" }),
  ]);
  const parent = tempParent();
  const result = await importStockCandidate({
    pageTitle: PAGE_TITLE,
    derivativeUrl: URL_720,
    root: storeRoot(),
    fetchImpl: seq.fn,
    ingest: makeIngest().fn,
    tempDir: parent,
    maxBytes: 1000,
  });

  if (result.ok) assert.fail("应失败");
  assert.equal(result.reasonCode, "too-large");
  assert.match(result.error, /素材过大/);
  assert.equal(result.cleanupDone, true);
  assert.deepEqual(readdirSync(parent), []);
});

test("无 Content-Length 且两段累计超限：中止、too-large、临时目录已清理", async () => {
  const seq = fetchSequence([
    () => metadataResponse(),
    () =>
      bytesResponse([
        new TextEncoder().encode("123456"),
        new TextEncoder().encode("123456"),
      ]),
  ]);
  const parent = tempParent();
  const result = await importStockCandidate({
    pageTitle: PAGE_TITLE,
    derivativeUrl: URL_720,
    root: storeRoot(),
    fetchImpl: seq.fn,
    ingest: makeIngest().fn,
    tempDir: parent,
    maxBytes: 10,
  });

  if (result.ok) assert.fail("应失败");
  assert.equal(result.reasonCode, "too-large");
  assert.match(result.error, /素材过大/);
  assert.deepEqual(readdirSync(parent), []);
});

test("空闲超时：timeout，清理完成", async () => {
  const seq = fetchSequence([
    () => metadataResponse(),
    () => slowResponse([PAYLOAD], 100),
  ]);
  const parent = tempParent();
  const result = await importStockCandidate({
    pageTitle: PAGE_TITLE,
    derivativeUrl: URL_720,
    root: storeRoot(),
    fetchImpl: seq.fn,
    ingest: makeIngest().fn,
    tempDir: parent,
    idleTimeoutMs: 20,
  });

  if (result.ok) assert.fail("应失败");
  assert.equal(result.reasonCode, "timeout");
  assert.match(result.error, /下载超时（300s）：已清理临时文件，未发布素材。/);
  assert.equal(result.cleanupDone, true);
  assert.deepEqual(readdirSync(parent), []);
});

test("总超时：timeout，消息秒数按总超时向上取整到至少 1", async () => {
  const seq = fetchSequence([
    () => metadataResponse(),
    () =>
      slowResponse(
        [
          new TextEncoder().encode("aa"),
          new TextEncoder().encode("bb"),
          new TextEncoder().encode("cc"),
          new TextEncoder().encode("dd"),
        ],
        20,
      ),
  ]);
  const result = await importStockCandidate({
    pageTitle: PAGE_TITLE,
    derivativeUrl: URL_720,
    root: storeRoot(),
    fetchImpl: seq.fn,
    ingest: makeIngest().fn,
    totalTimeoutMs: 30,
  });

  if (result.ok) assert.fail("应失败");
  assert.equal(result.reasonCode, "timeout");
  assert.match(result.error, /下载超时（1s）：已清理临时文件，未发布素材。/);
  assert.equal(result.cleanupDone, true);
});

test("总超时跨重试：退避与第二次尝试共用注入预算，终态为 timeout", async () => {
  // 第一次 503 后固定退避 1s；第二次尝试只剩 ~150ms 预算，却被要求等 500ms
  // 才出首段字节——预算若按次重置，这里会成功（旧行为），共用预算则超时。
  const totalTimeoutMs = 1_150;
  const seq = fetchSequence([
    () => metadataResponse(),
    () => new Response(null, { status: 503 }),
    () => slowResponse([PAYLOAD], 500),
  ]);
  const startedAt = Date.now();
  const result = await importStockCandidate({
    pageTitle: PAGE_TITLE,
    derivativeUrl: URL_720,
    root: storeRoot(),
    fetchImpl: seq.fn,
    ingest: makeIngest().fn,
    totalTimeoutMs,
  });
  const elapsed = Date.now() - startedAt;

  if (result.ok) assert.fail("跨重试总预算耗尽应超时");
  assert.equal(result.reasonCode, "timeout");
  assert.match(result.error, /下载超时（1s）：已清理临时文件，未发布素材。/);
  assert.equal(result.cleanupDone, true);
  // 第二次下载确实已启动（退避在其之前发生），但其自身预算被总预算截短。
  assert.equal(downloadCalls(seq.calls), 2);
  assert.ok(
    elapsed < totalTimeoutMs + 300,
    `总耗时 ${elapsed}ms 应受注入预算 ${totalTimeoutMs}ms（含退避）约束`,
  );
});

test("第一次 503、第二次 200：重试成功，下载 fetch 恰为 2 次且字节不累加", async () => {
  const seq = fetchSequence([
    () => metadataResponse(),
    () => new Response("STALE-BYTES", { status: 503 }),
    () => bytesResponse([PAYLOAD]),
  ]);
  const ingest = makeIngest();
  const result = await importStockCandidate({
    pageTitle: PAGE_TITLE,
    derivativeUrl: URL_720,
    root: storeRoot(),
    fetchImpl: seq.fn,
    ingest: ingest.fn,
  });

  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.equal(seq.calls.length, 3);
  assert.equal(downloadCalls(seq.calls), 2);
  const [ingestCall] = ingest.calls;
  assert.ok(ingestCall);
  // 退避后重试须重开临时文件：只保留第二次的完整字节
  assert.deepEqual(Array.from(ingestCall.bytes), Array.from(PAYLOAD));
});

test("三次 500：upstream，消息含「下载失败」", async () => {
  const seq = fetchSequence([
    () => metadataResponse(),
    () => new Response(null, { status: 500 }),
    () => new Response(null, { status: 500 }),
    () => new Response(null, { status: 500 }),
  ]);
  const result = await importStockCandidate({
    pageTitle: PAGE_TITLE,
    derivativeUrl: URL_720,
    root: storeRoot(),
    fetchImpl: seq.fn,
    ingest: makeIngest().fn,
  });

  if (result.ok) assert.fail("应失败");
  assert.equal(result.reasonCode, "upstream");
  assert.match(result.error, /下载失败/);
  assert.match(result.error, /已重试 2 次/);
  assert.equal(result.cleanupDone, true);
  assert.equal(downloadCalls(seq.calls), 3);
});

test("对账不符：mismatch；本次新写删除、预存 original/proxy 保留", async () => {
  const mismatchWidth = 1290; // 档位 1280 + 10px，超过 ±2px 容差
  const runCase = async (preSeeded: boolean) => {
    const seq = fetchSequence([
      () => metadataResponse(),
      () => bytesResponse([PAYLOAD]),
    ]);
    const ingest = makeIngest({
      onCall: (input) => {
        const key = storeKeyFor(
          createHash("sha256").update(input.bytes).digest("hex"),
          "webm",
        );
        const original = originalPath(input.root, key);
        const proxy = proxyPath(input.root, key);
        mkdirSync(path.dirname(original), { recursive: true });
        mkdirSync(path.dirname(proxy), { recursive: true });
        if (!existsSync(original)) writeFileSync(original, "NEW-ORIGINAL");
        if (!existsSync(proxy)) writeFileSync(proxy, "NEW-PROXY");
      },
      mutateAsset: (asset) => ({
        ...asset,
        original: { ...asset.original, width: mismatchWidth },
      }),
    });
    const root = storeRoot();
    if (preSeeded) {
      mkdirSync(path.dirname(originalPath(root, PAYLOAD_KEY)), {
        recursive: true,
      });
      writeFileSync(originalPath(root, PAYLOAD_KEY), "PRE-ORIGINAL");
      mkdirSync(path.dirname(proxyPath(root, PAYLOAD_KEY)), {
        recursive: true,
      });
      writeFileSync(proxyPath(root, PAYLOAD_KEY), "PRE-PROXY");
    }
    const result = await importStockCandidate({
      pageTitle: PAGE_TITLE,
      derivativeUrl: URL_720,
      root,
      fetchImpl: seq.fn,
      ingest: ingest.fn,
    });
    if (result.ok) assert.fail("对账不符不得返回 asset");
    assert.equal(result.reasonCode, "mismatch");
    assert.match(result.error, /下载内容与候选元数据不符：/);
    assert.match(result.error, /（未发布素材）/);
    assert.equal(result.cleanupDone, true);
    return root;
  };

  const freshRoot = await runCase(false);
  assert.equal(existsSync(originalPath(freshRoot, PAYLOAD_KEY)), false);
  assert.equal(existsSync(proxyPath(freshRoot, PAYLOAD_KEY)), false);

  const seededRoot = await runCase(true);
  assert.equal(
    readFileSync(originalPath(seededRoot, PAYLOAD_KEY), "utf8"),
    "PRE-ORIGINAL",
  );
  assert.equal(
    readFileSync(proxyPath(seededRoot, PAYLOAD_KEY), "utf8"),
    "PRE-PROXY",
  );
});

test("ingest 失败映射：unsupported-format→unsupported、decode-failed→ingest、store-error→store-error", async () => {
  const cases: Array<[IngestReasonCode, string]> = [
    ["unsupported-format", "unsupported"],
    ["decode-failed", "ingest"],
    ["store-error", "store-error"],
  ];
  for (const [ingestReason, expected] of cases) {
    const seq = fetchSequence([
      () => metadataResponse(),
      () => bytesResponse([PAYLOAD]),
    ]);
    const result = await importStockCandidate({
      pageTitle: PAGE_TITLE,
      derivativeUrl: URL_720,
      root: storeRoot(),
      fetchImpl: seq.fn,
      ingest: failingIngest(ingestReason),
    });
    if (result.ok) assert.fail("应失败");
    assert.equal(result.reasonCode, expected, `映射 ${ingestReason}`);
    assert.match(result.error, /素材导入失败：假失败/);
    assert.equal(result.cleanupDone, true);
  }
});
