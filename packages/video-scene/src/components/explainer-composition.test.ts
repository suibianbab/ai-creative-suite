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
