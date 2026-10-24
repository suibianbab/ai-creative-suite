// D4 导出扩充（spec R2）：SvgNode 纯数据树 → 可独立打开的 SVG 文件字符串。
// 节点级转义/序列化/计数自 2026-10-24 起上提至 @acs/video-scene（W2 预览/
// 确认帧与 CLI 共用一份语义）；本文件保留画布封装与动画/静态导出器。
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const {
  MAX_SVG_EXPORT_NODES,
  serializeSvgNode,
  countSvgNodes,
  escapeSvg,
} = await import(
  pathToFileURL(path.join(ROOT, "packages/video-scene/dist/index.js")).href
);

export { MAX_SVG_EXPORT_NODES };
export const serializeNode = serializeSvgNode;
export const countNodes = countSvgNodes;

// 切片百分比：足够分辨率且末帧终点恰为 100%。
function pct(index, frameCount) {
  return String(Number(((index * 100) / frameCount).toFixed(4)));
}

function canvas(svgBody, { width, height, background }) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="NotoSansSC, sans-serif">` +
    `<rect width="${width}" height="${height}" fill="${escapeSvg(background)}"/>` +
    svgBody +
    `</svg>\n`
  );
}

export function buildAnimatedSvg({
  renderFrame,
  frameCount,
  fps,
  width,
  height,
  background,
  maxNodes = MAX_SVG_EXPORT_NODES,
}) {
  if (frameCount < 2)
    throw new Error(
      `采样帧数 ${frameCount} 不足 2，动画无从谈起；单帧用 --frame 出静态 SVG`,
    );
  const groups = [];
  const rules = [];
  let totalNodes = 0;
  for (let index = 0; index < frameCount; index++) {
    const node = renderFrame(index);
    totalNodes += countNodes(node);
    if (totalNodes > maxNodes)
      throw new Error(
        `SVG 导出节点预算超限（${totalNodes} > ${maxNodes}），建议 --fps 降采样`,
      );
    groups.push(`<g class="kf kf-${index}">${serializeNode(node)}</g>`);
    rules.push(
      `@keyframes kf-${index} {${pct(index, frameCount)}% {opacity: 1;} ${pct(index + 1, frameCount)}% {opacity: 0;}}`,
      `.kf-${index} {opacity: 0; animation: kf-${index} ${(frameCount / fps).toFixed(3)}s steps(1, end) infinite;}`,
    );
  }
  const svg = canvas(`<style>${rules.join("")}</style>${groups.join("")}`, {
    width,
    height,
    background,
  });
  return { svg, totalNodes };
}

export function buildStaticSvg({
  renderFrame,
  frame,
  width,
  height,
  background,
  maxNodes = MAX_SVG_EXPORT_NODES,
}) {
  const node = renderFrame(frame);
  const totalNodes = countNodes(node);
  if (totalNodes > maxNodes)
    throw new Error(`SVG 导出节点预算超限（${totalNodes} > ${maxNodes}）`);
  return {
    svg: canvas(serializeNode(node), { width, height, background }),
    totalNodes,
  };
}
