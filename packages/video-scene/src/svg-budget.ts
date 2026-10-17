import type { SvgNode } from "./svg.js";

// ADR 0003 §2.4 资源限制：组件渲染输出的元素数上限。spec 字节上限与
// params 条目上限挡住入站，这里挡出站——超出即拒绝渲染，而不是让渲染端
// 在病态节点树上耗尽资源。
export const MAX_RENDER_NODES = 2000;

export class SceneResourceError extends Error {}

function countNodes(node: SvgNode): number {
  let total = 1;
  for (const child of node.children ?? []) total += countNodes(child);
  return total;
}

// 渲染桥接层每帧调用：超上限抛 SceneResourceError（报出实际节点数与上限）。
export function assertNodeBudget(
  node: SvgNode,
  cap: number = MAX_RENDER_NODES,
): void {
  const count = countNodes(node);
  if (count > cap) {
    throw new SceneResourceError(
      `渲染输出元素节点 ${count} 超过上限 ${cap}（ADR 0003 §2.4）`,
    );
  }
}
