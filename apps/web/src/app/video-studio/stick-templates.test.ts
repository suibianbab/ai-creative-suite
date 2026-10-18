import assert from "node:assert/strict";
import test from "node:test";
import { type SceneSpec, stickFigure } from "@acs/video-scene";
import {
  applyStickTemplate,
  buildStickRevisePatch,
  draftStickFromSpec,
  isStickComponentId,
  STICK_TEMPLATES,
} from "./stick-templates";

const SPEC = {
  specVersion: 1,
  componentId: "basic-shapes",
  componentVersion: 1,
  seed: 7,
  background: "#ffffff",
  durationMs: 3000,
  params: {},
} as unknown as SceneSpec;

const STICK_PARAMS = {
  title: "走入画面",
  groundY: 800,
  figures: [{ action: "走", fromX: 80, toX: 920 }],
  strokeColor: "#1b2c29",
  groundColor: "#9aa8a0",
  textColor: "#1b2c29",
  enterMs: 400,
  cycleMs: 800,
  travelMs: 1200,
};

const STICK_SPEC = {
  ...SPEC,
  componentId: "stick-figure",
  params: structuredClone(STICK_PARAMS),
} as unknown as SceneSpec;

test("五枚起点模板：apply 换组件/参数合法、保留时长/背景/seed", () => {
  assert.equal(STICK_TEMPLATES.length, 5);
  for (const template of STICK_TEMPLATES) {
    const applied = applyStickTemplate(SPEC, template.templateId);
    assert.equal(applied.error, null, template.templateId);
    assert.equal(applied.spec!.componentId, "stick-figure");
    assert.equal(applied.spec!.componentVersion, 1);
    assert.equal(applied.spec!.durationMs, 3000);
    assert.equal(applied.spec!.background, "#ffffff");
    assert.equal(applied.spec!.seed, 7);
    assert.deepEqual(
      applied.spec!.params,
      structuredClone(template.params),
      template.templateId,
    );
  }
  // 模板清单与 templateId/label 逐字
  assert.deepEqual(
    STICK_TEMPLATES.map((t) => `${t.templateId}|${t.label}`),
    [
      "stick-walk-across|一人横穿",
      "stick-present|讲解指板",
      "stick-wave-hello|挥手打招呼",
      "stick-jump-joy|庆祝跳跃",
      "stick-meet|两人相遇",
    ],
  );
  // stick-meet 三人（含挥手）
  const meet = applyStickTemplate(SPEC, "stick-meet").spec!;
  const figures = (meet.params as { figures: unknown[] }).figures;
  assert.equal(figures.length, 3);
});

test("未知模板 id 报错", () => {
  const applied = applyStickTemplate(SPEC, "no-such-stick");
  assert.equal(applied.spec, null);
  assert.equal(applied.error, "未知火柴人模板 no-such-stick");
});

test("draftStickFromSpec：toX=fromX 省略段、toX≠fromX 展开三段", () => {
  const draft = draftStickFromSpec(STICK_SPEC);
  assert.equal(draft.title, "走入画面");
  assert.equal(draft.data, "走,80,920");
  const stationary = {
    ...STICK_SPEC,
    params: {
      ...structuredClone(STICK_PARAMS),
      figures: [
        { action: "走", fromX: 80, toX: 920 },
        { action: "指", fromX: 500, toX: 500 },
      ],
    },
  } as unknown as SceneSpec;
  assert.equal(draftStickFromSpec(stationary).data, "走,80,920\n指,500");
});

test("buildStickRevisePatch：round-trip + CRLF/空行/trim 容错 + toX 缺省", () => {
  const draft = {
    title: "相遇问好",
    data: "走, 80 ,420\r\n\r\n走,920,580\n指,500",
  };
  const result = buildStickRevisePatch(STICK_SPEC, draft);
  assert.equal(result.error, null);
  assert.deepEqual((result.spec!.params as { figures: unknown[] }).figures, [
    { action: "走", fromX: 80, toX: 420 },
    { action: "走", fromX: 920, toX: 580 },
    { action: "指", fromX: 500, toX: 500 },
  ]);
  assert.equal((result.spec!.params as { title: string }).title, "相遇问好");
  // 未触碰字段保留（groundY/颜色/时间窗来自模板基底）
  assert.equal((result.spec!.params as { groundY: number }).groundY, 800);
  // round-trip：draft 出去再读回来
  assert.equal(
    draftStickFromSpec(result.spec!).data,
    "走,80,420\n走,920,580\n指,500",
  );
});

test("buildStickRevisePatch：非火柴人组件拒绝", () => {
  const result = buildStickRevisePatch(SPEC, { title: "x", data: "站,500" });
  assert.equal(result.spec, null);
  assert.equal(result.error, "当前镜头组件不是火柴人组件");
});

test("buildStickRevisePatch：行级错误（行号定位、动作/坐标/数量/空串）", () => {
  const cases: Array<[string, string]> = [
    ["站,500\n跑,100\n跳,600", "第 2 行：动作必须是 走/站/挥手/指/跳"],
    ["站,500\n走,abc", "第 2 行：动作,起点x[,终点x] 格式不符（坐标 0..1000）"],
    [
      "站,500\n走,100,,300",
      "第 2 行：动作,起点x[,终点x] 格式不符（坐标 0..1000）",
    ],
    ["走,100,300,900", "第 1 行：动作,起点x[,终点x] 格式不符（坐标 0..1000）"],
    ["走,-5", "第 1 行：动作,起点x[,终点x] 格式不符（坐标 0..1000）"],
    ["走,100,1001", "第 1 行：动作,起点x[,终点x] 格式不符（坐标 0..1000）"],
    ["站,500\n走,100\n跳,600\n指,700", "火柴人最多 3 行（人数上限）"],
    ["", "火柴人至少需要一行（1 个人物）"],
    // 全角数字：动作词「走」合法，坐标段 Number("１００")=NaN → 格式不符（失败位置在坐标，非动作）
    ["走,１００", "第 1 行：动作,起点x[,终点x] 格式不符（坐标 0..1000）"],
  ];
  for (const [data, want] of cases) {
    const result = buildStickRevisePatch(STICK_SPEC, { title: "t", data });
    assert.equal(result.spec, null, data);
    assert.equal(result.error, want, data);
  }
});

test("isStickComponentId", () => {
  assert.equal(isStickComponentId("stick-figure"), true);
  assert.equal(isStickComponentId("flow-diagram"), false);
});

// —— 终评 I-1（Codex 复核）：模板时序必须收进规划器默认 2000ms 镜头 ——
// 组件公式（stick-figure.ts）：行走完成时刻 = i×200（梯次）+ enterMs +
// travelMs；默认镜头末帧 tMs = 47/24×1000 ≈ 1958.33ms。
type FigureDecl = { action: string; fromX: number; toX: number };

function figureTransform(root: unknown, i: number): string {
  const groups: Array<Record<string, unknown>> = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as {
      tag?: string;
      attrs?: Record<string, unknown>;
      children?: unknown[];
    };
    if (n.tag === "g" && n.attrs && "transform" in n.attrs)
      groups.push(n.attrs);
    for (const child of n.children ?? []) walk(child);
  };
  walk(root);
  return groups[i]!.transform as string;
}

test("五枚模板时序预算：行走人物 ≤1800ms 落定（默认 2000ms 镜头留 ≥200ms 停留）", () => {
  // 上限 1800（非 1958.33）：落定后至少 ~5 帧可见停留，标题承诺的动作在
  // 默认镜头内成立。跳（x 固定）与 fromX=toX 的人物无行程，只查淡入完成。
  for (const template of STICK_TEMPLATES) {
    const params = template.params as {
      figures: FigureDecl[];
      enterMs: number;
      travelMs: number;
    };
    params.figures.forEach((figure, i) => {
      const travels = figure.action !== "跳" && figure.toX !== figure.fromX;
      const done = i * 200 + params.enterMs + (travels ? params.travelMs : 0);
      assert.ok(
        done <= 1800,
        `${template.templateId} 人物${i} 完成于 ${done}ms > 1800ms（默认 2000ms 镜头内动作被截断）`,
      );
    });
  }
});

test("默认 2 秒镜头末帧（帧 47 @24fps）：横穿/相遇人物已抵达 toX", () => {
  const renderAtLastFrame = (templateId: string) =>
    stickFigure.render(applyStickTemplate(SPEC, templateId).spec!, {
      frame: 47,
      fps: 24,
      width: 1920,
      height: 1080,
    } as Parameters<typeof stickFigure.render>[1]);
  const across = renderAtLastFrame("stick-walk-across");
  assert.ok(
    figureTransform(across, 0).startsWith("translate(920.00 "),
    `横穿未抵达: ${figureTransform(across, 0)}`,
  );
  const meet = renderAtLastFrame("stick-meet");
  assert.ok(
    figureTransform(meet, 0).startsWith("translate(420.00 "),
    `相遇人物0未抵达: ${figureTransform(meet, 0)}`,
  );
  assert.ok(
    figureTransform(meet, 1).startsWith("translate(580.00 "),
    `相遇人物1未抵达: ${figureTransform(meet, 1)}`,
  );
  assert.ok(
    figureTransform(meet, 2).startsWith("translate(500.00 "),
    `相遇人物2位置异常: ${figureTransform(meet, 2)}`,
  );
});
