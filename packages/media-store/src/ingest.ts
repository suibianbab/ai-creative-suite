// P2.5-T2 导入管线（spec §1.1/§3）：扩展名门(S1) → sha256/storeKey → 临时落盘
// → 探测(P) → 时长对账(P6) → 全片解码门(D1) → 原子落仓(S3) → 代理判定与
// 转码(W) → MediaAsset。任何失败：临时目录清空、本次新写的仓文件回滚（预
// 存不动）、不产半成品资产；账本写入是调用方（T3）的事。
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MediaAsset } from "@acs/video-document";
import { runProbe as defaultProbe, type ProbeOutcome } from "./probe.js";
import { transcodeProxy as defaultTranscode, needsProxy } from "./proxy.js";
import {
  originalPath,
  proxyPath,
  storeKeyFor,
  writeAtomically,
} from "./store.js";

const SUPPORTED_EXTENSIONS = new Set(["mp4", "webm", "mov"]);
const MIN_DURATION_MS = 200;
const MAX_DURATION_MS = 600000;

export type IngestOrigin = { kind: "local-upload"; fileName: string };

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
export function runDecode(filePath: string): RunDecodeResult {
  const spawned = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", filePath, "-f", "null", "-"],
    { encoding: "utf8" },
  );
  if (spawned.error) {
    return {
      ok: false,
      error: `未找到 ffmpeg（请安装 FFmpeg 并加入 PATH）：${spawned.error.message}`,
    };
  }
  if (spawned.status !== 0 || (spawned.stderr ?? "").trim() !== "") {
    const detail = `${spawned.stderr ?? ""}${
      spawned.status !== 0 ? `（退出码 ${spawned.status}）` : ""
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
  runProbe?: (filePath: string) => ProbeOutcome;
  runDecode?: (filePath: string) => RunDecodeResult;
  runTranscode?: typeof defaultTranscode;
  tempDir?: string;
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
    const extension = input.fileName.includes(".")
      ? (input.fileName.split(".").pop() ?? "").toLowerCase()
      : "";
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      return fail(
        `不支持的媒体格式 ${
          extension === "" ? "（无扩展名）" : `.${extension}`
        }：仅支持 mp4 / webm / mov`,
        "unsupported-format",
      );
    }
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const storeKey = storeKeyFor(sha256, extension as "mp4" | "webm" | "mov");
    tempDir = mkdtempSync(path.join(input.tempDir ?? tmpdir(), "acs-ingest-"));
    const tempFile = path.join(tempDir, `source.${extension}`);
    writeFileSync(tempFile, input.bytes);

    const probed = probeFn(tempFile);
    if (!probed.ok) return fail(probed.error, "probe-failed");
    const probe = probed.probe;
    if (
      probe.durationMs < MIN_DURATION_MS ||
      probe.durationMs > MAX_DURATION_MS
    ) {
      return fail(
        `视频时长 ${probe.durationMs}ms 越界：仅支持 ${MIN_DURATION_MS}ms..10 分钟`,
        "duration-out-of-range",
      );
    }
    const decoded = decodeFn(tempFile);
    if (!decoded.ok) return fail(decoded.error, "decode-failed");

    const dest = originalPath(input.root, storeKey);
    const existedBefore = existsSync(dest);
    const wroteOriginal = writeAtomically(dest, input.bytes) === "written";

    const buildAsset = (proxy?: MediaAsset["proxy"]): MediaAsset => ({
      assetId: randomUUID(),
      createdAt: input.now?.() ?? new Date().toISOString(),
      origin: { kind: "local-upload", fileName: input.fileName },
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
      ...(proxy === undefined ? {} : { proxy }),
    });

    if (input.generateProxy !== false && needsProxy(probe)) {
      const transcoded = transcodeFn(
        tempFile,
        proxyPath(input.root, storeKey),
        probe,
      );
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
