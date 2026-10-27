// P2.6-T5 P1-P6 下载核验编排：W5 白名单 → P1 重取与许可门 → P2 成员校验 →
// P3 流式下载（重试/超时/上限）→ P4 ingest → P5 对账与失败清理 → P6 临时目录。
// 服务端是信任边界：入账元数据一律取自本次重取，客户端只传 pageTitle/derivativeUrl。
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MediaAsset } from "@acs/video-document";
import {
  type IngestReasonCode,
  type IngestResult,
  ingestMediaFile,
} from "../ingest.js";
import { originalPath, proxyPath, storeKeyFor } from "../store.js";
import type { StockCandidate, StockDerivative } from "./types.js";
import {
  buildWikimediaVideoInfoUrl,
  findDerivative,
  isAllowedWikimediaAssetUrl,
  normalizeWikimediaPages,
} from "./wikimedia.js";

const USER_AGENT = "ACS-VideoStudio/0.1 (local development)";
const METADATA_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 500_000_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 300_000;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 3;
const DURATION_TOLERANCE_MS = 1_000;
const DIMENSION_TOLERANCE_PX = 2;
const RETRY_DELAYS_MS = [1_000, 2_000];
const FALLBACK_FILE_NAME = "wikimedia";
const IDLE_TIMEOUT = Symbol("stock-download-idle-timeout");
const TOTAL_TIMEOUT = Symbol("stock-download-total-timeout");

export type StockImportReasonCode =
  | "upstream"
  | "timeout"
  | "too-large"
  | "unlicensed"
  | "mismatch"
  | "unsupported"
  | "ingest"
  | "store-error";

export type StockImportResult =
  | { ok: true; asset: MediaAsset }
  | {
      ok: false;
      error: string;
      reasonCode: StockImportReasonCode;
      cleanupDone: boolean;
    };

type StockLicense = NonNullable<StockCandidate["license"]>;

type StreamReader = {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(): Promise<void>;
};

type DownloadAttemptOutcome =
  | { ok: true }
  | { ok: false; kind: "retryable"; reason: string }
  | { ok: false; kind: "fatal"; error: string }
  | { ok: false; kind: "too-large" }
  | { ok: false; kind: "timeout" };

type DownloadOutcome =
  | { ok: true }
  | {
      ok: false;
      reasonCode: "upstream" | "timeout" | "too-large";
      error: string;
    };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function retryDelayMs(attempt: number): number {
  return (
    RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)] ?? 2_000
  );
}

function clampRetries(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RETRIES;
  return Math.max(1, Math.trunc(value));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

// P1：按 pageTitle 重取 videoinfo；网络错误/408/429/5xx 按重试策略，其余 4xx
// 立即失败。响应不可解析同样是 upstream。
async function fetchCandidateMetadata(input: {
  pageTitle: string;
  fetchImpl: typeof fetch;
  retries: number;
}): Promise<
  { ok: true; candidates: StockCandidate[] } | { ok: false; error: string }
> {
  let lastError = "网络错误";
  for (let attempt = 1; attempt <= input.retries; attempt++) {
    let response: Response;
    try {
      response = await input.fetchImpl(
        buildWikimediaVideoInfoUrl(input.pageTitle),
        {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
        },
      );
    } catch (error) {
      lastError = errorMessage(error);
      if (attempt < input.retries) {
        await sleep(retryDelayMs(attempt));
        continue;
      }
      return { ok: false, error: lastError };
    }

    if (response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { ok: false, error: "Wikimedia 响应不可解析" };
      }
      const normalized = normalizeWikimediaPages(body);
      return normalized.ok
        ? { ok: true, candidates: normalized.candidates }
        : { ok: false, error: normalized.error };
    }

    lastError = `HTTP ${response.status}`;
    if (!isRetryableStatus(response.status) || attempt >= input.retries) {
      return { ok: false, error: lastError };
    }
    await sleep(retryDelayMs(attempt));
  }
  return { ok: false, error: lastError };
}

async function readWithTimeouts(
  reader: StreamReader,
  idleTimeoutMs: number,
  totalDeadline: Promise<never>,
): Promise<{ done: boolean; value?: Uint8Array }> {
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const idleDeadline = new Promise<never>((_, reject) => {
    idleTimer = setTimeout(() => reject(IDLE_TIMEOUT), idleTimeoutMs);
  });
  try {
    return await Promise.race([reader.read(), idleDeadline, totalDeadline]);
  } finally {
    clearTimeout(idleTimer);
  }
}

// P3 单次尝试：每次重开/截断临时文件，失败重试不累加字节。空闲超时按相邻
// 两段字节的间隔计；总预算由 downloadToFile 统一下发（跨重试与退避共用）。
async function downloadAttempt(input: {
  url: string;
  tempFile: string;
  fetchImpl: typeof fetch;
  maxBytes: number;
  budgetMs: number;
  idleTimeoutMs: number;
}): Promise<DownloadAttemptOutcome> {
  const fd = openSync(input.tempFile, "w");
  const controller = new AbortController();
  let totalFired = false;
  let totalTimer: ReturnType<typeof setTimeout> | undefined;
  const totalDeadline = new Promise<never>((_, reject) => {
    totalTimer = setTimeout(() => {
      totalFired = true;
      controller.abort();
      reject(TOTAL_TIMEOUT);
    }, input.budgetMs);
  });
  void totalDeadline.catch(() => {});

  try {
    let response: Response;
    try {
      response = await input.fetchImpl(input.url, {
        redirect: "error",
        headers: { "User-Agent": USER_AGENT },
        signal: controller.signal,
      });
    } catch (error) {
      if (totalFired) return { ok: false, kind: "timeout" };
      return { ok: false, kind: "retryable", reason: errorMessage(error) };
    }

    // W6：只接受 200。206/204 等 2xx 不是「完整下载」，与其余非 200 一样按
    // 致命错误收口；408/429/5xx 仍走重试路径。
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      if (isRetryableStatus(response.status)) {
        return {
          ok: false,
          kind: "retryable",
          reason: `HTTP ${response.status}`,
        };
      }
      return {
        ok: false,
        kind: "fatal",
        error: `下载失败（HTTP ${response.status}）：${input.url}`,
      };
    }

    const declaredHeader = response.headers.get("content-length");
    const declaredBytes =
      declaredHeader === null ? Number.NaN : Number(declaredHeader);
    if (Number.isFinite(declaredBytes) && declaredBytes > input.maxBytes) {
      void response.body?.cancel().catch(() => {});
      controller.abort();
      return { ok: false, kind: "too-large" };
    }

    const reader = response.body?.getReader();
    if (reader === undefined) {
      return { ok: false, kind: "retryable", reason: "响应缺少正文" };
    }

    let received = 0;
    while (true) {
      let result: { done: boolean; value?: Uint8Array };
      try {
        result = await readWithTimeouts(
          reader,
          input.idleTimeoutMs,
          totalDeadline,
        );
      } catch (error) {
        if (error === TOTAL_TIMEOUT || error === IDLE_TIMEOUT || totalFired) {
          controller.abort();
          void reader.cancel().catch(() => {});
          return { ok: false, kind: "timeout" };
        }
        return { ok: false, kind: "retryable", reason: errorMessage(error) };
      }

      if (result.done || result.value === undefined) break;
      const chunk = result.value;
      received += chunk.byteLength;
      if (received > input.maxBytes) {
        controller.abort();
        void reader.cancel().catch(() => {});
        return { ok: false, kind: "too-large" };
      }
      writeSync(fd, chunk);
    }

    // W6：Content-Length 可核验时要求字节数完全一致；短体/长体都按上游异常
    // 可重试收口（传输截断常见于连接中断）。有 content-encoding 时该长度是
    // 压缩后字节，不能与解码后的 received 直接比较。
    const encoding = response.headers.get("content-encoding");
    if (
      Number.isFinite(declaredBytes) &&
      (encoding === null || encoding === "identity") &&
      received !== declaredBytes
    ) {
      return {
        ok: false,
        kind: "retryable",
        reason: "响应字节数与 Content-Length 不符",
      };
    }

    return { ok: true };
  } finally {
    clearTimeout(totalTimer);
    closeSync(fd);
  }
}

async function downloadToFile(input: {
  url: string;
  tempFile: string;
  fetchImpl: typeof fetch;
  maxBytes: number;
  totalTimeoutMs: number;
  idleTimeoutMs: number;
  retries: number;
}): Promise<DownloadOutcome> {
  // 总预算只在这里落一次：跨全部尝试与退避（规格「下载期间最长 300s」）。
  const deadlineAt = Date.now() + input.totalTimeoutMs;
  const remainingMs = () => deadlineAt - Date.now();
  const timeoutFailure = (): DownloadOutcome => ({
    ok: false,
    reasonCode: "timeout",
    error: `下载超时（${Math.max(1, Math.round(input.totalTimeoutMs / 1000))}s）：已清理临时文件，未发布素材。`,
  });
  let lastReason = "网络错误";
  for (let attempt = 1; attempt <= input.retries; attempt++) {
    const budgetMs = remainingMs();
    if (budgetMs <= 0) return timeoutFailure();
    const outcome = await downloadAttempt({
      url: input.url,
      tempFile: input.tempFile,
      fetchImpl: input.fetchImpl,
      maxBytes: input.maxBytes,
      budgetMs,
      idleTimeoutMs: input.idleTimeoutMs,
    });
    if (outcome.ok) return { ok: true };
    if (outcome.kind === "too-large") {
      return {
        ok: false,
        reasonCode: "too-large",
        error: "素材过大（>500MB）：已中止下载并清理临时文件。",
      };
    }
    if (outcome.kind === "timeout") return timeoutFailure();
    if (outcome.kind === "fatal") {
      return { ok: false, reasonCode: "upstream", error: outcome.error };
    }
    lastReason = outcome.reason;
    if (attempt < input.retries) {
      // 退避同样吃总预算：不够就等到期后按 timeout 收口，不额外多睡 1s/2s。
      const delay = Math.min(retryDelayMs(attempt), Math.max(0, remainingMs()));
      if (delay > 0) await sleep(delay);
    }
  }
  return {
    ok: false,
    reasonCode: "upstream",
    error: `下载失败：${lastReason}（已重试 ${Math.max(0, input.retries - 1)} 次）`,
  };
}

// P4：清洗后的 displayTitle + 强制正确扩展名，整名 ≤200 字符。
function buildFileName(
  displayTitle: string,
  container: StockDerivative["container"],
): string {
  const extension = `.${container}`;
  const sanitized = displayTitle
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/[\u0000-\u001f\u007f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  const base = (sanitized || FALLBACK_FILE_NAME)
    .slice(0, 200 - extension.length)
    .trimEnd();
  return `${base || FALLBACK_FILE_NAME}${extension}`;
}

// P5：时长 ±1000ms、宽高 ±2px；返回中文详情，空串表示通过。
function describeMismatch(
  asset: MediaAsset,
  candidate: StockCandidate,
  derivative: StockDerivative,
): string {
  const problems: string[] = [];
  // 任务 1 起 original 是视频|图片判别联合；stock 源当前只出视频——显式
  // 窄化（将来接图片 stock 时在判别上加分支）。
  const original = asset.original as Extract<
    typeof asset.original,
    { kind?: "video" }
  >;
  if (
    Math.abs(original.durationMs - candidate.durationMs) > DURATION_TOLERANCE_MS
  ) {
    problems.push(
      `时长不符：候选 ${candidate.durationMs}ms，实际 ${original.durationMs}ms`,
    );
  }
  if (Math.abs(original.width - derivative.width) > DIMENSION_TOLERANCE_PX) {
    problems.push(
      `宽度不符：档位 ${derivative.width}px，实际 ${original.width}px`,
    );
  }
  if (Math.abs(original.height - derivative.height) > DIMENSION_TOLERANCE_PX) {
    problems.push(
      `高度不符：档位 ${derivative.height}px，实际 ${original.height}px`,
    );
  }
  return problems.join("；");
}

// 清理边界：只删本次新写；预存文件可能被既有资产引用，一律不动。
function removeIfExists(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {}
}

function ingestReasonToStockReason(
  reasonCode: IngestReasonCode,
): StockImportReasonCode {
  if (reasonCode === "unsupported-format") return "unsupported";
  if (reasonCode === "store-error") return "store-error";
  return "ingest";
}

export async function importStockCandidate(input: {
  pageTitle: string;
  derivativeUrl: string;
  root: string;
  fetchImpl?: typeof fetch;
  ingest?: typeof ingestMediaFile;
  now?: () => string;
  tempDir?: string;
  maxBytes?: number;
  totalTimeoutMs?: number;
  idleTimeoutMs?: number;
  retries?: number;
}): Promise<StockImportResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const ingest = input.ingest ?? ingestMediaFile;
  const retries = clampRetries(input.retries ?? DEFAULT_RETRIES);
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  const totalTimeoutMs = input.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  const idleTimeoutMs = input.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  let workDir: string | undefined;

  // 单一清理点：所有返回路径都经 finish。rmSync 失败只把失败结果的
  // cleanupDone 降为 false，不掩盖已确定的导入结果；成功结果不带该标志。
  // 无日志设施，降级标志就是清理失败的信号。
  const finish = (result: StockImportResult): StockImportResult => {
    if (workDir === undefined) return result;
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      if (!result.ok) return { ...result, cleanupDone: false };
    }
    return result;
  };
  const fail = (
    reasonCode: StockImportReasonCode,
    error: string,
  ): StockImportResult =>
    finish({ ok: false, error, reasonCode, cleanupDone: true });

  try {
    // W5：白名单先于任何 fetch。
    if (!isAllowedWikimediaAssetUrl(input.derivativeUrl)) {
      return fail(
        "unsupported",
        "素材来源无效：仅允许 Wikimedia Commons 的 upload.wikimedia.org 直链。",
      );
    }

    const metadata = await fetchCandidateMetadata({
      pageTitle: input.pageTitle,
      fetchImpl,
      retries,
    });
    if (!metadata.ok) {
      return fail(
        "upstream",
        `在线素材检索失败：${metadata.error}（可重试或改用本地上传）`,
      );
    }

    const candidate = metadata.candidates.find(
      (item) => item.pageTitle === input.pageTitle,
    );
    if (!candidate) {
      return fail("unsupported", `候选已不存在或不可用：${input.pageTitle}`);
    }
    // 许可门先于 disabledReason：许可不明的候选带 disabledReason「许可不明」，
    // 但需要给出可入账性专用的原因码。
    const license: StockLicense | null = candidate.license;
    if (!license) {
      return fail(
        "unlicensed",
        `候选许可信息缺失：${input.pageTitle}（无法入账，请更换素材）`,
      );
    }
    if (candidate.disabledReason) {
      return fail("unsupported", `候选已不存在或不可用：${input.pageTitle}`);
    }

    const derivative = findDerivative(candidate, input.derivativeUrl);
    if (!derivative) {
      return fail(
        "unsupported",
        `该分辨率档位不属于此候选：${input.derivativeUrl}`,
      );
    }

    const retrievedAt = input.now?.() ?? new Date().toISOString();

    workDir = mkdtempSync(path.join(input.tempDir ?? tmpdir(), "acs-stock-"));
    const tempFile = path.join(workDir, `source.${derivative.container}`);
    const downloaded = await downloadToFile({
      url: input.derivativeUrl,
      tempFile,
      fetchImpl,
      maxBytes,
      totalTimeoutMs,
      idleTimeoutMs,
      retries,
    });
    if (!downloaded.ok) {
      return fail(downloaded.reasonCode, downloaded.error);
    }

    const bytes = readFileSync(tempFile);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const storeKey = storeKeyFor(sha256, derivative.container);
    const originalDest = originalPath(input.root, storeKey);
    const proxyDest = proxyPath(input.root, storeKey);
    const originalExisted = existsSync(originalDest);
    const proxyExisted = existsSync(proxyDest);

    let ingested: IngestResult;
    try {
      ingested = await ingest({
        bytes,
        fileName: buildFileName(candidate.displayTitle, derivative.container),
        root: input.root,
        now: input.now,
        origin: {
          kind: "stock-source",
          sourceId: "wikimedia",
          sourcePageUrl: candidate.sourcePageUrl,
          license,
          retrievedAt,
        },
      });
    } catch (error) {
      return fail("store-error", `素材导入失败：${errorMessage(error)}`);
    }
    if (!ingested.ok) {
      return fail(
        ingestReasonToStockReason(ingested.reasonCode),
        `素材导入失败：${ingested.error}`,
      );
    }

    const mismatch = describeMismatch(ingested.asset, candidate, derivative);
    if (mismatch !== "") {
      if (!originalExisted) removeIfExists(originalDest);
      if (!proxyExisted) removeIfExists(proxyDest);
      return fail(
        "mismatch",
        `下载内容与候选元数据不符：${mismatch}（未发布素材）`,
      );
    }

    return finish({ ok: true, asset: ingested.asset });
  } catch (error) {
    // fs 抛错（mkdtemp/readFile 等）也须落在 P6 契约内，而不是冒泡到路由的
    // 未保护 await——统一收成 store-error；fail 经 finish 清理并如实反映结果。
    return fail("store-error", `素材导入失败：${errorMessage(error)}`);
  }
}
