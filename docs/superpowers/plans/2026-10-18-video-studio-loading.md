# Video Studio P2-⑥ 加载画面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 追加 loading-dots / loading-progress 两组件（v7）、5 枚起点模板、镜头编辑卡第六族接线、e2e VID-022 闭环——P2 六题材收口。

**Architecture:** 沿 P2-①..⑤ 五族先例：video-scene 闭式纯函数组件（tMs 相位/爬升）+ 注册表 append bump v7；web 纯逻辑模板模块（标量草稿，沿 chart counter 先例）；shot-editor-card 第六族 optgroup 接线；e2e 克隆 e2e-sketch.mjs（A1 金标准 = sketch e2e 复跑）。

**Tech Stack:** TypeScript · node:test · React（仅接线）· Playwright（e2e）· ffmpeg signalstats。零新依赖。

**Spec:** `docs/superpowers/specs/2026-10-18-video-studio-loading-design.md`

## Global Constraints

- 零新依赖（无 rough.js/动画库；sin/easeOutCubic/clamp01 纯函数）。
- 注册表只追加：`defaultRegistry` v6→v7 一次覆盖两组件，数组按**追加序**排在 sketch-note 之后（**spec 勘误**：spec 中「数组按组件 id 字母序插在 line-chart 与 map-grid 之间」有误，实际数组是追加序——本提交随 plan 一并校正 spec 该句）。旧 spec 渲染路径零改动。
- 帧确定性：render 是 tMs 纯函数，禁墙钟/未播种随机/网络；同 spec 同帧双调 deepEqual。
- 规划器零改动（加载画面唯一入口 = 工作台模板下拉）。
- 模板时序预算：dots cycleMs ≤ 1200、progress progressMs ≤ 2000（模板测试逐枚钉死）。
- 错误消息中文带定位；非法编辑返回 `{spec:null,error}` 不落 patch（C1 语义）。
- 零 TTS 计费（e2e 台账行数不变）；媒体不入库（SHA-256 证据）；`info.txt` 等凭据永不入库。
- 每步命令在 worktree `D:/codex/animate/.claude/worktrees/video-studio-p0`（分支 `worktree-video-studio-p2`）内执行；commit 尾行 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- Biome：新文件 format 报错 `--write` 修后折入本任务提交（d7be40f/8385190 先例）。
- spec「字号 96 粗体」勘误：组件族零 font-weight 先例（bar/line/counter/map/flow/stick/sketch 均无），百分比文本以字号 96 实现重量，不引入 font-weight 属性——随本 plan 提交一并校正 spec。

## Review Focus

1. **相位弹跳纯函数边界**：`lift = max(0, sin(2π·((tMs/cycleMs)+i/N) % 1))`——负半周贴地 lift 恒 0（浮点负零安全）、相位 0.25 处 lift=1 峰值、错相 i/N、循环 `%1` 不发散、opacity 0.35..1 同相位联动。T1 dots 测试 2/3/6 钉死。
2. **弧与数字同步**：`e = easeOutCubic(clamp01(tMs/progressMs))`，弧 `frac = (target/100)·e` 与数字 `round(target·e)` 同缓动一致；p≥1 保持不再变；target=1/100 边界；dashoffset toFixed(4)。T1 progress 测试 2/4/5/6 钉死。
3. **标量草稿解析**：count/target 只认 ASCII 整数（regex `^[0-9]+$` 拒全角/小数/十六进制/空串——空串虽 Number("")=0 但被范围 3..6/1..100 拒绝，regex 先拒更明确）、label 按码点 1..12（astral 安全）。T2 测试 5 钉死。
4. **round-trip 与组件守卫**：dots↔count / progress↔target 回读稳定（另一字段空串）、非加载组件拒绝、合并保留 colors/cycleMs(或 progressMs)。T2 测试 3/4/6/7 钉死。
5. **apply 链 loading 接位**：loadingResult 必须接在 sketchResult 之后、buildRevisePatch 基底链 `loading ?? sketch ?? stick ?? flow ?? map ?? chart ?? base`——接错序静默丢加载数据。T3 无单测（接线层），e2e T4 导出断言（dots/label/targetPercent 逐字段）覆盖；typecheck + 全 web 套件守门。

---

### Task 1: loading-dots / loading-progress 组件 + 注册表 v7

**Files:**
- Create: `packages/video-scene/src/components/loading-dots.ts`
- Create: `packages/video-scene/src/components/loading-progress.ts`
- Test: `packages/video-scene/src/components/loading-dots.test.ts`
- Test: `packages/video-scene/src/components/loading-progress.test.ts`
- Modify: `packages/video-scene/src/default-registry.ts`
- Modify: `packages/video-scene/src/index.ts`

**Interfaces:**
- Consumes: `clamp01`/`easeOutCubic` from `../easing.js`；`fitFontSize` from `../text-width.js`；`SceneComponent`/`FrameContext`/`SceneSpecLike` from `../registry.js`；`SvgNode` from `../svg.js`。
- Produces: `export const loadingDots: SceneComponent`（componentId `"loading-dots"` version 1）；`export const loadingProgress: SceneComponent`（`"loading-progress"` version 1）；`defaultRegistry.version === 7`。Task 2/3 经 `@acs/video-scene` 的 `validateSceneSpec`/`defaultRegistry` 消费。

- [ ] **Step 1: 写失败测试（dots）**

`packages/video-scene/src/components/loading-dots.test.ts`（collect/specWith/makeCtx 沿 sketch-note.test.ts 同款私有惯例）：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { FrameContext } from "../registry.js";
import type { SvgNode } from "../svg.js";
import { loadingDots } from "./loading-dots.js";

function collect(node: SvgNode, tag: string, out: SvgNode[] = []): SvgNode[] {
  if (node.tag === tag) out.push(node);
  for (const child of node.children ?? []) collect(child, tag, out);
  return out;
}

const BASE = {
  title: "加载中",
  label: "请稍候",
  dots: 3,
  inkColor: "#2f2f2f",
  accentColor: "#e05a2b",
  cycleMs: 500,
};

function specWith(params: unknown) {
  return {
    componentId: "loading-dots",
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
  };
}

test("校验表：非法 params 逐条拒绝，合法返回原引用", () => {
  const cases: Array<[unknown, string]> = [
    ["nope", "loading-dots params 必须是对象"],
    [{ ...BASE, title: "a".repeat(41) }, "loading-dots params.title 必须是 ≤40 个字符"],
    [{ ...BASE, label: "" }, "loading-dots params.label 必须是 1..12 个字符"],
    [{ ...BASE, label: "一二三四五六七八九十甲乙丙" }, "loading-dots params.label 必须是 1..12 个字符"],
    [{ ...BASE, dots: 2 }, "loading-dots params.dots 必须是 3..6 的整数"],
    [{ ...BASE, dots: 7 }, "loading-dots params.dots 必须是 3..6 的整数"],
    [{ ...BASE, dots: 3.5 }, "loading-dots params.dots 必须是 3..6 的整数"],
    [{ ...BASE, cycleMs: 399 }, "loading-dots params.cycleMs 必须是 400..2000 的整数"],
    [{ ...BASE, cycleMs: 2001 }, "loading-dots params.cycleMs 必须是 400..2000 的整数"],
    [{ ...BASE, inkColor: "#fff" }, "loading-dots params.inkColor 必须是 #rrggbb"],
    [{ ...BASE, accentColor: "red" }, "loading-dots params.accentColor 必须是 #rrggbb"],
  ];
  for (const [params, message] of cases) {
    assert.throws(() => loadingDots.validateParams(params), { message });
  }
  const ok = { ...BASE };
  assert.equal(loadingDots.validateParams(ok), ok);
});

test("横排几何：N=3 圆心 408/500/592，相位 0.25 峰值跳起 90、负半周贴地", () => {
  // frame 3 @24fps → tMs 125；cycle 500 → dot0 相位 0.25（正弦峰值 lift=1）、
  // dot1/dot2 相位 0.5833/0.9167（负半周 → max(0,·)=0 贴地）
  const node = loadingDots.render(specWith(BASE) as never, makeCtx({ frame: 3 }));
  const circles = collect(node, "circle");
  assert.equal(circles.length, 3);
  assert.deepEqual(
    circles.map((c) => c.attrs?.cx),
    [408, 500, 592],
  );
  assert.deepEqual(
    circles.map((c) => c.attrs?.cy),
    [430, 520, 520],
  );
  assert.equal(circles[0]?.attrs?.r, 28);
  assert.equal(circles[0]?.attrs?.fill, "#e05a2b");
});

test("不透明度随相位：峰值 1、贴地 0.35", () => {
  const node = loadingDots.render(specWith(BASE) as never, makeCtx({ frame: 3 }));
  const circles = collect(node, "circle");
  assert.equal(circles[0]?.attrs?.opacity, 1);
  assert.equal(circles[1]?.attrs?.opacity, 0.35);
  assert.equal(circles[2]?.attrs?.opacity, 0.35);
});

test("标题 300ms 淡入：frame 0 全透明、tMs=300 全显", () => {
  const at = (frame: number) => {
    const node = loadingDots.render(specWith(BASE) as never, makeCtx({ frame }));
    return collect(node, "text").find((t) => t.text === "加载中")?.attrs
      ?.opacity;
  };
  assert.equal(at(0), 0);
  assert.equal(at(7.2), 1);
});

test("状态文案：(500,700) 居中，12 字自动缩排", () => {
  const long = { ...BASE, label: "正在加载十二字样例文案" };
  const node = loadingDots.render(specWith(long) as never, makeCtx({ frame: 3 }));
  const label = collect(node, "text").find((t) => t.text === long.label);
  assert.equal(label?.attrs?.x, 500);
  assert.equal(label?.attrs?.y, 700);
  assert.equal(label?.attrs?.["font-size"], 30);
  // fitFontSize(36, 12 字, 600)：emUnits=12 → 600/12=50 → min(36,50)=36？
  // 12 全角字符按 1em/码点 → 宽 12em > 600/36≈16.67em 需缩 → 600/12=50 → 仍 >36？
  // 见实现注：fitFontSize(base, text, max) = min(base, max/emUnits(text))，
  // emUnits=12 → min(36, 50) = 36。断言改为 36：
});

test("循环相位：dot0 在 tMs 625（一个整周期后）重回峰值", () => {
  // 625/500 = 1.25 → %1 = 0.25 → lift=1（循环成立，非一次性动画）
  const node = loadingDots.render(specWith(BASE) as never, makeCtx({ frame: 15 }));
  const circles = collect(node, "circle");
  assert.equal(circles[0]?.attrs?.cy, 430);
});

test("label 按码点计数：emoji 2 码点合法且渲染不劈半", () => {
  const emoji = { ...BASE, label: "😀😀" };
  assert.equal(loadingDots.validateParams(emoji), emoji);
  const node = loadingDots.render(specWith(emoji) as never, makeCtx({ frame: 3 }));
  const label = collect(node, "text").find((t) => t.text === "😀😀");
  assert.ok(label);
});

test("结构：背景 rect 首子元素 + svg viewBox 0 0 1000 1000", () => {
  const node = loadingDots.render(specWith(BASE) as never, makeCtx({ frame: 3 }));
  const root = node.children ?? [];
  assert.equal(root[0]?.tag, "rect");
  assert.equal(root[0]?.attrs?.fill, "#ffffff");
  assert.equal(root[1]?.tag, "svg");
  assert.equal(root[1]?.attrs?.viewBox, "0 0 1000 1000");
});

test("帧确定性：同 spec 同帧双调 deepEqual（分数帧）", () => {
  const a = loadingDots.render(specWith(BASE) as never, makeCtx({ frame: 17.28 }));
  const b = loadingDots.render(specWith(BASE) as never, makeCtx({ frame: 17.28 }));
  assert.deepEqual(a, b);
});
```

**注意**：测试 5（状态文案缩排）的 font-size 断言以 `fitFontSize` 实际语义为准——写测试时先读 `packages/video-scene/src/text-width.ts` 的 `fitFontSize` 实现，按公式 `min(base, max/emUnits)` 重算 12 字的期望值（注释里的两行推演如有出入以实现公式为准，把断言与推演写一致）。**推演写进测试注释，断言值用公式值。**

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @acs/video-scene test`
Expected: FAIL——`Cannot find module './loading-dots.js'`（TS2307 级别模块缺失，两文件全红）。

- [ ] **Step 3: 写失败测试（progress）**

`packages/video-scene/src/components/loading-progress.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { FrameContext } from "../registry.js";
import type { SvgNode } from "../svg.js";
import { loadingProgress } from "./loading-progress.js";

function collect(node: SvgNode, tag: string, out: SvgNode[] = []): SvgNode[] {
  if (node.tag === tag) out.push(node);
  for (const child of node.children ?? []) collect(child, tag, out);
  return out;
}

const BASE = {
  title: "进度",
  label: "加载资料",
  targetPercent: 80,
  inkColor: "#2f2f2f",
  accentColor: "#e05a2b",
  progressMs: 1000,
};

function specWith(params: unknown) {
  return {
    componentId: "loading-progress",
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
  };
}

test("校验表：非法 params 逐条拒绝，合法返回原引用", () => {
  const cases: Array<[unknown, string]> = [
    ["nope", "loading-progress params 必须是对象"],
    [{ ...BASE, title: "a".repeat(41) }, "loading-progress params.title 必须是 ≤40 个字符"],
    [{ ...BASE, label: "" }, "loading-progress params.label 必须是 1..12 个字符"],
    [{ ...BASE, targetPercent: 0 }, "loading-progress params.targetPercent 必须是 1..100 的整数"],
    [{ ...BASE, targetPercent: 101 }, "loading-progress params.targetPercent 必须是 1..100 的整数"],
    [{ ...BASE, targetPercent: 72.5 }, "loading-progress params.targetPercent 必须是 1..100 的整数"],
    [{ ...BASE, progressMs: 399 }, "loading-progress params.progressMs 必须是 400..2000 的整数"],
    [{ ...BASE, progressMs: 2001 }, "loading-progress params.progressMs 必须是 400..2000 的整数"],
    [{ ...BASE, inkColor: "#12345" }, "loading-progress params.inkColor 必须是 #rrggbb"],
    [{ ...BASE, accentColor: "orange" }, "loading-progress params.accentColor 必须是 #rrggbb"],
  ];
  for (const [params, message] of cases) {
    assert.throws(() => loadingProgress.validateParams(params), { message });
  }
  const ok = { ...BASE };
  assert.equal(loadingProgress.validateParams(ok), ok);
});

test("中途弧与数字同步：tMs 250 → e=0.578125、dashoffset 0.5375、percent 46%", () => {
  // frame 6 @24fps → tMs 250；e = 1−0.75³ = 0.578125（二进制精确）；
  // frac = 0.8×0.578125 = 0.4625；percent = round(80×0.578125) = round(46.25) = 46
  const node = loadingProgress.render(specWith(BASE) as never, makeCtx({ frame: 6 }));
  const circles = collect(node, "circle");
  const arc = circles.find((c) => c.attrs?.["stroke-dashoffset"] !== undefined);
  assert.equal(arc?.attrs?.["stroke-dashoffset"], 0.5375);
  const percent = collect(node, "text").find((t) => t.text?.endsWith("%"));
  assert.equal(percent?.text, "46%");
});

test("p=0：dashoffset 1、percent 0%、轨道全圆", () => {
  const node = loadingProgress.render(specWith(BASE) as never, makeCtx({ frame: 0 }));
  const circles = collect(node, "circle");
  const track = circles.find((c) => c.attrs?.opacity === 0.12);
  assert.ok(track);
  const arc = circles.find((c) => c.attrs?.["stroke-dashoffset"] !== undefined);
  assert.equal(arc?.attrs?.["stroke-dashoffset"], 1);
  const percent = collect(node, "text").find((t) => t.text?.endsWith("%"));
  assert.equal(percent?.text, "0%");
});

test("p≥1 保持：tMs 2000 后弧与数字停在目标不再变", () => {
  const at = (frame: number) => {
    const node = loadingProgress.render(specWith(BASE) as never, makeCtx({ frame }));
    const arc = collect(node, "circle").find(
      (c) => c.attrs?.["stroke-dashoffset"] !== undefined,
    );
    const percent = collect(node, "text").find((t) => t.text?.endsWith("%"));
    return [arc?.attrs?.["stroke-dashoffset"], percent?.text];
  };
  assert.deepEqual(at(48), [0.2, "80%"]);
  assert.deepEqual(at(60), [0.2, "80%"]);
});

test("target=100 完成态：dashoffset 0、percent 100%", () => {
  const full = { ...BASE, targetPercent: 100 };
  const node = loadingProgress.render(specWith(full) as never, makeCtx({ frame: 48 }));
  const arc = collect(node, "circle").find(
    (c) => c.attrs?.["stroke-dashoffset"] !== undefined,
  );
  assert.equal(arc?.attrs?.["stroke-dashoffset"], 0);
  assert.equal(
    collect(node, "text").find((t) => t.text?.endsWith("%"))?.text,
    "100%",
  );
});

test("target=1 边界：结束 percent 1%、dashoffset 0.99", () => {
  const tiny = { ...BASE, targetPercent: 1 };
  const node = loadingProgress.render(specWith(tiny) as never, makeCtx({ frame: 48 }));
  const arc = collect(node, "circle").find(
    (c) => c.attrs?.["stroke-dashoffset"] !== undefined,
  );
  assert.equal(arc?.attrs?.["stroke-dashoffset"], 0.99);
  assert.equal(
    collect(node, "text").find((t) => t.text?.endsWith("%"))?.text,
    "1%",
  );
});

test("环几何：r 180 stroke 22、rotate(-90 500 520) 自 12 点、accent 圆头", () => {
  const node = loadingProgress.render(specWith(BASE) as never, makeCtx({ frame: 6 }));
  const arc = collect(node, "circle").find(
    (c) => c.attrs?.["stroke-dashoffset"] !== undefined,
  );
  assert.equal(arc?.attrs?.r, 180);
  assert.equal(arc?.attrs?.["stroke-width"], 22);
  assert.equal(arc?.attrs?.stroke, "#e05a2b");
  assert.equal(arc?.attrs?.["stroke-linecap"], "round");
  assert.equal(arc?.attrs?.pathLength, 1);
  assert.equal(arc?.attrs?.transform, "rotate(-90 500 520)");
});

test("百分比文本：环心 (500,520) 字号 96；label (500,780)", () => {
  const node = loadingProgress.render(specWith(BASE) as never, makeCtx({ frame: 6 }));
  const percent = collect(node, "text").find((t) => t.text?.endsWith("%"));
  assert.equal(percent?.attrs?.x, 500);
  assert.equal(percent?.attrs?.y, 520);
  assert.equal(percent?.attrs?.["font-size"], 96);
  assert.equal(percent?.attrs?.fill, "#2f2f2f");
  const label = collect(node, "text").find((t) => t.text === "加载资料");
  assert.equal(label?.attrs?.y, 780);
});

test("帧确定性：同 spec 同帧双调 deepEqual（分数帧）", () => {
  const a = loadingProgress.render(specWith(BASE) as never, makeCtx({ frame: 17.28 }));
  const b = loadingProgress.render(specWith(BASE) as never, makeCtx({ frame: 17.28 }));
  assert.deepEqual(a, b);
});
```

- [ ] **Step 4: 跑测试确认失败**

Run: `pnpm --filter @acs/video-scene test`
Expected: FAIL——`Cannot find module './loading-progress.js'`（dots 同样缺失）。

- [ ] **Step 5: 实现 loading-dots**

`packages/video-scene/src/components/loading-dots.ts`：

```ts
import { clamp01 } from "../easing.js";
import type {
  FrameContext,
  SceneComponent,
  SceneSpecLike,
} from "../registry.js";
import type { SvgNode } from "../svg.js";
import { fitFontSize } from "../text-width.js";

// 加载等待 v1：闭式相位弹跳——点 i 相位 ((tMs/cycleMs)+i/N)%1，正半周跳起
// （lift = max(0, sin(2π·phase))，yOff = −AMP·lift），负半周贴地休息；不透
// 明度 0.35..1 随同一 lift 联动。循环动画，任意帧非空。render 纯函数：
// 禁墙钟/未播种随机/网络。

type LoadingDotsParams = {
  title: string;
  label: string;
  dots: number; // 3..6
  inkColor: string;
  accentColor: string;
  cycleMs: number; // 400..2000
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DESIGN_SPACE = 1000;
const TITLE_FADE_MS = 300;
const DOT_R = 28;
const DOT_PITCH = 92; // 2·DOT_R + GAP 36
const BASE_Y = 520;
const AMP = 90;
const REST_OPACITY = 0.35;
const LABEL_FONT = 36;
const LABEL_MAX_WIDTH = 600;
const LABEL_Y = 700;
const MIN_DOTS = 3;
const MAX_DOTS = 6;
const MAX_LABEL = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function validateParams(value: unknown): LoadingDotsParams {
  if (!isRecord(value)) throw new Error("loading-dots params 必须是对象");
  if (typeof value.title !== "string" || value.title.length > 40) {
    throw new Error("loading-dots params.title 必须是 ≤40 个字符");
  }
  // 与 render 同口径：按码点计数（emoji 不劈半）
  const labelChars =
    typeof value.label === "string" ? Array.from(value.label) : [];
  if (labelChars.length < 1 || labelChars.length > MAX_LABEL) {
    throw new Error(`loading-dots params.label 必须是 1..${MAX_LABEL} 个字符`);
  }
  if (
    !Number.isInteger(value.dots) ||
    (value.dots as number) < MIN_DOTS ||
    (value.dots as number) > MAX_DOTS
  ) {
    throw new Error(
      `loading-dots params.dots 必须是 ${MIN_DOTS}..${MAX_DOTS} 的整数`,
    );
  }
  for (const key of ["inkColor", "accentColor"] as const) {
    if (!isHexColor(value[key])) {
      throw new Error(`loading-dots params.${key} 必须是 #rrggbb`);
    }
  }
  if (
    !Number.isInteger(value.cycleMs) ||
    (value.cycleMs as number) < 400 ||
    (value.cycleMs as number) > 2000
  ) {
    throw new Error("loading-dots params.cycleMs 必须是 400..2000 的整数");
  }
  return value as LoadingDotsParams;
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const params = spec.params as LoadingDotsParams;
  const tMs = (ctx.frame / ctx.fps) * 1000;

  const n = params.dots;
  const totalWidth = 2 * DOT_R + (n - 1) * DOT_PITCH;
  const left = 500 - totalWidth / 2;
  const dotNodes: SvgNode[] = [];
  for (let i = 0; i < n; i += 1) {
    const phase = (tMs / params.cycleMs + i / n) % 1;
    const lift = Math.max(0, Math.sin(2 * Math.PI * phase));
    dotNodes.push({
      tag: "circle",
      attrs: {
        cx: left + DOT_R + i * DOT_PITCH,
        cy: BASE_Y - AMP * lift,
        r: DOT_R,
        fill: params.accentColor,
        opacity: Number(
          (REST_OPACITY + (1 - REST_OPACITY) * lift).toFixed(4),
        ),
      },
    });
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
              fill: params.inkColor,
              "text-anchor": "middle",
              "dominant-baseline": "middle",
              opacity: clamp01(tMs / TITLE_FADE_MS),
            },
            text: params.title,
          },
          ...dotNodes,
          {
            tag: "text",
            attrs: {
              x: 500,
              y: LABEL_Y,
              "font-size": fitFontSize(LABEL_FONT, params.label, LABEL_MAX_WIDTH),
              fill: params.inkColor,
              "text-anchor": "middle",
              "dominant-baseline": "middle",
            },
            text: params.label,
          },
        ],
      },
    ],
  };
}

export const loadingDots: SceneComponent = {
  componentId: "loading-dots",
  version: 1,
  validateParams,
  render,
};
```

- [ ] **Step 6: 实现 loading-progress**

`packages/video-scene/src/components/loading-progress.ts`：

```ts
import { clamp01, easeOutCubic } from "../easing.js";
import type {
  FrameContext,
  SceneComponent,
  SceneSpecLike,
} from "../registry.js";
import type { SvgNode } from "../svg.js";
import { fitFontSize } from "../text-width.js";

// 加载进度环 v1：闭式弧长爬升——e = easeOutCubic(clamp01(tMs/progressMs))，
// 弧占比 frac = (targetPercent/100)·e（pathLength=1 + dasharray 1 +
// dashoffset 1−frac，沿 line-drawing 口径；rotate(-90) 自 12 点顺时针），
// 中心百分比 round(targetPercent·e)% 与弧同缓动同步，p≥1 保持。
// render 纯函数：禁墙钟/未播种随机/网络。

type LoadingProgressParams = {
  title: string;
  label: string;
  targetPercent: number; // 1..100
  inkColor: string;
  accentColor: string;
  progressMs: number; // 400..2000
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DESIGN_SPACE = 1000;
const TITLE_FADE_MS = 300;
const RING_R = 180;
const RING_STROKE = 22;
const TRACK_OPACITY = 0.12;
const PERCENT_FONT = 96;
const LABEL_FONT = 36;
const LABEL_MAX_WIDTH = 600;
const LABEL_Y = 780;
const MAX_LABEL = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function validateParams(value: unknown): LoadingProgressParams {
  if (!isRecord(value)) {
    throw new Error("loading-progress params 必须是对象");
  }
  if (typeof value.title !== "string" || value.title.length > 40) {
    throw new Error("loading-progress params.title 必须是 ≤40 个字符");
  }
  const labelChars =
    typeof value.label === "string" ? Array.from(value.label) : [];
  if (labelChars.length < 1 || labelChars.length > MAX_LABEL) {
    throw new Error(
      `loading-progress params.label 必须是 1..${MAX_LABEL} 个字符`,
    );
  }
  if (
    !Number.isInteger(value.targetPercent) ||
    (value.targetPercent as number) < 1 ||
    (value.targetPercent as number) > 100
  ) {
    throw new Error(
      "loading-progress params.targetPercent 必须是 1..100 的整数",
    );
  }
  for (const key of ["inkColor", "accentColor"] as const) {
    if (!isHexColor(value[key])) {
      throw new Error(`loading-progress params.${key} 必须是 #rrggbb`);
    }
  }
  if (
    !Number.isInteger(value.progressMs) ||
    (value.progressMs as number) < 400 ||
    (value.progressMs as number) > 2000
  ) {
    throw new Error("loading-progress params.progressMs 必须是 400..2000 的整数");
  }
  return value as LoadingProgressParams;
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const params = spec.params as LoadingProgressParams;
  const tMs = (ctx.frame / ctx.fps) * 1000;
  const e = easeOutCubic(clamp01(tMs / params.progressMs));
  const frac = (params.targetPercent / 100) * e;
  const percent = Math.round(params.targetPercent * e);

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
              fill: params.inkColor,
              "text-anchor": "middle",
              "dominant-baseline": "middle",
              opacity: clamp01(tMs / TITLE_FADE_MS),
            },
            text: params.title,
          },
          {
            tag: "circle",
            attrs: {
              cx: 500,
              cy: 520,
              r: RING_R,
              fill: "none",
              stroke: params.inkColor,
              "stroke-width": RING_STROKE,
              opacity: TRACK_OPACITY,
            },
          },
          {
            tag: "circle",
            attrs: {
              cx: 500,
              cy: 520,
              r: RING_R,
              fill: "none",
              stroke: params.accentColor,
              "stroke-width": RING_STROKE,
              "stroke-linecap": "round",
              pathLength: 1,
              "stroke-dasharray": 1,
              "stroke-dashoffset": Number((1 - frac).toFixed(4)),
              transform: "rotate(-90 500 520)",
            },
          },
          {
            tag: "text",
            attrs: {
              x: 500,
              y: 520,
              "font-size": PERCENT_FONT,
              fill: params.inkColor,
              "text-anchor": "middle",
              "dominant-baseline": "middle",
            },
            text: `${percent}%`,
          },
          {
            tag: "text",
            attrs: {
              x: 500,
              y: LABEL_Y,
              "font-size": fitFontSize(LABEL_FONT, params.label, LABEL_MAX_WIDTH),
              fill: params.inkColor,
              "text-anchor": "middle",
              "dominant-baseline": "middle",
            },
            text: params.label,
          },
        ],
      },
    ],
  };
}

export const loadingProgress: SceneComponent = {
  componentId: "loading-progress",
  version: 1,
  validateParams,
  render,
};
```

- [ ] **Step 7: 跑两组件测试确认通过**

Run: `pnpm --filter @acs/video-scene test`
Expected: 既有 113 + 新 18 = **131 全绿**（若 Step 1 测试 5 的 font-size 断言与 fitFontSize 公式不符，按 Step 1 注意事项以公式值修正断言——修正的是测试推演注释与断言的一致性，不是放宽断言）。

- [ ] **Step 8: 注册表 v7 + index 导出**

`packages/video-scene/src/default-registry.ts`——import 块按模块路径字母序插在 `line-drawing` 与 `map-grid` 之间：

```ts
import { loadingDots } from "./components/loading-dots.js";
import { loadingProgress } from "./components/loading-progress.js";
```

注释块末尾（v6 行之后）加一行：

```ts
// v7（P2-⑥ 加载）：追加 loading-dots / loading-progress，同一分支内原子落地。
```

数组末尾（`sketchNote,` 之后）追加 `loadingDots,` `loadingProgress,`（**追加序**，见 Global Constraints spec 勘误）；`createRegistry(…, 6)` → `createRegistry(…, 7)`。

`packages/video-scene/src/index.ts`——在 `export * from "./components/line-drawing.js";` 之后插：

```ts
export { loadingDots } from "./components/loading-dots.js";
export { loadingProgress } from "./components/loading-progress.js";
```

- [ ] **Step 9: 全套件 + 注册表断言**

Run: `pnpm --filter @acs/video-scene test`
Expected: 131/131 全绿（含既有 default-registry 版本测试随 v7 更新——若存在钉版本的测试，按其既有写法同步到 7）。

- [ ] **Step 10: Commit**

```bash
git add packages/video-scene/src/components/loading-dots.ts packages/video-scene/src/components/loading-dots.test.ts packages/video-scene/src/components/loading-progress.ts packages/video-scene/src/components/loading-progress.test.ts packages/video-scene/src/default-registry.ts packages/video-scene/src/index.ts
git commit -m "feat(video-scene): loading-dots/loading-progress 加载组件（相位弹跳+弧长爬升）与注册表 v7

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: loading-templates 起点模板与标量数据编辑

**Files:**
- Create: `apps/web/src/app/video-studio/loading-templates.ts`
- Test: `apps/web/src/app/video-studio/loading-templates.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `defaultRegistry`（v7，含两组件）与 `validateSceneSpec`；`SceneSpec` type。
- Produces: `LOADING_TEMPLATES`（5 枚）、`LoadingTemplate` type、`isLoadingComponentId(componentId)`、`applyLoadingTemplate(spec, templateId)`、`LoadingEditDraft { title, label, count, target }`、`draftLoadingFromSpec(spec)`、`buildLoadingRevisePatch(spec, draft)`。Task 3 接线消费全部导出。

- [ ] **Step 1: 写失败测试**

`apps/web/src/app/video-studio/loading-templates.test.ts`（SceneSpec.params 为 unknown 类型——访问一律 `as` 断言，沿 sketch-templates.test.ts 惯例）：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLoadingTemplate,
  buildLoadingRevisePatch,
  draftLoadingFromSpec,
  isLoadingComponentId,
  LOADING_TEMPLATES,
  type LoadingEditDraft,
} from "./loading-templates";
import type { SceneSpec } from "@acs/video-scene";

function baseSpec(): SceneSpec {
  return {
    componentId: "text-animation",
    componentVersion: 1,
    params: {},
    seed: 7,
    background: "#f7f5f2",
    durationMs: 2000,
  };
}

test("5 枚模板全部过 validateSceneSpec 且预算不变量成立（cycle ≤1200 / progress ≤2000）", () => {
  for (const template of LOADING_TEMPLATES) {
    const applied = applyLoadingTemplate(baseSpec(), template.templateId);
    assert.equal(applied.error, null, template.templateId);
    assert.ok(applied.spec);
    const params = applied.spec!.params as Record<string, unknown>;
    if (template.componentId === "loading-dots") {
      assert.ok((params.cycleMs as number) <= 1200, template.templateId);
    } else {
      assert.ok((params.progressMs as number) <= 2000, template.templateId);
    }
  }
});

test("未知 templateId 报错；structuredClone 隔离两次应用", () => {
  const bad = applyLoadingTemplate(baseSpec(), "loading-nope");
  assert.equal(bad.spec, null);
  assert.equal(bad.error, "未知加载模板 loading-nope");
  const a = applyLoadingTemplate(baseSpec(), "loading-dots-3");
  const b = applyLoadingTemplate(baseSpec(), "loading-dots-3");
  assert.ok(a.spec && b.spec);
  assert.notEqual(a.spec!.params, b.spec!.params);
  (a.spec!.params as { dots: number }).dots = 6;
  assert.equal((b.spec!.params as { dots: number }).dots, 3);
});

test("round-trip：dots ↔ count、progress ↔ target，另一字段空串", () => {
  const dotsSpec = applyLoadingTemplate(baseSpec(), "loading-dots-3").spec!;
  assert.deepEqual(draftLoadingFromSpec(dotsSpec), {
    title: "加载等待",
    label: "加载中",
    count: "3",
    target: "",
  } satisfies LoadingEditDraft);
  const ringSpec = applyLoadingTemplate(baseSpec(), "loading-ring-72").spec!;
  assert.deepEqual(draftLoadingFromSpec(ringSpec), {
    title: "加载进度",
    label: "加载资料",
    count: "",
    target: "72",
  } satisfies LoadingEditDraft);
});

test("buildLoadingRevisePatch：dots 改 count/label、progress 改 target/label 落 params", () => {
  const dotsSpec = applyLoadingTemplate(baseSpec(), "loading-dots-3").spec!;
  const dotsNext = buildLoadingRevisePatch(dotsSpec, {
    title: "等待画面",
    label: "正在加载",
    count: "4",
    target: "",
  });
  assert.equal(dotsNext.error, null);
  const dotsParams = dotsNext.spec!.params as Record<string, unknown>;
  assert.equal(dotsParams.dots, 4);
  assert.equal(dotsParams.label, "正在加载");
  assert.equal(dotsParams.title, "等待画面");
  // 合并保留：colors/cycleMs 不被编辑丢弃
  assert.equal(dotsParams.cycleMs, 720);
  assert.equal(dotsParams.accentColor, "#e05a2b");

  const ringSpec = applyLoadingTemplate(baseSpec(), "loading-ring-72").spec!;
  const ringNext = buildLoadingRevisePatch(ringSpec, {
    title: "加载进度",
    label: "同步数据",
    count: "",
    target: "85",
  });
  assert.equal(ringNext.error, null);
  const ringParams = ringNext.spec!.params as Record<string, unknown>;
  assert.equal(ringParams.targetPercent, 85);
  assert.equal(ringParams.label, "同步数据");
  assert.equal(ringParams.progressMs, 1600);
});

test("解析错误表：label 空/超长、count/target 非法——行内错误不落 patch", () => {
  const dotsSpec = applyLoadingTemplate(baseSpec(), "loading-dots-3").spec!;
  const ringSpec = applyLoadingTemplate(baseSpec(), "loading-ring-72").spec!;
  const cases: Array<[SceneSpec, LoadingEditDraft, string]> = [
    [dotsSpec, { title: "t", label: "", count: "3", target: "" }, "状态文案必须是 1..12 个字符"],
    [dotsSpec, { title: "t", label: "一二三四五六七八九十甲乙丙", count: "3", target: "" }, "状态文案必须是 1..12 个字符"],
    [dotsSpec, { title: "t", label: "加载中", count: "", target: "" }, "点数必须是 3..6 的整数"],
    [dotsSpec, { title: "t", label: "加载中", count: "7", target: "" }, "点数必须是 3..6 的整数"],
    [dotsSpec, { title: "t", label: "加载中", count: "4.5", target: "" }, "点数必须是 3..6 的整数"],
    [dotsSpec, { title: "t", label: "加载中", count: "４", target: "" }, "点数必须是 3..6 的整数"],
    [ringSpec, { title: "t", label: "加载中", count: "", target: "" }, "目标百分比必须是 1..100 的整数"],
    [ringSpec, { title: "t", label: "加载中", count: "", target: "0" }, "目标百分比必须是 1..100 的整数"],
    [ringSpec, { title: "t", label: "加载中", count: "", target: "101" }, "目标百分比必须是 1..100 的整数"],
    [ringSpec, { title: "t", label: "加载中", count: "", target: "8x" }, "目标百分比必须是 1..100 的整数"],
  ];
  for (const [spec, draft, message] of cases) {
    const result = buildLoadingRevisePatch(spec, draft);
    assert.equal(result.spec, null, message);
    assert.equal(result.error, message);
  }
});

test("非加载组件拒绝", () => {
  const result = buildLoadingRevisePatch(baseSpec(), {
    title: "t",
    label: "加载中",
    count: "3",
    target: "",
  });
  assert.equal(result.spec, null);
  assert.equal(result.error, "当前镜头组件不是加载组件");
});

test("title 边界：41 字被 validateSceneSpec 拒（组件消息透传）", () => {
  const dotsSpec = applyLoadingTemplate(baseSpec(), "loading-dots-3").spec!;
  const result = buildLoadingRevisePatch(dotsSpec, {
    title: "a".repeat(41),
    label: "加载中",
    count: "3",
    target: "",
  });
  assert.equal(result.spec, null);
  assert.ok(result.error!.includes("title"));
});

test("isLoadingComponentId：两组件 id 命中、其余不命中", () => {
  assert.ok(isLoadingComponentId("loading-dots"));
  assert.ok(isLoadingComponentId("loading-progress"));
  assert.ok(!isLoadingComponentId("sketch-note"));
  assert.ok(!isLoadingComponentId("bar-chart"));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @acs/web test`
Expected: FAIL——`Cannot find module './loading-templates'`（文件级 not ok）。

- [ ] **Step 3: 实现 loading-templates**

`apps/web/src/app/video-studio/loading-templates.ts`：

```ts
// P2-⑥ 加载：起点模板与标量数据编辑纯逻辑（沿 chart-templates 的 counter
// 先例用标量输入而非多行 textarea）。模板参数过 validateSceneSpec 兜底；
// 非法数据行内报错、不落 patch（C1 语义）。

import {
  defaultRegistry,
  type SceneSpec,
  validateSceneSpec,
} from "@acs/video-scene";

export type LoadingTemplate = {
  templateId: string;
  componentId: "loading-dots" | "loading-progress";
  label: string;
  params: Record<string, unknown>;
};

const LOADING_COLORS = {
  inkColor: "#2f2f2f",
  accentColor: "#e05a2b",
};

export const LOADING_TEMPLATES: LoadingTemplate[] = [
  {
    templateId: "loading-dots-3",
    componentId: "loading-dots",
    label: "三点等待",
    params: {
      title: "加载等待",
      label: "加载中",
      dots: 3,
      ...LOADING_COLORS,
      cycleMs: 720,
    },
  },
  {
    templateId: "loading-dots-5",
    componentId: "loading-dots",
    label: "五点序列",
    params: {
      title: "处理进行中",
      label: "正在处理",
      dots: 5,
      ...LOADING_COLORS,
      cycleMs: 960,
    },
  },
  {
    templateId: "loading-ring-full",
    componentId: "loading-progress",
    label: "进度环·完成",
    params: {
      title: "加载完成",
      label: "数据就绪",
      targetPercent: 100,
      ...LOADING_COLORS,
      progressMs: 1600,
    },
  },
  {
    templateId: "loading-ring-72",
    componentId: "loading-progress",
    label: "进度环·进行中",
    params: {
      title: "加载进度",
      label: "加载资料",
      targetPercent: 72,
      ...LOADING_COLORS,
      progressMs: 1600,
    },
  },
  {
    templateId: "loading-ring-30",
    componentId: "loading-progress",
    label: "进度环·起步",
    params: {
      title: "开始加载",
      label: "正在启动",
      targetPercent: 30,
      ...LOADING_COLORS,
      progressMs: 1200,
    },
  },
];

export function isLoadingComponentId(componentId: string): boolean {
  return componentId === "loading-dots" || componentId === "loading-progress";
}

export function applyLoadingTemplate(
  spec: SceneSpec,
  templateId: string,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  const template = LOADING_TEMPLATES.find((t) => t.templateId === templateId);
  if (!template) return { spec: null, error: `未知加载模板 ${templateId}` };
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

export type LoadingEditDraft = {
  title: string;
  label: string;
  // dots 组件的 点数（3..6）/ progress 组件的 目标百分比（1..100）——
  // 表单字符串，应用时解析；不适用侧保持空串
  count: string;
  target: string;
};

export function draftLoadingFromSpec(spec: SceneSpec): LoadingEditDraft {
  const params = spec.params as {
    title?: string;
    label?: string;
    dots?: number;
    targetPercent?: number;
  };
  return {
    title: params.title ?? "",
    label: params.label ?? "",
    count:
      spec.componentId === "loading-dots" ? String(params.dots ?? "") : "",
    target:
      spec.componentId === "loading-progress"
        ? String(params.targetPercent ?? "")
        : "",
  };
}

const MAX_LABEL = 12;
const ASCII_INT = /^[0-9]+$/;

// 只认 ASCII 整数字面量：拒全角数字/小数/十六进制/空串（Number("")=0 陷阱
// 由 regex 先拦，范围再兜底）
function parseIntField(value: string): number | null {
  const trimmed = value.trim();
  if (!ASCII_INT.test(trimmed)) return null;
  return Number(trimmed);
}

export function buildLoadingRevisePatch(
  spec: SceneSpec,
  draft: LoadingEditDraft,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  if (!isLoadingComponentId(spec.componentId)) {
    return { spec: null, error: "当前镜头组件不是加载组件" };
  }
  const labelChars = Array.from(draft.label.trim());
  if (labelChars.length < 1 || labelChars.length > MAX_LABEL) {
    return { spec: null, error: `状态文案必须是 1..${MAX_LABEL} 个字符` };
  }
  const params: Record<string, unknown> = {
    ...(spec.params as Record<string, unknown>),
    title: draft.title,
    label: labelChars.join(""),
  };
  if (spec.componentId === "loading-dots") {
    const dots = parseIntField(draft.count);
    if (dots === null || dots < 3 || dots > 6) {
      return { spec: null, error: "点数必须是 3..6 的整数" };
    }
    params.dots = dots;
  } else {
    const target = parseIntField(draft.target);
    if (target === null || target < 1 || target > 100) {
      return { spec: null, error: "目标百分比必须是 1..100 的整数" };
    }
    params.targetPercent = target;
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
Expected: 116 + 8 = **124 全绿**。

- [ ] **Step 5: typecheck + biome**

Run: `pnpm --filter @acs/web typecheck` → 0 错；`pnpm exec biome check apps/web/src/app/video-studio/loading-templates.ts apps/web/src/app/video-studio/loading-templates.test.ts` → 0 error（format 报错 `--write` 修，折入提交）。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/video-studio/loading-templates.ts apps/web/src/app/video-studio/loading-templates.test.ts
git commit -m "feat(video-studio): loading-templates 五枚起点模板与标量数据编辑

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: 镜头编辑卡接入手绘同款第六族（加载）

**Files:**
- Modify: `apps/web/src/app/video-studio/shot-editor-card.tsx`（12 处）
- Modify: `apps/web/src/app/video-studio/video-studio.css`（1 块）

**Interfaces:**
- Consumes: Task 2 全部导出；既有五族接线结构（state/effect/reset/prefill/apply 链）。
- Produces: 第六族 optgroup「加载」+ `.loading-title-input` / `.loading-label-input` / `.loading-count-input` / `.loading-target-input` / `.loading-edit-error`（Task 4 e2e 选择器依赖）。baseSpec 应用链 `loading ?? sketch ?? stick ?? flow ?? map ?? chart ?? base`。

- [ ] **Step 1: 12 处接线编辑（先做全部编辑，再跑既有套件确认零回归——接线层无新单测，与五族先例一致）**

1. **import 块**（模块路径字母序，插在 `./flow-templates` 与 `./map-templates` 之间）：

```tsx
import {
  applyLoadingTemplate,
  buildLoadingRevisePatch,
  draftLoadingFromSpec,
  isLoadingComponentId,
  LOADING_TEMPLATES,
  type LoadingEditDraft,
} from "./loading-templates";
```

2. **文件头注释**（58 行附近）：纯逻辑清单补 `loading-templates.ts`（`… sketch-templates.ts / loading-templates.ts 纯逻辑，非法草稿不回调`）。

3. **EMPTY 常量**（`EMPTY_SKETCH_DRAFT` 之后）：

```tsx
const EMPTY_LOADING_DRAFT: LoadingEditDraft = {
  title: "",
  label: "",
  count: "",
  target: "",
};
```

4. **resolveAnyTemplate**（91-93 行 sketch 步之后、error return 之前加 loading 步；77-78 行注释「五族」→「六族」，解析顺序描述补加载）：

```tsx
  const loading = applyLoadingTemplate(spec, templateId);
  if (loading.spec) return { spec: loading.spec, error: null };
```

5. **state**（`sketchError` useState 之后）：

```tsx
  const [loadingDraft, setLoadingDraft] = useState<LoadingEditDraft>(() =>
    spec && isLoadingComponentId(spec.componentId)
      ? draftLoadingFromSpec(spec)
      : EMPTY_LOADING_DRAFT,
  );
  const [loadingError, setLoadingError] = useState<string | null>(null);
```

6. **effect 重置**（`setSketchDraft(...)` 之后、eslint 注释行之前）：

```tsx
    setLoadingError(null);
    setLoadingDraft(
      nextSpec && isLoadingComponentId(nextSpec.componentId)
        ? draftLoadingFromSpec(nextSpec)
        : EMPTY_LOADING_DRAFT,
    );
```

7. **onChange 模板选中**：错误清理列表（393-394 行 `setSketchError(null)` 之后）加 `setLoadingError(null);`；预填 else-if 链（410-412 行 sketch 分支之后）加：

```tsx
                } else if (isLoadingComponentId(applied.spec.componentId)) {
                  setLoadingDraft(draftLoadingFromSpec(applied.spec));
```

8. **下拉 label**（383 行）：`组件模板（图表 / 地图 / 流程 / 火柴人 / 手绘）` → `组件模板（图表 / 地图 / 流程 / 火柴人 / 手绘 / 加载）`。

9. **optgroup**（450 行「手绘」组之后）：

```tsx
              <optgroup label="加载">
                {LOADING_TEMPLATES.map((template) => (
                  <option key={template.templateId} value={template.templateId}>
                    {template.label}
                  </option>
                ))}
              </optgroup>
```

10. **编辑字段 JSX**（655 行 sketch 块 `) : null}` 之后）：

```tsx
          {isLoadingComponentId(spec.componentId) ? (
            <>
              <label className="shot-edit-field">
                加载标题
                <input
                  className="loading-title-input"
                  maxLength={40}
                  value={loadingDraft.title}
                  onChange={(event) =>
                    setLoadingDraft({
                      ...loadingDraft,
                      title: event.target.value,
                    })
                  }
                />
              </label>
              <label className="shot-edit-field">
                状态文案（1..12 字）
                <input
                  className="loading-label-input"
                  maxLength={12}
                  value={loadingDraft.label}
                  onChange={(event) =>
                    setLoadingDraft({
                      ...loadingDraft,
                      label: event.target.value,
                    })
                  }
                />
              </label>
              {spec.componentId === "loading-dots" ? (
                <label className="shot-edit-field">
                  点数（3..6）
                  <input
                    className="loading-count-input"
                    type="number"
                    min={3}
                    max={6}
                    value={loadingDraft.count}
                    onChange={(event) =>
                      setLoadingDraft({
                        ...loadingDraft,
                        count: event.target.value,
                      })
                    }
                  />
                </label>
              ) : (
                <label className="shot-edit-field">
                  目标百分比（1..100）
                  <input
                    className="loading-target-input"
                    type="number"
                    min={1}
                    max={100}
                    value={loadingDraft.target}
                    onChange={(event) =>
                      setLoadingDraft({
                        ...loadingDraft,
                        target: event.target.value,
                      })
                    }
                  />
                </label>
              )}
              {loadingError ? (
                <p className="loading-edit-error">{loadingError}</p>
              ) : null}
            </>
          ) : null}
```

11. **应用链**（sketchResult 块 748-772 行之后）：①注释（686-689 行）「图表/地图/流程/火柴人/手绘数据」补「/加载」；②loadingResult 块：

```tsx
                const loadingResult = isLoadingComponentId(
                  (
                    sketchResult?.spec ??
                    stickResult?.spec ??
                    flowResult?.spec ??
                    mapResult?.spec ??
                    chartResult?.spec ??
                    baseSpec
                  ).componentId,
                )
                  ? buildLoadingRevisePatch(
                      sketchResult?.spec ??
                        stickResult?.spec ??
                        flowResult?.spec ??
                        mapResult?.spec ??
                        chartResult?.spec ??
                        baseSpec,
                      loadingDraft,
                    )
                  : null;
                if (
                  loadingResult &&
                  (loadingResult.error || !loadingResult.spec)
                ) {
                  setLoadingError(loadingResult.error ?? "加载数据无效");
                  return;
                }
```

③`buildRevisePatch` 基底链（775-780 行）最前插 `loadingResult?.spec ??`：

```tsx
                const { patch, error } = buildRevisePatch(
                  draft,
                  loadingResult?.spec ??
                    sketchResult?.spec ??
                    stickResult?.spec ??
                    flowResult?.spec ??
                    mapResult?.spec ??
                    chartResult?.spec ??
                    baseSpec,
                );
```

④成功清理列表（791 行 `setSketchError(null)` 之后）加 `setLoadingError(null);`。

12. **CSS**（`.sketch-edit-error` 规则块之后）：

```css
/* P2-⑥ 加载编辑字段（沿手绘控件同款外观；数字输入沿 shot-duration-input） */
.loading-edit-error {
  margin: 0;
  font-size: 12px;
  color: #a3230f;
}
```

- [ ] **Step 2: 全 web 套件 + typecheck**

Run: `pnpm --filter @acs/web test` → 124/124；`pnpm --filter @acs/web typecheck` → 0 错。

- [ ] **Step 3: video-scene 复跑（tsc 重建 dist → dev/代理端拿到 v7）**

Run: `pnpm --filter @acs/video-scene test`
Expected: 131/131（接线零触碰组件）。

- [ ] **Step 4: biome**

Run: `pnpm exec biome check apps/web/src/app/video-studio` → 0 error（format 报错 `--write` 修，折入提交）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/video-studio/shot-editor-card.tsx apps/web/src/app/video-studio/video-studio.css
git commit -m "feat(video-studio): 镜头编辑卡接入加载模板下拉（第六族 optgroup）与标量数据编辑

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: e2e VID-022 + 登记收口

**Files:**
- Create: `scripts/video/e2e-loading.mjs`
- Modify: `qa/registry.json`（VID-022）
- Modify: `AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md`（顶部 P2-⑥ 条目）
- Create（gitignored 证据）: `artifacts/video-studio-loading/E2E_LOADING.md`

**Interfaces:**
- Consumes: 前三任务全部产物；`scripts/video/e2e-sketch.mjs`（A1 子进程复跑）；`scripts/video/render-scene.mjs`；:3211 代理上的 dev server（v7 dist）。
- Produces: exit 0 闭环证据 + VID-022 登记（qa:validate 82 automated）+ CURRENT_STATE 条目。

- [ ] **Step 1: 写 e2e 脚本**

`scripts/video/e2e-loading.mjs`（克隆重构自 e2e-sketch.mjs，差异已内联；A1 金标准哈希 = P2-⑤ 已档）：

```js
#!/usr/bin/env node
// P2-⑥ 加载端到端闭环验收（VID-022，零 TTS 计费）：
//   浏览器新建→STEM 分镜（4 镜头 218 帧，水循环）→保存
//   →镜头 2 换 loading-dots-3（旁白并发编辑单次应用一并落库）
//     →改状态文案/点数→应用→保存
//   →镜头 3 换 loading-ring-72→改状态文案/目标百分比→应用→保存
//   →导出 JSON（结构断言：componentId/label/dots/targetPercent/旁白合并/时长保留）
//   →CLI render-scene 双画幅出片→双跑逐字节 SHA-256 一致
//   →加载帧 YAVG ≥100（帧 80 点列可见 / 帧 140 进度环爬升中，双画幅）
//   →A1 金标准：sketch e2e（VID-021）子进程复跑 = P2-⑤ 已档哈希（v7 追加无害）
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
const OUT_DIR = path.join(ROOT, "artifacts/video-studio-loading");
const EXPORTED = path.join(OUT_DIR, "e2e.video-project.json");
const SENTENCE = "做一个8秒的STEM解说视频，主题是水循环，分4个镜头";
const USAGE_LEDGER = path.join(ROOT, "artifacts/tts-usage.jsonl");

function fail(step, detail) {
  console.error(`[e2e-loading] FAIL at ${step}: ${detail ?? ""}`);
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

// 逐帧亮度（有限范围黑 ≈ 16）：signalstats YAVG，零新依赖的数值断言口径（沿 VID-016..021）。
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

// —— 1. 镜头 2 换 loading-dots-3：旁白与换模板同草稿并发，单次应用一并落库
//        （P2-① 终评 I1 合并语义不回退）→ 二次应用改标量数据 ——
const card2 = page.locator(".shot-list > li").nth(1);
await card2.locator(".shot-edit-toggle").click();
await card2.locator(".shot-narration-input").fill("加载画面占一秒。");
await card2
  .locator(".chart-template-select")
  .selectOption("loading-dots-3");
await card2.locator(".shot-apply").click();
await card2
  .locator(".loading-count-input")
  .waitFor({ state: "visible", timeout: 10_000 })
  .catch(() => fail("加载编辑字段", "换模板后 .loading-count-input 未出现"));
await page
  .waitForFunction(
    (index) => {
      const el = document
        .querySelectorAll(".shot-list > li")
        [index]?.querySelector(".loading-label-input");
      return Boolean(el && el.value === "加载中");
    },
    1,
    { timeout: 10_000, polling: 100 },
  )
  .catch(() => fail("模板预填", "loading-label-input 未回填模板默认文案"));
await card2.locator(".loading-label-input").fill("正在加载");
await card2.locator(".loading-count-input").fill("4");
await card2.locator(".shot-apply").click();
await page.click(".editor-save");
await waitForMessage(page, "已保存", "保存加载镜头");

// —— 2. 镜头 3 换 loading-ring-72 + 标量数据编辑 ——
const card3 = page.locator(".shot-list > li").nth(2);
await card3.locator(".shot-edit-toggle").click();
await card3
  .locator(".chart-template-select")
  .selectOption("loading-ring-72");
await card3.locator(".shot-apply").click();
await card3
  .locator(".loading-target-input")
  .waitFor({ state: "visible", timeout: 10_000 })
  .catch(() => fail("进度环编辑字段", "换模板后 .loading-target-input 未出现"));
await page
  .waitForFunction(
    (index) => {
      const el = document
        .querySelectorAll(".shot-list > li")
        [index]?.querySelector(".loading-target-input");
      return Boolean(el && el.value === "72");
    },
    2,
    { timeout: 10_000, polling: 100 },
  )
  .catch(() => fail("进度环模板预填", "loading-target-input 未回填 72"));
await card3.locator(".loading-label-input").fill("同步数据");
await card3.locator(".loading-target-input").fill("85");
await card3.locator(".shot-apply").click();
await page.click(".editor-save");
await waitForMessage(page, "已保存", "保存进度环镜头");

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
if (s2.componentId !== "loading-dots") fail("镜头 2 组件", s2.componentId);
if (s2.params.dots !== 4) fail("镜头 2 点数", String(s2.params.dots));
if (s2.params.label !== "正在加载") fail("镜头 2 文案", String(s2.params.label));
if (s2.durationMs !== 3100)
  fail("时长保留", `镜头 2 durationMs=${s2.durationMs}`);
// 并发合并断言（P2-① 终评 I1 语义）：换模板时同草稿的旁白编辑不被丢弃
const working2 = exported.shots[1].contentVersions.find(
  (v) => v.versionId === exported.shots[1].workingVersionId,
);
if (working2?.narrationText !== "加载画面占一秒。")
  fail("旁白并发合并", `narrationText=${working2?.narrationText ?? "(空)"}`);
const s3 = specOf(exported.shots[2]);
if (s3.componentId !== "loading-progress")
  fail("镜头 3 组件", s3.componentId);
if (s3.params.targetPercent !== 85)
  fail("镜头 3 目标百分比", String(s3.params.targetPercent));
if (s3.params.label !== "同步数据")
  fail("镜头 3 文案", String(s3.params.label));
if (s3.params.inkColor !== "#2f2f2f")
  fail("镜头 3 inkColor 保留", String(s3.params.inkColor));
await page.screenshot({
  path: path.join(OUT_DIR, "loading-editor.png"),
  fullPage: true,
});
console.log(
  `[e2e-loading] 编辑落库: 项目 ${exported.id} v${exported.savedVersion}，镜头2=${s2.componentId}(dots=4,${s2.params.label})，镜头3=${s3.componentId}(target=${s3.params.targetPercent},${s3.params.label})，旁白合并=${working2?.narrationText}`,
);

// —— 4. CLI 双画幅出片 + 双跑一致 + 加载帧 YAVG ——
// spans [2000,3100,2000,2000]ms @24fps → 总 218 帧：镜头 2 帧域 48..121，
// 镜头 3 帧域 122..169。帧 80（镜头 2 内 1333ms）：loading-dots cycle 720
// → dot1 相位 0.10 弹跳中、余点贴地——点列可见；帧 140（镜头 3 内 733ms）：
// loading-progress progressMs 1600 → e≈0.841 → 弧 71% 已画、中心 71%——环与
// 数字可见。两帧均 YAVG ≥100。
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
  console.log(`[e2e-loading] 双跑一致: ${aspect} ${a}`);
  for (const frame of [80, 140]) {
    const yavg = frameYavg(path.join(RENDER_DIR, `${aspect}.mp4`), frame);
    if (yavg < 100)
      fail("加载帧亮度", `${aspect} 帧 ${frame} YAVG=${yavg} < 100`);
    console.log(`[e2e-loading] ${aspect}: 帧 ${frame} YAVG=${yavg}（≥100）`);
  }
}

// —— 5. 控制台零 error + 计费不变 ——
if (consoleErrors.length > 0) fail("浏览器控制台", consoleErrors.join(" | "));
const usageAfter = usageLines();
if (usageAfter !== usageBefore)
  fail("计费", `tts-usage.jsonl 行数变化 ${usageBefore} → ${usageAfter}`);

// —— 6. A1 金标准：sketch e2e（VID-021）子进程复跑 = P2-⑤ 已档哈希（v7 追加无害）——
const SKETCH_HASHES = {
  landscape: "0809f91f90b7e467ac446740078d3623a6c073232e0dfb781331556cfc8a6f21",
  portrait: "8ce96e223835d0b7694dd83abdc08815ba67b3e071266fa80b44376c473db94d",
};
const sketchRun = spawnSync(
  process.execPath,
  [path.join(ROOT, "scripts/video/e2e-sketch.mjs")],
  { cwd: ROOT, encoding: "utf8", timeout: 900_000, env: { ...process.env } },
);
if (sketchRun.status !== 0)
  fail("A1 sketch 复跑", `${sketchRun.stdout ?? ""}\n${sketchRun.stderr ?? ""}`);
for (const [aspect, want] of Object.entries(SKETCH_HASHES)) {
  const m = `${sketchRun.stdout}`.match(
    new RegExp(`双跑一致: ${aspect} ([0-9a-f]{64})`),
  );
  if (!m || m[1] !== want)
    fail("A1 金标准", `${aspect}: ${m?.[1] ?? "(无输出)"} ≠ ${want}`);
}
console.log(
  "[e2e-loading] A1: sketch 复跑哈希 = P2-⑤ 已档（注册表 v7 追加无害）",
);

await browser.close();
console.log(
  `[e2e-loading] OK: 模板换装→标量数据编辑→出片→双跑一致→加载帧非空→A1 sketch 金标准一致，计费零新增（台账 ${usageAfter} 行不变）`,
);
console.log("[e2e-loading] SHA-256:");
for (const name of [
  "e2e.video-project.json",
  "render/landscape.mp4",
  "render/portrait.mp4",
  "loading-editor.png",
]) {
  console.log(`  ${name}: ${sha256(path.join(OUT_DIR, name))}`);
}
```

- [ ] **Step 2: 跑 e2e（前置：:3211 代理在跑且指向 v7 dist——Task 3 Step 3 已重建）**

Run: `node scripts/video/e2e-loading.mjs`（后台运行，输出留档 workspace `e2e-loading-run.log`）
Expected: 末行 `[e2e-loading] OK: 模板换装→标量数据编辑→出片→双跑一致→加载帧非空→A1 sketch 金标准一致，计费零新增（台账 34 行不变）` + SHA-256 表（4 行）。中途预期 marker：`编辑落库: 项目 …`、`双跑一致: landscape/portrait <64hex>`、`帧 80/140 YAVG≥100` ×4、`A1: sketch 复跑哈希 = P2-⑤ 已档`。

- [ ] **Step 3: QA 登记 VID-022（qa/registry.json，VID-021 条目之后）**

```json
    {
      "id": "VID-022",
      "tier": "integration",
      "title": "Video Studio loading templates and edit loop (phase bounce dots + ring progress)",
      "cwd": ".",
      "argv": ["node", "scripts/video/e2e-loading.mjs"],
      "requiresPorts": [3211],
      "checks": [
        "Template dropdown sixth group applies loading components: shot 2 swaps to loading-dots-3 and shot 3 to loading-ring-72 through the real editor card with label/count/target inputs prefilled from template defaults",
        "Scalar data edit round-trips: dots count and status label survive on loading-dots, targetPercent and label on loading-progress, colors and cycle/progress timing params preserved through merge",
        "Narration edit merges in single apply: working-version narration equals the concurrently edited text, durationMs 3100 survives the swap",
        "Renders both aspects deterministic: double run byte-identical via SHA-256, loading frames non-empty (signalstats YAVG >= 100 at frames 80 and 140), sketch baseline unchanged (VID-021 rerun inside reproduces archived hashes, registry v7 append harmless)",
        "No TTS billing: ledger line count unchanged and browser console logs zero errors"
      ]
    }
```

- [ ] **Step 4: 证据文档 + CURRENT_STATE**

写 `artifacts/video-studio-loading/E2E_LOADING.md`（沿 E2E_SKETCH.md 结构：链路/结果/产物与可复核性，含双画幅 SHA-256、A1 sketch 哈希、台账行数、复跑方式 `BASE_URL=http://localhost:3211 node scripts/video/e2e-loading.mjs`）。`CURRENT_STATE.md` 顶部（`# Current State v2` 后）插 P2-⑥ 条目（提交号、两组件几何/时序摘要、v7、模板清单、接线第六族、e2e 数字、回归计数、qa:validate 82 automated + 51 manual；注明 P2 六题材收口、9/11 矢量子类）。

- [ ] **Step 5: 全栈验证 + Commit**

Run: `pnpm --filter @acs/video-document test` → 71/71；`node --test scripts/video/*.test.mjs` → 57；`pnpm qa:validate` → `QA registry valid: 82 automated and 51 manual cases`；`pnpm exec biome check apps/web/src/app/video-studio packages/video-scene/src scripts/video/e2e-loading.mjs` → 0 error。

```bash
git add scripts/video/e2e-loading.mjs qa/registry.json AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md
git commit -m "feat(video-studio): P2-⑥ 加载收口——e2e VID-022、A1 金标准与登记

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Self-Review 记录

- **Spec 覆盖**：R1→Task 1（组件+v7+旧渲染不变由 e2e A1 覆盖）；R2→Task 1 测试（几何/相位/弧/数字 pins + deepEqual）；R3→Task 1 校验表 + Task 2 预算不变量；R4→Task 2/3（C1 语义 + 合并落库）+ Task 4 e2e；R5→Task 4 全部。错误表 11 行→Task 1 校验表（组件侧 7 行）+ Task 2 测试 5/6（工作台侧 4 行）逐一对应。
- **Placeholder 扫描**：无 TBD/TODO；所有代码步含完整代码；e2e 为全量脚本。
- **类型一致性**：`LoadingEditDraft` 四字段在 Task 2 定义、Task 3 EMPTY/JSX/e2e 一致；`isLoadingComponentId`/`applyLoadingTemplate`/`buildLoadingRevisePatch`/`draftLoadingFromSpec` 签名与 Task 3 调用点一致；选择器 `.loading-{title,label,count,target}-input`/`.loading-edit-error` Task 3 JSX 与 Task 4 e2e 一致；A1 哈希 = E2E_SKETCH.md 已档值逐字符。
- **Review Focus**：每条已标注 owning task 测试；第 5 条（apply 链接位）由 e2e 导出断言 + typecheck + 全 web 套件守门（与五族先例同口径）。
- **两处 spec 勘误随 plan 提交**（Global Constraints 已列）：注册表数组为追加序非字母序；「粗体」以字号 96 实现（族内零 font-weight 先例）。Task 1 Step 1 测试 5 的 font-size 断言需按 fitFontSize 实现公式核对（注意事项已写进该步）。
