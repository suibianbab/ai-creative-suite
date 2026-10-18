# Video Studio P2-③ 流程图/示意图 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给组件注册表追加两个流程题材组件（flow-steps 线性流程 / flow-diagram 节点连线）并接入工作台起点模板，全程零新依赖、零 planner 改动、零 TTS 计费。

**Architecture:** 沿 P2-①② 先例：video-scene 包内新增两个纯函数 SVG 组件（1000×1000 设计空间嵌套 svg viewBox、梯次弹入、pathLength=1 描画），defaultRegistry v3→v4 只追加；web 侧新增 flow-templates.ts 纯逻辑模块（5 枚模板 + 行编辑 round-trip，C1 语义），编辑卡下拉扩为三族 optgroup、应用链统一合并语义（I1）。e2e 复用 map 链路形态新增 VID-019，并以 map e2e 媒体哈希为金标准验证「注册表追加无害」。

**Tech Stack:** TypeScript + node:test（video-scene tsc 构建 + dist 测试 / web tsx 直跑）、React 19 + Next 16（仅编辑卡接线，沿用既有模式）、Playwright chromium + Remotion CLI + ffmpeg signalstats（e2e）。

**Spec:** `docs/superpowers/specs/2026-10-18-video-studio-flowchart-design.md`

## Global Constraints

- 注册表只追加：新组件 = 追加 + bump registryVersion（v3→v4），不改旧组件；旧 spec 渲染路径零改动。
- 帧确定性：render 纯函数，禁墙钟/未播种随机/网络/存储（determinism-gate 词法巡检 src/components）；同 spec 同帧输出一致。
- 老项目字节不变：map e2e（VID-018）复跑 exit 0，媒体哈希 = P2-② 已档 landscape `64eb4480cc7a987b1addec3b58987257534cf68ec99363d6de8072662e56a825` / portrait `7aeff69d9c08307e1a972a5f7364af290692a171647e25788e8218f2f11916ff` 逐字节一致。
- 规划器零改动：P0 句式与 P1 分镜规划器不生成流程图镜头；流程图进画面的唯一路径 = 工作台模板选择。
- 组件纪律：1000×1000 设计空间 + 嵌套 svg viewBox、背景 rect 为首子元素、tMs = 帧/fps×1000、easing.js 缓动、validateParams 中文消息带定位（`flow-steps params.…` / `flow-diagram params.…`）。
- v1 几何裁定：不引自动布局引擎；steps 几何由步数与 direction 唯一推出；diagram 节点显式 x,y、边端点按中心连线收缩固定余量 100（近圆近似，近距按 `(len−20)/2` 收缩钳 0）。
- 工作台：非法编辑行内报错不落 patch（C1 语义）；模板应用与并发草稿编辑（旁白/背景/时长）一次应用一并落库（P2-① I1 语义）。
- 零新依赖；单元测试零网络；e2e 零 TTS（台账 `artifacts/tts-usage.jsonl` 行数不变，现 34 行、累计 ¥0.0370/¥50）；媒体不入库、SHA-256 为证据口径；git 一律在 worktree `D:/codex/animate/.claude/worktrees/video-studio-p0`（分支 `worktree-video-studio-p2`），commit 尾行 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 命令口径：video-scene 套件 `pnpm --filter @acs/video-scene test`（tsc 构建 + node --test dist）；web 套件 `pnpm --filter @acs/web test`；web 类型 `pnpm --filter @acs/web typecheck`；lint `pnpm exec biome check apps/web/src/app/video-studio packages/video-scene/src`。基线计数：video-scene 74 / video-document 71 / web 92 / scripts 57 / qa 78 自动 + 51 手工。

## Review Focus

1. **重合/近距节点边裁剪**——两节点中心距 <220 时边端收缩 `(len−20)/2` 且钳 0；完全重合（len=0）输出退化线段不产生 NaN → Task 2「近距收缩与重合守卫」测试钉住。
2. **八步上限横向几何**——8 步时 slot=720/7、boxW=518.4/7≈74.06，箭头两端仍 x2>x1（非负长度）、全树无 NaN → Task 1「八步上限几何」测试钉住。
3. **节点标签含逗号 / 标签恰为「菱形」**——节点行从右解析：`南,北,520,300` 读标签「南,北」；`菱形,200,520`（3 段）读盒节点标签「菱形」；`甲,200,520,菱形` 读菱形节点「甲」→ Task 3「逗号与菱形标记消歧」测试钉住。
4. **边引用未声明节点 / 边标含逗号**——`甲->乙,丙,丁` 从右消歧读 to=「乙,丙」、边标=「丁」；引用未声明节点按整段行号报错 → Task 3「引用与重复错误」「逗号与菱形标记消歧」测试钉住。
5. **模板换装并发编辑合并（I1 不回退）**——换模板与旁白草稿并发、单次应用一并落库，旁白不丢 → Task 5 e2e 旁白并发合并断言 + Task 3 spread 保留断言钉住。

---
### Task 1: flow-steps 线性流程组件

**Files:**
- Create: `packages/video-scene/src/components/flow-steps.ts`
- Create: `packages/video-scene/src/components/flow-steps.test.ts`
- Modify: `packages/video-scene/src/default-registry.ts`（数组追加 flowSteps、版本 3→4、注释补 v4 行）
- Modify: `packages/video-scene/src/index.ts`（命名再导出 flowSteps）

**Interfaces:**
- Consumes: `clamp01`/`easeOutCubic`（../easing.js）、`fitFontSize(max, text, maxWidth)`（../text-width.js）、`FrameContext`/`SceneComponent`/`SceneSpecLike`（../registry.js）、`SvgNode`（../svg.js，`{tag, attrs, children?, text?}`）。
- Produces: `export const flowSteps: SceneComponent`（componentId `"flow-steps"`、version 1）；`defaultRegistry` registryVersion=4；`import { flowSteps } from "@acs/video-scene"`（Task 3 消费）。

**几何与动画口径（实现与测试共用的精确值）：**
- 横向：中心 x_i = 140 + i×slot，slot = 720/(N−1)，全部在 y=520；boxW = min(slot×0.72, 240)，boxH = 96。N=4 → cx=[140,380,620,860]，boxW=172.8，盒 rect x=[53.6, 293.6, 533.6, 773.6]、y=472。
- 纵向：中心 y_i = 220 + i×slot，slot = 600/(N−1)，全部在 x=500；boxW = 280，boxH = min(slot×0.72, 160)。N=5 → cy=[220,370,520,670,820]，boxH=108，盒 rect y=[166,316,466,616,766]、x=360。
- 箭头（横向，i→i+1）：x1 = cx_i + boxW/2 + 10，x2 = cx_{i+1} − boxW/2 − 10，y=520。N=4 首箭头 d=`M 236.40,520.00 L 283.60,520.00`；箭头三角 points=`283.60,520.00 269.60,513.00 269.60,527.00`（tip=x2、base=(x2−14, ∓7)）。纵向：y1 = cy_i + boxH/2 + 10，y2 = cy_{i+1} − boxH/2 − 10，x=500。N=5 首箭头 d=`M 500.00,284.00 L 500.00,306.00`；points=`500.00,306.00 493.00,292.00 507.00,292.00`。
- 时序（enterMs=E）：盒 i 延迟 i×120，appear = easeOutCubic(clamp01((tMs−i×120)/E))，scale = 1.4−0.4×appear（toFixed(4)，绕盒中心 translate(cx cy)…translate(−cx −cy)）；标签 opacity = clamp01((tMs−i×120−E)/300)；箭头 i 在前盒落定后（delay = i×120+E）240ms 线性描画，dashoffset = Number((1−p).toFixed(4))、p = clamp01((tMs−delay)/240)；箭头三角 opacity = clamp01((tMs−delay−240)/160)。

- [ ] **Step 1: 写失败测试**

创建 `packages/video-scene/src/components/flow-steps.test.ts`（沿 map-grid.test.ts 惯例：collect 私有遍历、makeCtx 默认 frame 24/fps 24 → tMs=1000）：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { FrameContext } from "../registry.js";
import type { SvgNode } from "../svg.js";
import { flowSteps } from "./flow-steps.js";

// collect 为各组件测试私有惯例（bar/line/map 同款），不跨文件共享
function collect(node: SvgNode, tag: string, out: SvgNode[] = []): SvgNode[] {
  if (node.tag === tag) out.push(node);
  for (const child of node.children ?? []) collect(child, tag, out);
  return out;
}

const BASE = {
  title: "四步流程",
  steps: [
    { label: "甲" },
    { label: "乙" },
    { label: "丙" },
    { label: "丁" },
  ],
  direction: "horizontal",
  boxColor: "#dcebe1",
  arrowColor: "#2f6f4f",
  textColor: "#1b2c29",
  enterMs: 200,
};

function specWith(params: unknown) {
  return {
    componentId: "flow-steps",
    componentVersion: 1,
    params,
    seed: 1,
    background: "#ffffff",
    durationMs: 3000,
  };
}
function makeCtx(overrides: Partial<FrameContext> = {}): FrameContext {
  return {
    frame: 24,
    fps: 24,
    width: 1920,
    height: 1080,
    ...overrides,
  } as FrameContext;
}

test("校验表：越界输入逐项拒绝", () => {
  const cases: Array<[unknown, RegExp]> = [
    [{ ...BASE, steps: [{ label: "甲" }] }, /steps 必须是 2\.\.8 个/],
    [
      {
        ...BASE,
        steps: Array.from({ length: 9 }, () => ({ label: "步" })),
      },
      /steps 必须是 2\.\.8 个/,
    ],
    [
      { ...BASE, steps: [{ label: "" }, { label: "乙" }] },
      /label 必须是 1\.\.10 个字符/,
    ],
    [
      {
        ...BASE,
        steps: [{ label: "一二三四五六七八九十壹" }, { label: "乙" }],
      },
      /label 必须是 1\.\.10 个字符/,
    ],
    [{ ...BASE, steps: [{ label: "甲" }, 5] }, /steps\[1\] 必须是对象/],
    [{ ...BASE, direction: "diagonal" }, /direction 必须是 horizontal 或 vertical/],
    [{ ...BASE, boxColor: "green" }, /boxColor 必须是 #rrggbb/],
    [{ ...BASE, arrowColor: "rgb(1,2,3)" }, /arrowColor 必须是 #rrggbb/],
    [{ ...BASE, enterMs: 100 }, /enterMs 必须是 200\.\.6000 的整数/],
    [{ ...BASE, title: "x".repeat(41) }, /title 必须是 ≤40 个字符/],
  ];
  for (const [params, re] of cases) {
    assert.throws(() => flowSteps.validateParams(params), re);
  }
});

test("横向几何：步数唯一决定盒位与尺寸（N=4）", () => {
  // slot=720/3=240；boxW=min(172.8,240)=172.8、boxH=96；中心 y=520
  const node = flowSteps.render(specWith(BASE) as never, makeCtx());
  const rects = collect(node, "rect");
  assert.equal(rects.length, 5); // 背景 + 4 盒
  assert.deepEqual(
    rects.slice(1).map((r) => r.attrs.x),
    [140 - 86.4, 380 - 86.4, 620 - 86.4, 860 - 86.4],
  );
  for (const r of rects.slice(1)) {
    assert.equal(r.attrs.y, 520 - 48);
    assert.equal(r.attrs.width, 172.8);
    assert.equal(r.attrs.height, 96);
    assert.equal(r.attrs.rx, 10);
    assert.equal(r.attrs.fill, "#dcebe1");
  }
  // 标题存在且居中（map-grid 同款）
  const title = collect(node, "text").find((t) => t.text === "四步流程");
  assert.equal(title?.attrs.x, 500);
  assert.equal(title?.attrs["dominant-baseline"], "middle");
});

test("纵向几何与箭头（N=5）：盒位/尺寸 + 首箭头 d 与三角", () => {
  const params = {
    ...BASE,
    steps: [
      { label: "一" },
      { label: "二" },
      { label: "三" },
      { label: "四" },
      { label: "五" },
    ],
    direction: "vertical" as const,
  };
  const node = flowSteps.render(specWith(params) as never, makeCtx());
  const rects = collect(node, "rect").slice(1);
  // slot=600/4=150；boxH=min(108,160)=108、boxW=280；中心 x=500
  assert.deepEqual(
    rects.map((r) => r.attrs.y),
    [220 - 54, 370 - 54, 520 - 54, 670 - 54, 820 - 54],
  );
  for (const r of rects) {
    assert.equal(r.attrs.x, 500 - 140);
    assert.equal(r.attrs.width, 280);
    assert.equal(r.attrs.height, 108);
  }
  assert.equal(collect(node, "path").length, 4);
  assert.equal(collect(node, "polygon").length, 4);
  assert.equal(
    collect(node, "path")[0]!.attrs.d,
    "M 500.00,284.00 L 500.00,306.00",
  );
  assert.equal(
    collect(node, "polygon")[0]!.attrs.points,
    "500.00,306.00 493.00,292.00 507.00,292.00",
  );
});

test("横向箭头几何与描画属性（N=4 首箭头）", () => {
  const node = flowSteps.render(specWith(BASE) as never, makeCtx());
  const path = collect(node, "path")[0]!;
  assert.equal(path.attrs.d, "M 236.40,520.00 L 283.60,520.00");
  assert.equal(path.attrs.fill, "none");
  assert.equal(path.attrs.stroke, "#2f6f4f");
  assert.equal(path.attrs["stroke-width"], 8);
  assert.equal(path.attrs.pathLength, 1);
  assert.equal(path.attrs["stroke-dasharray"], 1);
  assert.equal(path.attrs["stroke-dashoffset"], 0); // tMs=1000 已描完
  assert.equal(
    collect(node, "polygon")[0]!.attrs.points,
    "283.60,520.00 269.60,513.00 269.60,527.00",
  );
});

test("梯次弹入与标签两级节奏（tMs=100，enterMs=200）", () => {
  const node = flowSteps.render(specWith(BASE) as never, makeCtx({ frame: 2.4 }));
  const rects = collect(node, "rect").slice(1);
  // 盒 0：appear=easeOutCubic(0.5)=0.875、scale=1.4−0.4×0.875=1.05
  assert.ok(Math.abs((rects[0]!.attrs.opacity as number) - 0.875) < 1e-9);
  assert.ok(rects[0]!.attrs.transform.includes("scale(1.0500)"));
  // 盒 1 延迟 120ms 未入场：opacity 0、scale 1.4000
  assert.equal(rects[1]!.attrs.opacity, 0);
  assert.ok(rects[1]!.attrs.transform.includes("scale(1.4000)"));
  // 标签两级：100 < 0+200 → 全 0
  const labels = collect(node, "text").filter((t) => t.text !== BASE.title);
  assert.deepEqual(
    labels.map((t) => t.attrs.opacity),
    [0, 0, 0, 0],
  );
});

test("箭头描画时窗与三角淡入（enterMs=200 → 首箭头 delay=200）", () => {
  const at = (frame: number) =>
    flowSteps.render(specWith(BASE) as never, makeCtx({ frame }));
  const offsets = [4.8, 7.68, 9.408].map((f) =>
    collect(at(f), "path")[0]!.attrs["stroke-dashoffset"],
  );
  // tMs=200 → p=0；320 → p=0.5；392 → p=0.8
  assert.deepEqual(offsets, [1, 0.5, 0.2]);
  const headOps = [10.56, 12.48, 14.4].map((f) =>
    collect(at(f), "polygon")[0]!.attrs.opacity,
  );
  // 三角窗口 (tMs−440)/160：440 → 0；520 → 0.5；600 → 1
  assert.deepEqual(headOps, [0, 0.5, 1]);
});

test("标签淡入窗口：enterMs 后 300ms 线性到位", () => {
  const at = (frame: number) =>
    collect(
      flowSteps.render(specWith(BASE) as never, makeCtx({ frame })),
      "text",
    )
      .filter((t) => t.text !== BASE.title)
      .map((t) => t.attrs.opacity);
  assert.equal(at(8.4)[0], 0.5); // (350−200)/300
  assert.deepEqual(at(13.44), [1, 1, 1, 1]); // (560−200)/300 ≥ 1
});

test("纯函数：同 spec 同帧双调 deepEqual", () => {
  const s = specWith(BASE) as never;
  assert.deepEqual(
    flowSteps.render(s, makeCtx({ frame: 13 })),
    flowSteps.render(s, makeCtx({ frame: 13 })),
  );
});

test("八步上限几何：slot=720/7、无 NaN、箭头非负长", () => {
  const params = {
    ...BASE,
    steps: Array.from({ length: 8 }, (_, i) => ({ label: `步${i + 1}` })),
  };
  const node = flowSteps.render(specWith(params) as never, makeCtx());
  const rects = collect(node, "rect").slice(1);
  assert.equal(rects.length, 8);
  // boxW = min((720/7)×0.72, 240) = 518.4/7
  for (const r of rects) {
    assert.ok(Math.abs((r.attrs.width as number) - 518.4 / 7) < 1e-9);
    assert.ok(Math.abs((r.attrs.height as number) - 96) < 1e-9);
  }
  // 首末中心 = 140 / 860（等距覆盖全区；浮点表达差异容忍 1e-9）
  assert.ok(Math.abs((rects[0]!.attrs.x as number) - (140 - 518.4 / 14)) < 1e-9);
  assert.ok(Math.abs((rects[7]!.attrs.x as number) - (860 - 518.4 / 14)) < 1e-9);
  // 7 支箭头全部 x2 > x1（长度非负）
  for (const p of collect(node, "path")) {
    const m = /M ([0-9.]+),520\.00 L ([0-9.]+),520\.00/.exec(
      String(p.attrs.d),
    )!;
    assert.ok(Number(m[2]) > Number(m[1]), p.attrs.d as string);
  }
  assert.ok(!JSON.stringify(node).includes("NaN"));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @acs/video-scene test`
Expected: FAIL——tsc 编译报 `Cannot find module './flow-steps.js'`（组件尚不存在），9 个新测试未通过（构建失败即 RED）。

- [ ] **Step 3: 写实现**

创建 `packages/video-scene/src/components/flow-steps.ts`：

```ts
import { clamp01, easeOutCubic } from "../easing.js";
import type {
  FrameContext,
  SceneComponent,
  SceneSpecLike,
} from "../registry.js";
import type { SvgNode } from "../svg.js";
import { fitFontSize } from "../text-width.js";

// 线性流程图 v1：N 步盒子按方向（横向/纵向）等距排布，步间直线箭头
// （pathLength=1 + dashoffset 描画，同 line-drawing 口径）。盒 i 在 i×120ms
// 弹入（scale 1.4→1 + 淡入，梯次口径同 bar-chart/map-grid）；盒内标签在
// enterMs 后 300ms 淡入（两级节奏，同 map-grid）；箭头在前盒落定后 240ms
// 线性描画，箭头三角随后 160ms 淡入。几何由步数与 direction 唯一推出
// （v1 不引自动布局，spec 裁定）。1000×1000 设计空间嵌套 svg viewBox；
// render 纯函数，禁墙钟/随机/网络。

type FlowStepsParams = {
  title: string;
  steps: Array<{ label: string }>;
  direction: "horizontal" | "vertical";
  boxColor: string;
  arrowColor: string;
  textColor: string;
  enterMs: number; // 200..6000
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DESIGN_SPACE = 1000;
// 横向：中心 x 140..860 于 y=520；纵向：中心 y 220..820 于 x=500
const H_LEFT = 140;
const H_RIGHT = 860;
const V_TOP = 220;
const V_BOTTOM = 820;
const MID_X = 500;
const MID_Y = 520;
const BOX_RATIO = 0.72;
const H_BOX_W_CAP = 240;
const H_BOX_H = 96;
const V_BOX_W = 280;
const V_BOX_H_CAP = 160;
const STAGGER_MS = 120;
const LABEL_FADE_MS = 300;
const ARROW_MS = 240;
const ARROWHEAD_MS = 160;
const ARROW_GAP = 10;
const MAX_STEPS = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function validateParams(value: unknown): FlowStepsParams {
  if (!isRecord(value)) throw new Error("flow-steps params 必须是对象");
  if (typeof value.title !== "string" || value.title.length > 40) {
    throw new Error("flow-steps params.title 必须是 ≤40 个字符");
  }
  if (
    !Array.isArray(value.steps) ||
    value.steps.length < 2 ||
    value.steps.length > MAX_STEPS
  ) {
    throw new Error(
      `flow-steps params.steps 必须是 2..${MAX_STEPS} 个 {label}`,
    );
  }
  value.steps.forEach((step, i) => {
    if (!isRecord(step)) {
      throw new Error(`flow-steps params.steps[${i}] 必须是对象`);
    }
    if (
      typeof step.label !== "string" ||
      step.label.length < 1 ||
      step.label.length > 10
    ) {
      throw new Error(
        `flow-steps params.steps[${i}].label 必须是 1..10 个字符`,
      );
    }
  });
  if (value.direction !== "horizontal" && value.direction !== "vertical") {
    throw new Error("flow-steps params.direction 必须是 horizontal 或 vertical");
  }
  for (const key of ["boxColor", "arrowColor", "textColor"] as const) {
    if (!isHexColor(value[key])) {
      throw new Error(`flow-steps params.${key} 必须是 #rrggbb`);
    }
  }
  if (
    !Number.isInteger(value.enterMs) ||
    (value.enterMs as number) < 200 ||
    (value.enterMs as number) > 6000
  ) {
    throw new Error("flow-steps params.enterMs 必须是 200..6000 的整数");
  }
  return value as FlowStepsParams;
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const params = spec.params as FlowStepsParams;
  const tMs = (ctx.frame / ctx.fps) * 1000;
  const n = params.steps.length;
  const horizontal = params.direction === "horizontal";
  // 步中心等距排布：横向 x ∈ [140,860]@y=520；纵向 y ∈ [220,820]@x=500
  const slot = horizontal
    ? (H_RIGHT - H_LEFT) / (n - 1)
    : (V_BOTTOM - V_TOP) / (n - 1);
  const boxW = horizontal ? Math.min(slot * BOX_RATIO, H_BOX_W_CAP) : V_BOX_W;
  const boxH = horizontal ? H_BOX_H : Math.min(slot * BOX_RATIO, V_BOX_H_CAP);

  const boxes: SvgNode[] = [];
  const labels: SvgNode[] = [];
  params.steps.forEach((step, i) => {
    const delay = i * STAGGER_MS;
    const appear = easeOutCubic(clamp01((tMs - delay) / params.enterMs));
    const cx = horizontal ? H_LEFT + i * slot : MID_X;
    const cy = horizontal ? MID_Y : V_TOP + i * slot;
    const fontSize = fitFontSize(22, step.label, boxW * 0.8);
    boxes.push({
      tag: "rect",
      attrs: {
        x: cx - boxW / 2,
        y: cy - boxH / 2,
        width: boxW,
        height: boxH,
        rx: 10,
        fill: params.boxColor,
        opacity: appear,
        // 弹入：scale 1.4 → 1（绕盒中心）
        transform: `translate(${cx} ${cy}) scale(${(1.4 - 0.4 * appear).toFixed(4)}) translate(${-cx} ${-cy})`,
      },
    });
    labels.push({
      tag: "text",
      attrs: {
        x: cx,
        y: cy + fontSize * 0.36,
        "font-size": fontSize,
        fill: params.textColor,
        "text-anchor": "middle",
        opacity: clamp01((tMs - delay - params.enterMs) / LABEL_FADE_MS),
      },
      text: step.label,
    });
  });

  const arrows: SvgNode[] = [];
  const heads: SvgNode[] = [];
  for (let i = 0; i + 1 < n; i += 1) {
    const delay = i * STAGGER_MS + params.enterMs; // 前盒落定后描画
    const p = clamp01((tMs - delay) / ARROW_MS);
    const headOpacity = clamp01((tMs - delay - ARROW_MS) / ARROWHEAD_MS);
    const stroke = {
      fill: "none",
      stroke: params.arrowColor,
      "stroke-width": 8,
      "stroke-linecap": "round",
      pathLength: 1,
      "stroke-dasharray": 1,
      "stroke-dashoffset": Number((1 - p).toFixed(4)),
    };
    if (horizontal) {
      const x1 = H_LEFT + i * slot + boxW / 2 + ARROW_GAP;
      const x2 = H_LEFT + (i + 1) * slot - boxW / 2 - ARROW_GAP;
      arrows.push({
        tag: "path",
        attrs: {
          d: `M ${x1.toFixed(2)},${MID_Y.toFixed(2)} L ${x2.toFixed(2)},${MID_Y.toFixed(2)}`,
          ...stroke,
        },
      });
      heads.push({
        tag: "polygon",
        attrs: {
          points: `${x2.toFixed(2)},${MID_Y.toFixed(2)} ${(x2 - 14).toFixed(2)},${(MID_Y - 7).toFixed(2)} ${(x2 - 14).toFixed(2)},${(MID_Y + 7).toFixed(2)}`,
          fill: params.arrowColor,
          opacity: headOpacity,
        },
      });
    } else {
      const y1 = V_TOP + i * slot + boxH / 2 + ARROW_GAP;
      const y2 = V_TOP + (i + 1) * slot - boxH / 2 - ARROW_GAP;
      arrows.push({
        tag: "path",
        attrs: {
          d: `M ${MID_X.toFixed(2)},${y1.toFixed(2)} L ${MID_X.toFixed(2)},${y2.toFixed(2)}`,
          ...stroke,
        },
      });
      heads.push({
        tag: "polygon",
        attrs: {
          points: `${MID_X.toFixed(2)},${y2.toFixed(2)} ${(MID_X - 7).toFixed(2)},${(y2 - 14).toFixed(2)} ${(MID_X + 7).toFixed(2)},${(y2 - 14).toFixed(2)}`,
          fill: params.arrowColor,
          opacity: headOpacity,
        },
      });
    }
  }

  return {
    tag: "g",
    attrs: {},
    children: [
      {
        tag: "rect",
        attrs: {
          x: 0,
          y: 0,
          width: ctx.width,
          height: ctx.height,
          fill: spec.background,
        },
      },
      {
        tag: "svg",
        attrs: {
          x: 0,
          y: 0,
          width: ctx.width,
          height: ctx.height,
          viewBox: `0 0 ${DESIGN_SPACE} ${DESIGN_SPACE}`,
        },
        children: [
          {
            tag: "text",
            attrs: {
              x: 500,
              y: 100,
              "font-size": fitFontSize(48, params.title, 880),
              fill: params.textColor,
              "text-anchor": "middle",
              "dominant-baseline": "middle",
            },
            text: params.title,
          },
          ...boxes,
          ...arrows,
          ...heads,
          ...labels,
        ],
      },
    ],
  };
}

export const flowSteps: SceneComponent = {
  componentId: "flow-steps",
  version: 1,
  validateParams,
  render,
};
```

修改 `packages/video-scene/src/default-registry.ts`——import 区加一行、数组加 flowSteps、版本 3→4、注释补：

```ts
import { flowSteps } from "./components/flow-steps.js";
```

数组（mapJourney 之后）：

```ts
    mapGrid,
    mapJourney,
    flowSteps,
  ],
  4,
);
```

注释块追加一行（既有 v3 行之后）：

```ts
// v4（P2-③ 流程图/示意图）：追加流程组件，同一分支内原子落地。
```

修改 `packages/video-scene/src/index.ts`——在 basic-shapes 导出之后、line-chart 之前插入（字母序），沿用命名再导出注释组：

```ts
export { flowSteps } from "./components/flow-steps.js";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @acs/video-scene test`
Expected: PASS——83 个测试全绿（基线 74 + 新 9），无警告。

- [ ] **Step 5: 提交**

```bash
git add packages/video-scene/src/components/flow-steps.ts packages/video-scene/src/components/flow-steps.test.ts packages/video-scene/src/default-registry.ts packages/video-scene/src/index.ts
git commit -m "feat(video-studio): flow-steps 线性流程组件 + 注册表 v4

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```
### Task 2: flow-diagram 节点连线组件

**Files:**
- Create: `packages/video-scene/src/components/flow-diagram.ts`
- Create: `packages/video-scene/src/components/flow-diagram.test.ts`
- Modify: `packages/video-scene/src/default-registry.ts`（数组追加 flowDiagram，版本维持 4）
- Modify: `packages/video-scene/src/index.ts`（命名再导出 flowDiagram）

**Interfaces:**
- Consumes: 同 Task 1 的 easing/registry/svg/text-width 契约。
- Produces: `export const flowDiagram: SceneComponent`（componentId `"flow-diagram"`、version 1）；`import { flowDiagram } from "@acs/video-scene"`。

**几何与动画口径（实现与测试共用的精确值）：**
- 节点尺寸恒定：box 180×72（rx 10，rect 相对中心 x=−90/y=−36）；diamond 半对角 110×64（polygon points `-110,0 0,-64 110,0 0,64`）。节点为 `<g transform="translate(x y) scale(s)" opacity>` 包 rect/polygon + 居中 text（`fitFontSize(22, label, diamond?150:156)`，y = fs×0.36）。
- 节点 i 延迟 i×120 弹入：appear = easeOutCubic(clamp01((tMs−i×120)/enterMs))，scale = 1.4−0.4×appear（toFixed(4)），opacity = appear（标签随组，单级节奏——spec 只约定 steps 两级）。
- 边（from→to 按标签引用）：a/b 为两节点中心，len = hypot；`len===0` 时置 len=1（重合守卫，不 NaN）；收缩余量 trim = len<220 ? max((len−20)/2, 0) : 100；单位向量 u=(dx,dy)/len；start = a+u×trim、end = b−u×trim；d=`M sx,sy L ex,ey`（toFixed(2)）。
- 边时序：startT = max(delayFrom, delayTo) + enterMs（两端落定后）；p = clamp01((tMs−startT)/drawMs) 线性描画（pathLength=1、dasharray 1、dashoffset=Number((1−p).toFixed(4))、stroke-width 8）；箭头三角 tip=end、base=end−u×14、两侧偏移 perp=(−uy,ux)×7，opacity = clamp01((tMs−startT−drawMs)/160)；边标（可选）在 (start+end)/2 上移 24，`fitFontSize(20, label, 200)`，opacity = clamp01((tMs−startT−drawMs−160)/240)。
- 精确样例：甲(300,300)→乙(700,700)：d=`M 370.71,370.71 L 629.29,629.29`、三角 `629.29,629.29 614.44,624.34 624.34,614.44`。甲(400,520)→乙(520,520)：trim=50 → d=`M 450.00,520.00 L 470.00,520.00`。甲(700,300)→乙(300,300)：d=`M 600.00,300.00 L 400.00,300.00`、三角 `400.00,300.00 414.00,293.00 414.00,307.00`。

- [ ] **Step 1: 写失败测试**

创建 `packages/video-scene/src/components/flow-diagram.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { FrameContext } from "../registry.js";
import type { SvgNode } from "../svg.js";
import { flowDiagram } from "./flow-diagram.js";

// collect 为各组件测试私有惯例（bar/line/map 同款），不跨文件共享
function collect(node: SvgNode, tag: string, out: SvgNode[] = []): SvgNode[] {
  if (node.tag === tag) out.push(node);
  for (const child of node.children ?? []) collect(child, tag, out);
  return out;
}

const BASE = {
  title: "两节点连线",
  nodes: [
    { label: "甲", x: 300, y: 300, kind: "box" },
    { label: "乙", x: 700, y: 700, kind: "box" },
  ],
  edges: [{ from: "甲", to: "乙" }],
  boxColor: "#dcebe1",
  arrowColor: "#2f6f4f",
  textColor: "#1b2c29",
  enterMs: 200,
  drawMs: 400,
};

function specWith(params: unknown) {
  return {
    componentId: "flow-diagram",
    componentVersion: 1,
    params,
    seed: 1,
    background: "#ffffff",
    durationMs: 3000,
  };
}
function makeCtx(overrides: Partial<FrameContext> = {}): FrameContext {
  return {
    frame: 24,
    fps: 24,
    width: 1920,
    height: 1080,
    ...overrides,
  } as FrameContext;
}

test("校验表：越界输入逐项拒绝", () => {
  const cases: Array<[unknown, RegExp]> = [
    [
      { ...BASE, nodes: [{ label: "甲", x: 0, y: 0, kind: "box" }] },
      /nodes 必须是 2\.\.12 个/,
    ],
    [
      {
        ...BASE,
        nodes: Array.from({ length: 13 }, (_, i) => ({
          label: `N${i}`,
          x: 100,
          y: 100,
          kind: "box",
        })),
      },
      /nodes 必须是 2\.\.12 个/,
    ],
    [
      {
        ...BASE,
        nodes: [
          { label: "", x: 0, y: 0, kind: "box" },
          { label: "乙", x: 100, y: 100, kind: "box" },
        ],
      },
      /label 必须是 1\.\.6 个字符/,
    ],
    [
      {
        ...BASE,
        nodes: [
          { label: "七个字标签", x: 0, y: 0, kind: "box" },
          { label: "乙", x: 100, y: 100, kind: "box" },
        ],
      },
      /label 必须是 1\.\.6 个字符/,
    ],
    [
      {
        ...BASE,
        nodes: [
          { label: "甲", x: 0, y: 0, kind: "box" },
          { label: "甲", x: 100, y: 100, kind: "box" },
        ],
      },
      /nodes\[1\]\.label 与 nodes\[0\] 重复/,
    ],
    [
      {
        ...BASE,
        nodes: [
          { label: "甲", x: -1, y: 0, kind: "box" },
          { label: "乙", x: 100, y: 100, kind: "box" },
        ],
      },
      /x \/ y 必须是 0\.\.1000 的数/,
    ],
    [
      {
        ...BASE,
        nodes: [
          { label: "甲", x: 0, y: 0, kind: "circle" },
          { label: "乙", x: 100, y: 100, kind: "box" },
        ],
      },
      /kind 必须是 box 或 diamond/,
    ],
    [{ ...BASE, edges: [] }, /edges 必须是 1\.\.16 条/],
    [
      {
        ...BASE,
        edges: Array.from({ length: 17 }, () => ({ from: "甲", to: "乙" })),
      },
      /edges 必须是 1\.\.16 条/,
    ],
    [{ ...BASE, edges: [{ from: "丙", to: "乙" }] }, /from\/to 必须引用已声明节点/],
    [
      { ...BASE, edges: [{ from: "甲", to: "乙", label: "一二三四五六七" }] },
      /label 必须是 ≤6 个字符/,
    ],
    [{ ...BASE, arrowColor: "blue" }, /arrowColor 必须是 #rrggbb/],
    [{ ...BASE, drawMs: 100 }, /drawMs 必须是 200\.\.6000 的整数/],
    [{ ...BASE, title: "x".repeat(41) }, /title 必须是 ≤40 个字符/],
  ];
  for (const [params, re] of cases) {
    assert.throws(() => flowDiagram.validateParams(params), re);
  }
});

test("节点几何：盒/菱形尺寸恒定，标签居中（settle 帧全局 scale=1）", () => {
  const params = {
    ...BASE,
    nodes: [
      { label: "甲", x: 300, y: 300, kind: "box" },
      { label: "乙", x: 700, y: 700, kind: "diamond" },
    ],
  };
  const node = flowDiagram.render(specWith(params) as never, makeCtx());
  // 根 g + 2 节点 g
  const groups = collect(node, "g");
  assert.equal(groups.length, 3);
  assert.equal(groups[1]!.attrs.transform, "translate(300 300) scale(1.0000)");
  assert.equal(groups[1]!.attrs.opacity, 1);
  const boxRect = collect(groups[1]!, "rect")[0]!.attrs;
  assert.deepEqual(
    [boxRect.x, boxRect.y, boxRect.width, boxRect.height, boxRect.rx],
    [-90, -36, 180, 72, 10],
  );
  assert.equal(boxRect.fill, "#dcebe1");
  // 菱形 polygon 与箭头三角同为 polygon——按 points 区分
  const polygons = collect(node, "polygon");
  const diamond = polygons.find((p) => p.attrs.points === "-110,0 0,-64 110,0 0,64");
  assert.ok(diamond, "菱形 polygon 缺失");
  assert.equal(polygons.length, 2); // 菱形 + 1 支箭头三角
  // 节点标签随组、居中（短标签字号 22）
  const texts = groups[2] ? collect(groups[2]!, "text") : [];
  assert.equal(texts[0]!.text, "乙");
  assert.equal(Number(texts[0]!.attrs["font-size"]), 22);
  assert.equal(texts[0]!.attrs["text-anchor"], "middle");
});

test("边端点收缩（近圆近似 100）：对角线 d 与箭头三角", () => {
  const node = flowDiagram.render(specWith(BASE) as never, makeCtx());
  const path = collect(node, "path")[0]!;
  assert.equal(path.attrs.d, "M 370.71,370.71 L 629.29,629.29");
  assert.equal(path.attrs["stroke-width"], 8);
  assert.equal(path.attrs.pathLength, 1);
  assert.equal(path.attrs["stroke-dashoffset"], 0); // tMs=1000 已描完
  const head = collect(node, "polygon")[0]!;
  assert.equal(
    head.attrs.points,
    "629.29,629.29 614.44,624.34 624.34,614.44",
  );
  assert.equal(head.attrs.fill, "#2f6f4f");
});

test("近距收缩与重合守卫：len<220 按 (len−20)/2，len=0 无 NaN", () => {
  const near = flowDiagram.render(
    specWith({
      ...BASE,
      nodes: [
        { label: "甲", x: 400, y: 520, kind: "box" },
        { label: "乙", x: 520, y: 520, kind: "box" },
      ],
    }) as never,
    makeCtx(),
  );
  assert.equal(
    collect(near, "path")[0]!.attrs.d,
    "M 450.00,520.00 L 470.00,520.00",
  );
  const same = flowDiagram.render(
    specWith({
      ...BASE,
      nodes: [
        { label: "甲", x: 500, y: 500, kind: "box" },
        { label: "乙", x: 500, y: 500, kind: "box" },
      ],
    }) as never,
    makeCtx(),
  );
  assert.equal(
    collect(same, "path")[0]!.attrs.d,
    "M 500.00,500.00 L 500.00,500.00",
  );
  assert.ok(!JSON.stringify(same).includes("NaN"));
});

test("箭头朝向由边方向唯一决定：左向边三角朝左", () => {
  const node = flowDiagram.render(
    specWith({
      ...BASE,
      nodes: [
        { label: "甲", x: 700, y: 300, kind: "box" },
        { label: "乙", x: 300, y: 300, kind: "box" },
      ],
    }) as never,
    makeCtx(),
  );
  assert.equal(
    collect(node, "path")[0]!.attrs.d,
    "M 600.00,300.00 L 400.00,300.00",
  );
  assert.equal(
    collect(node, "polygon")[0]!.attrs.points,
    "400.00,300.00 414.00,293.00 414.00,307.00",
  );
});

test("节点梯次弹入（tMs=100，enterMs=200）：i×120ms", () => {
  const node = flowDiagram.render(specWith(BASE) as never, makeCtx({ frame: 2.4 }));
  const groups = collect(node, "g").slice(1);
  // 甲：appear=easeOutCubic(0.5)=0.875、scale=1.05
  assert.equal(groups[0]!.attrs.opacity, 0.875);
  assert.ok(groups[0]!.attrs.transform.includes("scale(1.0500)"));
  // 乙：延迟 120ms 未入场
  assert.equal(groups[1]!.attrs.opacity, 0);
  assert.ok(groups[1]!.attrs.transform.includes("scale(1.4000)"));
});

test("边描画时窗：startT=max(两节点延迟)+enterMs=320，drawMs=400", () => {
  const at = (frame: number) =>
    flowDiagram.render(specWith(BASE) as never, makeCtx({ frame }));
  const offsets = [7.68, 12.48, 17.28].map((f) =>
    collect(at(f), "path")[0]!.attrs["stroke-dashoffset"],
  );
  // tMs=320 → p=0；520 → p=0.5；720 → p=1
  assert.deepEqual(offsets, [1, 0.5, 0]);
  const headOps = [17.28, 19.2, 21.12].map((f) =>
    collect(at(f), "polygon")[0]!.attrs.opacity,
  );
  // 三角窗口 (tMs−720)/160：720 → 0；800 → 0.5；880 → 1
  assert.deepEqual(headOps, [0, 0.5, 1]);
});

test("边标随描画完成淡入：位置在边中点上移 24，窗口 +160ms 起 240ms", () => {
  const params = { ...BASE, edges: [{ from: "甲", to: "乙", label: "是" }] };
  const node = flowDiagram.render(specWith(params) as never, makeCtx());
  const label = collect(node, "text").find((t) => t.text === "是");
  assert.ok(label, "边标缺失");
  // 边中点 = ((370.71..+629.29..)/2, 同) = (500,500) → y=476（浮点容忍 1e-9）
  assert.ok(Math.abs((label!.attrs.x as number) - 500) < 1e-9);
  assert.ok(Math.abs((label!.attrs.y as number) - 476) < 1e-9);
  assert.equal(label!.attrs["text-anchor"], "middle");
  const at = (frame: number) =>
    collect(
      flowDiagram.render(specWith(params) as never, makeCtx({ frame })),
      "text",
    ).find((t) => t.text === "是")!.attrs.opacity;
  // 窗口 (tMs−320−400−160)/240：880 → 0；1000 → 0.5；1120 → 1
  assert.deepEqual([at(21.12), at(24), at(26.88)], [0, 0.5, 1]);
});

test("纯函数：同 spec 同帧双调 deepEqual", () => {
  const s = specWith(BASE) as never;
  assert.deepEqual(
    flowDiagram.render(s, makeCtx({ frame: 13 })),
    flowDiagram.render(s, makeCtx({ frame: 13 })),
  );
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @acs/video-scene test`
Expected: FAIL——tsc 编译报 `Cannot find module './flow-diagram.js'`（组件尚不存在）。

- [ ] **Step 3: 写实现**

创建 `packages/video-scene/src/components/flow-diagram.ts`：

```ts
import { clamp01, easeOutCubic } from "../easing.js";
import type {
  FrameContext,
  SceneComponent,
  SceneSpecLike,
} from "../registry.js";
import type { SvgNode } from "../svg.js";
import { fitFontSize } from "../text-width.js";

// 节点连线示意图 v1：节点（盒子 180×72 / 菱形判定 110×64 半对角，显式
// x,y）按声明序 i×120ms 弹入（scale 1.4→1 + 淡入）；边按节点标签引用，
// 两端落定后在 drawMs 窗口线性描画（pathLength=1 + dashoffset，同
// line-drawing 口径）并带箭头三角；边标随描画完成淡入。边端点按中心
// 连线方向收缩固定余量 100（近圆近似——菱形角部略有出入，确定性优先，
// spec 裁定）；近距（len<220）改按 (len−20)/2 收缩钳 0，重合（len=0）
// 守卫为 len=1 输出退化线段，不产生 NaN。1000×1000 设计空间嵌套 svg
// viewBox；render 纯函数，禁墙钟/随机/网络。

type FlowNode = {
  label: string;
  x: number;
  y: number;
  kind: "box" | "diamond";
};
type FlowDiagramParams = {
  title: string;
  nodes: FlowNode[];
  edges: Array<{ from: string; to: string; label?: string }>;
  boxColor: string;
  arrowColor: string;
  textColor: string;
  enterMs: number; // 200..6000
  drawMs: number; // 200..6000
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DESIGN_SPACE = 1000;
const BOX_W = 180;
const BOX_H = 72;
const DIA_HW = 110;
const DIA_HH = 64;
const EDGE_TRIM = 100;
const NEAR_LEN = 220;
const STAGGER_MS = 120;
const ARROWHEAD_MS = 160;
const EDGE_LABEL_FADE_MS = 240;
const MAX_NODES = 12;
const MAX_EDGES = 16;
const COORD_MAX = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function validateParams(value: unknown): FlowDiagramParams {
  if (!isRecord(value)) throw new Error("flow-diagram params 必须是对象");
  if (typeof value.title !== "string" || value.title.length > 40) {
    throw new Error("flow-diagram params.title 必须是 ≤40 个字符");
  }
  if (
    !Array.isArray(value.nodes) ||
    value.nodes.length < 2 ||
    value.nodes.length > MAX_NODES
  ) {
    throw new Error(
      `flow-diagram params.nodes 必须是 2..${MAX_NODES} 个 {label, x, y, kind}`,
    );
  }
  const seen = new Set<string>();
  value.nodes.forEach((node, i) => {
    if (!isRecord(node)) {
      throw new Error(`flow-diagram params.nodes[${i}] 必须是对象`);
    }
    if (
      typeof node.label !== "string" ||
      node.label.length < 1 ||
      node.label.length > 6
    ) {
      throw new Error(
        `flow-diagram params.nodes[${i}].label 必须是 1..6 个字符`,
      );
    }
    if (seen.has(node.label)) {
      throw new Error(
        `flow-diagram params.nodes[${i}].label 与 nodes[${[...seen].indexOf(node.label)}] 重复`,
      );
    }
    seen.add(node.label);
    for (const key of ["x", "y"] as const) {
      const v = node[key];
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        v < 0 ||
        v > COORD_MAX
      ) {
        throw new Error(
          `flow-diagram params.nodes[${i}].x / y 必须是 0..1000 的数`,
        );
      }
    }
    if (node.kind !== "box" && node.kind !== "diamond") {
      throw new Error(
        `flow-diagram params.nodes[${i}].kind 必须是 box 或 diamond`,
      );
    }
  });
  if (
    !Array.isArray(value.edges) ||
    value.edges.length < 1 ||
    value.edges.length > MAX_EDGES
  ) {
    throw new Error(
      `flow-diagram params.edges 必须是 1..${MAX_EDGES} 条 {from, to, label?}`,
    );
  }
  value.edges.forEach((edge, i) => {
    if (!isRecord(edge)) {
      throw new Error(`flow-diagram params.edges[${i}] 必须是对象`);
    }
    for (const key of ["from", "to"] as const) {
      if (typeof edge[key] !== "string" || !seen.has(edge[key])) {
        throw new Error(
          `flow-diagram params.edges[${i}].from/to 必须引用已声明节点`,
        );
      }
    }
    if (
      edge.label !== undefined &&
      (typeof edge.label !== "string" ||
        edge.label.length < 1 ||
        edge.label.length > 6)
    ) {
      throw new Error(`flow-diagram params.edges[${i}].label 必须是 ≤6 个字符`);
    }
  });
  for (const key of ["boxColor", "arrowColor", "textColor"] as const) {
    if (!isHexColor(value[key])) {
      throw new Error(`flow-diagram params.${key} 必须是 #rrggbb`);
    }
  }
  for (const key of ["enterMs", "drawMs"] as const) {
    const v = value[key];
    if (!Number.isInteger(v) || (v as number) < 200 || (v as number) > 6000) {
      throw new Error(`flow-diagram params.${key} 必须是 200..6000 的整数`);
    }
  }
  return value as FlowDiagramParams;
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const params = spec.params as FlowDiagramParams;
  const tMs = (ctx.frame / ctx.fps) * 1000;
  const delays = new Map<string, number>(
    params.nodes.map((node, i) => [node.label, i * STAGGER_MS]),
  );
  const byLabel = new Map<string, FlowNode>(
    params.nodes.map((node) => [node.label, node]),
  );

  const nodeGroups: SvgNode[] = params.nodes.map((node, i) => {
    const appear = easeOutCubic(clamp01((tMs - i * STAGGER_MS) / params.enterMs));
    const fontSize = fitFontSize(
      22,
      node.label,
      node.kind === "diamond" ? 150 : BOX_W - 24,
    );
    const shape: SvgNode =
      node.kind === "box"
        ? {
            tag: "rect",
            attrs: {
              x: -BOX_W / 2,
              y: -BOX_H / 2,
              width: BOX_W,
              height: BOX_H,
              rx: 10,
              fill: params.boxColor,
            },
          }
        : {
            tag: "polygon",
            attrs: {
              points: `${-DIA_HW},0 0,${-DIA_HH} ${DIA_HW},0 0,${DIA_HH}`,
              fill: params.boxColor,
            },
          };
    return {
      tag: "g",
      attrs: {
        // 弹入：scale 1.4 → 1（绕节点中心）
        transform: `translate(${node.x} ${node.y}) scale(${(1.4 - 0.4 * appear).toFixed(4)})`,
        opacity: appear,
      },
      children: [
        shape,
        {
          tag: "text",
          attrs: {
            x: 0,
            y: fontSize * 0.36,
            "font-size": fontSize,
            fill: params.textColor,
            "text-anchor": "middle",
          },
          text: node.label,
        },
      ],
    };
  });

  const edgePaths: SvgNode[] = [];
  const edgeHeads: SvgNode[] = [];
  const edgeLabels: SvgNode[] = [];
  for (const edge of params.edges) {
    const a = byLabel.get(edge.from)!;
    const b = byLabel.get(edge.to)!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    // 重合守卫：len=0 → 1（退化线段，不除零）
    const len = Math.hypot(dx, dy) || 1;
    // 近圆近似收缩：常规 100；近距 (len−20)/2 钳 0（两端各让 10）
    const trim = len < NEAR_LEN ? Math.max((len - 20) / 2, 0) : EDGE_TRIM;
    const ux = dx / len;
    const uy = dy / len;
    const sx = a.x + ux * trim;
    const sy = a.y + uy * trim;
    const ex = b.x - ux * trim;
    const ey = b.y - uy * trim;
    // 两端节点都落定后开始描画
    const startT =
      Math.max(delays.get(edge.from)!, delays.get(edge.to)!) + params.enterMs;
    const p = clamp01((tMs - startT) / params.drawMs);
    edgePaths.push({
      tag: "path",
      attrs: {
        d: `M ${sx.toFixed(2)},${sy.toFixed(2)} L ${ex.toFixed(2)},${ey.toFixed(2)}`,
        fill: "none",
        stroke: params.arrowColor,
        "stroke-width": 8,
        "stroke-linecap": "round",
        pathLength: 1,
        "stroke-dasharray": 1,
        "stroke-dashoffset": Number((1 - p).toFixed(4)),
      },
    });
    // 箭头三角：tip=end，base=end−u×14，两侧 (−uy,ux)×7
    const bx = ex - ux * 14;
    const by = ey - uy * 14;
    const px = -uy * 7;
    const py = ux * 7;
    edgeHeads.push({
      tag: "polygon",
      attrs: {
        points: `${ex.toFixed(2)},${ey.toFixed(2)} ${(bx + px).toFixed(2)},${(by + py).toFixed(2)} ${(bx - px).toFixed(2)},${(by - py).toFixed(2)}`,
        fill: params.arrowColor,
        opacity: clamp01((tMs - startT - params.drawMs) / ARROWHEAD_MS),
      },
    });
    if (edge.label !== undefined) {
      edgeLabels.push({
        tag: "text",
        attrs: {
          x: (sx + ex) / 2,
          y: (sy + ey) / 2 - 24,
          "font-size": fitFontSize(20, edge.label, 200),
          fill: params.textColor,
          "text-anchor": "middle",
          opacity: clamp01(
            (tMs - startT - params.drawMs - ARROWHEAD_MS) / EDGE_LABEL_FADE_MS,
          ),
        },
        text: edge.label,
      });
    }
  }

  return {
    tag: "g",
    attrs: {},
    children: [
      {
        tag: "rect",
        attrs: {
          x: 0,
          y: 0,
          width: ctx.width,
          height: ctx.height,
          fill: spec.background,
        },
      },
      {
        tag: "svg",
        attrs: {
          x: 0,
          y: 0,
          width: ctx.width,
          height: ctx.height,
          viewBox: `0 0 ${DESIGN_SPACE} ${DESIGN_SPACE}`,
        },
        children: [
          {
            tag: "text",
            attrs: {
              x: 500,
              y: 100,
              "font-size": fitFontSize(48, params.title, 880),
              fill: params.textColor,
              "text-anchor": "middle",
              "dominant-baseline": "middle",
            },
            text: params.title,
          },
          ...nodeGroups,
          ...edgePaths,
          ...edgeHeads,
          ...edgeLabels,
        ],
      },
    ],
  };
}

export const flowDiagram: SceneComponent = {
  componentId: "flow-diagram",
  version: 1,
  validateParams,
  render,
};
```

修改 `packages/video-scene/src/default-registry.ts`——import 加：

```ts
import { flowDiagram } from "./components/flow-diagram.js";
```

数组 flowSteps 之后加 `flowDiagram,`（版本维持 4——v4 注释已覆盖两组件，同一刀原子落地）。

修改 `packages/video-scene/src/index.ts`——flowSteps 行之前插入：

```ts
export { flowDiagram } from "./components/flow-diagram.js";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @acs/video-scene test`
Expected: PASS——92 个测试全绿（Task 1 后 83 + 新 9）。

- [ ] **Step 5: 提交**

```bash
git add packages/video-scene/src/components/flow-diagram.ts packages/video-scene/src/components/flow-diagram.test.ts packages/video-scene/src/default-registry.ts packages/video-scene/src/index.ts
git commit -m "feat(video-studio): flow-diagram 节点连线组件（盒子/菱形 + 边裁剪描画）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```
### Task 3: flow-templates 起点模板与数据编辑纯逻辑

**Files:**
- Create: `apps/web/src/app/video-studio/flow-templates.ts`
- Create: `apps/web/src/app/video-studio/flow-templates.test.ts`

**Interfaces:**
- Consumes: `defaultRegistry` / `SceneSpec` / `validateSceneSpec`（`@acs/video-scene`，Task 1/2 后注册表含两组件）；沿 map-templates.ts 模式。
- Produces（Task 4 消费，签名与 applyMapTemplate 家族一致）：`FlowTemplate`、`FLOW_TEMPLATES`（5 枚：steps-4 / steps-v-5 / flow-decision / flow-cycle / flow-compare）、`isFlowComponentId(componentId: string): boolean`、`applyFlowTemplate(spec: SceneSpec, templateId: string): { spec: SceneSpec; error: null } | { spec: null; error: string }`、`FlowEditDraft = { title: string; data: string }`、`draftFlowFromSpec(spec: SceneSpec): FlowEditDraft`、`buildFlowRevisePatch(spec: SceneSpec, draft: FlowEditDraft): { spec: SceneSpec; error: null } | { spec: null; error: string }`。

**行格式与消歧规则（实现与测试共用）：**
- steps 组件：每行一个步骤标签（整行为标签，2..8 行；标签 1..10 字符）。
- diagram 组件：节点段每行 `标签,x,y[,菱形]`（从右取字段——末段恰为「菱形」且其前两段为坐标 → 菱形节点 [.. label, x, y, 菱形]；否则尾两段数值 → 盒节点；标签可含逗号。`菱形,200,520`（3 段）读盒节点标签「菱形」），`---` 单独一行分隔，边段每行 `标签->标签[,边标]`（首个 `->` 前为 from；右侧从右消歧——多段时末段为边标、其余 join 为 to；单段即 to。`甲->乙,丙` 读 to=乙、边标=丙，文档化取舍）。
- 行号 = 整段数据 1 基行号（含 `---` 行）；splitLines 容错 CRLF/首尾空白/空行。

- [ ] **Step 1: 写失败测试**

创建 `apps/web/src/app/video-studio/flow-templates.test.ts`（沿 map-templates.test.ts 惯例）：

```ts
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
    applied.spec!.params.steps.map((s: { label: string }) => s.label),
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
  const applied = applyFlowTemplate(SPEC, "steps-4")!;
  const draft = draftFlowFromSpec(applied.spec!);
  assert.equal(draft.title, "四步流程");
  assert.equal(draft.data, "需求\n设计\n开发\n交付");
  const revised = buildFlowRevisePatch(applied.spec!, {
    title: "上线流程",
    data: "调研\n方案\n开发\n上线",
  });
  assert.equal(revised.error, null);
  assert.deepEqual(
    revised.spec!.params.steps.map((s: { label: string }) => s.label),
    ["调研", "方案", "开发", "上线"],
  );
  assert.equal(revised.spec!.params.title, "上线流程");
  // 未触碰字段保留（direction/colors/enterMs）
  assert.equal(revised.spec!.params.direction, "horizontal");
  assert.equal(revised.spec!.params.enterMs, 1200);
  assert.equal(revised.spec!.params.boxColor, "#dcebe1");
});

test("diagram round-trip：菱形标记与边标原样展开", () => {
  const applied = applyFlowTemplate(SPEC, "flow-decision")!;
  const draft = draftFlowFromSpec(applied.spec!);
  assert.equal(
    draft.data,
    "开始,200,520\n检查,500,520,菱形\n通过,820,400\n退回,820,660\n---\n开始->检查\n检查->通过,是\n检查->退回,否",
  );
  const back = buildFlowRevisePatch(applied.spec!, draft);
  assert.equal(back.error, null);
  assert.deepEqual(back.spec!.params.nodes, applied.spec!.params.nodes);
  assert.deepEqual(back.spec!.params.edges, applied.spec!.params.edges);
});

test("diagram 数据修订：菱形标记 + 边标进 params", () => {
  const applied = applyFlowTemplate(SPEC, "flow-decision")!;
  const revised = buildFlowRevisePatch(applied.spec!, {
    title: "输入校验",
    data: "输入,240,520\n校验,520,520,菱形\n通过,840,400\n---\n输入->校验\n校验->通过,是",
  });
  assert.equal(revised.error, null);
  assert.deepEqual(revised.spec!.params.nodes[0], {
    label: "输入",
    x: 240,
    y: 520,
    kind: "box",
  });
  assert.equal(revised.spec!.params.nodes[1].kind, "diamond");
  assert.equal(revised.spec!.params.nodes[1].label, "校验");
  assert.deepEqual(revised.spec!.params.edges[1], {
    from: "校验",
    to: "通过",
    label: "是",
  });
  // 未触碰字段保留
  assert.equal(revised.spec!.params.enterMs, 1000);
  assert.equal(revised.spec!.params.drawMs, 800);
  assert.equal(revised.spec!.params.arrowColor, "#2f6f4f");
});

test("段与行数错误逐项拒绝", () => {
  const steps = applyFlowTemplate(SPEC, "steps-4")!.spec!;
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
  const diagram = applyFlowTemplate(SPEC, "flow-decision")!.spec!;
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
  const diagram = applyFlowTemplate(SPEC, "flow-decision")!.spec!;
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
  const steps = applyFlowTemplate(SPEC, "steps-4")!.spec!;
  const revised = buildFlowRevisePatch(steps, {
    title: "t",
    data: "调研\r\n\r\n方案\r\n开发\n\n上线\r\n",
  });
  assert.equal(revised.error, null);
  assert.deepEqual(
    revised.spec!.params.steps.map((s: { label: string }) => s.label),
    ["调研", "方案", "开发", "上线"],
  );
});

test("逗号与「菱形」标记消歧（文档化取舍）", () => {
  const diagram = applyFlowTemplate(SPEC, "flow-decision")!.spec!;
  const revised = buildFlowRevisePatch(diagram, {
    title: "t",
    data: "南,北,520,300\n菱形,200,520\n甲,200,520,菱形\n乙,丙,300,300\n---\n甲->乙,丙,丁",
  });
  assert.equal(revised.error, null);
  const nodes = revised.spec!.params.nodes as Array<{
    label: string;
    x: number;
    y: number;
    kind: string;
  }>;
  // 末段非「菱形」→ 标签含逗号读法
  assert.equal(nodes[0].label, "南,北");
  assert.equal(nodes[0].kind, "box");
  // 3 段无标记位 → 盒节点标签「菱形」
  assert.equal(nodes[1].label, "菱形");
  assert.equal(nodes[1].kind, "box");
  // 末段恰为「菱形」→ 菱形节点「甲」
  assert.equal(nodes[2].label, "甲");
  assert.equal(nodes[2].kind, "diamond");
  // 边从右消歧：甲->乙,丙,丁 → to=乙,丙、边标=丁
  assert.deepEqual(revised.spec!.params.edges[0], {
    from: "甲",
    to: "乙,丙",
    label: "丁",
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @acs/web test`
Expected: FAIL——`flow-templates.test.ts` 报 `Cannot find module './flow-templates'`，9 个新测试失败（基线 92 其余通过）。

- [ ] **Step 3: 写实现**

创建 `apps/web/src/app/video-studio/flow-templates.ts`：

```ts
// P2-③ 流程图/示意图：流程起点模板与数据编辑纯逻辑（沿 map-templates.ts 模式）。
// 模板参数过 validateSceneSpec 兜底；非法数据行内报错、不落 patch（C1 语义）。

import {
  defaultRegistry,
  type SceneSpec,
  validateSceneSpec,
} from "@acs/video-scene";

export type FlowTemplate = {
  templateId: string;
  componentId: "flow-steps" | "flow-diagram";
  label: string;
  params: Record<string, unknown>;
};

const FLOW_COLORS = {
  boxColor: "#dcebe1",
  arrowColor: "#2f6f4f",
  textColor: "#1b2c29",
};

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    templateId: "steps-4",
    componentId: "flow-steps",
    label: "横向四步流程",
    params: {
      title: "四步流程",
      steps: [
        { label: "需求" },
        { label: "设计" },
        { label: "开发" },
        { label: "交付" },
      ],
      direction: "horizontal",
      ...FLOW_COLORS,
      enterMs: 1200,
    },
  },
  {
    templateId: "steps-v-5",
    componentId: "flow-steps",
    label: "纵向五阶段",
    params: {
      title: "五阶段推进",
      steps: [
        { label: "立项" },
        { label: "调研" },
        { label: "方案" },
        { label: "实施" },
        { label: "复盘" },
      ],
      direction: "vertical",
      ...FLOW_COLORS,
      enterMs: 1200,
    },
  },
  {
    templateId: "flow-decision",
    componentId: "flow-diagram",
    label: "判定分支",
    params: {
      title: "判定分支",
      nodes: [
        { label: "开始", x: 200, y: 520, kind: "box" },
        { label: "检查", x: 500, y: 520, kind: "diamond" },
        { label: "通过", x: 820, y: 400, kind: "box" },
        { label: "退回", x: 820, y: 660, kind: "box" },
      ],
      edges: [
        { from: "开始", to: "检查" },
        { from: "检查", to: "通过", label: "是" },
        { from: "检查", to: "退回", label: "否" },
      ],
      ...FLOW_COLORS,
      enterMs: 1000,
      drawMs: 800,
    },
  },
  {
    templateId: "flow-cycle",
    componentId: "flow-diagram",
    label: "三节点循环",
    params: {
      title: "循环闭环",
      nodes: [
        { label: "谋划", x: 300, y: 350, kind: "box" },
        { label: "执行", x: 700, y: 350, kind: "box" },
        { label: "改进", x: 500, y: 720, kind: "box" },
      ],
      edges: [
        { from: "谋划", to: "执行" },
        { from: "执行", to: "改进" },
        { from: "改进", to: "谋划" },
      ],
      ...FLOW_COLORS,
      enterMs: 1000,
      drawMs: 800,
    },
  },
  {
    templateId: "flow-compare",
    componentId: "flow-diagram",
    label: "两源对比",
    params: {
      title: "两案对比",
      nodes: [
        { label: "方案甲", x: 280, y: 350, kind: "box" },
        { label: "方案乙", x: 280, y: 720, kind: "box" },
        { label: "评估", x: 730, y: 520, kind: "box" },
      ],
      edges: [
        { from: "方案甲", to: "评估" },
        { from: "方案乙", to: "评估" },
      ],
      ...FLOW_COLORS,
      enterMs: 1000,
      drawMs: 800,
    },
  },
];

export function isFlowComponentId(componentId: string): boolean {
  return componentId === "flow-steps" || componentId === "flow-diagram";
}

export function applyFlowTemplate(
  spec: SceneSpec,
  templateId: string,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  const template = FLOW_TEMPLATES.find((t) => t.templateId === templateId);
  if (!template) return { spec: null, error: `未知流程模板 ${templateId}` };
  const next: SceneSpec = {
    ...spec,
    componentId: template.componentId,
    componentVersion: 1,
    params: structuredClone(template.params),
  };
  try {
    validateSceneSpec(next, defaultRegistry);
  } catch (error) {
    return {
      spec: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return { spec: next, error: null };
}

export type FlowEditDraft = {
  title: string;
  // steps：每行一个步骤标签（2..8 行）；diagram：节点段每行
  // `标签,x,y[,菱形]`（缺省 box），`---` 单独一行分隔，边段每行
  // `标签->标签[,边标]`
  data: string;
};

export function draftFlowFromSpec(spec: SceneSpec): FlowEditDraft {
  const params = spec.params as {
    title?: string;
    steps?: Array<{ label: string }>;
    nodes?: Array<{
      label: string;
      x: number;
      y: number;
      kind: "box" | "diamond";
    }>;
    edges?: Array<{ from: string; to: string; label?: string }>;
  };
  if (spec.componentId === "flow-steps") {
    return {
      title: params.title ?? "",
      data: (params.steps ?? []).map((s) => s.label).join("\n"),
    };
  }
  const nodeLines = (params.nodes ?? []).map((n) =>
    n.kind === "diamond"
      ? `${n.label},${n.x},${n.y},菱形`
      : `${n.label},${n.x},${n.y}`,
  );
  const edgeLines = (params.edges ?? []).map((e) =>
    e.label === undefined ? `${e.from}->${e.to}` : `${e.from}->${e.to},${e.label}`,
  );
  return {
    title: params.title ?? "",
    data: [...nodeLines, "---", ...edgeLines].join("\n"),
  };
}

// 节点行从右取字段（标签可含逗号——同 map-templates 消歧先例）：
// 末段恰为「菱形」且倒数第二/三段为坐标 → 菱形节点 [.. label, x, y, 菱形]；
// 否则尾两段数值 → 盒节点 [.. label, x, y]。`菱形,200,520`（3 段）读作
// 盒节点标签「菱形」——文档化取舍。
function parseNodeLine(
  line: string,
): { label: string; x: number; y: number; kind: "box" | "diamond" } | null {
  const parts = line.split(",").map((p) => p.trim());
  const coord = (raw: string): number | null => {
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 && v <= 1000 ? v : null;
  };
  if (parts.length >= 4 && parts[parts.length - 1] === "菱形") {
    const y = coord(parts[parts.length - 2]!);
    const x = coord(parts[parts.length - 3]!);
    const label = parts.slice(0, -3).join(",").trim();
    if (x === null || y === null) return null;
    if (label.length < 1 || label.length > 6) return null;
    return { label, x, y, kind: "diamond" };
  }
  if (parts.length >= 3) {
    const y = coord(parts[parts.length - 1]!);
    const x = coord(parts[parts.length - 2]!);
    const label = parts.slice(0, -2).join(",").trim();
    if (x === null || y === null) return null;
    if (label.length < 1 || label.length > 6) return null;
    return { label, x, y, kind: "box" };
  }
  return null;
}

// 边行：首个 `->` 前为 from；右侧从右消歧——多段时末段为边标、其余 join
// 为 to；单段即 to（无边标）。`甲->乙,丙` 读 to=乙、边标=丙（文档化取舍，
// 同 map 尾段消歧先例）。
function parseEdgeLine(
  line: string,
): { from: string; to: string; label?: string } | null {
  const arrow = line.indexOf("->");
  if (arrow < 1) return null;
  const from = line.slice(0, arrow).trim();
  const tailParts = line
    .slice(arrow + 2)
    .split(",")
    .map((p) => p.trim());
  let to: string;
  let label: string | undefined;
  if (tailParts.length === 1) {
    to = tailParts[0]!;
  } else {
    to = tailParts.slice(0, -1).join(",").trim();
    label = tailParts[tailParts.length - 1]!;
  }
  if (from.length < 1 || from.length > 6) return null;
  if (to.length < 1 || to.length > 6) return null;
  if (label !== undefined && (label.length < 1 || label.length > 6)) return null;
  return label === undefined ? { from, to } : { from, to, label };
}

function splitLines(data: string): string[] {
  return data
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function buildFlowRevisePatch(
  spec: SceneSpec,
  draft: FlowEditDraft,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  if (!isFlowComponentId(spec.componentId)) {
    return { spec: null, error: "当前镜头组件不是流程组件" };
  }
  const lines = splitLines(draft.data);
  let params: Record<string, unknown>;
  if (spec.componentId === "flow-steps") {
    if (lines.length < 2) {
      return { spec: null, error: "流程步骤至少需要两行" };
    }
    if (lines.length > 8) {
      return { spec: null, error: "流程步骤最多 8 行（步数上限）" };
    }
    const steps: Array<{ label: string }> = [];
    for (let i = 0; i < lines.length; i += 1) {
      const label = lines[i]!;
      if (label.length < 1 || label.length > 10) {
        return {
          spec: null,
          error: `第 ${i + 1} 行：步骤标签必须是 1..10 个字符`,
        };
      }
      steps.push({ label });
    }
    params = {
      ...(spec.params as Record<string, unknown>),
      title: draft.title,
      steps,
    };
  } else {
    const sep = lines.indexOf("---");
    if (sep < 0) {
      return { spec: null, error: "数据需用一行「---」分隔节点段与边段" };
    }
    const nodeLines = lines.slice(0, sep);
    const edgeLines = lines.slice(sep + 1);
    if (nodeLines.length < 2) {
      return { spec: null, error: "节点段至少需要两行" };
    }
    if (nodeLines.length > 12) {
      return { spec: null, error: "节点段最多 12 行（节点上限）" };
    }
    if (edgeLines.length < 1) {
      return { spec: null, error: "边段至少需要一行" };
    }
    if (edgeLines.length > 16) {
      return { spec: null, error: "边段最多 16 行（连线上限）" };
    }
    const nodes: Array<{
      label: string;
      x: number;
      y: number;
      kind: "box" | "diamond";
    }> = [];
    const seen = new Set<string>();
    for (let i = 0; i < nodeLines.length; i += 1) {
      const parsed = parseNodeLine(nodeLines[i]!);
      if (!parsed) {
        return {
          spec: null,
          error: `第 ${i + 1} 行：标签,x,y[,菱形] 格式不符（标签 1..6 字符，坐标 0..1000）`,
        };
      }
      if (seen.has(parsed.label)) {
        return {
          spec: null,
          error: `第 ${i + 1} 行：节点标签「${parsed.label}」重复`,
        };
      }
      seen.add(parsed.label);
      nodes.push(parsed);
    }
    const edges: Array<{ from: string; to: string; label?: string }> = [];
    for (let i = 0; i < edgeLines.length; i += 1) {
      // 行号按整段数据计（含 --- 行）
      const lineNo = sep + 2 + i;
      const parsed = parseEdgeLine(edgeLines[i]!);
      if (!parsed) {
        return {
          spec: null,
          error: `第 ${lineNo} 行：标签->标签[,边标] 格式不符（标签 1..6 字符，边标 1..6 字符）`,
        };
      }
      if (!seen.has(parsed.from)) {
        return {
          spec: null,
          error: `第 ${lineNo} 行：节点「${parsed.from}」未声明`,
        };
      }
      if (!seen.has(parsed.to)) {
        return { spec: null, error: `第 ${lineNo} 行：节点「${parsed.to}」未声明` };
      }
      edges.push(parsed);
    }
    params = {
      ...(spec.params as Record<string, unknown>),
      title: draft.title,
      nodes,
      edges,
    };
  }
  const next: SceneSpec = { ...spec, params };
  try {
    validateSceneSpec(next, defaultRegistry);
  } catch (error) {
    return {
      spec: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return { spec: next, error: null };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @acs/web test`
Expected: PASS——101 个测试全绿（基线 92 + 新 9）。
Run: `pnpm --filter @acs/web typecheck`
Expected: 0 错误。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/app/video-studio/flow-templates.ts apps/web/src/app/video-studio/flow-templates.test.ts
git commit -m "feat(video-studio): flow-templates 5 枚起点模板与数据编辑纯逻辑

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```
### Task 4: 镜头编辑卡接入流程模板（下拉第三族 optgroup + 数据编辑）

**Files:**
- Modify: `apps/web/src/app/video-studio/shot-editor-card.tsx`（注释 2 处、import 1 处、EMPTY 常量、resolveAnyTemplate、state/effect、下拉 label+optgroup+onChange、流程字段块、应用链）
- Modify: `apps/web/src/app/video-studio/video-studio.css`（`.map-edit-error` 块后追加 `.flow-*` 三条）

**Interfaces:**
- Consumes（Task 3 Produces，签名一致）：`applyFlowTemplate(spec, templateId) → { spec; error } | { spec: null; error }`、`buildFlowRevisePatch(spec, draft) → { spec; error } | { spec: null; error }`、`draftFlowFromSpec(spec) → FlowEditDraft`、`isFlowComponentId(componentId) → boolean`、`FLOW_TEMPLATES`、`type FlowEditDraft = { title: string; data: string }`。
- 既有消费不变：chart/map 两族的 state、字段与应用链原样保留；本刀只在 map 链后追加 flow 链。

**说明：** 编辑卡是客户端组件接线（沿 P2-② 地图接线先例），无新增单元测试——行为由 Task 3 纯逻辑测试 + Task 5 e2e 钉住；本刀的验证 = typecheck + web 套件（101 基线不回退）+ biome。

- [ ] **Step 1: 接线编辑卡**

对 `apps/web/src/app/video-studio/shot-editor-card.tsx` 做以下编辑（每处均为唯一匹配的精确替换）：

**1a.** 文件头注释第 33 行 `校验全走 shot-edit.ts / chart-templates.ts / map-templates.ts 纯逻辑，` 改为：

```ts
// 校验全走 shot-edit.ts / chart-templates.ts / map-templates.ts /
// flow-templates.ts 纯逻辑，
```

**1b.** 在 `} from "./chart-templates";`（第 13 行）之后、`import {`（map-templates）之前插入：

```ts
import {
  applyFlowTemplate,
  buildFlowRevisePatch,
  draftFlowFromSpec,
  FLOW_TEMPLATES,
  type FlowEditDraft,
  isFlowComponentId,
} from "./flow-templates";
```

（import 按 biome 自然序：`./chart-templates` < `./flow-templates` < `./map-templates`。）

**1c.** `const EMPTY_MAP_DRAFT: MapEditDraft = { title: "", data: "" };`（第 44 行）之后插入：

```ts
const EMPTY_FLOW_DRAFT: FlowEditDraft = { title: "", data: "" };
```

**1d.** resolveAnyTemplate 整体替换（注释 `两族` → `三族`，链上插入 flow）：

```ts
// 模板下拉跨图表/地图/流程三族解析：先按图表找，找不到再按流程、地图找。
function resolveAnyTemplate(
  spec: SceneSpec,
  templateId: string,
): { spec: SceneSpec | null; error: string | null } {
  const chart = applyChartTemplate(spec, templateId);
  if (chart.spec) return { spec: chart.spec, error: null };
  const flow = applyFlowTemplate(spec, templateId);
  if (flow.spec) return { spec: flow.spec, error: null };
  const map = applyMapTemplate(spec, templateId);
  if (map.spec) return { spec: map.spec, error: null };
  return { spec: null, error: flow.error ?? map.error ?? chart.error };
}
```

**1e.** state 块：`const [mapError, setMapError] = useState<string | null>(null);`（第 122 行）之后插入：

```ts
const [flowDraft, setFlowDraft] = useState<FlowEditDraft>(() =>
  spec && isFlowComponentId(spec.componentId)
    ? draftFlowFromSpec(spec)
    : EMPTY_FLOW_DRAFT,
);
const [flowError, setFlowError] = useState<string | null>(null);
```

**1f.** effect 重置块：`setMapDraft(...EMPTY_MAP_DRAFT)` 调用（第 153-157 行）之后、`// eslint-disable-next-line` 之前插入：

```ts
setFlowError(null);
setFlowDraft(
  nextSpec && isFlowComponentId(nextSpec.componentId)
    ? draftFlowFromSpec(nextSpec)
    : EMPTY_FLOW_DRAFT,
);
```

**1g.** 下拉 label `组件模板（图表 / 地图）` 改为 `组件模板（图表 / 地图 / 流程）`。

**1h.** 下拉 onChange：`setMapError(null);` 之后补一行 `setFlowError(null);`；预填分支链尾追加：

```ts
} else if (isFlowComponentId(applied.spec.componentId)) {
  setFlowDraft(draftFlowFromSpec(applied.spec));
}
```

**1i.** `</optgroup>`（地图组收尾）之后、`</select>` 之前插入：

```tsx
<optgroup label="流程">
  {FLOW_TEMPLATES.map((template) => (
    <option key={template.templateId} value={template.templateId}>
      {template.label}
    </option>
  ))}
</optgroup>
```

**1j.** 地图字段块 `) : null}`（第 456 行，`.map-edit-error` 段落所在块的收尾）之后插入流程字段块：

```tsx
{isFlowComponentId(spec.componentId) ? (
  <>
    <label className="shot-edit-field">
      流程标题
      <input
        className="flow-title-input"
        maxLength={40}
        value={flowDraft.title}
        onChange={(event) =>
          setFlowDraft({ ...flowDraft, title: event.target.value })
        }
      />
    </label>
    <label className="shot-edit-field">
      数据（
      {spec.componentId === "flow-steps"
        ? "每行一个步骤标签，2..8 行、1..10 字符"
        : "节点段每行 标签,x,y[,菱形]；单独一行 --- 分隔；边段每行 标签->标签[,边标]"}
      ）
      <textarea
        className="flow-data-input"
        rows={8}
        value={flowDraft.data}
        onChange={(event) =>
          setFlowDraft({ ...flowDraft, data: event.target.value })
        }
      />
    </label>
    {flowError ? <p className="flow-edit-error">{flowError}</p> : null}
  </>
) : null}
```

**1k.** 应用链：注释 `// 时长 + 图表/地图数据——选中模板时已预填该模板默认值）一次` 改为 `// 时长 + 图表/地图/流程数据——选中模板时已预填该模板默认值）一次`；`mapResult` 判错块之后、`const { patch, error } = buildRevisePatch(` 之前插入：

```ts
const flowResult = isFlowComponentId(
  (mapResult?.spec ?? chartResult?.spec ?? baseSpec).componentId,
)
  ? buildFlowRevisePatch(
      mapResult?.spec ?? chartResult?.spec ?? baseSpec,
      flowDraft,
    )
  : null;
if (flowResult && (flowResult.error || !flowResult.spec)) {
  setFlowError(flowResult.error ?? "流程数据无效");
  return;
}
```

并把

```ts
const { patch, error } = buildRevisePatch(
  draft,
  mapResult?.spec ?? chartResult?.spec ?? baseSpec,
);
```

改为

```ts
const { patch, error } = buildRevisePatch(
  draft,
  flowResult?.spec ?? mapResult?.spec ?? chartResult?.spec ?? baseSpec,
);
```

成功清理处 `setMapError(null);` 之后补 `setFlowError(null);`。

- [ ] **Step 2: 追加 CSS**

`video-studio.css` 的 `.map-edit-error { ... }` 块（第 713-717 行）之后插入：

```css
/* P2-③ 流程编辑字段（沿图表/地图控件同款外观） */
.flow-title-input {
  font-size: 13px;
  padding: 4px 8px;
  border: 1px solid #bfd6c8;
  border-radius: 6px;
  font-family: inherit;
}

.flow-data-input {
  font-size: 13px;
  padding: 6px 8px;
  border: 1px solid #bfd6c8;
  border-radius: 6px;
  min-height: 120px;
  resize: vertical;
  font-family: inherit;
}

.flow-edit-error {
  margin: 0;
  font-size: 12px;
  color: #a3230f;
}
```

- [ ] **Step 3: 类型与套件验证**

Run: `pnpm --filter @acs/web typecheck`
Expected: 0 错误。

Run: `pnpm --filter @acs/web test`
Expected: PASS——101 个测试全绿（Task 3 基线不回退；本刀无新增测试）。

Run: `pnpm exec biome check apps/web/src/app/video-studio packages/video-scene/src`
Expected: 无错误（import 顺序/格式全过；若 named-import 顺序被 biome 重排，按其提示顺序修正后再跑）。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/app/video-studio/shot-editor-card.tsx apps/web/src/app/video-studio/video-studio.css
git commit -m "feat(video-studio): 镜头编辑卡接入流程模板下拉（第三族 optgroup）与数据编辑

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```
### Task 5: e2e 闭环（VID-019）+ A1 金标准复跑 + 证据与登记收口

**Files:**
- Create: `scripts/video/e2e-flow.mjs`
- Modify: `qa/registry.json`（automated 数组尾追加 VID-019）
- Create: `artifacts/video-studio-flow/E2E_FLOW.md`（gitignored 目录，不入库——本地证据）
- Modify: `AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md`（顶部新增一条）

**Interfaces:**
- Consumes（Task 1/2/3/4 已落地）：注册表 v4 两组件、FLOW_TEMPLATES 5 枚、编辑卡第三族 optgroup + `.flow-title-input`/`.flow-data-input`/`.flow-edit-error`、应用链 I1 合并。
- 环境：`@acs/web` dev server 在 :3210、`scripts/dev/proxy-3211.mjs` 在 :3211、`packages/{video-document,video-scene}` 已 build、ffmpeg 在 PATH、Playwright chromium。

- [ ] **Step 1: 写 e2e 脚本**

创建 `scripts/video/e2e-flow.mjs`（沿 e2e-map.mjs 骨架，改流程题材断言）：

```js
#!/usr/bin/env node
// P2-③ 流程图/示意图端到端闭环验收（VID-019，零 TTS 计费）：
//   浏览器新建→STEM 分镜（4 镜头 218 帧，水循环）→保存
//   →镜头 2 换 steps-4（旁白并发编辑单次应用一并落库）→改步骤数据→应用→保存
//   →镜头 3 换 flow-decision→改节点/边数据（菱形标记 + 边标）→应用→保存
//   →导出 JSON（结构断言：steps/direction/nodes/edges/旁白合并/时长保留）
//   →CLI render-scene 双画幅出片→双跑逐字节 SHA-256 一致
//   →流程帧 YAVG ≥100（帧 80 四盒到位 / 帧 140 判定节点入场中段，双画幅）
//   →计费台账行数不变 + 浏览器控制台零 error。
// 前置: @acs/web dev server 已在 BASE_URL（:3210，建议经 scripts/dev/proxy-3211.mjs）；
//       packages/{video-document,video-scene} 已 build；ffmpeg 在 PATH。
// exit 0 = 闭环成立；任何一步失败 exit 1 并打印步骤名。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3211";
const OUT_DIR = path.join(ROOT, "artifacts/video-studio-flow");
const EXPORTED = path.join(OUT_DIR, "e2e.video-project.json");
const SENTENCE = "做一个8秒的STEM解说视频，主题是水循环，分4个镜头";
const USAGE_LEDGER = path.join(ROOT, "artifacts/tts-usage.jsonl");

function fail(step, detail) {
  console.error(`[e2e-flow] FAIL at ${step}: ${detail ?? ""}`);
  process.exit(1);
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function usageLines() {
  try {
    return readFileSync(USAGE_LEDGER, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0).length;
  } catch {
    return 0;
  }
}

// 逐帧亮度（有限范围黑 ≈ 16）：signalstats YAVG，零新依赖的数值断言口径（沿 VID-016..018）。
function frameYavg(videoPath, frameNumber) {
  const out = spawnSync(
    "ffmpeg",
    [
      "-v",
      "info",
      "-i",
      videoPath,
      "-vf",
      `select='eq(n,${frameNumber})',signalstats,metadata=print:key=lavfi.signalstats.YAVG`,
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", timeout: 60_000 },
  );
  const match = `${out.stderr}`.match(/YAVG=([0-9.]+)/);
  if (!match)
    fail("YAVG 提取", `${videoPath} 第 ${frameNumber} 帧无 YAVG 输出`);
  return Number(match[1]);
}

function renderProject(projectPath, outDir, step) {
  mkdirSync(outDir, { recursive: true });
  const render = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "scripts/video/render-scene.mjs"),
      "--project",
      projectPath,
      "--out",
      outDir,
    ],
    { cwd: ROOT, encoding: "utf8", timeout: 600_000 },
  );
  if (render.status !== 0)
    fail(step, `${render.stdout ?? ""}\n${render.stderr ?? ""}`);
}

async function waitForMessage(page, text, step) {
  await page
    .locator(".editor-message", { hasText: text })
    .waitFor({ timeout: 10_000 })
    .catch(() => fail(step, `未出现提示: ${text}`));
}

mkdirSync(OUT_DIR, { recursive: true });
rmSync(EXPORTED, { force: true });
const usageBefore = usageLines();

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "zh-CN",
});
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200));
});

// —— 去程：新建 → 分镜规划 → 确认应用 → 保存 ——
await page.goto(`${BASE_URL}/video-studio`, {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
await page
  .waitForSelector("html[data-studio-ready]", { timeout: 20_000 })
  .catch(() => fail("打开工作台", "客户端未就绪（data-studio-ready 未出现）"));
await page
  .locator(".project-create")
  .first()
  .waitFor({ state: "visible", timeout: 20_000 })
  .catch(() => fail("打开工作台", "selector 不可见: .project-create"));
await page.click(".project-create");
await page.fill("#planner-sentence", SENTENCE);
await page.click(".planner-run");
await page
  .locator(".storyboard-card")
  .waitFor({ timeout: 20_000 })
  .catch(() => fail("分镜确认卡", "未出现"));
await page.click(".plan-apply");
await waitForMessage(page, "首个 4 个镜头", "追加应用");
await page
  .locator(".editor-shots")
  .waitFor({ timeout: 20_000 })
  .catch(() => fail("镜头时间线", "未出现"));
await page.click(".editor-save");
await waitForMessage(page, "已保存", "保存基线");

// —— 1. 镜头 2 换 steps-4：旁白与换模板同草稿并发，单次应用一并落库
//        （P2-① 终评 I1 合并语义不回退）→ 二次应用改步骤数据 ——
const card2 = page.locator(".shot-list > li").nth(1);
await card2.locator(".shot-edit-toggle").click();
await card2.locator(".shot-narration-input").fill("流程先横向走一遍。");
await card2.locator(".chart-template-select").selectOption("steps-4");
await card2.locator(".shot-apply").click();
await card2
  .locator(".flow-data-input")
  .waitFor({ state: "visible", timeout: 10_000 })
  .catch(() => fail("流程编辑字段", "换模板后 .flow-data-input 未出现"));
await page
  .waitForFunction(
    (index) => {
      const el = document
        .querySelectorAll(".shot-list > li")
        [index]?.querySelector(".flow-data-input");
      return Boolean(el && el.value.includes("需求"));
    },
    1,
    { timeout: 10_000, polling: 100 },
  )
  .catch(() => fail("模板预填", "flow-data-input 未回填模板默认数据"));
await card2.locator(".flow-data-input").fill("调研\n方案\n开发\n上线");
await card2.locator(".shot-apply").click();
await page.click(".editor-save");
await waitForMessage(page, "已保存", "保存线性流程镜头");

// —— 2. 镜头 3 换 flow-decision + 节点/边数据编辑（菱形标记 + 边标）——
const card3 = page.locator(".shot-list > li").nth(2);
await card3.locator(".shot-edit-toggle").click();
await card3.locator(".chart-template-select").selectOption("flow-decision");
await card3.locator(".shot-apply").click();
await card3
  .locator(".flow-data-input")
  .waitFor({ state: "visible", timeout: 10_000 })
  .catch(() => fail("示意图编辑字段", "换模板后 .flow-data-input 未出现"));
await page
  .waitForFunction(
    (index) => {
      const el = document
        .querySelectorAll(".shot-list > li")
        [index]?.querySelector(".flow-data-input");
      return Boolean(el && el.value.includes("开始,200,520"));
    },
    2,
    { timeout: 10_000, polling: 100 },
  )
  .catch(() => fail("示意图预填", "flow-data-input 未回填模板默认数据"));
await card3
  .locator(".flow-data-input")
  .fill(
    "输入,240,520\n校验,520,520,菱形\n通过,840,400\n---\n输入->校验\n校验->通过,是",
  );
await card3.locator(".shot-apply").click();
await page.click(".editor-save");
await waitForMessage(page, "已保存", "保存判定分支镜头");

// —— 3. 导出 + 结构断言 ——
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 15_000 }),
  page.click(".editor-export"),
]);
await download.saveAs(EXPORTED);
if (!existsSync(EXPORTED)) fail("导出", "下载文件未落盘");
const exported = JSON.parse(readFileSync(EXPORTED, "utf8"));
const specOf = (shot) =>
  shot.contentVersions.find((v) => v.versionId === shot.workingVersionId)
    .sceneSource.spec;
const s2 = specOf(exported.shots[1]);
if (s2.componentId !== "flow-steps") fail("镜头 2 组件", s2.componentId);
const steps = s2.params.steps.map((s) => s.label).join("|");
if (steps !== "调研|方案|开发|上线") fail("镜头 2 数据", steps);
if (s2.params.direction !== "horizontal")
  fail("镜头 2 方向", s2.params.direction);
// 字段保留断言：时长不被模板换掉
if (s2.durationMs !== 3100)
  fail("时长保留", `镜头 2 durationMs=${s2.durationMs}`);
// 并发合并断言（P2-① 终评 I1 语义）：换模板时同草稿的旁白编辑不被丢弃
const working2 = exported.shots[1].contentVersions.find(
  (v) => v.versionId === exported.shots[1].workingVersionId,
);
if (working2?.narrationText !== "流程先横向走一遍。")
  fail("旁白并发合并", `narrationText=${working2?.narrationText ?? "(空)"}`);
const s3 = specOf(exported.shots[2]);
if (s3.componentId !== "flow-diagram") fail("镜头 3 组件", s3.componentId);
const nodes = s3.params.nodes;
if (
  nodes[0].label !== "输入" ||
  nodes[0].x !== 240 ||
  nodes[0].y !== 520 ||
  nodes[0].kind !== "box"
)
  fail("镜头 3 盒节点", JSON.stringify(nodes[0]));
if (
  nodes[1].label !== "校验" ||
  nodes[1].kind !== "diamond" ||
  nodes[1].x !== 520 ||
  nodes[1].y !== 520
)
  fail("镜头 3 菱形节点", JSON.stringify(nodes[1]));
if (nodes.length !== 3) fail("镜头 3 节点数", String(nodes.length));
const edges = s3.params.edges;
if (JSON.stringify(edges[0]) !== '{"from":"输入","to":"校验"}')
  fail("镜头 3 边 0", JSON.stringify(edges[0]));
if (JSON.stringify(edges[1]) !== '{"from":"校验","to":"通过","label":"是"}')
  fail("镜头 3 边标", JSON.stringify(edges[1]));
await page.screenshot({
  path: path.join(OUT_DIR, "flow-editor.png"),
  fullPage: true,
});
console.log(
  `[e2e-flow] 编辑落库: 项目 ${exported.id} v${exported.savedVersion}，镜头2=${s2.componentId}(${steps})，镜头3=${s3.componentId}(校验菱形+边标「是」)，旁白合并=${working2?.narrationText}`,
);

// —— 4. CLI 双画幅出片 + 双跑一致 + 流程帧 YAVG ——
// spans [2000,3100,2000,2000]ms @24fps → 总 218 帧：镜头 2 帧域 48..121，
// 镜头 3 帧域 122..169。帧 80（镜头 2 内 1333ms）：steps-4 enterMs 1200 +
// 梯次 3×120 → 首两盒成形、末盒 appear≈0.81；帧 140（镜头 3 内 750ms）：
// flow-decision enterMs 1000 → 首节点 appear 0.75（边未动笔），白底深字。
// 两帧均断言 YAVG ≥100（非全黑）。
const RENDER_DIR = path.join(OUT_DIR, "render");
renderProject(EXPORTED, RENDER_DIR, "CLI 出片");
const RERUN_DIR = path.join(OUT_DIR, "rerun");
const RERUN_PROJECT = path.join(OUT_DIR, "rerun.video-project.json");
copyFileSync(EXPORTED, RERUN_PROJECT);
renderProject(RERUN_PROJECT, RERUN_DIR, "CLI 复跑");
for (const aspect of ["landscape", "portrait"]) {
  const a = sha256(path.join(RENDER_DIR, `${aspect}.mp4`));
  const b = sha256(path.join(RERUN_DIR, `${aspect}.mp4`));
  if (a !== b) fail("双跑一致", `${aspect}: ${a} ≠ ${b}`);
  console.log(`[e2e-flow] 双跑一致: ${aspect} ${a}`);
  for (const frame of [80, 140]) {
    const yavg = frameYavg(path.join(RENDER_DIR, `${aspect}.mp4`), frame);
    if (yavg < 100)
      fail("流程帧亮度", `${aspect} 帧 ${frame} YAVG=${yavg} < 100`);
    console.log(`[e2e-flow] ${aspect}: 帧 ${frame} YAVG=${yavg}（≥100）`);
  }
}

// —— 5. 控制台零 error + 计费不变 ——
if (consoleErrors.length > 0) fail("浏览器控制台", consoleErrors.join(" | "));
const usageAfter = usageLines();
if (usageAfter !== usageBefore)
  fail("计费", `tts-usage.jsonl 行数变化 ${usageBefore} → ${usageAfter}`);

await browser.close();
console.log(
  `[e2e-flow] OK: 模板换装→数据编辑→出片→双跑一致→流程帧非空，计费零新增（台账 ${usageAfter} 行不变）`,
);
console.log("[e2e-flow] SHA-256:");
for (const name of [
  "e2e.video-project.json",
  "render/landscape.mp4",
  "render/portrait.mp4",
  "flow-editor.png",
]) {
  console.log(`  ${name}: ${sha256(path.join(OUT_DIR, name))}`);
}
```

- [ ] **Step 2: 首跑 e2e（RED→GREEN 口径：新脚本本身即验收对象）**

前置：:3210 dev 与 :3211 代理在跑（复用 P2-② 的 `pnpm --filter @acs/web dev` + `node scripts/dev/proxy-3211.mjs`，已跑则跳过）。

Run: `node scripts/video/e2e-flow.mjs`（BASE_URL 默认 :3211）
Expected: exit 0——全链路提示 OK，双跑一致两组 SHA 相等，帧 80/140 双画幅 YAVG ≥100，台账行数不变。任何一步 FAIL → 按 systematic-debugging 修（修组件/模板/接线，不放宽断言）。

- [ ] **Step 3: 跨轮复跑 + A1 金标准（注册表追加无害）**

Run: `node scripts/video/e2e-flow.mjs`（第二次整轮）
Expected: exit 0，且本次打印的 `render/landscape.mp4`/`render/portrait.mp4` SHA-256 与首跑一致（跨进程帧确定性）。

Run: `node scripts/video/e2e-map.mjs`
Expected: exit 0，且 landscape/portrait SHA-256 = P2-② 已档金标准
`64eb4480cc7a987b1addec3b58987257534cf68ec99363d6de8072662e56a825` /
`7aeff69d9c08307e1a972a5f7364af290692a171647e25788e8218f2f11916ff`
（两组件追加零改旧渲染路径——A1 不变式）。

- [ ] **Step 4: 登记 VID-019**

`qa/registry.json` automated 数组末（VID-018 对象之后）追加：

```json
{
  "id": "VID-019",
  "tier": "integration",
  "title": "Video Studio flow templates and edit loop (steps/diagram)",
  "cwd": ".",
  "argv": ["node", "scripts/video/e2e-flow.mjs"],
  "requiresPorts": [3211],
  "checks": [
    "Workbench flow template selector (third optgroup) swaps shot 2 to flow-steps and shot 3 to flow-diagram through the real editor card, edited step labels and diamond-marked node/edge data land in the saved and exported project JSON while narration text and duration survive the swap",
    "Exported working specs assert componentId plus params shape: steps join to the edited label list with direction horizontal and durationMs 3100 kept, and diagram nodes/edges round-trip including a diamond kind and a labeled edge",
    "CLI render-scene outputs both aspects and flow frames stay non-empty: ffmpeg signalstats YAVG >= 100 at frame 80 (four boxes entering late stage) and frame 140 (decision nodes mid entrance) on landscape and portrait",
    "Double run of the exported project is byte-identical on both aspects via SHA-256 and the whole e2e re-run reproduces the same MP4 hashes (cross-process frame determinism)",
    "Billing ledger line count is unchanged and the browser console logs zero errors (zero TTS synthesis in this cut)"
  ]
}
```

Run: `pnpm qa:validate`
Expected: PASS——79 automated + 51 manual（VID-019 计数 +1）。

- [ ] **Step 5: 证据文档与状态登记**

创建 `artifacts/video-studio-flow/E2E_FLOW.md`（沿 E2E_MAP.md 结构：日期/执行人/脚本/环境、链路小节、结果（退出码 0）小节——YAVG 实测值、双跑/跨轮 SHA-256、A1 map 金标准复跑哈希、计费零新增；产物与可复核性小节——媒体不入库声明 + 本地文件 SHA-256 表 + 复跑命令 `BASE_URL=http://localhost:3211 node scripts/video/e2e-flow.mjs`）。全部数值取自 Step 2/3 实测输出，不预填。

`AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md` 顶部（`# Current State v2` 之后、P2-② 条目之前）插入一条，格式沿 P2-② 条目：日期 + `Video Studio 流程图/示意图（P2 题材 ③，线性流程 + 节点连线）` + 计划五任务完成（分支/ spec/ 提交哈希取自实际 git log）+ 两组件 v1 几何/时序要点 + 注册表 v4 一次覆盖 + flow-templates 5 枚模板与行格式消歧（标签含逗号从右取、「菱形」标记、边从右消歧）+ 编辑卡第三族 optgroup + I1 合并链 + e2e VID-019 要点（YAVG/双跑/跨轮/A1 map 哈希保持）+ 回归计数 + 媒体不入库。数值取实测。

- [ ] **Step 6: 全栈回归**

Run（五条）:
- `pnpm --filter @acs/video-scene test` → 92 全绿（74+9 flow-steps+9 flow-diagram）
- `pnpm --filter @acs/video-document test` → 71 全绿
- `pnpm --filter @acs/web test` → 101 全绿
- `pnpm --filter scripts test` → 57 全绿
- `pnpm --filter @acs/web typecheck` + `pnpm exec biome check apps/web/src/app/video-studio packages/video-scene/src scripts/video/e2e-flow.mjs` → 0 错误

- [ ] **Step 7: 提交**

```bash
git add scripts/video/e2e-flow.mjs qa/registry.json AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md
git commit -m "feat(video-studio): P2-③ 流程图/示意图收口——e2e VID-019、证据与登记

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

（`artifacts/video-studio-flow/` 媒体与项目 JSON 按约定不入库；E2E_FLOW.md 随 gitignore 留本地。）
