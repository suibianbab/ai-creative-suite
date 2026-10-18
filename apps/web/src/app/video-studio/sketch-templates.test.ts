import assert from "node:assert/strict";
import test from "node:test";
import type { SceneSpec } from "@acs/video-scene";
import {
  applySketchTemplate,
  buildSketchRevisePatch,
  draftSketchFromSpec,
  isSketchComponentId,
  SKETCH_TEMPLATES,
} from "./sketch-templates";

const SPEC = {
  specVersion: 1,
  componentId: "basic-shapes",
  componentVersion: 1,
  seed: 7,
  background: "#ffffff",
  durationMs: 3000,
  params: {},
} as unknown as SceneSpec;

const SKETCH_PARAMS = {
  title: "三大要点",
  items: [{ text: "要点一", emphasis: "下划线" }],
  inkColor: "#2f2f2f",
  accentColor: "#e05a2b",
  writeMs: 480,
  drawMs: 420,
  staggerMs: 240,
};

const SKETCH_SPEC = {
  ...SPEC,
  componentId: "sketch-note",
  params: structuredClone(SKETCH_PARAMS),
} as unknown as SceneSpec;

test("五枚模板：apply 合法、保留时长/背景/seed、时序预算 ≤2000ms", () => {
  for (const template of SKETCH_TEMPLATES) {
    const applied = applySketchTemplate(SPEC, template.templateId);
    assert.equal(applied.error, null, template.templateId);
    assert.equal(applied.spec!.componentId, "sketch-note");
    assert.equal(applied.spec!.durationMs, 3000);
    assert.equal(applied.spec!.background, "#ffffff");
    assert.equal(applied.spec!.seed, 7);
    const items = (applied.spec!.params as { items: Array<unknown> }).items;
    const { writeMs, drawMs, staggerMs } = applied.spec!.params as {
      writeMs: number;
      drawMs: number;
      staggerMs: number;
    };
    // P2-③ 34bda10 教训：末条目收笔必须在 2000ms 规划器默认镜头内
    assert.ok(
      160 + (items.length - 1) * staggerMs + writeMs + drawMs <= 2000,
      `${template.templateId} 预算超限`,
    );
  }
});

test("apply：未知模板报错、structuredClone 隔离", () => {
  const bad = applySketchTemplate(SPEC, "no-such-sketch");
  assert.equal(bad.spec, null);
  assert.equal(bad.error, "未知手绘模板 no-such-sketch");
  const applied = applySketchTemplate(SPEC, "sketch-underline-3");
  (applied.spec!.params as { items: Array<{ text: string }> }).items[0]!.text =
    "篡改";
  const again = applySketchTemplate(SPEC, "sketch-underline-3");
  assert.equal(
    (again.spec!.params as { items: Array<{ text: string }> }).items[0]!.text,
    "要点一",
  );
});

test("round-trip：无强调省略段、下划线/圈带段", () => {
  const spec = {
    ...SKETCH_SPEC,
    params: {
      ...SKETCH_PARAMS,
      items: [
        { text: "甲", emphasis: "无" },
        { text: "乙", emphasis: "下划线" },
        { text: "丙", emphasis: "圈" },
      ],
    },
  } as unknown as SceneSpec;
  const draft = draftSketchFromSpec(spec);
  assert.equal(draft.title, "三大要点");
  assert.equal(draft.data, "甲\n乙,下划线\n丙,圈");
  const back = buildSketchRevisePatch(spec, draft);
  assert.equal(back.error, null);
  assert.deepEqual((back.spec!.params as { items: unknown[] }).items, [
    { text: "甲", emphasis: "无" },
    { text: "乙", emphasis: "下划线" },
    { text: "丙", emphasis: "圈" },
  ]);
});

test("从右取字段：文本可含逗号、显式,无、首逗号整行为文本", () => {
  const spec = {
    ...SKETCH_SPEC,
    params: { ...SKETCH_PARAMS, items: [{ text: "甲", emphasis: "无" }] },
  } as unknown as SceneSpec;
  const cases: Array<[string, { text: string; emphasis: string }]> = [
    ["增长,环比,下划线", { text: "增长,环比", emphasis: "下划线" }],
    ["含,逗号", { text: "含,逗号", emphasis: "无" }],
    ["甲,无", { text: "甲", emphasis: "无" }],
    [",下划线", { text: ",下划线", emphasis: "无" }],
  ];
  for (const [data, want] of cases) {
    const back = buildSketchRevisePatch(spec, {
      title: "三大要点",
      data,
    });
    assert.equal(back.error, null, data);
    assert.deepEqual((back.spec!.params as { items: unknown[] }).items, [want]);
  }
});

test("错误表：空行集/超行数/超长文本（带行号）", () => {
  const empty = buildSketchRevisePatch(SKETCH_SPEC as unknown as SceneSpec, {
    title: "t",
    data: " \r\n ",
  });
  assert.equal(empty.error, "手绘至少需要一行（1 条文本）");
  const six = buildSketchRevisePatch(SKETCH_SPEC as unknown as SceneSpec, {
    title: "t",
    data: Array.from({ length: 6 }, (_, i) => `第${i + 1}条`).join("\n"),
  });
  assert.equal(six.error, "手绘最多 5 行（条目上限）");
  const long = buildSketchRevisePatch(SKETCH_SPEC as unknown as SceneSpec, {
    title: "t",
    data: "甲\n超过十二个字符的文本行甲乙",
  });
  assert.equal(long.error, "第 2 行：文本必须是 1..12 个字符");
});

test("CRLF/空行/trim 容错", () => {
  const back = buildSketchRevisePatch(SKETCH_SPEC as unknown as SceneSpec, {
    title: "t",
    data: "甲, 下划线 \r\n\r\n 乙 \n  丙,圈",
  });
  assert.equal(back.error, null);
  assert.deepEqual((back.spec!.params as { items: unknown[] }).items, [
    { text: "甲", emphasis: "下划线" },
    { text: "乙", emphasis: "无" },
    { text: "丙", emphasis: "圈" },
  ]);
});

test("合并保留：colors/时序字段不丢、非手绘组件拒绝", () => {
  const spec = {
    ...SKETCH_SPEC,
    params: { ...SKETCH_PARAMS },
  } as unknown as SceneSpec;
  const back = buildSketchRevisePatch(spec, {
    title: "新标题",
    data: "新文本,圈",
  });
  assert.equal(back.error, null);
  const merged = back.spec!.params as {
    title: string;
    items: Array<{ text: string; emphasis: string }>;
    inkColor: string;
    accentColor: string;
    writeMs: number;
    drawMs: number;
    staggerMs: number;
  };
  assert.equal(merged.title, "新标题");
  assert.deepEqual(merged.items, [{ text: "新文本", emphasis: "圈" }]);
  assert.equal(merged.inkColor, "#2f2f2f");
  assert.equal(merged.accentColor, "#e05a2b");
  assert.equal(merged.writeMs, 480);
  assert.equal(merged.drawMs, 420);
  assert.equal(merged.staggerMs, 240);
  const wrong = buildSketchRevisePatch(SPEC, { title: "t", data: "甲" });
  assert.equal(wrong.error, "当前镜头组件不是手绘组件");
  assert.equal(isSketchComponentId("sketch-note"), true);
  assert.equal(isSketchComponentId("stick-figure"), false);
});
