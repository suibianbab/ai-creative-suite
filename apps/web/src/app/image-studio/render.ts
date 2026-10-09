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
  }
>();

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = window.document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
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
  });
  return result;
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
    context.save();
    context.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
    context.rotate((layer.rotation * Math.PI) / 180);
    context.globalAlpha = layer.opacity;

    if (layer.kind === "image") {
      const bitmap = maskedSource(layer, assets);
      if (bitmap) {
        const crop = layer.crop ?? {
          x: 0,
          y: 0,
          width: layer.sourceWidth,
          height: layer.sourceHeight,
        };
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
