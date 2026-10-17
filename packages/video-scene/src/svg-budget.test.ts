// P2-A（ADR 0003 §2.4）：渲染输出元素数上限。spec 有字节上限、params 有
// 条目上限，但组件输出若退化成百万节点树，会在渲染端炸掉而非被拒绝。
// assertNodeBudget 在渲染桥接层（remotion 合成与工作台预览）每帧执行。
import assert from "node:assert/strict";
import test from "node:test";
import type { SvgNode } from "./svg.js";
import {
  assertNodeBudget,
  MAX_RENDER_NODES,
  SceneResourceError,
} from "./svg-budget.js";

function treeOf(count: number): SvgNode {
  // 一条 count 节点的链
  let node: SvgNode = { tag: "g", attrs: {}, text: "leaf" };
  for (let i = 1; i < count; i++)
    node = { tag: "g", attrs: {}, children: [node] };
  return node;
}

test("assertNodeBudget：恰在上限内通过（含 text 叶子）", () => {
  const within = treeOf(MAX_RENDER_NODES);
  let counted = 0;
  let cursor: SvgNode | undefined = within;
  while (cursor) {
    counted++;
    cursor = cursor.children?.[0];
  }
  assert.equal(counted, MAX_RENDER_NODES);
  assert.doesNotThrow(() => assertNodeBudget(within));
});

test("assertNodeBudget：超上限抛 SceneResourceError 并报出数字", () => {
  const over = treeOf(MAX_RENDER_NODES + 1);
  assert.throws(
    () => assertNodeBudget(over),
    (error: unknown) =>
      error instanceof SceneResourceError &&
      String(MAX_RENDER_NODES + 1).length > 0 &&
      /元素节点|nodes/i.test(error.message),
  );
});
