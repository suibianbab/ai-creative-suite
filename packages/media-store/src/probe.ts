// P2.5-T2 P 表：ffprobe 包装 + 纯解析。runProbe 只负责进程与 P5/ENOENT；
// P1-P4 全在 parseProbeOutput（纯函数，零进程，录制夹具可测）。
import { spawn } from "node:child_process";

export type ProbeResult = {
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  hasAudio: boolean;
  formatName: string;
  // 任务 1（2026-10-28）：图片探测分支。image 存在时视频字段全部
  // undefined——ffprobe 对单帧图不给时长/帧率，解析侧按图片契约出。
  image?: { width: number; height: number; format: "png" | "jpeg" | "webp" };
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
  const codecName = String(video?.codec_name ?? "");
  // 图片分支（任务 1）：codec 是图片解码器且无时长——单帧图。
  const IMAGE_CODEC: Record<string, "png" | "jpeg" | "webp"> = {
    png: "png",
    mjpeg: "jpeg",
    webp: "webp",
  };
  if (codecName in IMAGE_CODEC && !Number.isFinite(durationSeconds)) {
    const width = Number(video?.width);
    const height = Number(video?.height);
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return { ok: false, error: "无法读取图片画幅（文件可能不完整）" };
    }
    return {
      ok: true,
      probe: {
        durationMs: 0,
        width,
        height,
        fps: 0,
        codec: codecName,
        hasAudio: false,
        formatName: String(format?.format_name ?? ""),
        image: { width, height, format: IMAGE_CODEC[codecName]! },
      },
    };
  }
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

// 异步进程采集（F4）：spawnSync 会冻结整条事件循环——Next 路由里每次上传
// 都会卡死全部请求与 HMR。手动累积 stdout/stderr 无 maxBuffer 上限（坏文件
// 的海量 stderr 不再变成 ENOBUFS 假 ENOENT）。
export type CaptureResult = {
  error?: Error;
  status: number | null;
  stdout: string;
  stderr: string;
};

export function runCapture(
  cmd: string,
  args: string[],
): Promise<CaptureResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    // 'error' 后 'close' 仍会触发；Promise 只结算一次，双 resolve 无害
    child.on("error", (error) => {
      resolve({ error, status: null, stdout, stderr });
    });
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

// F1：只有 ENOENT 才是"未装 FFmpeg"；其他 spawn 错误（如历史上
// maxBuffer 溢出的 ENOBUFS）误报"请安装 FFmpeg"会误导用户重装。
export function isEnoentError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

export async function runProbe(filePath: string): Promise<ProbeOutcome> {
  const captured = await runCapture("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);
  if (captured.error) {
    if (isEnoentError(captured.error)) {
      return {
        ok: false,
        error: `未找到 ffprobe（请安装 FFmpeg 并加入 PATH）：${captured.error.message}`,
      };
    }
    return {
      ok: false,
      error: `文件无法探测：进程启动失败（${captured.error.message}）`,
    };
  }
  if (captured.status !== 0) {
    const tail = captured.stderr.slice(-200);
    return { ok: false, error: `文件无法探测：ffprobe 失败（${tail}）` };
  }
  return parseProbeOutput(captured.stdout);
}
