import type {
  ImageDocument,
  ImageDocumentLayer,
  ImageLayer,
  LayerMask,
  MaskStroke,
} from "@acs/image-document";

export type ImageAssetMap = Record<string, ImageBitmap>;
const maskedCache = new Map<
  string,
  {
    mask: LayerMask;
    original: ImageBitmap;
    maskBitmap: ImageBitmap;
    canvas: HTMLCanvasElement;
    base: { x: number; y: number } | null;
  }
>();
const recolorCache = new Map<
  string,
  { source: CanvasImageSource; color: string; canvas: HTMLCanvasElement }
>();

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = window.document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function imageAdjustmentFilter(layer: ImageLayer): string {
  const adjustment = layer.adjustments;
  if (!adjustment) return "none";
  const exposure = 2 ** adjustment.exposure;
  const brightness = 1 + adjustment.brightness / 100;
  const contrast = 1 + adjustment.contrast / 100;
  const saturation = 1 + adjustment.saturation / 100;
  return `brightness(${exposure}) brightness(${brightness}) contrast(${contrast}) saturate(${saturation})`;
}

function paintStroke(context: CanvasRenderingContext2D, stroke: MaskStroke) {
  const first = stroke.points[0];
  if (!first) return;
  context.save();
  context.globalCompositeOperation =
    stroke.mode === "erase" ? "destination-out" : "source-over";
  context.strokeStyle = "#ffffff";
  context.fillStyle = "#ffffff";
  context.lineWidth = stroke.radius * 2;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y);
  context.stroke();
  context.beginPath();
  context.arc(first.x, first.y, stroke.radius, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

export function maskedSource(
  layer: ImageLayer,
  assets: ImageAssetMap,
): CanvasImageSource | undefined {
  const original = assets[layer.assetId];
  if (!original) return undefined;
  if (!layer.mask) return original;
  const maskBitmap = assets[layer.mask.assetId];
  if (!maskBitmap) return undefined;
  const cached = maskedCache.get(layer.id);
  if (
    cached?.mask === layer.mask &&
    cached.original === original &&
    cached.maskBitmap === maskBitmap
  )
    return cached.canvas;

  const { sourceWidth: width, sourceHeight: height } = layer;
  const maskCanvas = canvasOf(width, height);
  const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (!maskContext) throw new Error("Mask canvas is unavailable");
  maskContext.drawImage(maskBitmap, 0, 0, width, height);
  const pixels = maskContext.getImageData(0, 0, width, height);
  const data = pixels.data;
  let hasTransparency = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! < 255) {
      hasTransparency = true;
      break;
    }
  }
  for (let i = 0; i < data.length; i += 4) {
    const alpha = hasTransparency
      ? data[i + 3]!
      : Math.round((data[i]! + data[i + 1]! + data[i + 2]!) / 3);
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = alpha;
  }
  maskContext.putImageData(pixels, 0, 0);
  for (const stroke of layer.mask.strokes) paintStroke(maskContext, stroke);

  const alpha = layer.mask.strokes.length
    ? maskContext.getImageData(0, 0, width, height).data
    : data;
  let bottom = -1;
  const minimumRowPixels = Math.max(3, Math.round(width * 0.005));
  for (let y = height - 1; y >= 0 && bottom < 0; y--) {
    let visible = 0;
    for (let x = 0; x < width; x++) {
      if (alpha[(y * width + x) * 4 + 3]! >= 64) {
        visible++;
        if (visible >= minimumRowPixels) {
          bottom = y;
          break;
        }
      }
    }
  }
  let left = width;
  let right = -1;
  if (bottom >= 0) {
    const top = Math.max(0, bottom - Math.round(height * 0.02));
    for (let y = top; y <= bottom; y++) {
      for (let x = 0; x < width; x++) {
        if (alpha[(y * width + x) * 4 + 3]! < 64) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
  }
  const base = right >= left ? { x: (left + right) / 2, y: bottom + 1 } : null;

  const result = canvasOf(width, height);
  const resultContext = result.getContext("2d");
  if (!resultContext) throw new Error("Image canvas is unavailable");
  resultContext.drawImage(original, 0, 0, width, height);
  resultContext.globalCompositeOperation = "destination-in";
  resultContext.drawImage(maskCanvas, 0, 0);
  maskedCache.delete(layer.id);
  if (maskedCache.size >= 8) {
    const oldest = maskedCache.keys().next().value;
    if (oldest) maskedCache.delete(oldest);
  }
  maskedCache.set(layer.id, {
    mask: layer.mask,
    original,
    maskBitmap,
    canvas: result,
    base,
  });
  return result;
}

function recoloredSource(
  layer: ImageLayer,
  assets: ImageAssetMap,
): CanvasImageSource | undefined {
  const source = maskedSource(layer, assets);
  if (!source || !layer.recolor) return source;
  const cached = recolorCache.get(layer.id);
  if (cached?.source === source && cached.color === layer.recolor)
    return cached.canvas;
  const canvas = canvasOf(layer.sourceWidth, layer.sourceHeight);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Recolor canvas is unavailable");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = image.data;
  const color = layer.recolor;
  const target = [1, 3, 5].map((offset) =>
    Number.parseInt(color.slice(offset, offset + 2), 16),
  );
  if (color.toLowerCase() === "#000000") target.fill(34);
  // Preserve source shading while replacing hue. The original bitmap is never changed.
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    const luminance =
      (pixels[i]! * 0.2126 +
        pixels[i + 1]! * 0.7152 +
        pixels[i + 2]! * 0.0722) /
      255;
    const shade = 0.45 + luminance * 1.45;
    for (let channel = 0; channel < 3; channel++)
      pixels[i + channel] = Math.min(255, Math.round(target[channel]! * shade));
  }
  context.putImageData(image, 0, 0);
  recolorCache.delete(layer.id);
  if (recolorCache.size >= 8) {
    const oldest = recolorCache.keys().next().value;
    if (oldest) recolorCache.delete(oldest);
  }
  recolorCache.set(layer.id, { source, color, canvas });
  return canvas;
}

export function visibleProductBase(
  layer: ImageLayer,
  assets: ImageAssetMap,
): { x: number; y: number } | null {
  if (!layer.mask || !maskedSource(layer, assets)) return null;
  const base = maskedCache.get(layer.id)?.base;
  if (!base) return null;
  const crop = layer.crop ?? {
    x: 0,
    y: 0,
    width: layer.sourceWidth,
    height: layer.sourceHeight,
  };
  const baseX = Math.max(crop.x, Math.min(crop.x + crop.width, base.x));
  const baseY = Math.max(crop.y, Math.min(crop.y + crop.height, base.y));
  return {
    x: layer.x + ((baseX - crop.x) / crop.width) * layer.width,
    y: layer.y + ((baseY - crop.y) / crop.height) * layer.height,
  };
}

function drawContactShadow(
  context: CanvasRenderingContext2D,
  layer: ImageLayer,
  assets: ImageAssetMap,
) {
  const shadow = layer.contactShadow;
  if (!shadow || !layer.mask || shadow.opacity === 0) return;
  const red = Number.parseInt(shadow.color.slice(1, 3), 16);
  const green = Number.parseInt(shadow.color.slice(3, 5), 16);
  const blue = Number.parseInt(shadow.color.slice(5, 7), 16);
  const rgba = (opacity: number) =>
    `rgba(${red}, ${green}, ${blue}, ${opacity})`;
  const base = visibleProductBase(layer, assets);
  if (!base) return;
  const centerX = base.x + shadow.offsetX;
  const centerY = base.y + shadow.offsetY;
  context.save();
  context.translate(centerX, centerY);
  context.scale((layer.width * shadow.widthScale) / 2, shadow.depth);
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, rgba(shadow.opacity));
  gradient.addColorStop(0.45, rgba(shadow.opacity * 0.55));
  gradient.addColorStop(1, rgba(0));
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(0, 0, 1, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

export function drawImageDocument(
  context: CanvasRenderingContext2D,
  document: ImageDocument,
  assets: ImageAssetMap,
  selectedLayerId?: string,
  transparentBackground = false,
): void {
  const { width, height, background } = document.canvas;
  context.clearRect(0, 0, width, height);
  if (!transparentBackground) {
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
  }

  for (const layer of document.layers) {
    if (layer.kind === "image") drawContactShadow(context, layer, assets);
    context.save();
    context.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
    context.rotate((layer.rotation * Math.PI) / 180);
    context.globalAlpha = layer.opacity;

    if (layer.kind === "image") {
      const bitmap = recoloredSource(layer, assets);
      if (bitmap) {
        const crop = layer.crop ?? {
          x: 0,
          y: 0,
          width: layer.sourceWidth,
          height: layer.sourceHeight,
        };
        context.filter = imageAdjustmentFilter(layer);
        context.drawImage(
          bitmap,
          crop.x,
          crop.y,
          crop.width,
          crop.height,
          -layer.width / 2,
          -layer.height / 2,
          layer.width,
          layer.height,
        );
        context.filter = "none";
      }
    } else {
      context.fillStyle = layer.color;
      context.font = `700 ${layer.fontSize}px ${layer.fontFamily}`;
      context.textBaseline = "middle";
      context.fillText(layer.text, -layer.width / 2, 0, layer.width);
    }

    context.globalAlpha = 1;
    if (selectedLayerId === layer.id) {
      context.strokeStyle = "#2b806a";
      context.lineWidth = Math.max(2, width / 540);
      context.setLineDash([10, 7]);
      context.strokeRect(
        -layer.width / 2,
        -layer.height / 2,
        layer.width,
        layer.height,
      );
      context.setLineDash([]);
    }
    context.restore();
  }
}

export function hitTestLayer(
  layer: ImageDocumentLayer,
  x: number,
  y: number,
): boolean {
  const centerX = layer.x + layer.width / 2;
  const centerY = layer.y + layer.height / 2;
  const radians = (-layer.rotation * Math.PI) / 180;
  const dx = x - centerX;
  const dy = y - centerY;
  const localX = dx * Math.cos(radians) - dy * Math.sin(radians);
  const localY = dx * Math.sin(radians) + dy * Math.cos(radians);
  return (
    Math.abs(localX) <= layer.width / 2 && Math.abs(localY) <= layer.height / 2
  );
}
