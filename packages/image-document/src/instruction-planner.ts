import {
  applyImageOperation,
  type ImageAdjustments,
  type ImageDocument,
  type ImageDocumentLayer,
  type ImageOperation,
  type TextLayer,
} from "./index.js";

export type ImageInstructionPlan = {
  operations: ImageOperation[];
  summary: string[];
};

const canvasPresets: Record<string, { width: number; height: number }> = {
  方图: { width: 1080, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  竖图: { width: 1080, height: 1350 },
  "4:5": { width: 1080, height: 1350 },
  横图: { width: 1920, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
};

const colors: Record<string, string> = {
  白色: "#ffffff",
  黑色: "#000000",
  浅灰色: "#f2f2f2",
  红色: "#dc2828",
  蓝色: "#2878d8",
  绿色: "#278b53",
  黄色: "#e7bd28",
  粉色: "#e68fae",
};

function targetLayer(
  document: ImageDocument,
  selectedId: string | null,
  kind: "image" | "text",
): ImageDocumentLayer {
  const selected = document.layers.find((layer) => layer.id === selectedId);
  if (selected?.kind === kind) return selected;
  const matches = document.layers.filter((layer) => layer.kind === kind);
  if (matches.length === 1) return matches[0]!;
  throw new Error(
    matches.length === 0
      ? `请先添加${kind === "image" ? "图片" : "文字"}图层。`
      : `请先选中要编辑的${kind === "image" ? "图片" : "文字"}图层。`,
  );
}

/** A deliberately small local planner. Unknown requests fail rather than edit partially. */
export function planImageInstruction(
  document: ImageDocument,
  selectedId: string | null,
  input: string,
  createId: () => string,
): ImageInstructionPlan {
  const instruction = input.trim();
  if (!instruction || instruction.length > 240)
    throw new Error("请输入不超过 240 字的编辑要求。");
  const clauses = instruction
    .split(/[；;\n]+/)
    .map((part) => part.trim().replace(/[。！!]+$/, ""))
    .filter(Boolean);
  if (clauses.length === 0 || clauses.length > 4)
    throw new Error("请用分号分隔，最多输入 4 条编辑要求。");

  const operations: ImageOperation[] = [];
  const summary: string[] = [];
  let draft = document;
  for (const clause of clauses) {
    let operation: ImageOperation | undefined;
    let description = "";
    const canvas = clause.match(
      /^(?:把)?(?:画布|图片|图像)?\s*(?:改成|调整为|设为)\s*(方图|竖图|横图|1:1|4:5|16:9)$/,
    );
    const background = clause.match(
      /^(?:把)?(?:画布)?背景\s*(?:改成|设为|换成)\s*(白色|黑色|浅灰色|#[0-9a-fA-F]{6})$/,
    );
    const position = clause.match(
      /^(?:把)?(?:商品|图片|图层|它|选中图层)\s*(?:移到|放到)\s*(左边|右边|中间|顶部|底部)$/,
    );
    const adjustment = clause.match(
      /^(?:把)?(?:商品|图片|图像|选中图层)?\s*(亮度|对比度|饱和度|曝光)\s*(调到|设为|改为|提高|增加|降低|减少)\s*(-?\d+(?:\.\d+)?)\s*(?:档)?$/,
    );
    const recolor = clause.match(
      /^(?:(?:把|将)\s*)?(?:商品|产品|帽子|小帽|选中图层)(?:的)?(?:颜色|色彩)\s*(?:改成|改为|换成|设为|调整为)\s*(黑色|白色|红色|蓝色|绿色|黄色|粉色|#[0-9a-fA-F]{6})$/,
    );
    const addTitle = clause.match(/^添加标题\s*[：:]\s*(.+)$/);
    const editTitle = clause.match(
      /^(?:把)?(?:标题|选中文字)\s*(?:改成|改为|设为)\s*(.+)$/,
    );

    if (canvas) {
      const preset = canvasPresets[canvas[1]!]!;
      operation = { type: "resizeCanvas", ...preset };
      description = `画布调整为 ${canvas[1]}`;
    } else if (background) {
      const value = background[1]!;
      operation = {
        type: "setCanvas",
        patch: { background: colors[value] ?? value.toLowerCase() },
      };
      description = `背景改为 ${value}`;
    } else if (position) {
      const layer = targetLayer(draft, selectedId, "image");
      const horizontal = {
        左边: Math.round(draft.canvas.width * 0.06),
        右边: Math.round(draft.canvas.width * 0.94 - layer.width),
        中间: Math.round((draft.canvas.width - layer.width) / 2),
      };
      const vertical = {
        顶部: Math.round(draft.canvas.height * 0.06),
        底部: Math.round(draft.canvas.height * 0.94 - layer.height),
      };
      const place = position[1]!;
      operation = {
        type: "transform",
        layerId: layer.id,
        patch:
          place in horizontal
            ? { x: horizontal[place as keyof typeof horizontal] }
            : { y: vertical[place as keyof typeof vertical] },
      };
      description = `商品移到${place}`;
    } else if (adjustment) {
      const layer = targetLayer(draft, selectedId, "image");
      const key = {
        亮度: "brightness",
        对比度: "contrast",
        饱和度: "saturation",
        曝光: "exposure",
      }[adjustment[1]!] as keyof ImageAdjustments;
      const verb = adjustment[2]!;
      const amount = Number(adjustment[3]);
      const current =
        layer.kind === "image" ? (layer.adjustments?.[key] ?? 0) : 0;
      const value =
        verb === "提高" || verb === "增加"
          ? current + amount
          : verb === "降低" || verb === "减少"
            ? current - amount
            : amount;
      operation = {
        type: "setAdjustments",
        layerId: layer.id,
        patch: { [key]: value },
      };
      description = `${adjustment[1]}调整为 ${value}${key === "exposure" ? " 档" : ""}`;
    } else if (recolor) {
      const layer = targetLayer(draft, selectedId, "image");
      if (layer.kind !== "image" || !layer.mask)
        throw new Error(
          "换商品颜色需要先抠图：选中帽子图片，在右侧图片设置中点击“自动抠图（本机）”，检查蒙版后再预览这条指令。",
        );
      const color = recolor[1]!;
      operation = {
        type: "setRecolor",
        layerId: layer.id,
        color: colors[color] ?? color.toLowerCase(),
      };
      description = `商品近似换色为 ${color}（整块蒙版区域，需检查纹理和标志）`;
    } else if (addTitle) {
      const value = addTitle[1]!.trim();
      if (!value || value.length > 80) throw new Error("标题需要 1–80 个字。");
      const fontSize = Math.round(
        Math.min(draft.canvas.width * 0.055, draft.canvas.height * 0.07),
      );
      const layer: TextLayer = {
        id: createId(),
        kind: "text",
        name: "标题文字",
        text: value,
        fontSize,
        color: "#173f3b",
        fontFamily: "Arial, sans-serif",
        x: Math.round(draft.canvas.width * 0.06),
        y: Math.round(draft.canvas.height * 0.03),
        width: Math.round(draft.canvas.width * 0.88),
        height: Math.round(fontSize * 1.5),
        rotation: 0,
        opacity: 1,
      };
      operation = { type: "addText", layer };
      description = `添加标题「${value}」`;
    } else if (editTitle) {
      const value = editTitle[1]!
        .trim()
        .replace(/^[「“]/, "")
        .replace(/[」”]$/, "");
      if (!value || value.length > 80) throw new Error("标题需要 1–80 个字。");
      const layer = targetLayer(draft, selectedId, "text");
      operation = { type: "editText", layerId: layer.id, text: value };
      description = `标题改为「${value}」`;
    } else {
      throw new Error(
        `暂不支持“${clause.slice(0, 32)}”。可尝试画布、背景、商品位置、基础调色或标题指令。`,
      );
    }

    // Validate each step against the actual document rules before offering a preview.
    draft = applyImageOperation(draft, operation);
    operations.push(operation);
    summary.push(description);
  }
  return { operations, summary };
}
