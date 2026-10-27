// P2.5-T2 导入管线（spec §1.1/§3）：扩展名门(S1) → sha256/storeKey → 临时落盘
// → 探测(P) → 时长对账(P6) → 全片解码门(D1) → 原子落仓(S3) → 代理判定与
// 转码(W) → MediaAsset。任何失败：临时目录清空、本次新写的仓文件回滚（预
// 存不动）、不产半成品资产；账本写入是调用方（T3）的事。
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MediaAsset } from "@acs/video-document";
import {
  runProbe as defaultProbe,
  isEnoentError,
  type ProbeOutcome,
  runCapture,
} from "./probe.js";
import {
  transcodeProxy as defaultTranscode,
  needsProxy,
  PROXY_MAX_EDGE,
  type TranscodeOutcome,
} from "./proxy.js";
import {
  originalPath,
  proxyPath,
  storeKeyFor,
  writeAtomically,
} from "./store.js";

// 任务 1（2026-10-28）：图片入账（png/jpg/webp；jpeg 归一 jpg）。
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const SUPPORTED_EXTENSIONS = new Set([
  ...VIDEO_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
]);
function imageFormatFor(ext: string): "png" | "jpeg" | "webp" {
  if (ext === "png") return "png";
  if (ext === "webp") return "webp";
  return "jpeg";
}

const MIN_DURATION_MS = 200;
const MAX_DURATION_MS = 600000;

export type IngestOrigin =
  | { kind: "local-upload"; fileName: string }
  | {
      kind: "stock-source";
      sourceId: "wikimedia";
      sourcePageUrl: string;
      license: { name: string; author?: string; usageNote?: string };
      retrievedAt: string;
    };

export type IngestReasonCode =
  | "unsupported-format"
  | "probe-failed"
  | "decode-failed"
  | "duration-out-of-range"
  | "proxy-failed"
  | "store-error";

export type IngestResult =
  | { ok: true; asset: MediaAsset }
  | {
      ok: false;
      error: string;
      reasonCode: IngestReasonCode;
      cleanupDone: true;
    };

export type RunDecodeResult = { ok: true } | { ok: false; error: string };

// D1 全片解码门：退出码 0 且 stderr 干净才算过（教训：退出码 0 ≠ 成功）。
export async function runDecode(filePath: string): Promise<RunDecodeResult> {
  const captured = await runCapture("ffmpeg", [
    "-v",
    "error",
    "-i",
    filePath,
    "-f",
    "null",
    "-",
  ]);
  if (captured.error) {
    if (isEnoentError(captured.error)) {
      return {
        ok: false,
        error: `未找到 ffmpeg（请安装 FFmpeg 并加入 PATH）：${captured.error.message}`,
      };
    }
    return {
      ok: false,
      error: `文件无法完整解码：进程启动失败（${captured.error.message}）`,
    };
  }
  if (captured.status !== 0 || captured.stderr.trim() !== "") {
    const detail = `${captured.stderr}${
      captured.status !== 0 ? `（退出码 ${captured.status}）` : ""
    }`.slice(-300);
    return {
      ok: false,
      error: `文件无法完整解码：${detail}（文件可能损坏或不完整）`,
    };
  }
  return { ok: true };
}

export async function ingestMediaFile(input: {
  bytes: Buffer | Uint8Array;
  fileName: string;
  root: string;
  generateProxy?: boolean;
  now?: () => string;
  // 注入位容纳同步假件（await 平值）——测试注入免 async 样板
  runProbe?: (filePath: string) => ProbeOutcome | Promise<ProbeOutcome>;
  runDecode?: (filePath: string) => RunDecodeResult | Promise<RunDecodeResult>;
  runTranscode?: (
    inputPath: string,
    outputPath: string,
    probe: Parameters<typeof defaultTranscode>[2],
  ) => TranscodeOutcome | Promise<TranscodeOutcome>;
  tempDir?: string;
  origin?: IngestOrigin;
}): Promise<IngestResult> {
  const probeFn = input.runProbe ?? defaultProbe;
  const decodeFn = input.runDecode ?? runDecode;
  const transcodeFn = input.runTranscode ?? defaultTranscode;
  let tempDir: string | undefined;
  const cleanup = () => {
    if (tempDir !== undefined)
      rmSync(tempDir, { recursive: true, force: true });
  };
  const fail = (error: string, reasonCode: IngestReasonCode): IngestResult => {
    cleanup();
    return { ok: false, error, reasonCode, cleanupDone: true };
  };
  try {
    // validate 契约：origin.fileName 1..200——超限在此拒收（F2）
    if (input.fileName.length > 200) {
      return fail(
        `文件名过长（${input.fileName.length} 字符，上限 200）：请缩短后重传`,
        "unsupported-format",
      );
    }
    const extension = input.fileName.includes(".")
      ? (input.fileName.split(".").pop() ?? "").toLowerCase()
      : "";
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      return fail(
        `不支持的媒体格式 ${
          extension === "" ? "（无扩展名）" : `.${extension}`
        }：仅支持 mp4 / webm / mov / png / jpg / webp`,
        "unsupported-format",
      );
    }
    const isImageUpload = IMAGE_EXTENSIONS.has(extension);
    const storeExt = extension === "jpeg" ? "jpg" : extension;
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const storeKey = storeKeyFor(
      sha256,
      storeExt as "mp4" | "webm" | "mov" | "png" | "jpg" | "webp",
    );
    tempDir = mkdtempSync(path.join(input.tempDir ?? tmpdir(), "acs-ingest-"));
    const tempFile = path.join(tempDir, `source.${extension}`);
    writeFileSync(tempFile, input.bytes);

    const probed = await probeFn(tempFile);
    if (!probed.ok) return fail(probed.error, "probe-failed");
    const probe = probed.probe;
    // 图片路径（任务 1）：探测出的格式须与扩展名一致（防改名伪装），
    // 无时长/转码；解码门照走（损坏图在这里拒）。
    if (probe.image) {
      if (!isImageUpload || probe.image.format !== imageFormatFor(storeExt)) {
        return fail(
          `文件内容与扩展名不符（探测为 ${probe.image.format} 图，上传为 .${extension}）`,
          "probe-failed",
        );
      }
      const decoded = await decodeFn(tempFile);
      if (!decoded.ok) return fail(decoded.error, "decode-failed");
      const dest = originalPath(input.root, storeKey);
      const wroteOriginal =
        writeAtomically(dest, input.bytes) === "written" ? true : false;
      if (!wroteOriginal && !existsSync(dest)) {
        return fail("图片落仓失败", "store-error");
      }
      cleanup();
      return {
        ok: true,
        asset: {
          assetId: randomUUID(),
          createdAt: input.now?.() ?? new Date().toISOString(),
          origin: input.origin ?? {
            kind: "local-upload",
            fileName: input.fileName,
          },
          original: {
            kind: "image",
            sha256,
            bytes: input.bytes.byteLength,
            width: probe.image.width,
            height: probe.image.height,
            format: probe.image.format,
            storeKey,
          },
        },
      };
    }
    if (
      probe.durationMs < MIN_DURATION_MS ||
      probe.durationMs > MAX_DURATION_MS
    ) {
      return fail(
        `视频时长 ${probe.durationMs}ms 越界：仅支持 ${MIN_DURATION_MS}ms..10 分钟`,
        "duration-out-of-range",
      );
    }
    const decoded = await decodeFn(tempFile);
    if (!decoded.ok) return fail(decoded.error, "decode-failed");

    const dest = originalPath(input.root, storeKey);
    const existedBefore = existsSync(dest);
    const wroteOriginal = writeAtomically(dest, input.bytes) === "written";

    const buildAsset = (proxy?: MediaAsset["proxy"]): MediaAsset => {
      // validate 契约：proxy.note 1..200——在契约边界统一截断（F2），
      // 覆盖注入转码器与代理复用两条来路
      const capped =
        proxy === undefined
          ? undefined
          : { ...proxy, note: proxy.note.slice(0, 200) };
      return {
        assetId: randomUUID(),
        createdAt: input.now?.() ?? new Date().toISOString(),
        origin: input.origin ?? {
          kind: "local-upload",
          fileName: input.fileName,
        },
        original: {
          sha256,
          bytes: input.bytes.byteLength,
          durationMs: probe.durationMs,
          width: probe.width,
          height: probe.height,
          fps: probe.fps,
          codec: probe.codec,
          hasAudio: probe.hasAudio,
          storeKey,
        },
        ...(capped === undefined ? {} : { proxy: capped }),
      };
    };

    if (input.generateProxy !== false && needsProxy(probe)) {
      const proxyDest = proxyPath(input.root, storeKey);
      // F3：仓内已有可用代理（探测得过且长边达标）→ 复用，不重转码。
      // 与 S3 对 original 的复用对称——预存代理背后是既有资产的预览，
      // 重转码不但烧 CPU，瞬时失败还会 -y 覆盖毁掉它（W2 分寸）。
      if (existsSync(proxyDest)) {
        const recheck = await probeFn(proxyDest);
        const longEdge = recheck.ok
          ? Math.max(recheck.probe.width, recheck.probe.height)
          : Number.POSITIVE_INFINITY;
        if (recheck.ok && longEdge <= PROXY_MAX_EDGE) {
          const existingBytes = readFileSync(proxyDest);
          const asset = buildAsset({
            sha256: createHash("sha256").update(existingBytes).digest("hex"),
            bytes: existingBytes.byteLength,
            width: recheck.probe.width,
            height: recheck.probe.height,
            note: `复用仓内既有代理 ${path.basename(proxyDest)}`,
          });
          cleanup();
          return { ok: true, asset };
        }
      }
      const transcoded = await transcodeFn(tempFile, proxyDest, probe);
      if (!transcoded.ok) {
        // W2 回滚分寸：仅删本次新写；预存文件背后是既有资产，无权销毁。
        if (wroteOriginal && !existedBefore) {
          try {
            unlinkSync(dest);
          } catch {}
        }
        return fail(transcoded.error, "proxy-failed");
      }
      const asset = buildAsset({
        sha256: transcoded.sha256,
        bytes: transcoded.bytes,
        width: transcoded.width,
        height: transcoded.height,
        note: transcoded.note,
      });
      cleanup();
      return { ok: true, asset };
    }
    const asset = buildAsset();
    cleanup();
    return { ok: true, asset };
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : String(error),
      "store-error",
    );
  }
}
