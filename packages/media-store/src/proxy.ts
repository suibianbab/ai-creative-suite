// P2.5-T2 W 表：浏览器预览代理。needsProxy 判定 + 转码 + 自核验（W3：
// 产物过长边/时长差/不可解码 = 失败，删半成品）。note 记 ffmpeg 版本与参数
// 摘要——proxy 是可再生成字段，note 是再生成的配方指纹。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import { runProbe, type ProbeResult } from "./probe.js";

export const PROXY_MAX_EDGE = 1280;
const BROWSER_CODECS = new Set(["h264", "vp8", "vp9", "av1"]);
const PROXY_DURATION_TOLERANCE_MS = 500;

export function needsProxy(probe: ProbeResult): boolean {
  const longEdge = Math.max(probe.width, probe.height);
  return longEdge > PROXY_MAX_EDGE || !BROWSER_CODECS.has(probe.codec);
}

function ffmpegVersionLine(): string {
  const spawned = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  const firstLine = (spawned.stdout ?? "").split("\n")[0]?.trim();
  return firstLine !== undefined && firstLine !== ""
    ? firstLine
    : "ffmpeg 版本未知";
}

export function transcodeProxy(
  inputPath: string,
  outputPath: string,
  probe: ProbeResult,
):
  | {
      ok: true;
      sha256: string;
      bytes: number;
      width: number;
      height: number;
      note: string;
    }
  | { ok: false; error: string } {
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
  const spawned = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (spawned.error || spawned.status !== 0) {
    try {
      unlinkSync(outputPath);
    } catch {}
    return {
      ok: false,
      error: `代理转码失败：${String(
        spawned.stderr ?? spawned.error?.message ?? "",
      ).slice(-300)}`,
    };
  }
  const verified = runProbe(outputPath);
  if (!verified.ok) {
    try {
      unlinkSync(outputPath);
    } catch {}
    return { ok: false, error: `代理转码核验失败：${verified.error}` };
  }
  const longEdge = Math.max(verified.probe.width, verified.probe.height);
  const durationDrift = Math.abs(verified.probe.durationMs - probe.durationMs);
  if (longEdge > PROXY_MAX_EDGE || durationDrift >= PROXY_DURATION_TOLERANCE_MS) {
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
    note: `${ffmpegVersionLine()} | ${scale} | libx264 crf23 yuv420p${
      probe.hasAudio ? " + aac128k" : " | -an"
    }`,
  };
}
