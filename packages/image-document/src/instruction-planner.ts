import {
  applyImageOperation,
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
        `暂不支持“${clause.slice(0, 32)}”。可尝试画布、背景、商品位置或标题指令。`,
      );
    }

    // Validate each step against the actual document rules before offering a preview.
    draft = applyImageOperation(draft, operation);
    operations.push(operation);
    summary.push(description);
  }
  return { operations, summary };
}
