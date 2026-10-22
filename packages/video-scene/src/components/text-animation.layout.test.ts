import assert from "node:assert/strict";
import test from "node:test";
import { seededRandom } from "../random.js";
import type { FrameContext } from "../registry.js";
import type { SceneSpec } from "../spec.js";
import type { SvgNode } from "../svg.js";
import { emUnits } from "../text-width.js";
import { textAnimation } from "./text-animation.js";

// 双画幅版式覆写（2026-10-23 brief §三B 文字镜头）：titleLines 显式换行
// （拼接须与标题一致，空白不敏感）、titleScale 0.5..1.3、verticalOffset
// -0.25..0.25；无覆写时渲染必须与现状逐节点相等（旧项目零变化）。

function makeCtx(over: Partial<FrameContext> = {}): FrameContext {
  return {
    frame: 0,
    fps: 24,
    durationFrames: 288,
    width: 1280,
    height: 720,
    random: seededRandom(1),
    ...over,
  };
}

function specWith(
  params: Record<string, unknown>,
  layout?: SceneSpec["layout"],
): SceneSpec {
  const spec: SceneSpec = {
    specVersion: 1,
    componentId: "text-animation",
    componentVersion: 1,
    durationMs: 12000,
    seed: 7,
    background: "#ffffff",
    params,
  };
  return layout ? { ...spec, layout } : spec;
}

function textsOf(node: SvgNode): SvgNode[] {
  return (node.children ?? []).filter(
    (child) => child.tag === "text",
  ) as SvgNode[];
}

function requireText(node: SvgNode, text: string): SvgNode {
  const found = textsOf(node).find((child) => child.text === text);
  if (!found) throw new Error(`未找到文本节点：${text}`);
  return found;
}

const BASE = {
  titleColor: "#111111",
  subtitleColor: "#666666",
  entrance: "fade-up",
  enterMs: 800,
};
const OVERRIDE_TITLE = "双画幅预览与镜头级微调验收";

test("竖版覆写：titleLines 三行按给定行序渲染且同字号", () => {
  const spec = specWith(
    { ...BASE, title: OVERRIDE_TITLE },
    { portrait: { titleLines: ["双画幅预览", "与镜头级", "微调验收"] } },
  );
  const node = textAnimation.render(
    spec,
    makeCtx({ width: 720, height: 1280 }),
  );
  const first = requireText(node, "双画幅预览");
  const second = requireText(node, "与镜头级");
  const third = requireText(node, "微调验收");
  assert.ok((first.attrs.y as number) < (second.attrs.y as number));
  assert.ok((second.attrs.y as number) < (third.attrs.y as number));
  assert.equal(first.attrs["font-size"], second.attrs["font-size"]);
  assert.equal(second.attrs["font-size"], third.attrs["font-size"]);
});

test("竖版覆写：titleScale=1.3 字号大于自动字号且不超安全文字宽", () => {
  const plain = specWith({ ...BASE, title: OVERRIDE_TITLE });
  const scaled = specWith(
    { ...BASE, title: OVERRIDE_TITLE },
    { portrait: { titleScale: 1.3 } },
  );
  const portrait = makeCtx({ width: 720, height: 1280 });
  const autoTexts = textsOf(textAnimation.render(plain, portrait));
  const scaledTexts = textsOf(textAnimation.render(scaled, portrait));
  assert.equal(autoTexts.length, scaledTexts.length, "行数不受 scale 影响");
  assert.deepEqual(
    autoTexts.map((t) => t.text),
    scaledTexts.map((t) => t.text),
  );
  assert.ok(
    (scaledTexts[0]!.attrs["font-size"] as number) >
      (autoTexts[0]!.attrs["font-size"] as number),
  );
  for (const line of scaledTexts) {
    const size = line.attrs["font-size"] as number;
    assert.ok(
      emUnits(line.text!) * size <= 720 * 0.72 + 1e-6,
      "缩放后仍须在安全文字宽内",
    );
  }
});

test("竖版覆写：verticalOffset=0.2 块中心下移至少 0.19×画布高", () => {
  const plain = specWith({ ...BASE, title: OVERRIDE_TITLE });
  const shifted = specWith(
    { ...BASE, title: OVERRIDE_TITLE },
    { portrait: { verticalOffset: 0.2 } },
  );
  const portrait = makeCtx({ width: 720, height: 1280 });
  const plainFirst = textsOf(textAnimation.render(plain, portrait))[0]!;
  const shiftedFirst = textsOf(textAnimation.render(shifted, portrait))[0]!;
  assert.ok(
    (shiftedFirst.attrs.y as number) >
      (plainFirst.attrs.y as number) + 1280 * 0.19,
  );
});

test("覆写只影响目标画幅：另一画幅输出与无 layout 逐节点相等", () => {
  const params = { ...BASE, title: OVERRIDE_TITLE, subtitle: "看见排版的力量" };
  const plain = specWith(params);
  const portraitOnly = specWith(params, {
    portrait: { titleScale: 1.3, verticalOffset: 0.2 },
  });
  assert.deepEqual(
    textAnimation.render(plain, makeCtx({ frame: 10 })),
    textAnimation.render(portraitOnly, makeCtx({ frame: 10 })),
  );
  const landscapeOnly = specWith(params, {
    landscape: { titleLines: ["双画幅预览与", "镜头级微调验收"] },
  });
  assert.deepEqual(
    textAnimation.render(
      plain,
      makeCtx({ width: 720, height: 1280, frame: 10 }),
    ),
    textAnimation.render(
      landscapeOnly,
      makeCtx({ width: 720, height: 1280, frame: 10 }),
    ),
  );
});

test("横版覆写：titleLines 两行生效（默认单行），块随 offset 平移", () => {
  const spec = specWith(
    { ...BASE, title: OVERRIDE_TITLE, subtitle: "副标题随行" },
    {
      landscape: {
        titleLines: ["双画幅预览与", "镜头级微调验收"],
        verticalOffset: 0.1,
      },
    },
  );
  const node = textAnimation.render(spec, makeCtx({ frame: 48 }));
  const first = requireText(node, "双画幅预览与");
  const second = requireText(node, "镜头级微调验收");
  const subtitle = requireText(node, "副标题随行");
  assert.ok((first.attrs.y as number) < (second.attrs.y as number));
  assert.ok((second.attrs.y as number) < (subtitle.attrs.y as number));
  // 块中心 360 + 0.1×720 = 432：标题在其上方、副标题在其下方。
  assert.ok((first.attrs.y as number) < 432);
  assert.ok((subtitle.attrs.y as number) > 432);
});

test("validateLayout：合法组合通过，非法形状/边界拒绝", () => {
  const check = (
    layout: unknown,
    params: Record<string, unknown> = { ...BASE, title: OVERRIDE_TITLE },
  ) => textAnimation.validateLayout!(layout, params);
  // 合法
  check({ titleLines: ["双画幅预览", "与镜头级微调验收"] });
  check({ titleLines: [" 双画幅预览 ", "与镜头级微调验收"] }); // 空白不敏感
  check({ titleScale: 0.5 });
  check({ titleScale: 1.3 });
  check({ verticalOffset: -0.25 });
  check({ verticalOffset: 0.25 });
  check({});
  // 非法
  assert.throws(
    () => check({ titleLines: ["双画幅预览", "别的标题"] }),
    /拼接/,
  );
  assert.throws(
    () =>
      check(
        { titleLines: ["1", "2", "3", "4", "5"] },
        { ...BASE, title: "12345" },
      ),
    /1\.\.4/,
  );
  assert.throws(() => check({ titleLines: ["", OVERRIDE_TITLE] }), /非空白/);
  assert.throws(() => check({ titleScale: 1.4 }), /titleScale/);
  assert.throws(() => check({ titleScale: 0.4 }), /titleScale/);
  assert.throws(() => check({ verticalOffset: -0.26 }), /verticalOffset/);
  assert.throws(() => check({ foo: 1 }), /foo/);
});
