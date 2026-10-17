// 解码帧哈希（ADR 0003 §2.5）：确定性校验比较「解码后的帧」，不是容器字节——
// PNG 的压缩参数/辅助块可能在逐帧等像素的两次渲染间不同，文件字节哈希会误报。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// IHDR 固定是第一个 chunk：字节 16..23 是大端 width/height。把尺寸并入哈希，
// 防止「不同尺寸但原始字节恰好同长同内容」的帧被误判相等。
function pngDimensions(png) {
  if (png.length < 24 || png.readUInt32BE(12) !== 0x49484452) {
    throw new Error("不是合法 PNG（缺 IHDR 块），无法计算解码帧哈希");
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

// PNG → 解码 RGBA 原始像素 → sha256(尺寸 + 像素)。解码失败抛含路径的错误。
export function decodeFrameHash(pngPath) {
  const png = readFileSync(pngPath); // 缺文件时 ENOENT 自带路径
  const { width, height } = pngDimensions(png);
  const decoded = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", pngPath, "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
    { encoding: "buffer", maxBuffer: 512 * 1024 * 1024 },
  );
  if (decoded.status !== 0 || !decoded.stdout || decoded.stdout.length === 0) {
    throw new Error(
      `帧解码失败: ${pngPath}\n${decoded.stderr?.toString() ?? ""}`.trim(),
    );
  }
  const expectedBytes = width * height * 4;
  if (decoded.stdout.length !== expectedBytes) {
    throw new Error(
      `帧解码长度不符: ${pngPath}（期望 ${expectedBytes} 字节 RGBA，得到 ${decoded.stdout.length}）`,
    );
  }
  const dims = Buffer.alloc(8);
  dims.writeUInt32BE(width, 0);
  dims.writeUInt32BE(height, 4);
  return createHash("sha256")
    .update(Buffer.concat([dims, decoded.stdout]))
    .digest("hex");
}
