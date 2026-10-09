export type CropRect = { x: number; y: number; width: number; height: number };
export type ImageFrame = CropRect & { crop: CropRect };

export type MaskStroke = {
  mode: "erase" | "restore";
  radius: number;
  points: { x: number; y: number }[];
};

export type LayerMask = {
  assetId: string;
  strokes: MaskStroke[];
};

export type ImageLayer = {
  id: string;
  kind: "image";
  name: string;
  assetId: string;
  sourceWidth: number;
  sourceHeight: number;
  crop?: CropRect;
  mask?: LayerMask;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
};

export type TextLayer = {
  id: string;
  kind: "text";
  name: string;
  text: string;
  fontSize: number;
  color: string;
  fontFamily: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
};

export type ImageDocumentLayer = ImageLayer | TextLayer;

export type ImageDocument = {
  schemaVersion: 1;
  id: string;
  canvas: { width: number; height: number; background: string };
  productIdentityLock: true;
  layers: ImageDocumentLayer[];
};

export type ImageOperation =
  | { type: "addImage"; layer: ImageLayer }
  | { type: "addText"; layer: TextLayer }
  | {
      type: "transform";
      layerId: string;
      patch: Partial<
        Pick<
          ImageDocumentLayer,
          "x" | "y" | "width" | "height" | "rotation" | "opacity"
        >
      >;
    }
  | {
      type: "editText";
      layerId: string;
      text: string;
      color?: string;
      fontSize?: number;
    }
  | { type: "removeLayer"; layerId: string }
  | { type: "setCrop"; layerId: string; crop: CropRect | null }
  | {
      type: "setMask";
      layerId: string;
      assetId: string | null;
      frame?: ImageFrame;
    }
  | { type: "frameImage"; layerId: string; frame: ImageFrame }
  | { type: "paintMask"; layerId: string; stroke: MaskStroke }
  | { type: "moveLayer"; layerId: string; direction: "up" | "down" }
  | { type: "resizeCanvas"; width: number; height: number }
  | { type: "setCanvas"; patch: Partial<ImageDocument["canvas"]> };

export type ImageHistory = {
  past: ImageDocument[];
  present: ImageDocument;
  future: ImageDocument[];
};

export type ImageCapability =
  | "asset-placement"
  | "transform"
  | "basic-text"
  | "canvas"
  | "crop"
  | "mask-refine"
  | "remove-bg";
export type CapabilityExecutor = "native" | "photocraft" | "ai-provider";

export function routeImageCapability(
  capability: ImageCapability,
): CapabilityExecutor {
  switch (capability) {
    case "asset-placement":
    case "transform":
    case "basic-text":
    case "canvas":
    case "crop":
    case "mask-refine":
      return "native";
    case "remove-bg":
      return "ai-provider";
  }
}

export function createImageDocument(id: string): ImageDocument {
  return {
    schemaVersion: 1,
    id,
    canvas: { width: 1080, height: 1080, background: "#ffffff" },
    productIdentityLock: true,
    layers: [],
  };
}

export function createImageHistory(document: ImageDocument): ImageHistory {
  return { past: [], present: document, future: [] };
}

function validateTransform(layer: ImageDocumentLayer): void {
  for (const value of [
    layer.x,
    layer.y,
    layer.width,
    layer.height,
    layer.rotation,
    layer.opacity,
  ]) {
    if (!Number.isFinite(value))
      throw new Error("Layer transform must be finite");
  }
  if (layer.width <= 0 || layer.height <= 0)
    throw new Error("Layer size must be positive");
  if (layer.opacity < 0 || layer.opacity > 1)
    throw new Error("Layer opacity must be between 0 and 1");
}

function validateLayer(layer: ImageDocumentLayer): void {
  validateTransform(layer);
  if (!layer.id || !layer.name) throw new Error("Layer identity is required");
  if (layer.kind === "image") {
    if (!layer.assetId) throw new Error("Image asset ID is required");
    if (layer.mask) {
      if (!layer.mask.assetId || !Array.isArray(layer.mask.strokes))
        throw new Error("Mask asset and strokes are required");
      for (const stroke of layer.mask.strokes)
        validateMaskStroke(stroke, layer);
    }
    if (
      !Number.isFinite(layer.sourceWidth) ||
      !Number.isFinite(layer.sourceHeight) ||
      layer.sourceWidth <= 0 ||
      layer.sourceHeight <= 0
    ) {
      throw new Error("Image source dimensions must be positive");
    }
    const crop = layer.crop ?? {
      x: 0,
      y: 0,
      width: layer.sourceWidth,
      height: layer.sourceHeight,
    };
    for (const value of [crop.x, crop.y, crop.width, crop.height]) {
      if (!Number.isInteger(value))
        throw new Error("Crop coordinates must be integers");
    }
    if (
      crop.x < 0 ||
      crop.y < 0 ||
      crop.width < 1 ||
      crop.height < 1 ||
      crop.x + crop.width > layer.sourceWidth ||
      crop.y + crop.height > layer.sourceHeight
    ) {
      throw new Error("Crop must remain within the original image");
    }
    if (
      Math.abs(layer.width - (layer.height * crop.width) / crop.height) > 1.5
    ) {
      throw new Error(
        "Product Identity Lock requires proportional image scaling",
      );
    }
  }
  if (
    layer.kind === "text" &&
    (!Number.isFinite(layer.fontSize) || layer.fontSize <= 0)
  ) {
    throw new Error("Text font size must be positive");
  }
}

function validateMaskStroke(stroke: MaskStroke, layer: ImageLayer): void {
  if (
    (stroke.mode !== "erase" && stroke.mode !== "restore") ||
    !Number.isFinite(stroke.radius) ||
    stroke.radius < 1 ||
    stroke.radius > Math.max(layer.sourceWidth, layer.sourceHeight) / 2 ||
    !Array.isArray(stroke.points) ||
    stroke.points.length < 1 ||
    stroke.points.length > 10000 ||
    stroke.points.some(
      ({ x, y }) =>
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        y < 0 ||
        x > layer.sourceWidth ||
        y > layer.sourceHeight,
    )
  ) {
    throw new Error("Mask stroke is outside the original image");
  }
}

function updateLayer(
  document: ImageDocument,
  layerId: string,
  updater: (layer: ImageDocumentLayer) => ImageDocumentLayer,
): ImageDocument {
  let found = false;
  const layers = document.layers.map((layer) => {
    if (layer.id !== layerId) return layer;
    found = true;
    const next = updater(layer);
    validateLayer(next);
    return next;
  });
  if (!found) throw new Error("Layer not found");
  return { ...document, layers };
}

function withFrame(layer: ImageLayer, frame: ImageFrame): ImageLayer {
  return {
    ...layer,
    crop: frame.crop,
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
  };
}

export function frameFromSubjectBounds(
  source: { width: number; height: number },
  canvas: { width: number; height: number },
  bounds: CropRect,
): ImageFrame | null {
  if (
    ![
      source.width,
      source.height,
      canvas.width,
      canvas.height,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
    ].every(Number.isFinite) ||
    source.width < 1 ||
    source.height < 1 ||
    canvas.width < 1 ||
    canvas.height < 1 ||
    bounds.width < 1 ||
    bounds.height < 1 ||
    bounds.x < 0 ||
    bounds.y < 0 ||
    bounds.x + bounds.width > source.width ||
    bounds.y + bounds.height > source.height
  )
    return null;
  const padX = Math.max(2, Math.round(bounds.width * 0.05));
  const padY = Math.max(2, Math.round(bounds.height * 0.05));
  const x = Math.max(0, Math.floor(bounds.x - padX));
  const y = Math.max(0, Math.floor(bounds.y - padY));
  const right = Math.min(
    source.width,
    Math.ceil(bounds.x + bounds.width + padX),
  );
  const bottom = Math.min(
    source.height,
    Math.ceil(bounds.y + bounds.height + padY),
  );
  const crop = { x, y, width: right - x, height: bottom - y };
  const scale = Math.min(
    (canvas.width * 0.78) / crop.width,
    (canvas.height * 0.78) / crop.height,
  );
  const width = Math.max(1, Math.round(crop.width * scale));
  const height = Math.max(1, Math.round(crop.height * scale));
  return {
    crop,
    x: Math.round((canvas.width - width) / 2),
    y: Math.round((canvas.height - height) / 2),
    width,
    height,
  };
}

export function applyImageOperation(
  document: ImageDocument,
  operation: ImageOperation,
): ImageDocument {
  switch (operation.type) {
    case "addImage":
    case "addText": {
      const capability =
        operation.type === "addImage" ? "asset-placement" : "basic-text";
      routeImageCapability(capability);
      validateLayer(operation.layer);
      if (document.layers.some((layer) => layer.id === operation.layer.id)) {
        throw new Error("Layer ID already exists");
      }
      return {
        ...document,
        layers: [...document.layers, { ...operation.layer }],
      };
    }
    case "transform":
      routeImageCapability("transform");
      return updateLayer(document, operation.layerId, (layer) => {
        const allowed = new Set([
          "x",
          "y",
          "width",
          "height",
          "rotation",
          "opacity",
        ]);
        if (Object.keys(operation.patch).some((key) => !allowed.has(key))) {
          throw new Error(
            "Transform cannot change layer identity or asset reference",
          );
        }
        if (layer.kind === "image") {
          const { width, height } = operation.patch;
          const crop = layer.crop ?? {
            width: layer.sourceWidth,
            height: layer.sourceHeight,
          };
          if (width !== undefined && height === undefined) {
            return {
              ...layer,
              ...operation.patch,
              height: Math.round((width * crop.height) / crop.width),
            };
          }
          if (height !== undefined && width === undefined) {
            return {
              ...layer,
              ...operation.patch,
              width: Math.round((height * crop.width) / crop.height),
            };
          }
        }
        return { ...layer, ...operation.patch };
      });
    case "editText":
      routeImageCapability("basic-text");
      return updateLayer(document, operation.layerId, (layer) => {
        if (layer.kind !== "text")
          throw new Error("Only text layers can be edited as text");
        return {
          ...layer,
          text: operation.text,
          color: operation.color ?? layer.color,
          fontSize: operation.fontSize ?? layer.fontSize,
        };
      });
    case "setCrop":
      routeImageCapability("crop");
      return updateLayer(document, operation.layerId, (layer) => {
        if (layer.kind !== "image")
          throw new Error("Only image layers can be cropped");
        const previous = layer.crop ?? {
          x: 0,
          y: 0,
          width: layer.sourceWidth,
          height: layer.sourceHeight,
        };
        const next = operation.crop ?? {
          x: 0,
          y: 0,
          width: layer.sourceWidth,
          height: layer.sourceHeight,
        };
        const scale = layer.width / previous.width;
        const width = next.width * scale;
        const height = next.height * scale;
        const offsetX =
          (next.x + next.width / 2 - previous.x - previous.width / 2) * scale;
        const offsetY =
          (next.y + next.height / 2 - previous.y - previous.height / 2) * scale;
        const radians = (layer.rotation * Math.PI) / 180;
        const centerX = layer.x + layer.width / 2;
        const centerY = layer.y + layer.height / 2;
        return {
          ...layer,
          crop: operation.crop ?? undefined,
          width,
          height,
          x:
            centerX +
            offsetX * Math.cos(radians) -
            offsetY * Math.sin(radians) -
            width / 2,
          y:
            centerY +
            offsetX * Math.sin(radians) +
            offsetY * Math.cos(radians) -
            height / 2,
        };
      });
    case "setMask":
      routeImageCapability("mask-refine");
      return updateLayer(document, operation.layerId, (layer) => {
        if (layer.kind !== "image")
          throw new Error("Only image layers can have masks");
        if (operation.frame && !operation.assetId)
          throw new Error("A mask is required for automatic framing");
        const masked: ImageLayer = {
          ...layer,
          mask: operation.assetId
            ? { assetId: operation.assetId, strokes: [] }
            : undefined,
        };
        return operation.frame ? withFrame(masked, operation.frame) : masked;
      });
    case "frameImage":
      routeImageCapability("crop");
      return updateLayer(document, operation.layerId, (layer) => {
        if (layer.kind !== "image" || !layer.mask)
          throw new Error("A masked image is required for automatic framing");
        return withFrame(layer, operation.frame);
      });
    case "paintMask":
      routeImageCapability("mask-refine");
      return updateLayer(document, operation.layerId, (layer) => {
        if (layer.kind !== "image" || !layer.mask)
          throw new Error("Import a mask before refining it");
        validateMaskStroke(operation.stroke, layer);
        return {
          ...layer,
          mask: {
            ...layer.mask,
            strokes: [...layer.mask.strokes, operation.stroke],
          },
        };
      });
    case "removeLayer":
      if (!document.layers.some((layer) => layer.id === operation.layerId))
        throw new Error("Layer not found");
      return {
        ...document,
        layers: document.layers.filter(
          (layer) => layer.id !== operation.layerId,
        ),
      };
    case "moveLayer": {
      const index = document.layers.findIndex(
        (layer) => layer.id === operation.layerId,
      );
      if (index < 0) throw new Error("Layer not found");
      const target = index + (operation.direction === "up" ? 1 : -1);
      if (target < 0 || target >= document.layers.length) return document;
      const layers = [...document.layers];
      [layers[index], layers[target]] = [layers[target]!, layers[index]!];
      return { ...document, layers };
    }
    case "resizeCanvas": {
      routeImageCapability("canvas");
      const { width, height } = operation;
      if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width < 1 ||
        height < 1
      ) {
        throw new Error("Canvas dimensions must be positive integers");
      }
      if (width === document.canvas.width && height === document.canvas.height)
        return document;
      const shiftX = (width - document.canvas.width) / 2;
      const shiftY = (height - document.canvas.height) / 2;
      const layers = document.layers.map((layer) =>
        layer.kind === "image"
          ? {
              ...layer,
              x: Math.round(layer.x + shiftX),
              y: Math.round(layer.y + shiftY),
            }
          : {
              ...layer,
              x: Math.round((layer.x / document.canvas.width) * width),
              y: Math.round((layer.y / document.canvas.height) * height),
            },
      );
      return {
        ...document,
        canvas: { ...document.canvas, width, height },
        layers,
      };
    }
    case "setCanvas": {
      routeImageCapability("canvas");
      if ("width" in operation.patch || "height" in operation.patch) {
        throw new Error("Use resizeCanvas to change dimensions");
      }
      const canvas = { ...document.canvas, ...operation.patch };
      if (
        !Number.isInteger(canvas.width) ||
        !Number.isInteger(canvas.height) ||
        canvas.width < 1 ||
        canvas.height < 1
      ) {
        throw new Error("Canvas dimensions must be positive integers");
      }
      if (!/^#[0-9a-fA-F]{6}$/.test(canvas.background))
        throw new Error("Canvas background must be a hex color");
      return { ...document, canvas };
    }
  }
}

export function commitImageOperation(
  history: ImageHistory,
  operation: ImageOperation,
): ImageHistory {
  const next = applyImageOperation(history.present, operation);
  if (next === history.present) return history;
  return {
    past: [...history.past, history.present].slice(-100),
    present: next,
    future: [],
  };
}

/** Apply a proposed edit as one undo step, or leave the history untouched on failure. */
export function commitImageOperations(
  history: ImageHistory,
  operations: readonly ImageOperation[],
): ImageHistory {
  if (operations.length === 0) throw new Error("An edit needs an operation");
  const next = operations.reduce(applyImageOperation, history.present);
  if (next === history.present) return history;
  return {
    past: [...history.past, history.present].slice(-100),
    present: next,
    future: [],
  };
}

export function undoImageOperation(history: ImageHistory): ImageHistory {
  if (history.past.length === 0) return history;
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1]!,
    future: [history.present, ...history.future],
  };
}

export function redoImageOperation(history: ImageHistory): ImageHistory {
  if (history.future.length === 0) return history;
  return {
    past: [...history.past, history.present],
    present: history.future[0]!,
    future: history.future.slice(1),
  };
}

export type { ImageInstructionPlan } from "./instruction-planner.js";
export { planImageInstruction } from "./instruction-planner.js";
