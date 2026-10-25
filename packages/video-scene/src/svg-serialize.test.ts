import assert from "node:assert/strict";
import { test } from "node:test";
import type { SvgNode } from "./svg.js";
import { countSvgNodes, serializeSvgNode } from "./svg-serialize.js";

const fixture: SvgNode = {
  tag: "g",
  attrs: { fill: `a&b<c>"d'e` },
  children: [
    { tag: "rect", attrs: { width: 10, height: 5 } },
    { tag: "text", attrs: {}, text: `<&>"'` },
  ],
};

test("serializeSvgNode 转义五种 XML 实体并区分文本/自闭合", () => {
  const svg = serializeSvgNode(fixture);
  assert.ok(svg.includes('fill="a&amp;b&lt;c&gt;&quot;d&#39;e"'));
  assert.ok(svg.includes(">&lt;&amp;&gt;&quot;&#39;<"));
  assert.ok(svg.includes('<rect width="10" height="5"/>'));
  assert.ok(!svg.includes('<rect width="10" height="5"></rect>'));
});

test("countSvgNodes 统计整棵树", () => {
  assert.equal(countSvgNodes(fixture), 3);
  assert.equal(countSvgNodes({ tag: "rect", attrs: {} }), 1);
});

test("serializeSvgNode 金串锁定（上提前 CLI 语义的字节级基准）", () => {
  // 基准来自 scripts/video/svg-serialize.mjs 上提前的实际输出；CLI 侧
  // 的 9 条自有测试继续覆盖 canvas/animated 路径，这里锁节点级语义。
  assert.equal(
    serializeSvgNode(fixture),
    '<g fill="a&amp;b&lt;c&gt;&quot;d&#39;e"><rect width="10" height="5"/><text>&lt;&amp;&gt;&quot;&#39;</text></g>',
  );
});
