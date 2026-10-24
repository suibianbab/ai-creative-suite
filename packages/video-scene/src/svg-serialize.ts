// SvgNode → SVG 字符串的规范实现（自 scripts/video/svg-serialize.mjs 上提，
// 2026-10-24 W2：预览/确认帧与 CLI 导出共用一份转义与结构语义）。
import type { SvgNode } from "./svg.js";

export const MAX_SVG_EXPORT_NODES = 50000;

export function escapeSvg(value: unknown) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function esc(value: unknown) {
  return escapeSvg(value);
}

export function serializeSvgNode(node: SvgNode): string {
  const attrs = Object.entries(node.attrs ?? {})
    .map(([key, value]) => ` ${key}="${esc(value)}"`)
    .join("");
  if (node.text !== undefined)
    return `<${node.tag}${attrs}>${esc(node.text)}</${node.tag}>`;
  if (node.children?.length)
    return `<${node.tag}${attrs}>${node.children.map(serializeSvgNode).join("")}</${node.tag}>`;
  return `<${node.tag}${attrs}/>`;
}

export function countSvgNodes(node: SvgNode): number {
  return (
    1 + (node.children ?? []).reduce((sum, child) => sum + countSvgNodes(child), 0)
  );
}
