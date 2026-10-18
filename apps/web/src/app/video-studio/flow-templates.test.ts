import assert from "node:assert/strict";
import test from "node:test";
import type { SceneSpec } from "@acs/video-scene";
import {
  applyFlowTemplate,
  buildFlowRevisePatch,
  draftFlowFromSpec,
  FLOW_TEMPLATES,
  isFlowComponentId,
} from "./flow-templates";

const SPEC = {
  specVersion: 1,
  componentId: "basic-shapes",
  componentVersion: 1,
  seed: 7,
  background: "#ffffff",
  durationMs: 3000,
  params: {},
} as unknown as SceneSpec;

test("applyFlowTemplate 换装与未知模板", () => {
  const applied = applyFlowTemplate(SPEC, "steps-4");
  assert.equal(applied.error, null);
  assert.equal(applied.spec!.componentId, "flow-steps");
  assert.equal(applied.spec!.componentVersion, 1);
  assert.deepEqual(
    (applied.spec!.params as { steps: Array<{ label: string }> }).steps.map(
      (s) => s.label,
    ),
    ["需求", "设计", "开发", "交付"],
  );
  // 换组件不换镜头字段（durationMs/background/seed 保留）
  assert.equal(applied.spec!.durationMs, 3000);
  assert.equal(applied.spec!.background, "#ffffff");
  assert.equal(applied.spec!.seed, 7);
  const unknown = applyFlowTemplate(SPEC, "nope");
  assert.equal(unknown.error, "未知流程模板 nope");
  assert.equal(unknown.spec, null);
});

test("五枚模板全过 validateSceneSpec", () => {
  assert.equal(FLOW_TEMPLATES.length, 5);
  for (const template of FLOW_TEMPLATES) {
    const applied = applyFlowTemplate(SPEC, template.templateId);
    assert.equal(applied.error, null, template.templateId);
    assert.ok(applied.spec, template.templateId);
  }
  assert.equal(isFlowComponentId("flow-steps"), true);
  assert.equal(isFlowComponentId("flow-diagram"), true);
  assert.equal(isFlowComponentId("map-grid"), false);
});

test("steps round-trip：draft 回读 + 数据修订（spread 保留其余参数）", () => {
  const applied = applyFlowTemplate(SPEC, "steps-4");
  const draft = draftFlowFromSpec(applied.spec!);
  assert.equal(draft.title, "四步流程");
  assert.equal(draft.data, "需求\n设计\n开发\n交付");
  const revised = buildFlowRevisePatch(applied.spec!, {
    title: "上线流程",
    data: "调研\n方案\n开发\n上线",
  });
  assert.equal(revised.error, null);
  const p = revised.spec!.params as {
    steps: Array<{ label: string }>;
    title: string;
    direction: string;
    enterMs: number;
    boxColor: string;
  };
  assert.deepEqual(
    p.steps.map((s) => s.label),
    ["调研", "方案", "开发", "上线"],
  );
  assert.equal(p.title, "上线流程");
  // 未触碰字段保留（direction/colors/enterMs）
  assert.equal(p.direction, "horizontal");
  assert.equal(p.enterMs, 1200);
  assert.equal(p.boxColor, "#dcebe1");
});

test("diagram round-trip：菱形标记与边标原样展开", () => {
  const applied = applyFlowTemplate(SPEC, "flow-decision");
  const draft = draftFlowFromSpec(applied.spec!);
  assert.equal(
    draft.data,
    "开始,200,520\n检查,500,520,菱形\n通过,820,400\n退回,820,660\n---\n开始->检查\n检查->通过,是\n检查->退回,否",
  );
  const back = buildFlowRevisePatch(applied.spec!, draft);
  assert.equal(back.error, null);
  assert.deepEqual(
    (back.spec!.params as { nodes: unknown }).nodes,
    (applied.spec!.params as { nodes: unknown }).nodes,
  );
  assert.deepEqual(
    (back.spec!.params as { edges: unknown }).edges,
    (applied.spec!.params as { edges: unknown }).edges,
  );
});

test("diagram 数据修订：菱形标记 + 边标进 params", () => {
  const applied = applyFlowTemplate(SPEC, "flow-decision");
  const revised = buildFlowRevisePatch(applied.spec!, {
    title: "输入校验",
    data: "输入,240,520\n校验,520,520,菱形\n通过,840,400\n---\n输入->校验\n校验->通过,是",
  });
  assert.equal(revised.error, null);
  const p = revised.spec!.params as {
    nodes: Array<{
      label: string;
      x: number;
      y: number;
      kind: string;
    }>;
    edges: Array<{ from: string; to: string; label?: string }>;
    enterMs: number;
    drawMs: number;
    arrowColor: string;
  };
  assert.deepEqual(p.nodes[0], {
    label: "输入",
    x: 240,
    y: 520,
    kind: "box",
  });
  assert.equal(p.nodes[1]!.kind, "diamond");
  assert.equal(p.nodes[1]!.label, "校验");
  assert.deepEqual(p.edges[1], {
    from: "校验",
    to: "通过",
    label: "是",
  });
  // 未触碰字段保留
  assert.equal(p.enterMs, 1000);
  assert.equal(p.drawMs, 800);
  assert.equal(p.arrowColor, "#2f6f4f");
});

test("段与行数错误逐项拒绝", () => {
  const steps = applyFlowTemplate(SPEC, "steps-4").spec!;
  assert.equal(
    buildFlowRevisePatch(steps, { title: "t", data: "唯一" }).error,
    "流程步骤至少需要两行",
  );
  assert.equal(
    buildFlowRevisePatch(steps, {
      title: "t",
      data: Array.from({ length: 9 }, (_, i) => `步${i + 1}`).join("\n"),
    }).error,
    "流程步骤最多 8 行（步数上限）",
  );
  const diagram = applyFlowTemplate(SPEC, "flow-decision").spec!;
  assert.equal(
    buildFlowRevisePatch(diagram, {
      title: "t",
      data: "甲,100,100\n乙,200,200",
    }).error,
    "数据需用一行「---」分隔节点段与边段",
  );
  assert.equal(
    buildFlowRevisePatch(diagram, {
      title: "t",
      data: "甲,100,100\n乙,200,200\n---",
    }).error,
    "边段至少需要一行",
  );
  assert.equal(
    buildFlowRevisePatch(diagram, {
      title: "t",
      data: "甲,100,100\n---\n甲->甲",
    }).error,
    "节点段至少需要两行",
  );
  assert.equal(
    buildFlowRevisePatch(diagram, {
      title: "t",
      data: [
        ...Array.from({ length: 13 }, (_, i) => `N${i},100,100`),
        "---",
        "N0->N1",
      ].join("\n"),
    }).error,
    "节点段最多 12 行（节点上限）",
  );
  assert.equal(
    buildFlowRevisePatch(diagram, {
      title: "t",
      data: [
        "甲,100,100",
        "乙,200,200",
        "---",
        ...Array.from({ length: 17 }, () => "甲->乙"),
      ].join("\n"),
    }).error,
    "边段最多 16 行（连线上限）",
  );
  // 非流程组件守卫
  assert.equal(
    buildFlowRevisePatch(SPEC, { title: "t", data: "甲\n乙" }).error,
    "当前镜头组件不是流程组件",
  );
});

test("引用与重复错误带整段行号", () => {
  const diagram = applyFlowTemplate(SPEC, "flow-decision").spec!;
  assert.equal(
    buildFlowRevisePatch(diagram, {
      title: "t",
      data: "甲,100,100\n乙,200,200\n---\n甲->乙\n甲->丙",
    }).error,
    "第 5 行：节点「丙」未声明",
  );
  assert.equal(
    buildFlowRevisePatch(diagram, {
      title: "t",
      data: "甲,100,100\n甲,200,200\n---\n甲->甲",
    }).error,
    "第 2 行：节点标签「甲」重复",
  );
  assert.equal(
    buildFlowRevisePatch(diagram, {
      title: "t",
      data: "甲,100,100\n乙,200,200\n---\n甲乙",
    }).error,
    "第 4 行：标签->标签[,边标] 格式不符（标签 1..6 字符，边标 1..6 字符）",
  );
});

test("CRLF 与空行容错", () => {
  const steps = applyFlowTemplate(SPEC, "steps-4").spec!;
  const revised = buildFlowRevisePatch(steps, {
    title: "t",
    data: "调研\r\n\r\n方案\r\n开发\n\n上线\r\n",
  });
  assert.equal(revised.error, null);
  assert.deepEqual(
    (revised.spec!.params as { steps: Array<{ label: string }> }).steps.map(
      (s) => s.label,
    ),
    ["调研", "方案", "开发", "上线"],
  );
});

test("逗号与「菱形」标记消歧（文档化取舍）", () => {
  const diagram = applyFlowTemplate(SPEC, "flow-decision").spec!;
  const revised = buildFlowRevisePatch(diagram, {
    title: "t",
    data: "南,北,520,300\n菱形,200,520\n甲,200,520,菱形\n乙,丙,300,300\n---\n甲->乙,丙,丁",
  });
  assert.equal(revised.error, null);
  const nodes = (revised.spec!.params as {
    nodes: Array<{
      label: string;
      x: number;
      y: number;
      kind: string;
    }>;
  }).nodes;
  // 末段非「菱形」→ 标签含逗号读法
  assert.equal(nodes[0]!.label, "南,北");
  assert.equal(nodes[0]!.kind, "box");
  // 3 段无标记位 → 盒节点标签「菱形」
  assert.equal(nodes[1]!.label, "菱形");
  assert.equal(nodes[1]!.kind, "box");
  // 末段恰为「菱形」→ 菱形节点「甲」
  assert.equal(nodes[2]!.label, "甲");
  assert.equal(nodes[2]!.kind, "diamond");
  // 边从右消歧：甲->乙,丙,丁 → to=乙,丙、边标=丁
  assert.deepEqual(
    (revised.spec!.params as { edges: unknown[] }).edges[0],
    {
      from: "甲",
      to: "乙,丙",
      label: "丁",
    },
  );
});
