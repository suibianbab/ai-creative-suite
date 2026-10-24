import assert from "node:assert/strict";
import { test } from "node:test";
import { countSvgNodes, serializeSvgNode } from "./svg-serialize.js";
import type { SvgNode } from "./svg.js";

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
  assert.ok(!svg.includes("<rect width=\"10\" height=\"5\"></rect>"));
});

test("countSvgNodes 统计整棵树", () => {
  assert.equal(countSvgNodes(fixture), 3);
  assert.equal(countSvgNodes({ tag: "rect", attrs: {} }), 1);
});

test("与 scripts/video/svg-serialize.mjs 语义逐字节一致（对拍）", async () => {
  // @ts-expect-error 对拍目标是仓库内无类型 .mjs
  const script = await import("../../../scripts/video/svg-serialize.mjs");
  assert.equal(
    serializeSvgNode(fixture),
    script.serializeNode(fixture),
    "上提实现与既有 CLI 序列化器输出必须一致",
  );
});
