import assert from "node:assert/strict";
import test from "node:test";
import { defaultRegistry } from "../default-registry.js";
import type { FrameContext, SceneSpecLike } from "../registry.js";
import { validateSceneSpec } from "../spec.js";
import type { SvgNode } from "../svg.js";
import { emUnits } from "../text-width.js";
import {
  type ExplainerParams,
  explainerComposition,
} from "./explainer-composition.js";
import { flowStepLabelMaxWidth } from "./flow-steps.js";

const params: ExplainerParams = {
  title: "水循环的四个阶段",
  titleColor: "#ffffff",
  textColor: "#ffffff",
  boxColor: "#42a5a0",
  arrowColor: "#f5b652",
  strokeColor: "#b4d8e4",
  titleY: 145,
  titleEnterMs: 0,
  diagramOffsetX: 0,
  diagramOffsetY: -75,
  diagramEnterMs: 450,
  diagram: {
    kind: "flow",
    steps: [
      { label: "蒸发" },
      { label: "凝结" },
      { label: "降水" },
      { label: "汇流" },
    ],
  },
  annotations: [{ text: "循环往复", x: 500, y: 780, enterMs: 2200 }],
};
function spec(
  input: ExplainerParams = params,
): SceneSpecLike & { specVersion: 1 } {
  return {
    specVersion: 1,
    componentId: "explainer-composition",
    componentVersion: 1,
    durationMs: 4000,
    seed: 1,
    background: "#101f34",
    params: input,
  };
}
function ctx(width: number, height: number, frame = 72): FrameContext {
  return {
    frame,
    fps: 24,
    durationFrames: 96,
    width,
    height,
    random: () => 0.5,
  };
}
function textNodes(node: SvgNode): SvgNode[] {
  return [node, ...(node.children ?? []).flatMap(textNodes)].filter(
    (part) => part.tag === "text",
  );
}

test("注册组件：两个受限图示族能过验证，旧组件版本仍可用", () => {
  assert.equal(
    defaultRegistry.get("explainer-composition", 1),
    explainerComposition,
  );
  validateSceneSpec(spec(), defaultRegistry);
  validateSceneSpec(
    spec({
      ...params,
      diagram: { kind: "drawing", paths: ["M 200 300 L 500 500"] },
    }),
    defaultRegistry,
  );
  assert.equal(defaultRegistry.get("flow-steps", 1).version, 1);
  assert.equal(defaultRegistry.get("line-drawing", 1).version, 1);
});

test("横竖画幅复用流程图且标题、标注与图示同帧可见", () => {
  for (const [width, height] of [
    [1280, 720],
    [720, 1280],
  ] as const) {
    const tree = explainerComposition.render(spec(), ctx(width, height));
    const labels = textNodes(tree).filter(
      (node) => Number(node.attrs.opacity ?? 1) > 0,
    );
    assert.ok(labels.some((node) => node.text === params.title));
    assert.ok(labels.some((node) => node.text === "蒸发"));
    assert.ok(labels.some((node) => node.text === "循环往复"));
  }
});

test("入场时序由帧确定：图示晚于标题，标注晚于图示", () => {
  const early = explainerComposition.render(spec(), ctx(1280, 720, 2));
  assert.ok(textNodes(early).some((node) => node.text === params.title));
  assert.ok(
    !textNodes(early).some(
      (node) => node.text === "循环往复" && Number(node.attrs.opacity) > 0,
    ),
  );
  assert.deepEqual(
    early,
    explainerComposition.render(spec(), ctx(1280, 720, 2)),
  );
});

test("越界标注、非法路径及超量元素被拒", () => {
  assert.throws(
    () =>
      validateSceneSpec(
        spec({
          ...params,
          annotations: [{ text: "越界", x: 10, y: 800, enterMs: 0 }],
        }),
        defaultRegistry,
      ),
    /annotations/,
  );
  assert.throws(
    () =>
      validateSceneSpec(
        spec({ ...params, diagram: { kind: "drawing", paths: [] } }),
        defaultRegistry,
      ),
    /paths/,
  );
  assert.throws(
    () =>
      validateSceneSpec(
        spec({ ...params, annotations: Array(4).fill(params.annotations[0]) }),
        defaultRegistry,
      ),
    /annotations/,
  );
});

test("8 步长标签始终装在流程盒宽的 80% 内", () => {
  const long = spec({
    ...params,
    diagram: {
      kind: "flow",
      steps: Array.from({ length: 8 }, (_, index) => ({
        label: `处理阶段${index}`,
      })),
    },
  });
  for (const [width, height] of [
    [1280, 720],
    [720, 1280],
  ]) {
    const labels = textNodes(
      explainerComposition.render(long, ctx(width!, height!)),
    ).filter((node) => node.text?.startsWith("处理阶段"));
    assert.equal(labels.length, 8);
    const maxWidth = flowStepLabelMaxWidth(
      8,
      height! > width! ? "vertical" : "horizontal",
    );
    for (const label of labels) {
      assert.ok(
        Number(label.attrs["font-size"]) * emUnits(label.text!) <=
          maxWidth + 0.001,
      );
    }
  }
});

test("标注上界与字幕保留带隔开，带内坐标被拒", () => {
  for (const annotation of [
    { text: "安全", x: 500, y: 800, portraitY: 1450, enterMs: 0 },
  ]) {
    validateSceneSpec(
      spec({ ...params, annotations: [annotation] }),
      defaultRegistry,
    );
    for (const [width, height] of [
      [1280, 720],
      [720, 1280],
    ]) {
      const node = textNodes(
        explainerComposition.render(
          spec({ ...params, annotations: [annotation] }),
          ctx(width!, height!),
        ),
      ).find((part) => part.text === "安全")!;
      const bottom = Number(node.attrs.y) + Number(node.attrs["font-size"]) / 2;
      assert.ok(bottom < (height! > width! ? 1500 : 836));
    }
  }
  for (const annotation of [
    { text: "压字幕", x: 500, y: 836, enterMs: 0 },
    { text: "压字幕", x: 500, y: 780, portraitY: 1510, enterMs: 0 },
  ]) {
    assert.throws(
      () =>
        validateSceneSpec(
          spec({ ...params, annotations: [annotation] }),
          defaultRegistry,
        ),
      /annotations/,
    );
  }
});

test("图片图示仅接受有界内嵌位图，横竖版输出同一离线素材", () => {
  const src =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
  const imageSpec = spec({ ...params, diagram: { kind: "image", src } });
  validateSceneSpec(imageSpec, defaultRegistry);
  for (const [width, height] of [
    [1280, 720],
    [720, 1280],
  ]) {
    const tree = explainerComposition.render(imageSpec, ctx(width!, height!));
    const images = JSON.stringify(tree).match(/"tag":"image"/g) ?? [];
    assert.equal(images.length, 1);
    assert.ok(JSON.stringify(tree).includes(src));
  }
  assert.throws(
    () =>
      validateSceneSpec(
        spec({
          ...params,
          diagram: { kind: "image", src: "https://example.com/a.png" },
        }),
        defaultRegistry,
      ),
    /图片/,
  );
  assert.throws(
    () =>
      validateSceneSpec(
        spec({
          ...params,
          diagram: { kind: "image", src: "data:image/png;base64,AAAA" },
        }),
        defaultRegistry,
      ),
    /图片/,
  );
  assert.throws(
    () =>
      validateSceneSpec(
        spec({
          ...params,
          diagram: {
            kind: "image",
            src: `data:image/png;base64,${"A".repeat(180 * 1024)}`,
          },
        }),
        defaultRegistry,
      ),
    /图片/,
  );
});

const cycleParams: ExplainerParams = {
  ...params,
  diagram: {
    kind: "cycle",
    steps: [
      { label: "蒸发", caption: "海面升腾" },
      { label: "凝结", caption: "高空成云" },
      { label: "降水", caption: "雨落大地" },
      { label: "汇流", caption: "江河归海" },
    ],
    centerText: "水循环",
  },
};

function allNodes(node: SvgNode): SvgNode[] {
  return [node, ...(node.children ?? []).flatMap(allNodes)];
}

test("cycle 图示：阶段数、标签、短注与中心文字受校验约束", () => {
  validateSceneSpec(spec(cycleParams), defaultRegistry);
  const cycle = (
    steps: ExplainerParams["diagram"] extends never
      ? never
      : Extract<ExplainerParams["diagram"], { kind: "cycle" }>["steps"],
    centerText?: string,
  ) =>
    spec({
      ...params,
      diagram: {
        kind: "cycle",
        steps,
        ...(centerText === undefined ? {} : { centerText }),
      },
    });
  assert.throws(
    () =>
      validateSceneSpec(
        cycle([
          { label: "蒸发" },
          { label: "凝结" },
        ]),
        defaultRegistry,
      ),
    /cycle/,
  );
  assert.throws(
    () =>
      validateSceneSpec(
        spec({
          ...params,
          diagram: {
            kind: "cycle",
            steps: Array.from({ length: 7 }, () => ({ label: "阶段" })),
          },
        }),
        defaultRegistry,
      ),
    /cycle/,
  );
  assert.throws(
    () =>
      validateSceneSpec(
        cycle([{ label: "0123456" }, { label: "b" }, { label: "c" }]),
        defaultRegistry,
      ),
    /cycle/,
  );
  assert.throws(
    () =>
      validateSceneSpec(
        cycle([
          { label: "a" },
          { label: "b" },
          { label: "c", caption: "0123456789ABC" },
        ]),
        defaultRegistry,
      ),
    /cycle/,
  );
  assert.throws(
    () =>
      validateSceneSpec(
        cycle([{ label: "a" }, { label: "b" }, { label: "c" }], "01234567891"),
        defaultRegistry,
      ),
    /cycle/,
  );
});

test("cycle 图示：阶段盒、环向弧、闭合箭头与中心文字分时入场", () => {
  const late = explainerComposition.render(spec(cycleParams), ctx(1280, 720, 90));
  const boxes = allNodes(late).filter(
    (node) =>
      node.tag === "rect" &&
      Number(node.attrs.width) >= 180 &&
      Number(node.attrs.width) <= 300,
  );
  assert.equal(boxes.length, 4);
  const arcs = allNodes(late).filter(
    (node) => node.tag === "path" && String(node.attrs.d).includes("A "),
  );
  assert.equal(arcs.length, 4);
  const heads = allNodes(late).filter((node) => node.tag === "polygon");
  assert.equal(heads.length, 4);
  for (const text of [
    "蒸发",
    "凝结",
    "降水",
    "汇流",
    "海面升腾",
    "高空成云",
    "雨落大地",
    "江河归海",
  ]) {
    assert.ok(
      textNodes(late).some(
        (node) => node.text === text && Number(node.attrs.opacity ?? 1) > 0,
      ),
      text,
    );
  }
  const earlyCenter = textNodes(
    explainerComposition.render(spec(cycleParams), ctx(1280, 720, 40)),
  ).find((node) => node.text === "水循环");
  assert.ok(earlyCenter);
  assert.equal(Number(earlyCenter.attrs.opacity), 0);
  const settledCenter = textNodes(late).find((node) => node.text === "水循环");
  assert.ok(settledCenter && Number(settledCenter.attrs.opacity ?? 1) > 0);
});

test("cycle 竖版：环形沿 1778 设计空间纵向拉满且阶段盒不出界", () => {
  const portrait = explainerComposition.render(
    spec(cycleParams),
    ctx(720, 1280, 90),
  );
  const landscape = explainerComposition.render(
    spec(cycleParams),
    ctx(1280, 720, 90),
  );
  const viewBox = (tree: SvgNode) =>
    allNodes(tree)
      .filter((node) => node.tag === "svg")
      .map((node) => node.attrs.viewBox);
  assert.ok(viewBox(portrait).includes("0 0 1000 1778"));
  assert.ok(viewBox(landscape).includes("0 0 1000 1000"));
  const boxes = (tree: SvgNode) =>
    allNodes(tree).filter(
      (node) =>
        node.tag === "rect" &&
        Number(node.attrs.width) >= 180 &&
        Number(node.attrs.width) <= 300,
    );
  const portraitTops = boxes(portrait).map((node) => Number(node.attrs.y));
  const landscapeTops = boxes(landscape).map((node) => Number(node.attrs.y));
  // 竖版环形更高：最靠上的阶段盒显著高于横版（设计空间单位）。
  assert.ok(Math.min(...portraitTops) < 150);
  assert.ok(Math.min(...landscapeTops) > 250);
  for (const node of boxes(portrait)) {
    assert.ok(Number(node.attrs.x) >= 0);
    assert.ok(Number(node.attrs.x) + Number(node.attrs.width) <= 1000);
    assert.ok(Number(node.attrs.y) >= 0);
    assert.ok(Number(node.attrs.y) + Number(node.attrs.height) <= 1000);
  }
});

const labeledDrawingParams: ExplainerParams = {
  ...params,
  diagramOffsetY: 40,
  diagram: { kind: "drawing", paths: ["M 120 590 C 220 572 320 608 420 590"] },
  diagramLabels: [
    { text: "太阳", x: 700, y: 200, targetX: 760, targetY: 240, enterMs: 400 },
    { text: "海面", x: 260, y: 660, enterMs: 900 },
  ],
};

test("drawing 部件标注：带目标画引线端点，未带目标只有文字，按时序入场", () => {
  validateSceneSpec(spec(labeledDrawingParams), defaultRegistry);
  const late = explainerComposition.render(
    spec(labeledDrawingParams),
    ctx(1280, 720, 90),
  );
  for (const text of ["太阳", "海面"]) {
    assert.ok(
      textNodes(late).some(
        (node) => node.text === text && Number(node.attrs.opacity ?? 1) > 0,
      ),
      text,
    );
  }
  // 仅「太阳」给了 target：一个引线端点圆＋一条细引线；「海面」不产生。
  const dots = allNodes(late).filter((node) => node.tag === "circle");
  assert.equal(dots.length, 1);
  const leaders = allNodes(late).filter(
    (node) =>
      node.tag === "path" && Number(node.attrs["stroke-width"]) === 3,
  );
  assert.equal(leaders.length, 1);
  const early = textNodes(
    explainerComposition.render(spec(labeledDrawingParams), ctx(1280, 720, 20)),
  ).find((node) => node.text === "太阳");
  assert.ok(early);
  assert.equal(Number(early.attrs.opacity), 0);
  // 旧 drawing spec（无 diagramLabels）不渲染任何端点圆。
  const plain = explainerComposition.render(
    spec({ ...params, diagram: { kind: "drawing", paths: ["M 200 300 L 500 500"] } }),
    ctx(1280, 720, 90),
  );
  assert.equal(
    allNodes(plain).filter((node) => node.tag === "circle").length,
    0,
  );
});

test("diagramLabels 仅可与 drawing 搭配且字段受界", () => {
  assert.throws(
    () =>
      validateSceneSpec(
        spec({
          ...params,
          diagramLabels: [{ text: "太阳", x: 700, y: 200, enterMs: 400 }],
        }),
        defaultRegistry,
      ),
    /diagramLabels/,
  );
  for (const bad of [
    { text: "012345678", x: 700, y: 200 },
    { text: "太阳", x: 1001, y: 200 },
    { text: "太阳", x: 700, y: 200, targetX: 760 },
  ] as const) {
    assert.throws(
      () =>
        validateSceneSpec(
          spec({
            ...params,
            diagram: { kind: "drawing", paths: ["M 200 300 L 500 500"] },
            diagramLabels: [bad],
          }),
          defaultRegistry,
        ),
      /diagramLabels/,
      JSON.stringify(bad),
    );
  }
  assert.throws(
    () =>
      validateSceneSpec(
        spec({
          ...params,
          diagram: { kind: "drawing", paths: ["M 200 300 L 500 500"] },
          diagramLabels: Array.from({ length: 5 }, () => ({
            text: "太阳",
            x: 700,
            y: 200,
          })),
        }),
        defaultRegistry,
      ),
    /diagramLabels/,
  );
});
