// P2.5-T2 P 表：ffprobe 包装 + 纯解析。runProbe 只负责进程与 P5/ENOENT；
// P1-P4 全在 parseProbeOutput（纯函数，零进程，录制夹具可测）。
import { spawnSync } from "node:child_process";

export type ProbeResult = {
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  hasAudio: boolean;
  formatName: string;
};

export type ProbeOutcome =
  | { ok: true; probe: ProbeResult }
  | { ok: false; error: string };

export function parseFps(rate: string): number {
  const match = /^(\d+)\/(\d+)$/.exec(rate.trim());
  if (match) {
    const denominator = Number(match[2]);
    return denominator === 0 ? 0 : Number(match[1]) / denominator;
  }
  const value = Number(rate);
  return Number.isFinite(value) ? value : 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

export function parseProbeOutput(raw: string): ProbeOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "文件无法探测：ffprobe 输出不可解析" };
  }
  const root = asRecord(parsed);
  const streams = Array.isArray(root?.streams) ? root.streams : [];
  const records = streams.map(asRecord);
  const video = records.find((stream) => stream?.codec_type === "video");
  if (!video) {
    return { ok: false, error: "文件不含视频流" };
  }
  const format = asRecord(root?.format);
  const durationSeconds = format ? Number(format.duration) : Number.NaN;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { ok: false, error: "无法读取视频时长（文件可能不完整）" };
  }
  const width = Number(video?.width);
  const height = Number(video?.height);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return { ok: false, error: "无法读取视频画幅（文件可能不完整）" };
  }
  const fps = parseFps(String(video?.r_frame_rate ?? ""));
  if (!Number.isFinite(fps) || fps <= 0) {
    return { ok: false, error: "无法读取视频帧率（文件可能不完整）" };
  }
  return {
    ok: true,
    probe: {
      durationMs: Math.round(durationSeconds * 1000),
      width,
      height,
      fps,
      codec: String(video?.codec_name ?? ""),
      hasAudio: records.some((stream) => stream?.codec_type === "audio"),
      formatName: String(format?.format_name ?? ""),
    },
  };
}

export function runProbe(filePath: string): ProbeOutcome {
  const spawned = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ],
    { encoding: "utf8" },
  );
  if (spawned.error) {
    return {
      ok: false,
      error: `未找到 ffprobe（请安装 FFmpeg 并加入 PATH）：${spawned.error.message}`,
    };
  }
  if (spawned.status !== 0) {
    const tail = (spawned.stderr ?? "").slice(-200);
    return { ok: false, error: `文件无法探测：ffprobe 失败（${tail}）` };
  }
  return parseProbeOutput(spawned.stdout);
}
