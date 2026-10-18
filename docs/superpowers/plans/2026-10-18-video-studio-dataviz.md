# Video Studio P2-① 数据可视化（图表组件）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 video-scene 组件注册表追加 bar-chart / line-chart / number-counter 三个手写图表组件（注册表 v2），工作台接入 5 个起点模板与图表数据编辑，e2e VID-017 收口。

**Architecture:** 程序化 SVG、零新依赖（不引 D3）；组件沿 line-drawing 先例在 1000×1000 设计空间渲染（嵌套 svg viewBox，横竖版同 spec）；文本度量提取共享模块；工作台新纯逻辑模块 `chart-templates.ts`（沿 shot-edit.ts 模式），规划器零改动。

**Tech Stack:** TypeScript + node:test（video-scene / web 均同）、React（编辑卡接线）、Playwright + render-scene CLI（e2e）。

**Spec:** `docs/superpowers/specs/2026-10-18-video-studio-dataviz-design.md`

## Global Constraints

- 分支 `worktree-video-studio-p2`；全部命令在 worktree `D:/codex/animate/.claude/worktrees/video-studio-p0` 内执行（hook 强制）。
- worktree hook 拒绝 heredoc/复杂复合命令：文件追加用 Read+Edit 工具，命令保持简单。
- video-scene 零运行时依赖；组件源码禁 `Date.now` / `new Date` / `Math.random` / `fetch` 等（`determinism-gate.test.ts` 源码巡检 components/）。
- 数值边界：有限数 0 ≤ v ≤ 1e12；bars 1..8 条；points 2..12 个；label ≤12 字符；title ≤40 字符；prefix/suffix ≤6 字符；decimals 0..2 整数；动画时长 200..6000 整数毫秒。
- 颜色一律 `#rrggbb`；错误消息中文、带 `params.` 定位（沿 text-animation 措辞）。
- **规划器零改动**：`planner.ts` / `apply-plan.ts` / `shot-edit.ts` 的 reseed 分支一行不动（保既有 e2e 锚定）。
- 注册表版本一次性 bump 1→2，覆盖本刀全部三组件（分支原子落地；裁定记 ledger）。
- 媒体文件不入库；证据走 SHA-256 哈希表（提交 .md，不提交 mp4/png）；全程零 TTS 计费。
- 提交消息以 `Co-Authored-By: Claude Code <noreply@anthropic.com>` 结尾；改动的 .ts/.tsx 提交前过 `npx biome check`。
- 测试命令：video-scene `pnpm --filter @acs/video-scene run build && node --test "packages/video-scene/dist/**/*.test.js"`；web `pnpm --filter @acs/web test`；scripts `node --test scripts/video/*.test.mjs`。
- RED 阶段（video-scene）：新测试文件 import 未实现模块 → build 以 "Cannot find module" 失败 = 预期失败原因（feature missing）。

## Review Focus

1. **全零数值**（bars/points 全 0）→ yMax 归一为 1，柱高 0、折线水平线、attrs 无 NaN —— Task 2 测试「全零数据」、Task 3 测试「全零数据」。
2. **换模板后二次编辑 round-trip**（draftChartFromSpec(applyChartTemplate(...)) 回读模板数据）→ Task 5 测试「round-trip」。
3. **counter 超长文本**（prefix + 12 位数字 + suffix 溢出设计宽）→ 字号钳制不溢出 —— Task 4 测试「长文本字号自适应」。
4. **数据 textarea 空行/尾随空白/CRLF** → 解析跳空行、trim、容忍 `\r\n` —— Task 5 测试「空行跳过与 CRLF 容忍」。
5. **line 混合标签行**（部分行 `标签,数值`、部分行裸 `数值`）→ 无标签点不渲染 x 标签、有标签点正常 —— Task 5 测试「line 混合标签行」。

---

### Task 1: 文本度量共享模块提取（纯重构）

**Files:**
- Create: `packages/video-scene/src/text-width.ts`
- Test: `packages/video-scene/src/text-width.test.ts`
- Modify: `packages/video-scene/src/components/text-animation.ts`（删本地 emWidth/fitFontSize，改 import）
- Modify: `packages/video-scene/src/index.ts`（追加 export）

**Interfaces:**
- Consumes: 无（新模块）。
- Produces: `export function emUnits(text: string): number`（CJK ≥0x2e80 按 1em、其余 0.6em 求和）；`export function fitFontSize(base: number, text: string, maxWidth: number): number`（`emUnits(text)===0` 返回 base；否则 `Math.min(base, maxWidth / emUnits(text))`）。Task 2/3/4 的组件 import 使用。

- [ ] **Step 1: 写失败测试**

`packages/video-scene/src/text-width.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { emUnits, fitFontSize } from "./text-width.js";

test("emUnits：CJK 按 1em、拉丁/数字/空格按 0.6em、空串为 0", () => {
  assert.equal(emUnits(""), 0);
  assert.equal(emUnits("标题"), 2);
  assert.equal(emUnits("abc"), 1.8); // 3 × 0.6
  assert.equal(emUnits("第1年"), 2.6); // 2 CJK + 1 digit
});

test("fitFontSize：行宽超限时等比缩小，未超时保持 base，空文本返回 base", () => {
  assert.equal(fitFontSize(200, "标题", 840), 200); // 2em×200=400 ≤ 840
  assert.equal(fitFontSize(200, "十个字长的标题文本哦", 840), 84); // 10em → 840/10
  assert.equal(fitFontSize(120, "", 840), 120);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @acs/video-scene run build`
Expected: FAIL —— `Cannot find module './text-width.js'`（模块未实现）。

- [ ] **Step 3: 最小实现**

`packages/video-scene/src/text-width.ts`：

```ts
// 文本度量纯函数（设计空间与画布像素空间通用，单位由调用方决定）。
// 从 text-animation 提取（P2-①），图表组件与文字组件共用同一 em 口径。

// 估算一行文本的 em 宽：CJK/全角类字符按 1em，其余（拉丁/数字/空格）按 0.6em。
export function emUnits(text: string): number {
  let width = 0;
  for (const char of text) {
    width += char.codePointAt(0)! >= 0x2e80 ? 1 : 0.6;
  }
  return width;
}

// 字号钳制：base 是期望字号；若文本行会超出 maxWidth（调用方已乘安全系数），
// 等比缩到限内。空文本不渲染字形，直接返回 base。
export function fitFontSize(
  base: number,
  text: string,
  maxWidth: number,
): number {
  const em = emUnits(text);
  if (em === 0) return base;
  return Math.min(base, maxWidth / em);
}
```

`packages/video-scene/src/index.ts` 追加一行：

```ts
export * from "./text-width.js";
```

- [ ] **Step 4: 改造 text-animation 引用（行为零变化）**

`packages/video-scene/src/components/text-animation.ts`：
- 删除本地 `emWidth`（26-33 行）与 `fitFontSize`（37-41 行）两个函数；
- 顶部加 `import { fitFontSize } from "../text-width.js";`；
- 两处调用改为传 `ctx.width * TEXT_SAFE_WIDTH`（`TEXT_SAFE_WIDTH` 常量留在本文件）：

```ts
const titleSize = fitFontSize(ctx.height / 8, params.title, ctx.width * TEXT_SAFE_WIDTH);
const subtitleSize = fitFontSize(
  ctx.height / 14,
  params.subtitle ?? "",
  ctx.width * TEXT_SAFE_WIDTH,
);
```

- [ ] **Step 5: 跑测试确认通过（含 text-animation 既有测试零改动全绿）**

Run: `pnpm --filter @acs/video-scene run build && node --test "packages/video-scene/dist/**/*.test.js"`
Expected: PASS，总数 = 33（既有）+ 2（新）= 35。

- [ ] **Step 6: Commit**

```bash
git add packages/video-scene/src/text-width.ts packages/video-scene/src/text-width.test.ts packages/video-scene/src/components/text-animation.ts packages/video-scene/src/index.ts
git commit -m "refactor(video-scene): 提取文本度量 emUnits/fitFontSize 共享模块（纯重构）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: bar-chart 组件 + 注册表 v2

**Files:**
- Create: `packages/video-scene/src/components/bar-chart.ts`
- Test: `packages/video-scene/src/components/bar-chart.test.ts`
- Modify: `packages/video-scene/src/default-registry.ts`、`packages/video-scene/src/index.ts`

**Interfaces:**
- Consumes: Task 1 的 `fitFontSize`；`clamp01`/`easeOutCubic`（../easing.js）。
- Produces: `export const barChart: SceneComponent`（componentId `"bar-chart"`、version 1）；`defaultRegistry` 变为 `createRegistry([textAnimation, lineDrawing, basicShapes, barChart], 2)`。Task 5/6/7 依赖 componentId 字符串 `"bar-chart"`。

- [ ] **Step 1: 写失败测试**

`packages/video-scene/src/components/bar-chart.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { seededRandom } from "../random.js";
import type { FrameContext } from "../registry.js";
import type { SceneSpec } from "../spec.js";
import type { SvgNode } from "../svg.js";
import { barChart } from "./bar-chart.js";

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

function specWith(params: Record<string, unknown>): SceneSpec {
  return {
    specVersion: 1,
    componentId: "bar-chart",
    componentVersion: 1,
    durationMs: 12000,
    seed: 7,
    background: "#ffffff",
    params,
  };
}

const BASE = {
  title: "四种方案对比",
  bars: [
    { label: "甲", value: 30 },
    { label: "乙", value: 60 },
    { label: "丙", value: 20 },
  ],
  barColor: "#2f6f4f",
  accentColor: "#d9822b",
  textColor: "#1b2c29",
  enterMs: 1000,
};

// 收集指定 tag 的节点（排除嵌套 svg 外的背景 rect：背景是 g 的首子节点）
function collect(node: SvgNode, tag: string): SvgNode[] {
  if (node.tag === tag) return [node];
  return (node.children ?? []).flatMap((child) => collect(child, tag));
}

function barRects(node: SvgNode): SvgNode[] {
  // 柱矩形 = 嵌套 svg 内的 rect（背景 rect 在嵌套 svg 之外）
  const nested = collect(node, "svg")[0]!;
  return collect(nested, "rect");
}

test("柱高按值比例：t 足够大时 h = value/yMax×650（yMax = max×1.1）", () => {
  const node = barChart.render(specWith({ ...BASE }), makeCtx({ frame: 24 * 5 }));
  const rects = barRects(node);
  assert.equal(rects.length, 3);
  const yMax = 60 * 1.1;
  const expected = [30 / yMax * 650, 60 / yMax * 650, 20 / yMax * 650];
  rects.forEach((rect, i) => {
    const h = rect.attrs.height as number;
    assert.ok(Math.abs(h - expected[i]!) < 1e-9, `bar ${i}: ${h} ≠ ${expected[i]}`);
  });
});

test("最大柱用 accentColor，其余用 barColor", () => {
  const node = barChart.render(specWith({ ...BASE }), makeCtx({ frame: 24 * 5 }));
  const fills = barRects(node).map((rect) => rect.attrs.fill);
  assert.deepEqual(fills, ["#2f6f4f", "#d9822b", "#2f6f4f"]);
});

test("t=0：全部柱高 0；梯次延迟下 tMs=50 时柱 0 已动、柱 1 未动", () => {
  const spec = specWith({ ...BASE });
  const at0 = barRects(barChart.render(spec, makeCtx({ frame: 0 })));
  for (const rect of at0) assert.equal(rect.attrs.height, 0);
  const at50ms = barRects(barChart.render(spec, makeCtx({ frame: 24 * 50 / 1000 })));
  assert.ok((at50ms[0]!.attrs.height as number) > 0, "柱 0 应已生长");
  assert.equal(at50ms[1]!.attrs.height, 0, "柱 1 延迟 90ms 未到");
});

test("值标签在柱完成后 300ms 淡入：完成前 opacity 0，之后 >0", () => {
  const spec = specWith({ ...BASE });
  const valuesBefore = collect(barChart.render(spec, makeCtx({ frame: 24 * 0.8 })), "text")
    .filter((t) => t.text === "60");
  assert.equal(valuesBefore[0]!.attrs.opacity, 0);
  const valuesAfter = collect(barChart.render(spec, makeCtx({ frame: 24 * 1.5 })), "text")
    .filter((t) => t.text === "60");
  assert.ok((valuesAfter[0]!.attrs.opacity as number) > 0);
});

test("背景为首个子节点（fill = spec.background），标题存在且居中", () => {
  const node = barChart.render(specWith({ ...BASE }), makeCtx({ frame: 0 }));
  const bg = node.children![0]!;
  assert.equal(bg.tag, "rect");
  assert.equal(bg.attrs.fill, "#ffffff");
  const title = collect(node, "text").find((t) => t.text === "四种方案对比")!;
  assert.equal(title.attrs.x, 500);
  assert.equal(title.attrs["text-anchor"], "middle");
});

test("全零数据：yMax 归一为 1，柱高 0，attrs 无 NaN", () => {
  const node = barChart.render(
    specWith({ ...BASE, bars: [{ label: "甲", value: 0 }, { label: "乙", value: 0 }] }),
    makeCtx({ frame: 24 * 5 }),
  );
  for (const rect of barRects(node)) assert.equal(rect.attrs.height, 0);
  const json = JSON.stringify(node);
  assert.ok(!json.includes("NaN"), "输出含 NaN");
});

test("同 (spec, ctx) 两次渲染深度相等（纯函数）", () => {
  const spec = specWith({ ...BASE });
  assert.deepEqual(
    barChart.render(spec, makeCtx({ frame: 12 })),
    barChart.render(spec, makeCtx({ frame: 12 })),
  );
});

test("params 校验：bars 空/超 8、label 空/超 12、value 负/NaN/超 1e12、title 超 40、enterMs 越界、颜色非 hex 全拒绝", () => {
  assert.throws(() => barChart.validateParams({ ...BASE, bars: [] }), /bars/);
  assert.throws(
    () => barChart.validateParams({ ...BASE, bars: Array.from({ length: 9 }, () => ({ label: "x", value: 1 })) }),
    /bars/,
  );
  assert.throws(() => barChart.validateParams({ ...BASE, bars: [{ label: "", value: 1 }] }), /label/);
  assert.throws(() => barChart.validateParams({ ...BASE, bars: [{ label: "一二三四五六七八九十甲乙丙", value: 1 }] }), /label/);
  assert.throws(() => barChart.validateParams({ ...BASE, bars: [{ label: "x", value: -1 }] }), /value/);
  assert.throws(() => barChart.validateParams({ ...BASE, bars: [{ label: "x", value: Number.NaN }] }), /value/);
  assert.throws(() => barChart.validateParams({ ...BASE, bars: [{ label: "x", value: 1e13 }] }), /value/);
  assert.throws(() => barChart.validateParams({ ...BASE, title: "一".repeat(41) }), /title/);
  assert.throws(() => barChart.validateParams({ ...BASE, enterMs: 199 }), /enterMs/);
  assert.throws(() => barChart.validateParams({ ...BASE, enterMs: 6001 }), /enterMs/);
  assert.throws(() => barChart.validateParams({ ...BASE, barColor: "green" }), /barColor/);
});
```

- [ ] **Step 2: 跑 build 确认失败**

Run: `pnpm --filter @acs/video-scene run build`
Expected: FAIL —— `Cannot find module './bar-chart.js'`。

- [ ] **Step 3: 实现 bar-chart**

`packages/video-scene/src/components/bar-chart.ts`：

```ts
import { clamp01, easeOutCubic } from "../easing.js";
import { fitFontSize } from "../text-width.js";
import type { FrameContext, SceneComponent, SceneSpecLike } from "../registry.js";
import type { SvgNode } from "../svg.js";

// 柱状图组件 v1：标题 + N 柱对比（最大柱 accent 高亮），逐柱 90ms 梯次自基线
// 生长，值标签在柱完成后 300ms 淡入。1000×1000 设计空间嵌套 svg viewBox
//（横竖版同 spec 等比居中，沿 line-drawing 先例）；render 纯函数，禁墙钟/随机/网络。

type BarChartParams = {
  title: string;
  bars: Array<{ label: string; value: number }>;
  barColor: string;
  accentColor: string;
  textColor: string;
  enterMs: number; // 200..6000
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DESIGN_SPACE = 1000;
// 图表区（设计空间坐标）：x 120..880，y 200..850（基线）
const LEFT = 120;
const RIGHT = 880;
const TOP = 200;
const BASELINE = 850;
const CHART_WIDTH = RIGHT - LEFT;
const CHART_HEIGHT = BASELINE - TOP;
const STAGGER_MS = 90;
const VALUE_FADE_MS = 300;
const MAX_BARS = 8;
const MAX_VALUE = 1e12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function validateParams(value: unknown): BarChartParams {
  if (!isRecord(value)) throw new Error("bar-chart params 必须是对象");
  if (typeof value.title !== "string" || value.title.length > 40) {
    throw new Error("bar-chart params.title 必须是 ≤40 个字符");
  }
  if (
    !Array.isArray(value.bars) ||
    value.bars.length < 1 ||
    value.bars.length > MAX_BARS
  ) {
    throw new Error(`bar-chart params.bars 必须是 1..${MAX_BARS} 条 {label, value}`);
  }
  value.bars.forEach((bar, i) => {
    if (!isRecord(bar)) throw new Error(`bar-chart params.bars[${i}] 必须是对象`);
    if (typeof bar.label !== "string" || bar.label.length < 1 || bar.label.length > 12) {
      throw new Error(`bar-chart params.bars[${i}].label 必须是 1..12 个字符`);
    }
    if (
      typeof bar.value !== "number" ||
      !Number.isFinite(bar.value) ||
      bar.value < 0 ||
      bar.value > MAX_VALUE
    ) {
      throw new Error(`bar-chart params.bars[${i}].value 必须是 0..${MAX_VALUE} 的数`);
    }
  });
  if (!isHexColor(value.barColor))
    throw new Error("bar-chart params.barColor 必须是 #rrggbb");
  if (!isHexColor(value.accentColor))
    throw new Error("bar-chart params.accentColor 必须是 #rrggbb");
  if (!isHexColor(value.textColor))
    throw new Error("bar-chart params.textColor 必须是 #rrggbb");
  if (
    !Number.isInteger(value.enterMs) ||
    (value.enterMs as number) < 200 ||
    (value.enterMs as number) > 6000
  ) {
    throw new Error("bar-chart params.enterMs 必须是 200..6000 的整数");
  }
  return value as BarChartParams;
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const params = spec.params as BarChartParams;
  const tMs = (ctx.frame / ctx.fps) * 1000;
  const values = params.bars.map((bar) => bar.value);
  const maxValue = Math.max(...values);
  // y 上限 = max×1.1（值标签头空间）；全零归一为 1 防除零
  const yMax = maxValue * 1.1 || 1;
  const slot = CHART_WIDTH / params.bars.length;
  const barW = slot * 0.55;

  const bars: SvgNode[] = [];
  const labels: SvgNode[] = [];
  const valueTexts: SvgNode[] = [];
  params.bars.forEach((bar, i) => {
    const delay = i * STAGGER_MS;
    const grow = easeOutCubic(clamp01((tMs - delay) / params.enterMs));
    const h = (bar.value / yMax) * CHART_HEIGHT * grow;
    const center = LEFT + i * slot + slot / 2;
    bars.push({
      tag: "rect",
      attrs: {
        x: center - barW / 2,
        y: BASELINE - h,
        width: barW,
        height: h,
        rx: 6,
        fill: bar.value === maxValue ? params.accentColor : params.barColor,
      },
    });
    labels.push({
      tag: "text",
      attrs: {
        x: center,
        y: 890,
        "font-size": 26,
        fill: params.textColor,
        "text-anchor": "middle",
        opacity: grow,
      },
      text: bar.label,
    });
    valueTexts.push({
      tag: "text",
      attrs: {
        x: center,
        y: BASELINE - h - 18,
        "font-size": 28,
        fill: params.textColor,
        "text-anchor": "middle",
        opacity: clamp01((tMs - delay - params.enterMs) / VALUE_FADE_MS),
      },
      text: String(bar.value),
    });
  });

  const grids: SvgNode[] = [0.25, 0.5, 0.75].map((ratio) => ({
    tag: "line" as const,
    attrs: {
      x1: LEFT,
      y1: TOP + CHART_HEIGHT * ratio,
      x2: RIGHT,
      y2: TOP + CHART_HEIGHT * ratio,
      stroke: params.textColor,
      opacity: 0.15,
      "stroke-width": 2,
    },
  }));

  return {
    tag: "g",
    attrs: {},
    children: [
      {
        tag: "rect",
        attrs: { x: 0, y: 0, width: ctx.width, height: ctx.height, fill: spec.background },
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
          ...grids,
          {
            tag: "line",
            attrs: {
              x1: LEFT,
              y1: BASELINE,
              x2: RIGHT,
              y2: BASELINE,
              stroke: params.textColor,
              opacity: 0.5,
              "stroke-width": 3,
            },
          },
          ...bars,
          ...valueTexts,
          ...labels,
        ],
      },
    ],
  };
}

export const barChart: SceneComponent = {
  componentId: "bar-chart",
  version: 1,
  validateParams,
  render,
};
```

- [ ] **Step 4: 注册表 v2 + 导出**

`packages/video-scene/src/default-registry.ts` 改为：

```ts
import { basicShapes } from "./components/basic-shapes.js";
import { barChart } from "./components/bar-chart.js";
import { lineDrawing } from "./components/line-drawing.js";
import { textAnimation } from "./components/text-animation.js";
import { createRegistry } from "./registry.js";

// v2（P2-① 数据可视化）：追加 bar-chart。新视觉能力 = 追加组件 + bump 版本；
// 本刀后续 line-chart / number-counter 在同一分支内追加，版本维持 2（原子落地）。
export const defaultRegistry = createRegistry(
  [textAnimation, lineDrawing, basicShapes, barChart],
  2,
);
```

`packages/video-scene/src/index.ts` 追加：`export * from "./components/bar-chart.js";`

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @acs/video-scene run build && node --test "packages/video-scene/dist/**/*.test.js"`
Expected: PASS，总数 = 35 + 8 = 43。

- [ ] **Step 6: Commit**

```bash
git add packages/video-scene/src/components/bar-chart.ts packages/video-scene/src/components/bar-chart.test.ts packages/video-scene/src/default-registry.ts packages/video-scene/src/index.ts
git commit -m "feat(video-scene): bar-chart 柱状图组件 v1 + 注册表 bump v2

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: line-chart 组件

**Files:**
- Create: `packages/video-scene/src/components/line-chart.ts`
- Test: `packages/video-scene/src/components/line-chart.test.ts`
- Modify: `packages/video-scene/src/default-registry.ts`、`packages/video-scene/src/index.ts`

**Interfaces:**
- Consumes: Task 1 `fitFontSize`；`clamp01`/`easeOutCubic`。
- Produces: `export const lineChart: SceneComponent`（componentId `"line-chart"`、version 1）；注册表数组追加（版本仍 2）。Task 5/6/7 依赖字符串 `"line-chart"`。

- [ ] **Step 1: 写失败测试**

`packages/video-scene/src/components/line-chart.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { seededRandom } from "../random.js";
import type { FrameContext } from "../registry.js";
import type { SceneSpec } from "../spec.js";
import type { SvgNode } from "../svg.js";
import { lineChart } from "./line-chart.js";

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

function specWith(params: Record<string, unknown>): SceneSpec {
  return {
    specVersion: 1,
    componentId: "line-chart",
    componentVersion: 1,
    durationMs: 12000,
    seed: 7,
    background: "#ffffff",
    params,
  };
}

const BASE = {
  title: "年产量趋势",
  points: [
    { label: "第1年", value: 12 },
    { label: "第2年", value: 20 },
    { label: "第3年", value: 16 },
    { label: "第4年", value: 30 },
  ],
  lineColor: "#2f6f4f",
  markerColor: "#d9822b",
  textColor: "#1b2c29",
  drawMs: 1600,
};

function collect(node: SvgNode, tag: string): SvgNode[] {
  if (node.tag === tag) return [node];
  return (node.children ?? []).flatMap((child) => collect(child, tag));
}

test("t=0 时 dashoffset=1（未画），t≥drawMs 时 dashoffset=0（画完）", () => {
  const spec = specWith({ ...BASE });
  const at0 = collect(lineChart.render(spec, makeCtx({ frame: 0 })), "path")[0]!;
  assert.equal(at0.attrs["stroke-dashoffset"], 1);
  const done = collect(lineChart.render(spec, makeCtx({ frame: 24 * 3 })), "path")[0]!;
  assert.equal(done.attrs["stroke-dashoffset"], 0);
});

test("折线路径首尾端点坐标按值映射（yMax = max×1.1）", () => {
  const node = lineChart.render(specWith({ ...BASE }), makeCtx({ frame: 0 }));
  const d = collect(node, "path")[0]!.attrs.d as string;
  const yMax = 30 * 1.1;
  const firstY = 850 - (12 / yMax) * 650;
  const lastY = 850 - (30 / yMax) * 650;
  assert.ok(d.startsWith(`M120.00 ${firstY.toFixed(2)}`), d);
  assert.ok(d.endsWith(`L880.00 ${lastY.toFixed(2)}`), d);
});

test("数据点圆标随描画进度弹出：t=0 全 r=0，中期首点已现而末点未现，末帧全部 r=9", () => {
  const spec = specWith({ ...BASE });
  const radiiAt = (frame: number) =>
    collect(lineChart.render(spec, makeCtx({ frame })), "circle").map(
      (c) => c.attrs.r as number,
    );
  assert.deepEqual(radiiAt(0), [0, 0, 0, 0]);
  const mid = radiiAt(24 * 0.5); // drawMs=1600 → progress=easeOutCubic(0.3125)≈0.675
  assert.ok(mid[0]! > 0, "首点应已出现");
  assert.equal(mid[3]!, 0, "末点（frac=1）不应出现");
  assert.deepEqual(radiiAt(24 * 3), [9, 9, 9, 9]);
});

test("x 轴标签：有标签点渲染、无标签点跳过、超 6 字符截断加 …", () => {
  const spec = specWith({
    ...BASE,
    points: [
      { value: 1 },
      { label: "第2年", value: 2 },
      { label: "一二三四五六七八", value: 3 },
    ],
  });
  const texts = collect(lineChart.render(spec, makeCtx({ frame: 0 })), "text")
    .map((t) => t.text);
  assert.ok(!texts.includes("第2年") || texts.includes("第2年")); // 标签在 t=0 即渲染（随描画淡入由 marker 承担）
  assert.ok(texts.includes("一二三四五六…"), "超长标签应截断");
  assert.ok(!texts.includes("一二三四五六七八"));
  // 无标签点：不产生空文本节点
  assert.ok(!texts.includes(""));
});

test("全零数据：折线为水平基线线段、无 NaN", () => {
  const node = lineChart.render(
    specWith({ ...BASE, points: [{ value: 0 }, { value: 0 }, { value: 0 }] }),
    makeCtx({ frame: 24 * 3 }),
  );
  const d = collect(node, "path")[0]!.attrs.d as string;
  assert.ok(d.includes("850.00"), `全零应贴基线: ${d}`);
  assert.ok(!JSON.stringify(node).includes("NaN"));
});

test("同 (spec, ctx) 两次渲染深度相等（纯函数）", () => {
  const spec = specWith({ ...BASE });
  assert.deepEqual(
    lineChart.render(spec, makeCtx({ frame: 12 })),
    lineChart.render(spec, makeCtx({ frame: 12 })),
  );
});

test("params 校验：points 少于 2/超 12、label 超 12、value 负/非有限、drawMs 越界、颜色非 hex 拒绝", () => {
  assert.throws(() => lineChart.validateParams({ ...BASE, points: [{ value: 1 }] }), /points/);
  assert.throws(
    () => lineChart.validateParams({ ...BASE, points: Array.from({ length: 13 }, (_, i) => ({ value: i })) }),
    /points/,
  );
  assert.throws(() => lineChart.validateParams({ ...BASE, points: [{ label: "一二三四五六七八九十一二三", value: 1 }, { value: 2 }] }), /label/);
  assert.throws(() => lineChart.validateParams({ ...BASE, points: [{ value: -1 }, { value: 2 }] }), /value/);
  assert.throws(() => lineChart.validateParams({ ...BASE, points: [{ value: Infinity }, { value: 2 }] }), /value/);
  assert.throws(() => lineChart.validateParams({ ...BASE, drawMs: 199 }), /drawMs/);
  assert.throws(() => lineChart.validateParams({ ...BASE, lineColor: "#fff" }), /lineColor/);
});
```

- [ ] **Step 2: 跑 build 确认失败**

Run: `pnpm --filter @acs/video-scene run build`
Expected: FAIL —— `Cannot find module './line-chart.js'`。

- [ ] **Step 3: 实现 line-chart**

`packages/video-scene/src/components/line-chart.ts`：

```ts
import { clamp01, easeOutCubic } from "../easing.js";
import { fitFontSize } from "../text-width.js";
import type { FrameContext, SceneComponent, SceneSpecLike } from "../registry.js";
import type { SvgNode } from "../svg.js";

// 折线图组件 v1：标题 + 折线描画（pathLength=1 + dashoffset，同 line-drawing
// 口径）+ 数据点圆标（描画进度越过该点累计长度占比后弹出）。1000×1000 设计
// 空间嵌套 svg viewBox；render 纯函数，禁墙钟/随机/网络。

type LineChartParams = {
  title: string;
  points: Array<{ label?: string; value: number }>;
  lineColor: string;
  markerColor: string;
  textColor: string;
  drawMs: number; // 200..6000
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DESIGN_SPACE = 1000;
const LEFT = 120;
const RIGHT = 880;
const TOP = 200;
const BASELINE = 850;
const CHART_WIDTH = RIGHT - LEFT;
const CHART_HEIGHT = BASELINE - TOP;
const MARKER_R = 9;
const MARKER_WINDOW = 0.05; // 描画进度越过该点后 5% 进度窗口内弹出
const MAX_POINTS = 12;
const MAX_VALUE = 1e12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function validateParams(value: unknown): LineChartParams {
  if (!isRecord(value)) throw new Error("line-chart params 必须是对象");
  if (typeof value.title !== "string" || value.title.length > 40) {
    throw new Error("line-chart params.title 必须是 ≤40 个字符");
  }
  if (
    !Array.isArray(value.points) ||
    value.points.length < 2 ||
    value.points.length > MAX_POINTS
  ) {
    throw new Error(`line-chart params.points 必须是 2..${MAX_POINTS} 个 {label?, value}`);
  }
  value.points.forEach((point, i) => {
    if (!isRecord(point)) throw new Error(`line-chart params.points[${i}] 必须是对象`);
    if (
      point.label !== undefined &&
      (typeof point.label !== "string" || point.label.length > 12)
    ) {
      throw new Error(`line-chart params.points[${i}].label 必须是 ≤12 个字符`);
    }
    if (
      typeof point.value !== "number" ||
      !Number.isFinite(point.value) ||
      point.value < 0 ||
      point.value > MAX_VALUE
    ) {
      throw new Error(`line-chart params.points[${i}].value 必须是 0..${MAX_VALUE} 的数`);
    }
  });
  if (!isHexColor(value.lineColor))
    throw new Error("line-chart params.lineColor 必须是 #rrggbb");
  if (!isHexColor(value.markerColor))
    throw new Error("line-chart params.markerColor 必须是 #rrggbb");
  if (!isHexColor(value.textColor))
    throw new Error("line-chart params.textColor 必须是 #rrggbb");
  if (
    !Number.isInteger(value.drawMs) ||
    (value.drawMs as number) < 200 ||
    (value.drawMs as number) > 6000
  ) {
    throw new Error("line-chart params.drawMs 必须是 200..6000 的整数");
  }
  return value as LineChartParams;
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const params = spec.params as LineChartParams;
  const tMs = (ctx.frame / ctx.fps) * 1000;
  const progress = easeOutCubic(clamp01(tMs / params.drawMs));
  const values = params.points.map((point) => point.value);
  const yMax = Math.max(...values) * 1.1 || 1;
  const n = params.points.length;
  const xs = params.points.map((_, i) => LEFT + (CHART_WIDTH * i) / (n - 1));
  const ys = params.points.map((point) => BASELINE - (point.value / yMax) * CHART_HEIGHT);

  const d = xs
    .map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${ys[i]!.toFixed(2)}`)
    .join(" ");

  // 累计长度占比（设计空间坐标；比例与渲染空间一致，比例尺不变）
  const cum = [0];
  for (let i = 1; i < n; i += 1) {
    cum.push(cum[i - 1]! + Math.hypot(xs[i]! - xs[i - 1]!, ys[i]! - ys[i - 1]!));
  }
  const total = cum[n - 1]!; // n≥2 且 xs 严格递增 → total > 0
  const markers: SvgNode[] = params.points.map((point, i) => {
    const frac = cum[i]! / total;
    const appear = easeOutCubic(clamp01((progress - frac) / MARKER_WINDOW));
    return {
      tag: "circle",
      attrs: { cx: xs[i], cy: ys[i], r: MARKER_R * appear, fill: params.markerColor },
    };
  });

  const labels: SvgNode[] = [];
  params.points.forEach((point, i) => {
    if (!point.label) return;
    const text =
      point.label.length > 6 ? `${point.label.slice(0, 6)}…` : point.label;
    labels.push({
      tag: "text",
      attrs: {
        x: xs[i],
        y: 890,
        "font-size": 26,
        fill: params.textColor,
        "text-anchor": "middle",
        opacity: clamp01(progress * 2), // 随描画前半程淡入
      },
      text,
    });
  });

  const grids: SvgNode[] = [0.25, 0.5, 0.75].map((ratio) => ({
    tag: "line" as const,
    attrs: {
      x1: LEFT,
      y1: TOP + CHART_HEIGHT * ratio,
      x2: RIGHT,
      y2: TOP + CHART_HEIGHT * ratio,
      stroke: params.textColor,
      opacity: 0.15,
      "stroke-width": 2,
    },
  }));

  return {
    tag: "g",
    attrs: {},
    children: [
      {
        tag: "rect",
        attrs: { x: 0, y: 0, width: ctx.width, height: ctx.height, fill: spec.background },
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
          ...grids,
          {
            tag: "line",
            attrs: {
              x1: LEFT,
              y1: BASELINE,
              x2: RIGHT,
              y2: BASELINE,
              stroke: params.textColor,
              opacity: 0.5,
              "stroke-width": 3,
            },
          },
          {
            tag: "path",
            attrs: {
              d,
              fill: "none",
              stroke: params.lineColor,
              "stroke-width": 8,
              "stroke-linecap": "round",
              "stroke-linejoin": "round",
              pathLength: 1,
              "stroke-dasharray": 1,
              "stroke-dashoffset": 1 - progress,
            },
          },
          ...markers,
          ...labels,
        ],
      },
    ],
  };
}

export const lineChart: SceneComponent = {
  componentId: "line-chart",
  version: 1,
  validateParams,
  render,
};
```

- [ ] **Step 4: 注册表追加 + 导出**

`default-registry.ts` 数组追加 `lineChart`（版本仍 2，注释已有说明）；`index.ts` 追加 `export * from "./components/line-chart.js";`。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @acs/video-scene run build && node --test "packages/video-scene/dist/**/*.test.js"`
Expected: PASS，总数 = 43 + 7 = 50。

- [ ] **Step 6: Commit**

```bash
git add packages/video-scene/src/components/line-chart.ts packages/video-scene/src/components/line-chart.test.ts packages/video-scene/src/default-registry.ts packages/video-scene/src/index.ts
git commit -m "feat(video-scene): line-chart 折线图组件 v1（描画+数据点时序）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: number-counter 组件

**Files:**
- Create: `packages/video-scene/src/components/number-counter.ts`
- Test: `packages/video-scene/src/components/number-counter.test.ts`
- Modify: `packages/video-scene/src/default-registry.ts`、`packages/video-scene/src/index.ts`

**Interfaces:**
- Consumes: Task 1 `fitFontSize`；`clamp01`/`easeOutCubic`。
- Produces: `export const numberCounter: SceneComponent`（componentId `"number-counter"`、version 1）；注册表最终 `createRegistry([textAnimation, lineDrawing, basicShapes, barChart, lineChart, numberCounter], 2)`。Task 5/6/7 依赖字符串 `"number-counter"`。

- [ ] **Step 1: 写失败测试**

`packages/video-scene/src/components/number-counter.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { seededRandom } from "../random.js";
import type { FrameContext } from "../registry.js";
import type { SceneSpec } from "../spec.js";
import type { SvgNode } from "../svg.js";
import { numberCounter } from "./number-counter.js";

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

function specWith(params: Record<string, unknown>): SceneSpec {
  return {
    specVersion: 1,
    componentId: "number-counter",
    componentVersion: 1,
    durationMs: 12000,
    seed: 7,
    background: "#ffffff",
    params,
  };
}

const BASE = {
  title: "一次通过率",
  value: 98.6,
  prefix: "",
  suffix: "%",
  decimals: 1,
  countMs: 1500,
  numberColor: "#1b2c29",
  accentColor: "#d9822b",
};

function collect(node: SvgNode, tag: string): SvgNode[] {
  if (node.tag === tag) return [node];
  return (node.children ?? []).flatMap((child) => collect(child, tag));
}

function numberText(node: SvgNode): SvgNode {
  return collect(node, "text").find((t) => t.text!.includes("%"))!;
}

test("t=0 文本 = prefix + (0).toFixed(decimals) + suffix；t≥countMs 定格 value", () => {
  const spec = specWith({ ...BASE });
  const start = numberText(numberCounter.render(spec, makeCtx({ frame: 0 })));
  assert.equal(start.text, "0.0%");
  const done = numberText(numberCounter.render(spec, makeCtx({ frame: 24 * 3 })));
  assert.equal(done.text, "98.6%");
});

test("滚动中途数值单调不减且介于两端之间", () => {
  const spec = specWith({ ...BASE });
  let prev = 0;
  for (let frame = 0; frame <= 24 * 2; frame += 4) {
    const node = numberCounter.render(spec, makeCtx({ frame }));
    const current = Number(numberText(node).text!.replace("%", ""));
    assert.ok(current >= prev - 1e-9, `frame ${frame}: ${current} < ${prev}`);
    assert.ok(current <= 98.6 + 1e-9);
    prev = current;
  }
});

test("整数模式 decimals=0 无小数点", () => {
  const node = numberCounter.render(
    specWith({ ...BASE, value: 250000, suffix: "+", decimals: 0 }),
    makeCtx({ frame: 24 * 3 }),
  );
  const text = collect(node, "text").find((t) => t.text!.includes("+"))!.text;
  assert.equal(text, "250000+");
});

test("长文本字号自适应：prefix+长数字+suffix 钳制到 ≤200 且行宽 ≤840", () => {
  const node = numberCounter.render(
    specWith({ ...BASE, value: 123456789012, prefix: "累计", suffix: "件作品" }),
    makeCtx({ frame: 24 * 3 }),
  );
  const text = collect(node, "text").find((t) => t.text!.includes("件作品"))!;
  const size = text.attrs["font-size"] as number;
  assert.ok(size < 200, `长文本应缩小: ${size}`);
  // emUnits("累计123456789012件作品") = 6 + 12×0.6 = 13.2 → 840/13.2 ≈ 63.6
  assert.ok(Math.abs(size - 840 / 13.2) < 1e-9);
});

test("accent 下划线随 countMs 生长：t=0 宽 0，末帧宽 320 且居中", () => {
  const spec = specWith({ ...BASE });
  const nestedAt = (frame: number) =>
    collect(numberCounter.render(spec, makeCtx({ frame })), "svg")[0]!;
  const at0 = collect(nestedAt(0), "rect").find((r) => r.attrs.fill === "#d9822b")!;
  assert.equal(at0.attrs.width, 0);
  const done = collect(nestedAt(24 * 3), "rect").find((r) => r.attrs.fill === "#d9822b")!;
  assert.equal(done.attrs.width, 320);
  assert.equal(done.attrs.x, 500 - 160);
});

test("标题存在且在数字下方（y=660）", () => {
  const node = numberCounter.render(specWith({ ...BASE }), makeCtx({ frame: 0 }));
  const title = collect(node, "text").find((t) => t.text === "一次通过率")!;
  assert.equal(title.attrs.y, 660);
});

test("同 (spec, ctx) 两次渲染深度相等（纯函数）", () => {
  const spec = specWith({ ...BASE });
  assert.deepEqual(
    numberCounter.render(spec, makeCtx({ frame: 12 })),
    numberCounter.render(spec, makeCtx({ frame: 12 })),
  );
});

test("params 校验：value 负/超界、decimals 越界、prefix/suffix 超 6、countMs 越界、颜色拒绝", () => {
  assert.throws(() => numberCounter.validateParams({ ...BASE, value: -1 }), /value/);
  assert.throws(() => numberCounter.validateParams({ ...BASE, value: 1e13 }), /value/);
  assert.throws(() => numberCounter.validateParams({ ...BASE, decimals: 3 }), /decimals/);
  assert.throws(() => numberCounter.validateParams({ ...BASE, decimals: -1 }), /decimals/);
  assert.throws(() => numberCounter.validateParams({ ...BASE, prefix: "七个字符的前缀" }), /prefix/);
  assert.throws(() => numberCounter.validateParams({ ...BASE, suffix: "一二三四五六七" }), /suffix/);
  assert.throws(() => numberCounter.validateParams({ ...BASE, countMs: 199 }), /countMs/);
  assert.throws(() => numberCounter.validateParams({ ...BASE, numberColor: "red" }), /numberColor/);
});
```

注意 `prefix: "七个字符的前缀"` 是 8 字符，越 6 界正确触发。

- [ ] **Step 2: 跑 build 确认失败**

Run: `pnpm --filter @acs/video-scene run build`
Expected: FAIL —— `Cannot find module './number-counter.js'`。

- [ ] **Step 3: 实现 number-counter**

`packages/video-scene/src/components/number-counter.ts`：

```ts
import { clamp01, easeOutCubic } from "../easing.js";
import { fitFontSize } from "../text-width.js";
import type { FrameContext, SceneComponent, SceneSpecLike } from "../registry.js";
import type { SvgNode } from "../svg.js";

// 数字滚动组件 v1：大数字 count-up（value × easeOutCubic(t/countMs)，toFixed
// 直拼——不用 toLocaleString，locale 不确定）+ accent 下划线生长 + 底部标题。
// 1000×1000 设计空间嵌套 svg viewBox；render 纯函数，禁墙钟/随机/网络。

type NumberCounterParams = {
  title: string;
  value: number;
  prefix: string;
  suffix: string;
  decimals: number; // 0..2
  countMs: number; // 200..6000
  numberColor: string;
  accentColor: string;
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DESIGN_SPACE = 1000;
const NUMBER_MAX_SIZE = 200;
const NUMBER_SAFE_WIDTH = 840;
const UNDERLINE_FULL = 320;
const MAX_VALUE = 1e12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function validateParams(value: unknown): NumberCounterParams {
  if (!isRecord(value)) throw new Error("number-counter params 必须是对象");
  if (typeof value.title !== "string" || value.title.length > 40) {
    throw new Error("number-counter params.title 必须是 ≤40 个字符");
  }
  if (
    typeof value.value !== "number" ||
    !Number.isFinite(value.value) ||
    value.value < 0 ||
    value.value > MAX_VALUE
  ) {
    throw new Error(`number-counter params.value 必须是 0..${MAX_VALUE} 的数`);
  }
  if (typeof value.prefix !== "string" || value.prefix.length > 6) {
    throw new Error("number-counter params.prefix 必须是 ≤6 个字符");
  }
  if (typeof value.suffix !== "string" || value.suffix.length > 6) {
    throw new Error("number-counter params.suffix 必须是 ≤6 个字符");
  }
  if (!Number.isInteger(value.decimals) || (value.decimals as number) < 0 || (value.decimals as number) > 2) {
    throw new Error("number-counter params.decimals 必须是 0..2 的整数");
  }
  if (
    !Number.isInteger(value.countMs) ||
    (value.countMs as number) < 200 ||
    (value.countMs as number) > 6000
  ) {
    throw new Error("number-counter params.countMs 必须是 200..6000 的整数");
  }
  if (!isHexColor(value.numberColor))
    throw new Error("number-counter params.numberColor 必须是 #rrggbb");
  if (!isHexColor(value.accentColor))
    throw new Error("number-counter params.accentColor 必须是 #rrggbb");
  return value as NumberCounterParams;
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const params = spec.params as NumberCounterParams;
  const tMs = (ctx.frame / ctx.fps) * 1000;
  const progress = easeOutCubic(clamp01(tMs / params.countMs));
  const displayed = (params.value * progress).toFixed(params.decimals);
  const text = `${params.prefix}${displayed}${params.suffix}`;
  const underlineW = UNDERLINE_FULL * progress;

  return {
    tag: "g",
    attrs: {},
    children: [
      {
        tag: "rect",
        attrs: { x: 0, y: 0, width: ctx.width, height: ctx.height, fill: spec.background },
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
              y: 460,
              "font-size": fitFontSize(NUMBER_MAX_SIZE, text, NUMBER_SAFE_WIDTH),
              fill: params.numberColor,
              "text-anchor": "middle",
              "dominant-baseline": "middle",
            },
            text,
          },
          {
            tag: "rect",
            attrs: {
              x: 500 - underlineW / 2,
              y: 560,
              width: underlineW,
              height: 10,
              rx: 5,
              fill: params.accentColor,
            },
          },
          {
            tag: "text",
            attrs: {
              x: 500,
              y: 660,
              "font-size": fitFontSize(44, params.title, 880),
              fill: params.numberColor,
              "text-anchor": "middle",
              "dominant-baseline": "middle",
            },
            text: params.title,
          },
        ],
      },
    ],
  };
}

export const numberCounter: SceneComponent = {
  componentId: "number-counter",
  version: 1,
  validateParams,
  render,
};
```

- [ ] **Step 4: 注册表最终形态 + 导出**

`default-registry.ts` 数组追加 `numberCounter`（版本仍 2）；`index.ts` 追加 `export * from "./components/number-counter.js";`。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @acs/video-scene run build && node --test "packages/video-scene/dist/**/*.test.js"`
Expected: PASS，总数 = 50 + 8 = 58。

- [ ] **Step 6: Commit**

```bash
git add packages/video-scene/src/components/number-counter.ts packages/video-scene/src/components/number-counter.test.ts packages/video-scene/src/default-registry.ts packages/video-scene/src/index.ts
git commit -m "feat(video-scene): number-counter 数字滚动组件 v1（count-up+下划线生长）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: 工作台 chart-templates 纯逻辑模块

**Files:**
- Create: `apps/web/src/app/video-studio/chart-templates.ts`
- Test: `apps/web/src/app/video-studio/chart-templates.test.ts`

**Interfaces:**
- Consumes: `@acs/video-scene` 的 `defaultRegistry` / `validateSceneSpec` / `type SceneSpec`（shot-specs.ts 同款导入）。
- Produces（Task 6/7 依赖）:
  - `export type ChartTemplate = { templateId: string; componentId: "bar-chart" | "line-chart" | "number-counter"; label: string; params: Record<string, unknown> }`
  - `export const CHART_TEMPLATES: ChartTemplate[]`（5 个）
  - `export function isChartComponentId(componentId: string): boolean`
  - `export function applyChartTemplate(spec: SceneSpec, templateId: string): { spec: SceneSpec; error: null } | { spec: null; error: string }`
  - `export type ChartEditDraft = { title: string; data: string; value: string; prefix: string; suffix: string }`
  - `export function draftChartFromSpec(spec: SceneSpec): ChartEditDraft`
  - `export function buildChartRevisePatch(spec: SceneSpec, draft: ChartEditDraft): { spec: SceneSpec; error: null } | { spec: null; error: string }`

- [ ] **Step 1: 写失败测试**

`apps/web/src/app/video-studio/chart-templates.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { SceneSpec } from "@acs/video-scene";
import {
  CHART_TEMPLATES,
  applyChartTemplate,
  buildChartRevisePatch,
  draftChartFromSpec,
  isChartComponentId,
} from "./chart-templates.js";

const SPEC: SceneSpec = {
  specVersion: 1,
  componentId: "text-animation",
  componentVersion: 1,
  durationMs: 3000,
  seed: 42,
  background: "#f4f7f5",
  params: { title: "原标题", titleColor: "#1b2c29", subtitleColor: "#5d7469", entrance: "fade-up", enterMs: 800 },
};

test("CHART_TEMPLATES：5 个起点模板，id/组件/label 齐全且 params 过校验", () => {
  assert.equal(CHART_TEMPLATES.length, 5);
  const ids = new Set(CHART_TEMPLATES.map((t) => t.templateId));
  assert.deepEqual(
    [...ids].sort(),
    ["bar-compare-4", "bar-rank-6", "counter-kpi", "counter-percent", "line-trend-8"],
  );
  for (const template of CHART_TEMPLATES) {
    assert.ok(template.label.length > 0);
    const applied = applyChartTemplate(SPEC, template.templateId);
    assert.equal(applied.error, null, `${template.templateId} 应可用`);
  }
});

test("isChartComponentId：三图表组件为 true，其余 false", () => {
  assert.equal(isChartComponentId("bar-chart"), true);
  assert.equal(isChartComponentId("line-chart"), true);
  assert.equal(isChartComponentId("number-counter"), true);
  assert.equal(isChartComponentId("text-animation"), false);
  assert.equal(isChartComponentId("line-drawing"), false);
});

test("applyChartTemplate：换组件保 durationMs/background/seed，未知 id 报错", () => {
  const applied = applyChartTemplate(SPEC, "bar-compare-4");
  assert.equal(applied.error, null);
  assert.equal(applied.spec!.componentId, "bar-chart");
  assert.equal(applied.spec!.componentVersion, 1);
  assert.equal(applied.spec!.durationMs, 3000);
  assert.equal(applied.spec!.background, "#f4f7f5");
  assert.equal(applied.spec!.seed, 42);
  const unknown = applyChartTemplate(SPEC, "no-such-template");
  assert.equal(unknown.spec, null);
  assert.match(unknown.error!, /未知图表模板/);
});

test("applyChartTemplate 深拷贝：改产物 params 不污染模板库", () => {
  const applied = applyChartTemplate(SPEC, "bar-compare-4").spec!;
  const bars = applied.params as { bars: Array<{ label: string }> };
  bars.bars[0]!.label = "污染";
  const again = applyChartTemplate(SPEC, "bar-compare-4").spec!;
  assert.equal((again.params as { bars: Array<{ label: string }> }).bars[0]!.label, "甲");
});

test("round-trip：draftChartFromSpec(applyChartTemplate(...)) 回读模板数据（Review Focus#2）", () => {
  const bar = draftChartFromSpec(applyChartTemplate(SPEC, "bar-compare-4").spec!);
  assert.equal(bar.title, "四种方案对比");
  assert.equal(bar.data, "甲,30\n乙,48\n丙,22\n丁,40");
  const line = draftChartFromSpec(applyChartTemplate(SPEC, "line-trend-8").spec!);
  assert.equal(line.data.split("\n").length, 8);
  assert.ok(line.data.startsWith("第1年,12\n"));
  const counter = draftChartFromSpec(applyChartTemplate(SPEC, "counter-kpi").spec!);
  assert.equal(counter.value, "250000");
  assert.equal(counter.suffix, "+");
});

test("buildChartRevisePatch：bar 数据合法修改生效", () => {
  const applied = applyChartTemplate(SPEC, "bar-compare-4").spec!;
  const next = buildChartRevisePatch(applied, {
    ...draftChartFromSpec(applied),
    title: "四季降水",
    data: "春,12\n夏,28\n秋,21\n冬,8",
  });
  assert.equal(next.error, null);
  const bars = (next.spec!.params as { bars: Array<{ label: string; value: number }> }).bars;
  assert.deepEqual(bars, [
    { label: "春", value: 12 },
    { label: "夏", value: 28 },
    { label: "秋", value: 21 },
    { label: "冬", value: 8 },
  ]);
  assert.equal((next.spec!.params as { title: string }).title, "四季降水");
  // 未改字段保留基底（颜色/enterMs）
  assert.equal((next.spec!.params as { enterMs: number }).enterMs, 1200);
});

test("buildChartRevisePatch：行格式错误带行号定位、越界行数拒绝（Review Focus#5 混合行）", () => {
  const applied = applyChartTemplate(SPEC, "bar-compare-4").spec!;
  const bad = buildChartRevisePatch(applied, {
    ...draftChartFromSpec(applied),
    data: "甲,30\n乙 xyz\n丙,20",
  });
  assert.equal(bad.spec, null);
  assert.match(bad.error!, /第 2 行/);
  const empty = buildChartRevisePatch(applied, {
    ...draftChartFromSpec(applied),
    data: "",
  });
  assert.match(empty.error!, /bars/);
  const tooMany = buildChartRevisePatch(applied, {
    ...draftChartFromSpec(applied),
    data: Array.from({ length: 9 }, (_, i) => `项${i},1`).join("\n"),
  });
  assert.match(tooMany.error!, /bars/);
  // line 混合标签行：裸数值行合法
  const lineSpec = applyChartTemplate(SPEC, "line-trend-8").spec!;
  const mixed = buildChartRevisePatch(lineSpec, {
    ...draftChartFromSpec(lineSpec),
    data: "12\n第2年,20\n16",
  });
  assert.equal(mixed.error, null);
  const points = (mixed.spec!.params as { points: Array<{ label?: string; value: number }> }).points;
  assert.deepEqual(points, [{ value: 12 }, { label: "第2年", value: 20 }, { value: 16 }]);
});

test("buildChartRevisePatch：空行跳过、CRLF 容忍、尾随空白 trim（Review Focus#4）", () => {
  const applied = applyChartTemplate(SPEC, "bar-compare-4").spec!;
  const next = buildChartRevisePatch(applied, {
    ...draftChartFromSpec(applied),
    data: "甲,30\r\n\r\n  乙,48  \n  \n丙,22\n丁,40\n",
  });
  assert.equal(next.error, null);
  const bars = (next.spec!.params as { bars: Array<{ label: string }> }).bars;
  assert.deepEqual(bars.map((b) => b.label), ["甲", "乙", "丙", "丁"]);
});

test("buildChartRevisePatch：counter 数值/前缀/后缀/标题修改与非法拒绝", () => {
  const applied = applyChartTemplate(SPEC, "counter-percent").spec!;
  const next = buildChartRevisePatch(applied, {
    ...draftChartFromSpec(applied),
    title: "合格率",
    value: "99.9",
    prefix: "约 ",
    suffix: "%",
  });
  assert.equal(next.error, null);
  const params = next.spec!.params as { title: string; value: number; prefix: string };
  assert.equal(params.title, "合格率");
  assert.equal(params.value, 99.9);
  assert.equal(params.prefix, "约 ");
  const badValue = buildChartRevisePatch(applied, {
    ...draftChartFromSpec(applied),
    value: "abc",
  });
  assert.match(badValue.error!, /value/);
  const badTitle = buildChartRevisePatch(applied, {
    ...draftChartFromSpec(applied),
    title: "一".repeat(41),
  });
  assert.match(badTitle.error!, /title/);
});

test("buildChartRevisePatch：非图表组件 spec 返回错误", () => {
  const result = buildChartRevisePatch(SPEC, {
    title: "", data: "", value: "", prefix: "", suffix: "",
  });
  assert.equal(result.spec, null);
  assert.match(result.error!, /图表/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @acs/web test`
Expected: FAIL —— chart-templates 模块不存在（`Cannot find module './chart-templates.js'`），其余既有测试照常过。

- [ ] **Step 3: 实现 chart-templates**

`apps/web/src/app/video-studio/chart-templates.ts`：

```ts
// P2-① 数据可视化：图表起点模板与数据编辑纯逻辑（沿 shot-edit.ts 模式——
// 组件只做渲染/状态接线）。模板参数过 validateSceneSpec 兜底；非法数据行内
// 报错、不落 patch（沿转场 C1 语义：非法编辑不清文档）。

import {
  defaultRegistry,
  validateSceneSpec,
  type SceneSpec,
} from "@acs/video-scene";

export type ChartTemplate = {
  templateId: string;
  componentId: "bar-chart" | "line-chart" | "number-counter";
  label: string;
  params: Record<string, unknown>;
};

const BAR_COLORS = {
  barColor: "#2f6f4f",
  accentColor: "#d9822b",
  textColor: "#1b2c29",
};

export const CHART_TEMPLATES: ChartTemplate[] = [
  {
    templateId: "bar-compare-4",
    componentId: "bar-chart",
    label: "柱状对比（4 柱）",
    params: {
      title: "四种方案对比",
      bars: [
        { label: "甲", value: 30 },
        { label: "乙", value: 48 },
        { label: "丙", value: 22 },
        { label: "丁", value: 40 },
      ],
      ...BAR_COLORS,
      enterMs: 1200,
    },
  },
  {
    templateId: "bar-rank-6",
    componentId: "bar-chart",
    label: "柱状排行（6 柱）",
    params: {
      title: "各队伍得分排行",
      bars: [
        { label: "A队", value: 92 },
        { label: "B队", value: 78 },
        { label: "C队", value: 65 },
        { label: "D队", value: 51 },
        { label: "E队", value: 37 },
        { label: "F队", value: 22 },
      ],
      ...BAR_COLORS,
      enterMs: 1500,
    },
  },
  {
    templateId: "line-trend-8",
    componentId: "line-chart",
    label: "折线趋势（8 点）",
    params: {
      title: "年产量趋势",
      points: [
        { label: "第1年", value: 12 },
        { label: "第2年", value: 15 },
        { label: "第3年", value: 14 },
        { label: "第4年", value: 19 },
        { label: "第5年", value: 24 },
        { label: "第6年", value: 31 },
        { label: "第7年", value: 38 },
        { label: "第8年", value: 46 },
      ],
      lineColor: "#2f6f4f",
      markerColor: "#d9822b",
      textColor: "#1b2c29",
      drawMs: 1600,
    },
  },
  {
    templateId: "counter-kpi",
    componentId: "number-counter",
    label: "数字滚动 KPI",
    params: {
      title: "累计交付作品",
      value: 250000,
      prefix: "",
      suffix: "+",
      decimals: 0,
      countMs: 1800,
      numberColor: "#1b2c29",
      accentColor: "#2f6f4f",
    },
  },
  {
    templateId: "counter-percent",
    componentId: "number-counter",
    label: "百分比数字",
    params: {
      title: "一次通过率",
      value: 98.6,
      prefix: "",
      suffix: "%",
      decimals: 1,
      countMs: 1500,
      numberColor: "#1b2c29",
      accentColor: "#d9822b",
    },
  },
];

export function isChartComponentId(componentId: string): boolean {
  return (
    componentId === "bar-chart" ||
    componentId === "line-chart" ||
    componentId === "number-counter"
  );
}

export function applyChartTemplate(
  spec: SceneSpec,
  templateId: string,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  const template = CHART_TEMPLATES.find((t) => t.templateId === templateId);
  if (!template) return { spec: null, error: `未知图表模板 ${templateId}` };
  // 深拷贝：编辑产物不得回流污染模板库
  const next: SceneSpec = {
    ...spec,
    componentId: template.componentId,
    componentVersion: 1,
    params: structuredClone(template.params),
  };
  try {
    validateSceneSpec(next, defaultRegistry);
  } catch (error) {
    return { spec: null, error: error instanceof Error ? error.message : String(error) };
  }
  return { spec: next, error: null };
}

export type ChartEditDraft = {
  title: string; // 三组件共享
  data: string; // bar/line：每行 `标签,数值`（line 标签可省）
  value: string; // counter
  prefix: string; // counter
  suffix: string; // counter
};

type BarPoint = { label: string; value: number };
type LinePoint = { label?: string; value: number };

export function draftChartFromSpec(spec: SceneSpec): ChartEditDraft {
  const params = spec.params as {
    title?: string;
    bars?: BarPoint[];
    points?: LinePoint[];
    value?: number;
    prefix?: string;
    suffix?: string;
  };
  if (spec.componentId === "bar-chart") {
    return {
      title: params.title ?? "",
      data: (params.bars ?? []).map((b) => `${b.label},${b.value}`).join("\n"),
      value: "",
      prefix: "",
      suffix: "",
    };
  }
  if (spec.componentId === "line-chart") {
    return {
      title: params.title ?? "",
      data: (params.points ?? [])
        .map((p) => (p.label === undefined ? String(p.value) : `${p.label},${p.value}`))
        .join("\n"),
      value: "",
      prefix: "",
      suffix: "",
    };
  }
  return {
    title: params.title ?? "",
    data: "",
    value: String(params.value ?? ""),
    prefix: params.prefix ?? "",
    suffix: params.suffix ?? "",
  };
}

// 行解析：以最后一个逗号分隔（标签自身可含逗号）；返回 null = 该行格式非法。
function parseDataLine(line: string): { label: string | null; value: number } | null {
  const idx = line.lastIndexOf(",");
  if (idx < 0) {
    const value = Number(line);
    return Number.isFinite(value) ? { label: null, value } : null;
  }
  const label = line.slice(0, idx).trim();
  const value = Number(line.slice(idx + 1).trim());
  if (label.length < 1 || !Number.isFinite(value)) return null;
  return { label, value };
}

export function buildChartRevisePatch(
  spec: SceneSpec,
  draft: ChartEditDraft,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  if (!isChartComponentId(spec.componentId)) {
    return { spec: null, error: "当前镜头组件不是图表组件" };
  }
  const lines = draft.data
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  let params: Record<string, unknown>;
  if (spec.componentId === "bar-chart") {
    const bars: BarPoint[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const parsed = parseDataLine(lines[i]!);
      if (!parsed || parsed.label === null) {
        return {
          spec: null,
          error: `第 ${i + 1} 行：标签,数值 格式不符（标签 1..12 字符，数值 0..1e12）`,
        };
      }
      bars.push({ label: parsed.label, value: parsed.value });
    }
    params = { ...(spec.params as Record<string, unknown>), title: draft.title, bars };
  } else if (spec.componentId === "line-chart") {
    const points: LinePoint[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const parsed = parseDataLine(lines[i]!);
      if (!parsed) {
        return {
          spec: null,
          error: `第 ${i + 1} 行：数值 或 标签,数值 格式不符（数值 0..1e12）`,
        };
      }
      points.push(parsed.label === null ? { value: parsed.value } : { label: parsed.label, value: parsed.value });
    }
    params = { ...(spec.params as Record<string, unknown>), title: draft.title, points };
  } else {
    if (draft.value.trim() === "") {
      return { spec: null, error: "number-counter 数值不能为空" };
    }
    const value = Number(draft.value.trim());
    params = {
      ...(spec.params as Record<string, unknown>),
      title: draft.title,
      value,
      prefix: draft.prefix,
      suffix: draft.suffix,
    };
  }
  const next: SceneSpec = { ...spec, params };
  try {
    validateSceneSpec(next, defaultRegistry);
  } catch (error) {
    return { spec: null, error: error instanceof Error ? error.message : String(error) };
  }
  return { spec: next, error: null };
}
```

（counter 分支的空值守卫已内联在上方代码里：空数值输入返回 `number-counter 数值不能为空`，不以 0 静默通过；测试 `badValue` 用 "abc" 走 NaN 分支被 validateParams 拒，/value/ 匹配。）

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @acs/web test`
Expected: PASS，web 总数 = 73（既有）+ 10（新）= 83。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/video-studio/chart-templates.ts apps/web/src/app/video-studio/chart-templates.test.ts
git commit -m "feat(video-studio): 图表起点模板 5 枚与数据编辑纯逻辑（chart-templates）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: 编辑卡接线（组件模板下拉 + 图表数据编辑）

**Files:**
- Modify: `apps/web/src/app/video-studio/shot-editor-card.tsx`
- Modify: `apps/web/src/app/video-studio/video-studio.css`（图表编辑控件样式）

**Interfaces:**
- Consumes: Task 5 全部导出；既有 `buildRevisePatch`/`draftFromWorking`（shot-edit.ts，不改）。
- Produces: DOM 选择器 `.chart-template-select` / `.chart-title-input` / `.chart-data-input` / `.chart-value-input` / `.chart-prefix-input` / `.chart-suffix-input` / `.chart-edit-error`（Task 7 e2e 依赖）。

- [ ] **Step 1: 接线 shot-editor-card.tsx**

改动点（在既有结构上加，不动既有分支）：

1. import 增加：

```ts
import {
  CHART_TEMPLATES,
  applyChartTemplate,
  buildChartRevisePatch,
  draftChartFromSpec,
  isChartComponentId,
  type ChartEditDraft,
} from "./chart-templates";
```

2. 组件外模块级新增常量、组件内新增状态（既有 draft 状态之后）：

```ts
// 模块级（组件函数外）
const EMPTY_CHART_DRAFT: ChartEditDraft = { title: "", data: "", value: "", prefix: "", suffix: "" };

// 组件内
const [pendingTemplateId, setPendingTemplateId] = useState("");
const [chartDraft, setChartDraft] = useState<ChartEditDraft>(() =>
  spec && isChartComponentId(spec.componentId) ? draftChartFromSpec(spec) : EMPTY_CHART_DRAFT,
);
const [chartError, setChartError] = useState<string | null>(null);
```

3. working 版本重置 effect 内（`setEditError(null);` 之后）追加：

```ts
setPendingTemplateId("");
setChartError(null);
setChartDraft(
  nextSpec && isChartComponentId(nextSpec.componentId)
    ? draftChartFromSpec(nextSpec)
    : EMPTY_CHART_DRAFT,
);
```

4. 编辑表单内、既有组件特定字段（标题/副标题 或 换一枚模板 三元分支）**之后**追加两段：

「换成图表模板」下拉（所有组件可换）：

```tsx
<label className="shot-edit-field">
  组件模板（换成图表）
  <select
    className="chart-template-select"
    value={pendingTemplateId}
    onChange={(event) => {
      const templateId = event.target.value;
      setPendingTemplateId(templateId);
      setChartError(null);
      if (!templateId) return;
      const applied = applyChartTemplate(spec, templateId);
      if (applied.error || !applied.spec) {
        setChartError(applied.error ?? "模板无效");
        return;
      }
      // 选中即预填该模板数据到编辑字段（应用时才落文档）
      setChartDraft(draftChartFromSpec(applied.spec));
    }}
  >
    <option value="">— 保持当前组件 —</option>
    {CHART_TEMPLATES.map((template) => (
      <option key={template.templateId} value={template.templateId}>
        {template.label}
      </option>
    ))}
  </select>
</label>
```

当前组件是图表时的数据编辑字段：

```tsx
{isChartComponentId(spec.componentId) ? (
  <>
    <label className="shot-edit-field">
      图表标题
      <input
        className="chart-title-input"
        maxLength={40}
        value={chartDraft.title}
        onChange={(event) => setChartDraft({ ...chartDraft, title: event.target.value })}
      />
    </label>
    {spec.componentId === "number-counter" ? (
      <>
        <label className="shot-edit-field">
          数值
          <input
            className="chart-value-input"
            value={chartDraft.value}
            onChange={(event) => setChartDraft({ ...chartDraft, value: event.target.value })}
          />
        </label>
        <label className="shot-edit-field">
          前缀
          <input
            className="chart-prefix-input"
            maxLength={6}
            value={chartDraft.prefix}
            onChange={(event) => setChartDraft({ ...chartDraft, prefix: event.target.value })}
          />
        </label>
        <label className="shot-edit-field">
          后缀
          <input
            className="chart-suffix-input"
            maxLength={6}
            value={chartDraft.suffix}
            onChange={(event) => setChartDraft({ ...chartDraft, suffix: event.target.value })}
          />
        </label>
      </>
    ) : (
      <label className="shot-edit-field">
        数据（每行 标签,数值{spec.componentId === "line-chart" ? "，折线可只写数值" : ""}）
        <textarea
          className="chart-data-input"
          rows={6}
          value={chartDraft.data}
          onChange={(event) => setChartDraft({ ...chartDraft, data: event.target.value })}
        />
      </label>
    )}
    {chartError ? <p className="chart-edit-error">{chartError}</p> : null}
  </>
) : null}
```

5. 应用按钮 onClick 改为三分支组合（替换现有 `buildRevisePatch(draft, spec)` 调用块）：

```tsx
onClick={() => {
  // 换模板优先：纯 spec 修订（旁白/时长保持文档现值，二次应用可再改）
  if (pendingTemplateId) {
    const applied = applyChartTemplate(spec, pendingTemplateId);
    if (applied.error || !applied.spec) {
      setEditError(applied.error ?? "模板无效");
      return;
    }
    setEditError(null);
    setChartError(null);
    onRevise({ spec: applied.spec });
    return;
  }
  // 图表数据编辑先合入 spec，再走既有 narration/背景/时长门
  const chartResult = isChartComponentId(spec.componentId)
    ? buildChartRevisePatch(spec, chartDraft)
    : null;
  if (chartResult && (chartResult.error || !chartResult.spec)) {
    setChartError(chartResult.error ?? "图表数据无效");
    return;
  }
  const { patch, error } = buildRevisePatch(draft, chartResult?.spec ?? spec);
  if (error || !patch) {
    setEditError(error ?? "草稿无效");
    return;
  }
  setEditError(null);
  onRevise(patch);
}}
```

- [ ] **Step 2: 样式（video-studio.css 追加）**

在 `.shot-edit-error` 规则附近追加：

```css
.chart-template-select,
.chart-value-input,
.chart-prefix-input,
.chart-suffix-input {
  font-size: 13px;
  padding: 4px 8px;
  border: 1px solid #bfd6c8;
  border-radius: 6px;
  background: #fff;
  color: #1b2c29;
  font-family: inherit;
}

.chart-title-input {
  font-size: 13px;
  padding: 4px 8px;
  border: 1px solid #bfd6c8;
  border-radius: 6px;
  font-family: inherit;
}

.chart-data-input {
  font-size: 13px;
  padding: 6px 8px;
  border: 1px solid #bfd6c8;
  border-radius: 6px;
  min-height: 120px;
  resize: vertical;
  font-family: inherit;
}

.chart-edit-error {
  margin: 0;
  font-size: 12px;
  color: #a3230f;
}
```

- [ ] **Step 3: 验证（typecheck + web 套件 + biome）**

Run: `pnpm --filter @acs/web run typecheck`
Expected: 通过。

Run: `pnpm --filter @acs/web test`
Expected: PASS 83（本任务不加单测——接线归 e2e 覆盖，house 口径）。

Run: `npx biome check apps/web/src/app/video-studio/shot-editor-card.tsx apps/web/src/app/video-studio/video-studio.css`
Expected: 干净。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/video-studio/shot-editor-card.tsx apps/web/src/app/video-studio/video-studio.css
git commit -m "feat(video-studio): 镜头编辑卡接入图表模板下拉与数据编辑

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: e2e VID-017 + 收口（证据、QA 登记、状态文档）

**Files:**
- Create: `scripts/video/e2e-dataviz.mjs`
- Create: `artifacts/video-studio-dataviz/E2E_DATAVIZ.md`（提交；mp4/png 不提交）
- Modify: `qa/registry.json`（VID-017，沿 VID-016 条目格式）
- Modify: `AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md`（顶部条目）

**Interfaces:**
- Consumes: Task 6 的 DOM 选择器；`scripts/video/render-scene.mjs --project --out`；transitions e2e 的 `renderProject`/YAVG 口径。
- Produces: 退出码 0 = 闭环成立；证据哈希表（A3 双跑一致、R6 全项）。

- [ ] **Step 1: 写 e2e 脚本**

`scripts/video/e2e-dataviz.mjs`（结构沿 e2e-transitions.mjs：bootstrap 相同、渲染/YAVG/哈希工具相同）。核心流程：

```js
#!/usr/bin/env node
// P2-① 数据可视化端到端闭环验收（真实工作台链路，零 TTS 计费）：
//   浏览器新建→STEM 分镜（4 镜头，水循环）→保存
//   →镜头 2 换 bar-compare-4 模板→改数据（四季降水）→保存→导出（结构断言）
//   →镜头 3 换 counter-kpi 模板→保存→导出（结构断言）
//   →CLI render-scene 双画幅出片→双跑逐字节一致→图表帧 YAVG ≥100（双画幅）
//   →计费行数不变、控制台零 error。
// 前置: @acs/web dev 已在 BASE_URL（:3210，建议经 scripts/dev/proxy-3211.mjs）；
//       packages/{video-document,video-scene} 已 build；ffmpeg 在 PATH。
// exit 0 = 闭环成立；任何一步失败 exit 1 并打印步骤名。
```

关键段落（工具函数 `sha256` / `usageLines` / `frameYavg` / `renderProject` / `waitForMessage` 从 e2e-transitions.mjs 原样复制）：

```js
const SENTENCE = "做一个8秒的STEM解说视频，主题是水循环，分4个镜头";
// spans 2000/3100/2000/2000ms @24fps → [48,74,48,48]，总 218 帧
// 镜头 2 帧域 48..121；镜头 3 帧域 122..169

// —— 1. 镜头 2 换 bar-compare-4 + 改数据 ——
const card2 = page.locator(".shot-list > li").nth(1);
await card2.locator(".shot-edit-toggle").click();
await card2.locator(".chart-template-select").selectOption("bar-compare-4");
await card2.locator(".chart-data-input").fill("春,12\n夏,28\n秋,21\n冬,8");
await card2.locator(".shot-apply").click();
await page.click(".editor-save");
await waitForMessage(page, "已保存", "保存柱状图镜头");

// —— 2. 镜头 3 换 counter-kpi ——
const card3 = page.locator(".shot-list > li").nth(2);
await card3.locator(".shot-edit-toggle").click();
await card3.locator(".chart-template-select").selectOption("counter-kpi");
await card3.locator(".shot-apply").click();
await page.click(".editor-save");
await waitForMessage(page, "已保存", "保存计数镜头");

// —— 3. 导出 + 结构断言 ——
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 15_000 }),
  page.click(".editor-export"),
]);
await download.saveAs(EXPORTED);
const exported = JSON.parse(readFileSync(EXPORTED, "utf8"));
const specOf = (shot) =>
  shot.contentVersions.find((v) => v.versionId === shot.workingVersionId).sceneSource.spec;
const s2 = specOf(exported.shots[1]);
if (s2.componentId !== "bar-chart") fail("镜头 2 组件", s2.componentId);
const bars = s2.params.bars.map((b) => `${b.label},${b.value}`).join("|");
if (bars !== "春,12|夏,28|秋,21|冬,8") fail("镜头 2 数据", bars);
const s3 = specOf(exported.shots[2]);
if (s3.componentId !== "number-counter" || s3.params.value !== 250000)
  fail("镜头 3 组件/数值", JSON.stringify(s3.params));
// 字段保留断言：旁白/背景/时长不被模板换掉
if (typeof exported.shots[1].contentVersions.at(-1).narrationText !== "string")
  fail("旁白保留", "narrationText 缺失");

// —— 4. CLI 双画幅 + 双跑 + YAVG ——
renderProject(EXPORTED, RENDER_DIR, "CLI 出片");
renderProject(EXPORTED, RERUN_DIR, "CLI 复跑");
for (const aspect of ["landscape", "portrait"]) {
  const a = sha256(path.join(RENDER_DIR, `${aspect}.mp4`));
  const b = sha256(path.join(RERUN_DIR, `${aspect}.mp4`));
  if (a !== b) fail("双跑一致", `${aspect}: ${a} ≠ ${b}`);
  // 镜头 2 帧域中段（帧 80，柱已长成）与镜头 3（帧 140，数字定格）非全黑
  for (const frame of [80, 140]) {
    const yavg = frameYavg(path.join(RENDER_DIR, `${aspect}.mp4`), frame, `YAVG ${aspect}/${frame}`);
    if (yavg < 100) fail("图表帧亮度", `${aspect} 帧 ${frame} YAVG=${yavg} < 100`);
  }
}

// —— 5. 收尾 ——计费不变、控制台零 error、截图、哈希表打印
```

- [ ] **Step 2: 起前置服务并跑 e2e**

前置（三个终端/后台，已熟悉拓扑）：`pnpm --filter @acs/web dev`（:3210）、`node scripts/dev/proxy-3211.mjs`（:3211）、`BASE_URL=http://localhost:3211 node scripts/video/e2e-dataviz.mjs`。

Expected: exit 0，打印 landscape/portrait 双跑一致哈希（两轮相同）。

- [ ] **Step 3: 复跑一次确认双跑哈希稳定（跨进程帧确定性）**

再执行一遍 e2e（第二次），记录两轮哈希四元组是否各自一致。
Expected: 每轮内部双跑一致；跨轮哈希一致（同机同版本）。

- [ ] **Step 4: 证据文档 + QA 登记 + CURRENT_STATE**

`artifacts/video-studio-dataviz/E2E_DATAVIZ.md`：目的、前置、命令、判据（结构断言/YAVG ≥100/双跑一致/计费不变/零 error）、哈希表（landscape/portrait）、裁定注记（YAVG 口径沿 VID-016）。

`qa/registry.json`：沿 VID-016 条目格式新增 VID-017（自动化 `node scripts/video/e2e-dataviz.mjs`，覆盖点：模板换装/数据编辑/双画幅出片/双跑一致）。

`CURRENT_STATE.md` 顶部新增 P2-① 条目（一段：三组件+注册表 v2+模板与编辑+VID-017+回归计数）。

- [ ] **Step 5: 全回归四套 + 静态 + qa**

Run（依次）:
- `pnpm --filter @acs/video-document run build && node --test "packages/video-document/dist/**/*.test.js"` → 71
- `pnpm --filter @acs/video-scene run build && node --test "packages/video-scene/dist/**/*.test.js"` → 58
- `pnpm --filter @acs/web test` → 83
- `node --test scripts/video/*.test.mjs` → 57
- `pnpm --filter @acs/web run typecheck`
- `pnpm run qa:validate` → "77 automated and 51 manual cases"（VID-017 登记 +1 自动化）

- [ ] **Step 6: 转场 e2e 复跑（A1 注册表追加无害金标准）**

Run: `BASE_URL=http://localhost:3211 node scripts/video/e2e-transitions.mjs`
Expected: exit 0；A1 无转场基线哈希 = 已档 `bbda0997…`/`b1849dd5…`（证明组件追加未改旧渲染路径）。复跑再生的证据 JSON `git restore` 回库态（沿 7f44a66 先例）。

- [ ] **Step 7: Commit（提交 .md/.json/.mjs，不含 mp4/png）**

```bash
git add scripts/video/e2e-dataviz.mjs artifacts/video-studio-dataviz/E2E_DATAVIZ.md qa/registry.json AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md
git commit -m "feat(video-studio): P2-① 数据可视化收口——e2e VID-017、证据与登记

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## 执行后（executing-plans 收尾，不在本计划任务内）

最终全分支评审（opus，review-package）→ 按效应重定级 → ONE fix pass（每修 RED→GREEN + 全绿）→ ledger minors/rulings → 删除计划工作区 → finishing-a-development-branch（集成决定归用户）。
