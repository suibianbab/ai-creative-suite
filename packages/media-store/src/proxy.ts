// P2.5-T2 W 表：浏览器预览代理。needsProxy 判定 + 转码 + 自核验（W3：
// 产物过长边/时长差/不可解码 = 失败，删半成品）。note 记 ffmpeg 版本与参数
// 摘要——proxy 是可再生成字段，note 是再生成的配方指纹。
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { type ProbeResult, runCapture, runProbe } from "./probe.js";

export const PROXY_MAX_EDGE = 1280;
const BROWSER_CODECS = new Set(["h264", "vp8", "vp9", "av1"]);
const PROXY_DURATION_TOLERANCE_MS = 500;

export function needsProxy(probe: ProbeResult): boolean {
  const longEdge = Math.max(probe.width, probe.height);
  return longEdge > PROXY_MAX_EDGE || !BROWSER_CODECS.has(probe.codec);
}

async function ffmpegVersionLine(): Promise<string> {
  const captured = await runCapture("ffmpeg", ["-version"]);
  const firstLine = captured.stdout.split("\n")[0]?.trim();
  return firstLine !== undefined && firstLine !== ""
    ? firstLine
    : "ffmpeg 版本未知";
}

export type TranscodeOutcome =
  | {
      ok: true;
      sha256: string;
      bytes: number;
      width: number;
      height: number;
      note: string;
    }
  | { ok: false; error: string };

export async function transcodeProxy(
  inputPath: string,
  outputPath: string,
  probe: ProbeResult,
): Promise<TranscodeOutcome> {
  const scale = `scale='if(gt(iw,ih),min(${PROXY_MAX_EDGE},iw),-2)':'if(gt(iw,ih),-2,min(${PROXY_MAX_EDGE},ih))'`;
  const args = [
    "-v",
    "error",
    "-y",
    "-i",
    inputPath,
    "-vf",
    scale,
    "-c:v",
    "libx264",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
  ];
  if (probe.hasAudio) args.push("-c:a", "aac", "-b:a", "128k");
  else args.push("-an");
  args.push(outputPath);
  // ffmpeg 不建父目录（ingest 场景 root/proxy/ 首次转码时不存在）
  mkdirSync(path.dirname(outputPath), { recursive: true });
  const captured = await runCapture("ffmpeg", args);
  if (captured.error || captured.status !== 0) {
    try {
      unlinkSync(outputPath);
    } catch {}
    return {
      ok: false,
      error: `代理转码失败：${String(
        captured.stderr ?? captured.error?.message ?? "",
      ).slice(-300)}`,
    };
  }
  const verified = await runProbe(outputPath);
  if (!verified.ok) {
    try {
      unlinkSync(outputPath);
    } catch {}
    return { ok: false, error: `代理转码核验失败：${verified.error}` };
  }
  const longEdge = Math.max(verified.probe.width, verified.probe.height);
  const durationDrift = Math.abs(verified.probe.durationMs - probe.durationMs);
  if (
    longEdge > PROXY_MAX_EDGE ||
    durationDrift >= PROXY_DURATION_TOLERANCE_MS
  ) {
    try {
      unlinkSync(outputPath);
    } catch {}
    return {
      ok: false,
      error: `代理转码核验失败：产物长边 ${longEdge} 或时长差 ${durationDrift}ms 越限`,
    };
  }
  const bytes = readFileSync(outputPath);
  return {
    ok: true,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.byteLength,
    width: verified.probe.width,
    height: verified.probe.height,
    note: `${await ffmpegVersionLine()} | ${scale} | libx264 crf23 yuv420p${
      probe.hasAudio ? " + aac128k" : " | -an"
    }`,
  };
}
