// D4 导出扩充：SvgNode → 独立 SVG 文件字符串序列化单测（纯数据进出，零外部进程）。

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  buildAnimatedSvg,
  buildStaticSvg,
  countNodes,
  MAX_SVG_EXPORT_NODES,
  serializeNode,
} from "./svg-serialize.mjs";

const g = (attrs, ...children) => ({ tag: "g", attrs, children });
const text = (attrs, str) => ({ tag: "text", attrs, text: str });

test("serializeNode 转义 text 与 attr 的 XML 特殊字符", () => {
  const node = text({ "font-size": 48, fill: '#"<&>' }, "a<b>&\"c'");
  const out = serializeNode(node);
  assert.ok(out.includes('fill="#&quot;&lt;&amp;&gt;'));
  assert.ok(out.includes(">a&lt;b&gt;&amp;&quot;c&#39;</text>"));
});

test("serializeNode 无 children 无 text 自闭合", () => {
  assert.equal(
    serializeNode({ tag: "rect", attrs: { width: 10 } }),
    '<rect width="10"/>',
  );
});

test("serializeNode 嵌套 children 递归", () => {
  const out = serializeNode(
    g({ id: "root" }, text({}, "内"), { tag: "circle", attrs: { r: 2 } }),
  );
  assert.equal(out, '<g id="root"><text>内</text><circle r="2"/></g>');
});

test("countNodes 递归计数含根", () => {
  assert.equal(countNodes(g({}, text({}, "a"), g({}, text({}, "b")))), 4);
});

test("buildAnimatedSvg 生成每帧 keyframes 切片与画布", () => {
  const frames = [text({}, "一"), text({}, "二"), text({}, "三")];
  const { svg, totalNodes } = buildAnimatedSvg({
    renderFrame: (i) => frames[i],
    frameCount: 3,
    fps: 12,
    width: 1280,
    height: 720,
    background: "#102030",
  });
  assert.equal(totalNodes, 3);
  assert.ok(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(svg.includes('viewBox="0 0 1280 720"'));
  assert.ok(svg.includes('font-family="NotoSansSC, sans-serif"'));
  assert.ok(svg.includes('<rect width="1280" height="720" fill="#102030"/>'));
  assert.ok(svg.includes('class="kf kf-0"'));
  assert.ok(
    svg.includes("@keyframes kf-0 {0% {opacity: 1;} 33.3333% {opacity: 0;}}"),
  );
  assert.ok(
    svg.includes("@keyframes kf-2 {66.6667% {opacity: 1;} 100% {opacity: 0;}}"),
  );
  assert.ok(svg.includes("steps(1, end) infinite"));
  assert.ok(svg.includes("0.250s")); // 3 帧 / 12fps（toFixed(3) 定精度）
});

test("buildAnimatedSvg 确定性：同输入两次逐字节一致", () => {
  const args = {
    renderFrame: (i) => text({ x: i * 10 }, `帧${i}`),
    frameCount: 5,
    fps: 12,
    width: 720,
    height: 1280,
    background: "#ffffff",
  };
  const a = buildAnimatedSvg(args).svg;
  const b = buildAnimatedSvg(args).svg;
  assert.equal(
    createHash("sha256").update(a).digest("hex"),
    createHash("sha256").update(b).digest("hex"),
  );
});

test("buildAnimatedSvg 节点预算超限拒绝并建议降 fps", () => {
  assert.throws(
    () =>
      buildAnimatedSvg({
        renderFrame: () =>
          g({}, ...Array.from({ length: 30 }, () => text({}, "x"))),
        frameCount: 4,
        fps: 12,
        width: 1280,
        height: 720,
        background: "#fff",
        maxNodes: 100,
      }),
    /预算|fps/,
  );
});

test("buildAnimatedSvg 单帧拒绝（指路 --frame 静态）", () => {
  assert.throws(
    () =>
      buildAnimatedSvg({
        renderFrame: () => text({}, "x"),
        frameCount: 1,
        fps: 12,
        width: 1280,
        height: 720,
        background: "#fff",
      }),
    /--frame/,
  );
});

test("buildStaticSvg 无动画样式、单组、含指定帧内容", () => {
  const { svg, totalNodes } = buildStaticSvg({
    renderFrame: (i) => text({}, `第${i}帧`),
    frame: 7,
    width: 1280,
    height: 720,
    background: "#abc",
  });
  assert.equal(totalNodes, 1);
  assert.ok(!svg.includes("@keyframes"));
  assert.ok(svg.includes("第7帧"));
  assert.ok(svg.includes('fill="#abc"'));
});
