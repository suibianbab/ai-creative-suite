// P1-A E2E 控制台门禁暴露的缺陷：SvgNode 的 attrs 是 SVG 原生 kebab-case
// （序列化渲染路径需要），React createElement 却要求驼峰，否则每个预览帧
// 都打 Invalid DOM property 错误。reactSvgAttrs 负责这层适配。
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
