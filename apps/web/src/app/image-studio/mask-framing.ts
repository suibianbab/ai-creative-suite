import { frameFromSubjectBounds, type ImageFrame } from "@acs/image-document";

export function frameFromMask(
  bitmap: ImageBitmap,
  canvas: { width: number; height: number },
): ImageFrame | null {
  const sampleScale = Math.min(1, 768 / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * sampleScale));
  const height = Math.max(1, Math.round(bitmap.height * sampleScale));
  const sample = document.createElement("canvas");
  sample.width = width;
  sample.height = height;
  const context = sample.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  let hasTransparency = false;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i]! < 255) {
      hasTransparency = true;
      break;
    }
  }
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const opacity = hasTransparency
        ? pixels[i + 3]!
        : (pixels[i]! + pixels[i + 1]! + pixels[i + 2]!) / 3;
      if (opacity < 40) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) return null;
  const bounds = {
    x: Math.floor((left * bitmap.width) / width),
    y: Math.floor((top * bitmap.height) / height),
    width:
      Math.min(bitmap.width, Math.ceil(((right + 1) * bitmap.width) / width)) -
      Math.floor((left * bitmap.width) / width),
    height:
      Math.min(
        bitmap.height,
        Math.ceil(((bottom + 1) * bitmap.height) / height),
      ) - Math.floor((top * bitmap.height) / height),
  };
  return frameFromSubjectBounds(
    { width: bitmap.width, height: bitmap.height },
    canvas,
    bounds,
  );
}
