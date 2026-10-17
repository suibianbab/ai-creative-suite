// C 项（第六轮整改）：候选真实像素蒙版 —— 浏览器侧解码与坐标契约。
//
// 坐标契约（与服务端 parts-candidates.py docstring、桥 dev-bridge.mjs 对齐）：
// mask_png_b64 是 base64 的 8bit 灰度 PNG（255=选中），像素空间 = 服务返回图
// （exif_transpose 后、最长边 ≤1024 LANCZOS，不再二次缩放），与 bounds/outline
// 同空间。EXIF 两端已归一：服务转置在前，浏览器 <img> 的 naturalWidth/Height
// 默认应用 EXIF 方向（.pcraft/.psd 预览是桥栅格 PNG，无 EXIF）。消费方把蒙版
// 画到 sampleSize（=文档尺寸）画布后按平滑插值重采样，再以 ≥MASK_THRESHOLD
// 二值化——0/255 蒙版线性插值后在 128 阈值下边界稳定。桥端在 instruction 阶段
// 与文档尺寸强校验（失配 400 → 退回轮廓套索），绝不产生错位选区。

/** 二值化阈值：红通道 ≥128 视为选中（与 provider 蒙版解码口径一致）。 */
export const MASK_THRESHOLD = 128;

/** 将画布缩放后的灰阶像素真正写成 0/255，供 PhotoCraft 原生选区使用。 */
export function binarizeMaskPixels(data: Uint8ClampedArray): number {
  let selected = 0;
  for (let i = 0; i < data.length; i += 4) {
    const value = (data[i] ?? 0) >= MASK_THRESHOLD ? 255 : 0;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
    if (value === 255) selected += 1;
  }
  return selected;
}

/** 仅蒙版自身失效时允许以已确认的轮廓重试，其他编辑错误原样呈现。 */
export function shouldRetryCandidateMaskAsOutline(
  error: unknown,
  outlineLength: number,
): boolean {
  return (
    typeof error === "string" &&
    error.includes("候选蒙版") &&
    outlineLength >= 3
  );
}

const BASE64_STRICT = /^[A-Za-z0-9+/]+={0,2}$/;

export type DecodedMaskPng = Readonly<{
  // Uint8Array<ArrayBuffer>（而非 ArrayBufferLike）：Blob 构造要求视图底层
  // 是 ArrayBuffer，页面代码直接 new Blob([decoded.bytes]) 无需再拷贝。
  bytes: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
}>;

/**
 * 解码候选蒙版：严格 base64 → PNG 魔数 → IHDR 宽高（DataView，无 Buffer 依赖）。
 * 结构可疑（非法 base64 / 非 PNG / 头截断 / 非正尺寸）一律返回 null，调用方
 * 退回轮廓套索选区——坏蒙版不该让确认环死掉。
 */
export function decodeMaskPng(b64: unknown): DecodedMaskPng | null {
  if (typeof b64 !== "string" || b64.length === 0) return null;
  if (!BASE64_STRICT.test(b64) || b64.length % 4 !== 0) return null;
  let binary: string;
  try {
    binary = atob(b64);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  // PNG 签名 + IHDR：偏移 16-19 宽、20-23 高（bit depth/颜色类型由服务端契约
  // 与 grounding-contract.mjs 钉死，浏览器侧不重复解码像素前只需尺寸）。
  if (bytes.length < 26) return null;
  if (
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  )
    return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!Number.isSafeInteger(width) || width <= 0 || height <= 0) return null;
  return { bytes, width, height };
}
