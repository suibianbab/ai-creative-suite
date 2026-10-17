// P3-lite：SvgNode.attrs 的 React 适配层归一到本包。SvgNode 用 SVG 原生
// kebab-case（序列化渲染路径依赖），React createElement 只认驼峰；两座
// SvgTree 桥（web 预览 / remotion 合成）必须用同一份转换，不允许各自漂移。
import assert from "node:assert/strict";
import test from "node:test";
import { reactSvgAttrs } from "./react-svg-attrs.js";

test("reactSvgAttrs：kebab-case 属性名转驼峰，普通属性原样保留", () => {
  assert.deepEqual(
    reactSvgAttrs({
      x: 10,
      fill: "#112233",
      "font-size": 90,
      "text-anchor": "middle",
      "dominant-baseline": "middle",
      "stroke-width": 4,
      "stroke-linecap": "round",
    }),
    {
      x: 10,
      fill: "#112233",
      fontSize: 90,
      textAnchor: "middle",
      dominantBaseline: "middle",
      strokeWidth: 4,
      strokeLinecap: "round",
    },
  );
});

test("reactSvgAttrs：空对象与无连字符对象安全通过", () => {
  assert.deepEqual(reactSvgAttrs({}), {});
  assert.deepEqual(reactSvgAttrs({ opacity: 0.5 }), { opacity: 0.5 });
});
