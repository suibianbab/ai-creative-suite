# Video Studio P2-④ 火柴人 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 追加火柴人组件 stick-figure（闭式骨架动作）+ stick-templates 第四族起点模板 + 工作台接线 + e2e VID-020，注册表 v4→v5 追加无害。

**Architecture:** 单组件：骨架常量（头 r28 / 躯干 110 / 上臂 52+前臂 48 / 单段腿 120）+ 动作表——关节角是 `(action, φ)` 的闭式纯函数（无关键帧数组），1..3 人 i×200ms 梯次淡入。工作台新纯逻辑模块 `stick-templates.ts` 沿 chart/map/flow-templates.ts 模式（行格式 `动作,fromX[,toX]`，无消歧歧义）。编辑卡第四个 optgroup + 四族 apply 链。

**Tech Stack:** TypeScript · @acs/video-scene（纯函数 SVG，零新依赖）· node:test · Playwright（e2e）· ffmpeg signalstats。

**Spec:** `docs/superpowers/specs/2026-10-18-video-studio-stickman-design.md`

## Global Constraints

- 零新依赖；组件 render 纯函数：禁墙钟/未播种随机/网络（spec §方案）。
- 注册表只追加：`default-registry.ts` v4→**v5**（数组追加 `stickFigure`），旧组件零改动；旧 spec 渲染字节不变（A1）。
- `validateParams` 中文消息带定位，逐字按 spec 错误表。
- 单测零网络；e2e 零 TTS（`artifacts/tts-usage.jsonl` 行数不变）。
- 媒体不入库；SHA-256 证据口径沿 VID-013..019。
- DASHSCOPE_API_KEY 只从环境读，不落盘/日志。
- 规划器零改动（spec 裁定：火柴人不进句式路由）。
- 每个提交以 `Co-Authored-By: Claude Code <noreply@anthropic.com>` 结尾。
- 命令口径：`pnpm --filter @acs/video-scene test`（tsc 后 node --test）、`pnpm --filter @acs/web test`、`pnpm --filter @acs/web typecheck`、`pnpm --filter @acs/video-document test`、`node --test scripts/video/*.test.mjs`（57，回归）、`pnpm exec biome check apps/web/src/app/video-studio packages/video-scene/src scripts/video/e2e-stick.mjs`、`pnpm qa:validate`。sdd 脚本经 `bash <path>` 调用；worktree 内禁复合 bash 钩子问题——文件追加用 Edit 工具。
- 基线：HEAD = P2-③ 收口（cbbee7c）+ spec 提交（99f4ef3）。dev :3210 + 代理 :3211 在跑；e2e BASE_URL 默认 http://127.0.0.1:3211。

## Review Focus

1. **φ=0 边界与 NaN**：`tMs < delay+enterMs` 时 `frac` 为负——未开始图元必须 φ=0 站姿、坐标无 NaN（spec §方案「φ 取 0」）。T1 测试 8 钉死（frame 0 断 transform + 全树无 "NaN"）。
2. **raw clamp01 浮点噪声**：淡入 opacity 与 tMs 非整除帧（如 17.28/24×1000）带 1e-16 噪声——精确 deepEqual 会假红。T1 测试 7 按已立 1e-9 逐项惯例；toFixed(2) 坐标串精确相等。
3. **编辑行解析空串/全角**：`Number("")===0` 会把 `走,,600` 静默读成 0；全角逗号（U+FF0C）不切分会让整行成动作词报错。T2 测试 6 钉死（空坐标段拒绝 + 全角逗号拒绝 + trim/CRLF 容错）。
4. **多图元梯次第三人早帧**：figures[2] delay=400，tMs∈[0,400) 时 opacity=0 但组结构必须完整（渲染树含全部 3 组）。T1 测试 8 断三组俱在。
5. **apply 链 stick 接位**：stickResult 必须接在 flowResult 之后、baseSpec 链 `stick ?? flow ?? map ?? chart ?? base`——接错序会把火柴人数据静默丢给 buildRevisePatch。T3 无单测（接线层），e2e T4 的导出断言（figures 逐字段）覆盖；typecheck + 全 web 套件守门。

---

### Task 1: stick-figure 组件 + 注册表 v5

**Files:**
- Create: `packages/video-scene/src/components/stick-figure.ts`
- Create: `packages/video-scene/src/components/stick-figure.test.ts`
- Modify: `packages/video-scene/src/default-registry.ts`（import + 数组 + v5 注释）
- Modify: `packages/video-scene/src/index.ts`（命名再导出）

**Interfaces:**
- Consumes: `../easing.js` 的 `clamp01`；`../registry.js` 的 `FrameContext/SceneComponent/SceneSpecLike`；`../svg.js` 的 `SvgNode`；`../text-width.js` 的 `fitFontSize`。
- Produces: `export const stickFigure: SceneComponent = { componentId: "stick-figure", version: 1, validateParams, render }`（Task 2 的 `applyStickTemplate` 依赖它已入 `defaultRegistry` v5；Task 4 e2e 依赖 componentId 字符串）。

- [ ] **Step 1: 写失败测试**

`packages/video-scene/src/components/stick-figure.test.ts` 全文：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { FrameContext } from "../registry.js";
import type { SvgNode } from "../svg.js";
import { stickFigure } from "./stick-figure.js";

// collect 为各组件测试私有惯例（bar/line/map/flow 同款），不跨文件共享
function collect(node: SvgNode, tag: string, out: SvgNode[] = []): SvgNode[] {
  if (node.tag === tag) out.push(node);
  for (const child of node.children ?? []) collect(child, tag, out);
  return out;
}

const BASE = {
  title: "火柴人",
  groundY: 800,
  figures: [{ action: "站", fromX: 500, toX: 500 }],
  strokeColor: "#1b2c29",
  groundColor: "#9aa8a0",
  textColor: "#1b2c29",
  enterMs: 200,
  cycleMs: 1000,
  travelMs: 1000,
};

function specWith(params: unknown) {
  return {
    componentId: "stick-figure",
    componentVersion: 1,
    params,
    seed: 1,
    background: "#ffffff",
    durationMs: 3000,
  };
}
function makeCtx(overrides: Partial<FrameContext> = {}): FrameContext {
  return { frame: 24, fps: 24, width: 1920, height: 1080, ...overrides } as FrameContext;
}
// tMs = frame/fps×1000；at(10.8) → 450ms 等，测试全部走可整除断言值
const at = (tMs: number) =>
  stickFigure.render(specWith(BASE), makeCtx({ frame: (tMs / 1000) * 24 }) as never);
// 唯一 figure 的 <g>：嵌套 svg children = [标题, 地面线, ...figures]
const figureGroup = (root: SvgNode, i = 0) =>
  collect(root, "g").filter((g) => "transform" in g.attrs)[i]!;

test("站姿几何：呼吸 bob 与关节端点逐条断言（tMs=1000）", () => {
  // bob = 2·sin(2π·1000/1600) = −1.41421 → hipY = 800−120+1.41421 = 681.41
  const g = figureGroup(at(1000));
  assert.equal(g.attrs.transform, "translate(500.00 681.41)");
  const lines = collect(g, "line");
  assert.equal(lines.length, 7); // 脊柱+双臂×2段+双腿
  // 子序：脊柱, 臂L 上/前, 臂R 上/前, 腿L, 腿R（实现 children 顺序）
  assert.equal(`${lines[0]!.attrs.x1},${lines[0]!.attrs.y1}`, "0.00,0.00");
  assert.equal(`${lines[0]!.attrs.x2},${lines[0]!.attrs.y2}`, "0.00,-110.00");
  // 臂L：upper −6° → 肘 (−sin6°×52, −110+cos6°×52) = (−5.44, −58.28)
  assert.equal(`${lines[1]!.attrs.x2},${lines[1]!.attrs.y2}`, "-5.44,-58.28");
  // 臂L 前臂 rel 0 → 手 (−sin6°×100, −110+cos6°×100) = (−10.45, −10.55)
  assert.equal(`${lines[2]!.attrs.x2},${lines[2]!.attrs.y2}`, "-10.45,-10.55");
  // 臂R 镜像：前臂手 (10.45, −10.55)
  assert.equal(`${lines[4]!.attrs.x2},${lines[4]!.attrs.y2}`, "10.45,-10.55");
  // 腿L −4° → foot (−8.37, 119.71)；腿R +4° → (8.37, 119.71)
  assert.equal(`${lines[5]!.attrs.x2},${lines[5]!.attrs.y2}`, "-8.37,119.71");
  assert.equal(`${lines[6]!.attrs.x2},${lines[6]!.attrs.y2}`, "8.37,119.71");
});

test("走循环：φ=0.25 摆极值（腿 26°/臂 −20°/bob 4）", () => {
  const spec = specWith({ ...BASE, figures: [{ action: "走", fromX: 500, toX: 500 }] });
  const root = stickFigure.render(spec, makeCtx({ frame: 10.8 }) as never); // tMs=450, φ=0.25
  const g = collect(root, "g").filter((x) => "transform" in x.attrs)[0]!;
  assert.equal(g.attrs.transform, "translate(500.00 676.00)");
  const lines = collect(g, "line");
  // 腿L 26° → (52.60, 107.86)；腿R −26° → (−52.60, 107.86)
  assert.equal(`${lines[5]!.attrs.x2},${lines[5]!.attrs.y2}`, "52.60,107.86");
  assert.equal(`${lines[6]!.attrs.x2},${lines[6]!.attrs.y2}`, "-52.60,107.86");
  // 臂L −20° → 肘 (−17.79, −61.14)
  assert.equal(`${lines[1]!.attrs.x2},${lines[1]!.attrs.y2}`, "-17.79,-61.14");
});

test("走循环：φ=0.5 回中（swing≈0）", () => {
  const spec = specWith({ ...BASE, figures: [{ action: "走", fromX: 500, toX: 500 }] });
  const root = stickFigure.render(spec, makeCtx({ frame: 16.8 }) as never); // tMs=700, φ=0.5
  const g = collect(root, "g").filter((x) => "transform" in x.attrs)[0]!;
  assert.equal(g.attrs.transform, "translate(500.00 680.00)");
  const lines = collect(g, "line");
  assert.equal(lines[5]!.attrs.x2, "0.00");
});

test("行进窗口：travelMs 中途线性、到点后原地循环", () => {
  const spec = specWith({
    ...BASE,
    figures: [{ action: "走", fromX: 80, toX: 920 }],
    travelMs: 1000,
  });
  const mid = stickFigure.render(spec, makeCtx({ frame: 16.8 }) as never); // tMs=700 → 0.5 → x=500
  assert.equal(
    collect(mid, "g").filter((x) => "transform" in x.attrs)[0]!.attrs.transform,
    "translate(500.00 680.00)",
  );
  const done = stickFigure.render(spec, makeCtx({ frame: 120 }) as never); // tMs=5000 → x=920（踏步继续）
  assert.equal(
    collect(done, "g").filter((x) => "transform" in x.attrs)[0]!.attrs.transform.startsWith(
      "translate(920.00 ",
    ),
    true,
  );
});

test("跳：φ=0.5 抛物线顶点（yOff 120、腿 ±10°、臂 ±120°）与 φ=0.25 落地段同站", () => {
  const spec = specWith({ ...BASE, figures: [{ action: "跳", fromX: 500, toX: 500 }] });
  const peak = stickFigure.render(spec, makeCtx({ frame: 16.8 }) as never); // tMs=700, φ=0.5
  const g = collect(peak, "g").filter((x) => "transform" in x.attrs)[0]!;
  // bob=2·sin(2π·700/1600)=0.76537 → hipY=800−120−0.76537−120=559.23
  assert.equal(g.attrs.transform, "translate(500.00 559.23)");
  const lines = collect(g, "line");
  // 臂R 120° → 肘 (45.03,−136.00)、手 (86.60,−160.00)
  assert.equal(`${lines[3]!.attrs.x2},${lines[3]!.attrs.y2}`, "45.03,-136.00");
  assert.equal(`${lines[4]!.attrs.x2},${lines[4]!.attrs.y2}`, "86.60,-160.00");
  // 腿R +10° → foot (20.84, 118.18)
  assert.equal(`${lines[6]!.attrs.x2},${lines[6]!.attrs.y2}`, "20.84,118.18");
  const ground = stickFigure.render(spec, makeCtx({ frame: 10.8 }) as never); // φ=0.25 落地
  const gg = collect(ground, "g").filter((x) => "transform" in x.attrs)[0]!;
  // bob=1.96157 → hipY=678.04；腿 ±4°
  assert.equal(gg.attrs.transform, "translate(500.00 678.04)");
  const gl = collect(gg, "line");
  assert.equal(`${gl[5]!.attrs.x2},${gl[5]!.attrs.y2}`, "-8.37,119.71");
});

test("挥手：前臂每周期摆 3 次（φ=0.25 与 φ=1/12 手 y 相差 40.57）", () => {
  const spec = specWith({ ...BASE, figures: [{ action: "挥手", fromX: 500, toX: 500 }] });
  const a = stickFigure.render(spec, makeCtx({ frame: 10.8 }) as never); // φ=0.25 → rel=−85
  const b = stickFigure.render(spec, makeCtx({ frame: 6.8 }) as never); // tMs=283.33, φ=1/12 → rel=−35
  const la = collect(
    collect(a, "g").filter((x) => "transform" in x.attrs)[0]!,
    "line",
  );
  const lb = collect(
    collect(b, "g").filter((x) => "transform" in x.attrs)[0]!,
    "line",
  );
  // 右前臂（index 4）：肘 (26,−155.03) 固定（臂根在颈 y=−110）；手 x 同
  // 69.50，y −134.75（rel=−85）↔ −175.32（rel=−35）——挥手摆幅
  assert.equal(`${la[4]!.attrs.x2},${la[4]!.attrs.y2}`, "69.50,-134.75");
  assert.equal(`${lb[4]!.attrs.x2},${lb[4]!.attrs.y2}`, "69.50,-175.32");
});

test("镜像：toX<fromX 整组 scale(-1,1)，向右无 scale", () => {
  const left = specWith({ ...BASE, figures: [{ action: "走", fromX: 800, toX: 200 }] });
  const gl = collect(
    stickFigure.render(left, makeCtx({ frame: 10.8 }) as never),
    "g",
  ).filter((x) => "transform" in x.attrs)[0]!;
  assert.equal(gl.attrs.transform, "translate(650.00 676.00) scale(-1,1)");
  const right = specWith({ ...BASE, figures: [{ action: "走", fromX: 80, toX: 920 }] });
  const gr = collect(
    stickFigure.render(right, makeCtx({ frame: 10.8 }) as never),
    "g",
  ).filter((x) => "transform" in x.attrs)[0]!;
  assert.equal(gr.attrs.transform.includes("scale"), false);
});

test("淡入与梯次：raw clamp01 opacity 逐项 1e-9 近似（已立惯例）", () => {
  const spec = specWith({
    ...BASE,
    figures: [
      { action: "站", fromX: 300, toX: 300 },
      { action: "站", fromX: 600, toX: 600 },
    ],
  });
  const groups = (tMs: number) =>
    collect(
      stickFigure.render(spec, makeCtx({ frame: (tMs / 1000) * 24 }) as never),
      "g",
    ).filter((x) => "transform" in x.attrs);
  // fig0 delay0：tMs=100→0.5；fig1 delay200：tMs=300→0.5、tMs=500→1
  const ops = [
    groups(100)[0]!.attrs.opacity,
    groups(300)[1]!.attrs.opacity,
    groups(500)[1]!.attrs.opacity,
  ];
  const exp = [0.5, 0.5, 1];
  for (let i = 0; i < 3; i += 1) {
    assert.ok(Math.abs((ops[i] as number) - exp[i]!) < 1e-9);
  }
});

test("tMs=0 边界：φ 取 0 站姿、三组俱在、全树无 NaN", () => {
  const spec = specWith({
    ...BASE,
    figures: [
      { action: "走", fromX: 80, toX: 920 },
      { action: "跳", fromX: 500, toX: 500 },
      { action: "挥手", fromX: 700, toX: 700 },
    ],
  });
  const root = stickFigure.render(spec, makeCtx({ frame: 0 }) as never);
  const groups = collect(root, "g").filter((x) => "transform" in x.attrs);
  assert.equal(groups.length, 3);
  // fig0：bob=0 → hipY=680；progress=clamp01(−0.2)=0 → x=80
  assert.equal(groups[0]!.attrs.transform, "translate(80.00 680.00)");
  assert.equal(JSON.stringify(root).includes("NaN"), false);
});

test("帧确定性：同 spec 同 ctx 双调 deepEqual", () => {
  const spec = specWith({
    ...BASE,
    figures: [
      { action: "走", fromX: 80, toX: 920 },
      { action: "挥手", fromX: 700, toX: 700 },
    ],
  });
  const ctx = makeCtx({ frame: 17.28 });
  assert.deepEqual(
    stickFigure.render(spec, ctx as never),
    stickFigure.render(spec, ctx as never),
  );
});

test("校验表：越界/非法输入逐项拒绝（消息逐字）", () => {
  const cases: Array<[unknown, RegExp]> = [
    ["not-object", /stick-figure params 必须是对象/],
    [{ ...BASE, title: "x".repeat(41) }, /title 必须是 ≤40 个字符/],
    [{ ...BASE, figures: [] }, /figures 必须是 1\.\.3 个/],
    [
      {
        ...BASE,
        figures: [
          { action: "站", fromX: 100, toX: 100 },
          { action: "站", fromX: 200, toX: 200 },
          { action: "站", fromX: 300, toX: 300 },
          { action: "站", fromX: 400, toX: 400 },
        ],
      },
      /figures 必须是 1\.\.3 个/,
    ],
    [{ ...BASE, figures: [{ action: "跑", fromX: 100, toX: 100 }] }, /action 必须是 走\/站\/挥手\/指\/跳/],
    [{ ...BASE, figures: [{ action: "走", fromX: "300", toX: 300 }] }, /fromX \/ toX 必须是 0\.\.1000 的数/],
    [{ ...BASE, figures: [{ action: "走", fromX: -1, toX: 300 }] }, /fromX \/ toX 必须是 0\.\.1000 的数/],
    [{ ...BASE, figures: [{ action: "走", fromX: 100, toX: 1001 }] }, /fromX \/ toX 必须是 0\.\.1000 的数/],
    [{ ...BASE, groundY: 399 }, /groundY 必须是 400\.\.900 的数/],
    [{ ...BASE, groundY: 901 }, /groundY 必须是 400\.\.900 的数/],
    [{ ...BASE, enterMs: 199 }, /enterMs 必须是 200\.\.6000 的整数/],
    [{ ...BASE, cycleMs: 6000.5 }, /cycleMs 必须是 200\.\.6000 的整数/],
    [{ ...BASE, travelMs: "400" }, /travelMs 必须是 200\.\.6000 的整数/],
    [{ ...BASE, strokeColor: "#12345" }, /strokeColor 必须是 #rrggbb/],
    [{ ...BASE, groundColor: "red" }, /groundColor 必须是 #rrggbb/],
  ];
  for (const [params, pattern] of cases) {
    assert.throws(
      () => stickFigure.validateParams(params),
      pattern,
      `input: ${JSON.stringify(params).slice(0, 80)}`,
    );
  }
  // 合法最小输入不抛（返回原值）
  assert.equal(stickFigure.validateParams(BASE), BASE);
});
```

**注（写测试时执行）**：第一个测试「站姿几何：呼吸 bob…」的 deepEqual 占位写法是错的——删掉该测试，保留「站姿几何：腿/臂端点逐条断言」为唯一站姿测试（下方 Step 3 的实现以逐条断言的子序为准）。即最终测试文件不含占位测试。

- [ ] **Step 2: 跑测试确认 RED**

Run: `pnpm --filter @acs/video-scene test`
Expected: 文件级 `not ok` —— `Cannot find module '...stick-figure.js'`（dist 编译失败即整文件计 1 个 not ok，node --test 文件级计数，同 flow 先例）。

- [ ] **Step 3: 写实现**

`packages/video-scene/src/components/stick-figure.ts` 全文：

```ts
import { clamp01 } from "../easing.js";
import type {
  FrameContext,
  SceneComponent,
  SceneSpecLike,
} from "../registry.js";
import type { SvgNode } from "../svg.js";
import { fitFontSize } from "../text-width.js";

// 火柴人舞台 v1：骨架常量（头 r28 / 躯干 110 / 上臂 52+前臂 48 / 单段腿
// 120）+ 闭式动作表——关节角是 (action, φ) 的纯函数，无关键帧数组。角度
// 约定：从竖直向下起算、画布右摆为正（度）；前臂角相对上臂延长线。整组
// 朝向由 toX−fromX 符号决定，向左时组内 scale(-1,1) 镜像（动作只写右侧
// 版本）。1..3 人按 i×200ms 梯次淡入（无 scale 弹跳，spec 裁定）；呼吸
// bob=2·sin(2π·tMs/1600) 常开；tMs<delay+enterMs 时 φ 取 0（站姿）。
// render 纯函数：禁墙钟/未播种随机/网络。

const ACTIONS = ["走", "站", "挥手", "指", "跳"] as const;
type StickAction = (typeof ACTIONS)[number];
type StickFigureDecl = { action: StickAction; fromX: number; toX: number };
type StickFigureParams = {
  title: string;
  groundY: number;
  figures: StickFigureDecl[];
  strokeColor: string;
  groundColor: string;
  textColor: string;
  enterMs: number; // 200..6000
  cycleMs: number; // 200..6000
  travelMs: number; // 200..6000
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DESIGN_SPACE = 1000;
const HEAD_R = 28;
const HEAD_GAP = 6;
const SPINE = 110;
const UPPER_ARM = 52;
const FOREARM = 48;
const LEG = 120;
const STROKE = 10;
const STAGGER_MS = 200;
const BREATH_PERIOD = 1600;
const MAX_FIGURES = 3;
const COORD_MAX = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function validateParams(value: unknown): StickFigureParams {
  if (!isRecord(value)) throw new Error("stick-figure params 必须是对象");
  if (typeof value.title !== "string" || value.title.length > 40) {
    throw new Error("stick-figure params.title 必须是 ≤40 个字符");
  }
  if (
    !Array.isArray(value.figures) ||
    value.figures.length < 1 ||
    value.figures.length > MAX_FIGURES
  ) {
    throw new Error(
      `stick-figure params.figures 必须是 1..${MAX_FIGURES} 个 {action, fromX, toX}`,
    );
  }
  value.figures.forEach((figure, i) => {
    if (!isRecord(figure)) {
      throw new Error(`stick-figure params.figures[${i}] 必须是对象`);
    }
    if (
      typeof figure.action !== "string" ||
      !(ACTIONS as readonly string[]).includes(figure.action)
    ) {
      throw new Error(
        `stick-figure params.figures[${i}].action 必须是 走/站/挥手/指/跳`,
      );
    }
    for (const key of ["fromX", "toX"] as const) {
      const v = figure[key];
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        v < 0 ||
        v > COORD_MAX
      ) {
        throw new Error(
          `stick-figure params.figures[${i}].fromX / toX 必须是 0..1000 的数`,
        );
      }
    }
  });
  if (
    typeof value.groundY !== "number" ||
    !Number.isFinite(value.groundY) ||
    value.groundY < 400 ||
    value.groundY > 900
  ) {
    throw new Error("stick-figure params.groundY 必须是 400..900 的数");
  }
  for (const key of ["strokeColor", "groundColor", "textColor"] as const) {
    if (!isHexColor(value[key])) {
      throw new Error(`stick-figure params.${key} 必须是 #rrggbb`);
    }
  }
  for (const key of ["enterMs", "cycleMs", "travelMs"] as const) {
    const v = value[key];
    if (!Number.isInteger(v) || (v as number) < 200 || (v as number) > 6000) {
      throw new Error(`stick-figure params.${key} 必须是 200..6000 的整数`);
    }
  }
  return value as StickFigureParams;
}

type Pose = {
  legL: number;
  legR: number;
  armL: number;
  armR: number;
  foreL: number;
  foreR: number;
  bob: number;
  yOff: number;
};

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// 动作表（spec §方案）：角度单位度；bob 除「走」外都是呼吸值
function poseAt(action: StickAction, phi: number, tMs: number): Pose {
  const breath = 2 * Math.sin((2 * Math.PI * tMs) / BREATH_PERIOD);
  switch (action) {
    case "走": {
      const swing = Math.sin(2 * Math.PI * phi);
      return {
        legL: 26 * swing,
        legR: -26 * swing,
        armL: -20 * swing,
        armR: 20 * swing,
        foreL: 0,
        foreR: 0,
        bob: 4 * Math.abs(swing),
        yOff: 0,
      };
    }
    case "挥手":
      return {
        legL: -4,
        legR: 4,
        armL: -6,
        armR: 150,
        foreL: 0,
        foreR: -60 + 25 * Math.sin(6 * Math.PI * phi),
        bob: breath,
        yOff: 0,
      };
    case "指":
      return {
        legL: -4,
        legR: 4,
        armL: -6,
        armR: 90,
        foreL: 0,
        foreR: 0,
        bob: breath,
        yOff: 0,
      };
    case "跳": {
      const airborne = phi > 0.15 && phi < 0.85;
      return airborne
        ? {
            legL: -10,
            legR: 10,
            armL: -120,
            armR: 120,
            foreL: 0,
            foreR: 0,
            bob: breath,
            yOff: 120 * 4 * phi * (1 - phi),
          }
        : { legL: -4, legR: 4, armL: -6, armR: 6, foreL: 0, foreR: 0, bob: breath, yOff: 0 };
    }
    default:
      return { legL: -4, legR: 4, armL: -6, armR: 6, foreL: 0, foreR: 0, bob: breath, yOff: 0 };
  }
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const params = spec.params as StickFigureParams;
  const tMs = (ctx.frame / ctx.fps) * 1000;

  const figureGroups: SvgNode[] = params.figures.map((figure, i) => {
    const delay = i * STAGGER_MS;
    const tRel = tMs - delay - params.enterMs;
    const phi = tRel <= 0 ? 0 : (tRel / params.cycleMs) % 1;
    const pose = poseAt(figure.action, phi, tMs);
    // 行进窗口：走/站/挥手/指 在 travelMs 内 fromX→toX 线性；跳 x 固定
    // fromX（spec §方案「跳：x 固定 fromX」——抛物线竖直，滑跳读感差）
    const progress = clamp01(tRel / params.travelMs);
    const x =
      figure.action === "跳"
        ? figure.fromX
        : figure.fromX + (figure.toX - figure.fromX) * progress;
    const hipY = params.groundY - LEG - pose.bob - pose.yOff;
    const neckY = -SPINE;
    // 关节：从根沿角度推进（sin=+x、cos=+y 向下）
    const limb = (
      rootX: number,
      rootY: number,
      angleDeg: number,
      len: number,
    ): [number, number] => [
      rootX + Math.sin(rad(angleDeg)) * len,
      rootY + Math.cos(rad(angleDeg)) * len,
    ];
    const [elbowLx, elbowLy] = limb(0, neckY, pose.armL, UPPER_ARM);
    const [handLx, handLy] = limb(
      elbowLx,
      elbowLy,
      pose.armL + pose.foreL,
      FOREARM,
    );
    const [elbowRx, elbowRy] = limb(0, neckY, pose.armR, UPPER_ARM);
    const [handRx, handRy] = limb(
      elbowRx,
      elbowRy,
      pose.armR + pose.foreR,
      FOREARM,
    );
    const [footLx, footLy] = limb(0, 0, pose.legL, LEG);
    const [footRx, footRy] = limb(0, 0, pose.legR, LEG);
    const seg = (x1: number, y1: number, x2: number, y2: number): SvgNode => ({
      tag: "line",
      attrs: {
        x1: x1.toFixed(2),
        y1: y1.toFixed(2),
        x2: x2.toFixed(2),
        y2: y2.toFixed(2),
        stroke: params.strokeColor,
        "stroke-width": STROKE,
        "stroke-linecap": "round",
      },
    });
    const flip = figure.toX - figure.fromX < 0;
    return {
      tag: "g",
      attrs: {
        transform: `translate(${x.toFixed(2)} ${hipY.toFixed(2)})${flip ? " scale(-1,1)" : ""}`,
        opacity: clamp01((tMs - delay) / params.enterMs),
      },
      children: [
        seg(0, 0, 0, neckY), // 脊柱（髋→颈）
        seg(0, neckY, elbowLx, elbowLy),
        seg(elbowLx, elbowLy, handLx, handLy),
        seg(0, neckY, elbowRx, elbowRy),
        seg(elbowRx, elbowRy, handRx, handRy),
        seg(0, 0, footLx, footLy),
        seg(0, 0, footRx, footRy),
        {
          tag: "circle",
          attrs: {
            cx: "0",
            cy: (neckY - HEAD_R - HEAD_GAP).toFixed(2),
            r: HEAD_R,
            fill: params.strokeColor,
          },
        },
      ],
    };
  });

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
          {
            tag: "line",
            attrs: {
              x1: "40",
              y1: String(params.groundY),
              x2: "960",
              y2: String(params.groundY),
              stroke: params.groundColor,
              "stroke-width": 6,
              "stroke-linecap": "round",
            },
          },
          ...figureGroups,
        ],
      },
    ],
  };
}

export const stickFigure: SceneComponent = {
  componentId: "stick-figure",
  version: 1,
  validateParams,
  render,
};
```

`default-registry.ts` 三处：import 块按字母序插在 `number-counter` 之前：

```ts
import { stickFigure } from "./components/stick-figure.js";
```

数组 `flowDiagram,` 之后追加 `stickFigure,`；版本注释块追加一行并把 `createRegistry(..., 4)` 改 `5`：

```ts
// v4（P2-③ 流程图/示意图）：追加流程组件，同一分支内原子落地。
// v5（P2-④ 火柴人）：追加 stick-figure，同一分支内原子落地。
export const defaultRegistry: SceneRegistry = createRegistry(
```

`index.ts` 在 `export { flowSteps } ...` 之后、`export * from "./components/line-chart.js"` 之前按字母序插：

```ts
export { stickFigure } from "./components/stick-figure.js";
```
（字母序：line-chart < line-drawing < map-* < number-counter < stick-figure < text-animation——插在 `export * from "./components/number-counter.js";` 之后。）

- [ ] **Step 4: 跑测试确认 GREEN + 全套件**

Run: `pnpm --filter @acs/video-scene test`
Expected: 全部通过（原 92 + 新 11 ≈ 103；文件级计数以实际输出为准）。`Cannot find module` 消失。

Run: `pnpm --filter @acs/video-document test`
Expected: 71/71（回归——video-document 依赖注册表）。

- [ ] **Step 5: Commit**

```bash
git add packages/video-scene/src/components/stick-figure.ts packages/video-scene/src/components/stick-figure.test.ts packages/video-scene/src/default-registry.ts packages/video-scene/src/index.ts
git commit -m "feat(video-scene): stick-figure 组件（闭式骨架动作表）与注册表 v5

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: stick-templates.ts 纯逻辑（第四族模板 + 行编辑）

**Files:**
- Create: `apps/web/src/app/video-studio/stick-templates.ts`
- Create: `apps/web/src/app/video-studio/stick-templates.test.ts`

**Interfaces:**
- Consumes: `@acs/video-scene` 的 `defaultRegistry/SceneSpec/validateSceneSpec`；Task 1 的 componentId `"stick-figure"` 入 v5 注册表（模板 validateSceneSpec 兜底依赖）。
- Produces（Task 3 消费，名字逐字）：`STICK_TEMPLATES: StickTemplate[]`、`isStickComponentId(componentId: string): boolean`、`applyStickTemplate(spec: SceneSpec, templateId: string): { spec: SceneSpec; error: null } | { spec: null; error: string }`、`type StickEditDraft = { title: string; data: string }`、`draftStickFromSpec(spec: SceneSpec): StickEditDraft`、`buildStickRevisePatch(spec: SceneSpec, draft: StickEditDraft): { spec: SceneSpec; error: null } | { spec: null; error: string }`。

- [ ] **Step 1: 写失败测试**

`apps/web/src/app/video-studio/stick-templates.test.ts` 全文：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { SceneSpec } from "@acs/video-scene";
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
  travelMs: 2400,
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
  const draft = { title: "相遇问好", data: "走, 80 ,420\r\n\r\n走,920,580\n指,500" };
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
  assert.equal(draftStickFromSpec(result.spec!).data, "走,80,420\n走,920,580\n指,500");
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
    ["站,500\n走,100,,300", "第 2 行：动作,起点x[,终点x] 格式不符（坐标 0..1000）"],
    ["走,100,300,900", "第 1 行：动作,起点x[,终点x] 格式不符（坐标 0..1000）"],
    ["走,-5", "第 1 行：动作,起点x[,终点x] 格式不符（坐标 0..1000）"],
    ["走,100,1001", "第 1 行：动作,起点x[,终点x] 格式不符（坐标 0..1000）"],
    ["站,500\n走,100\n跳,600\n指,700", "火柴人最多 3 行（人数上限）"],
    ["", "火柴人至少需要一行（1 个人物）"],
    ["走,１００", "第 1 行：动作必须是 走/站/挥手/指/跳"],
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
```

- [ ] **Step 2: 跑测试确认 RED**

Run: `pnpm --filter @acs/web test`
Expected: 文件级 `not ok` —— `Cannot find module '...stick-templates.js'`（web 测试跑 tsx 源，报错形态同 flow 先例）。

- [ ] **Step 3: 写实现**

`apps/web/src/app/video-studio/stick-templates.ts` 全文：

```ts
// P2-④ 火柴人：起点模板与数据编辑纯逻辑（沿 flow-templates.ts 模式）。
// 模板参数过 validateSceneSpec 兜底；非法数据行内报错、不落 patch（C1 语义）。

import {
  defaultRegistry,
  type SceneSpec,
  validateSceneSpec,
} from "@acs/video-scene";

export type StickTemplate = {
  templateId: string;
  componentId: "stick-figure";
  label: string;
  params: Record<string, unknown>;
};

const STICK_COLORS = {
  strokeColor: "#1b2c29",
  groundColor: "#9aa8a0",
  textColor: "#1b2c29",
};

export const STICK_TEMPLATES: StickTemplate[] = [
  {
    templateId: "stick-walk-across",
    componentId: "stick-figure",
    label: "一人横穿",
    params: {
      title: "走入画面",
      groundY: 800,
      figures: [{ action: "走", fromX: 80, toX: 920 }],
      ...STICK_COLORS,
      enterMs: 400,
      cycleMs: 800,
      travelMs: 2400,
    },
  },
  {
    templateId: "stick-present",
    componentId: "stick-figure",
    label: "讲解指板",
    params: {
      title: "讲解要点",
      groundY: 800,
      figures: [{ action: "指", fromX: 500, toX: 500 }],
      ...STICK_COLORS,
      enterMs: 400,
      cycleMs: 1000,
      travelMs: 1000,
    },
  },
  {
    templateId: "stick-wave-hello",
    componentId: "stick-figure",
    label: "挥手打招呼",
    params: {
      title: "你好",
      groundY: 800,
      figures: [{ action: "挥手", fromX: 500, toX: 500 }],
      ...STICK_COLORS,
      enterMs: 400,
      cycleMs: 1000,
      travelMs: 1000,
    },
  },
  {
    templateId: "stick-jump-joy",
    componentId: "stick-figure",
    label: "庆祝跳跃",
    params: {
      title: "庆祝时刻",
      groundY: 800,
      figures: [{ action: "跳", fromX: 500, toX: 500 }],
      ...STICK_COLORS,
      enterMs: 400,
      cycleMs: 1000,
      travelMs: 1000,
    },
  },
  {
    templateId: "stick-meet",
    componentId: "stick-figure",
    label: "两人相遇",
    params: {
      title: "相遇问好",
      groundY: 800,
      figures: [
        { action: "走", fromX: 80, toX: 420 },
        { action: "走", fromX: 920, toX: 580 },
        { action: "挥手", fromX: 500, toX: 500 },
      ],
      ...STICK_COLORS,
      enterMs: 400,
      cycleMs: 1000,
      travelMs: 2000,
    },
  },
];

export function isStickComponentId(componentId: string): boolean {
  return componentId === "stick-figure";
}

export function applyStickTemplate(
  spec: SceneSpec,
  templateId: string,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  const template = STICK_TEMPLATES.find((t) => t.templateId === templateId);
  if (!template) return { spec: null, error: `未知火柴人模板 ${templateId}` };
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

export type StickEditDraft = {
  title: string;
  // 每行一个人物 `动作,fromX[,toX]`（动作 走/站/挥手/指/跳，坐标 0..1000；
  // toX 缺省 = fromX）
  data: string;
};

export function draftStickFromSpec(spec: SceneSpec): StickEditDraft {
  const params = spec.params as {
    title?: string;
    figures?: Array<{ action: string; fromX: number; toX: number }>;
  };
  return {
    title: params.title ?? "",
    data: (params.figures ?? [])
      .map((f) =>
        f.toX === f.fromX
          ? `${f.action},${f.fromX}`
          : `${f.action},${f.fromX},${f.toX}`,
      )
      .join("\n"),
  };
}

const STICK_ACTIONS = new Set(["走", "站", "挥手", "指", "跳"]);

// 坐标段：Number("")===0 是 JS 陷阱——空段显式拒绝；Number 对全角数字返回
// NaN，天然拒绝
function coord(raw: string): number | null {
  if (raw.length === 0) return null;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 && v <= 1000 ? v : null;
}

function parseFigureLine(
  line: string,
): { action: string; fromX: number; toX: number } | null {
  const parts = line.split(",").map((p) => p.trim());
  if (parts.length !== 2 && parts.length !== 3) return null;
  if (!STICK_ACTIONS.has(parts[0]!)) return null;
  const fromX = coord(parts[1]!);
  if (fromX === null) return null;
  let toX = fromX;
  if (parts.length === 3) {
    toX = coord(parts[2]!);
    if (toX === null) return null;
  }
  return { action: parts[0]!, fromX, toX };
}

function splitLines(data: string): string[] {
  return data
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function buildStickRevisePatch(
  spec: SceneSpec,
  draft: StickEditDraft,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  if (!isStickComponentId(spec.componentId)) {
    return { spec: null, error: "当前镜头组件不是火柴人组件" };
  }
  const lines = splitLines(draft.data);
  if (lines.length < 1) {
    return { spec: null, error: "火柴人至少需要一行（1 个人物）" };
  }
  if (lines.length > 3) {
    return { spec: null, error: "火柴人最多 3 行（人数上限）" };
  }
  const figures: Array<{ action: string; fromX: number; toX: number }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const head = lines[i]!.split(",")[0]!.trim();
    if (!STICK_ACTIONS.has(head)) {
      return { spec: null, error: `第 ${i + 1} 行：动作必须是 走/站/挥手/指/跳` };
    }
    const parsed = parseFigureLine(lines[i]!);
    if (!parsed) {
      return {
        spec: null,
        error: `第 ${i + 1} 行：动作,起点x[,终点x] 格式不符（坐标 0..1000）`,
      };
    }
    figures.push(parsed);
  }
  const params = {
    ...(spec.params as Record<string, unknown>),
    title: draft.title,
    figures,
  };
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

- [ ] **Step 4: 跑测试确认 GREEN + 全套件**

Run: `pnpm --filter @acs/web test`
Expected: 全绿（原 101 + 新 7 = 108）。

Run: `pnpm --filter @acs/web typecheck`
Expected: 0 错误。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/video-studio/stick-templates.ts apps/web/src/app/video-studio/stick-templates.test.ts
git commit -m "feat(video-studio): stick-templates 五枚起点模板与数据编辑纯逻辑

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: 编辑卡接线（第四 optgroup + 四族 apply 链）

**Files:**
- Modify: `apps/web/src/app/video-studio/shot-editor-card.tsx`（11 处，锚点如下）
- Modify: `apps/web/src/app/video-studio/video-studio.css`（`.flow-edit-error` 块后追加）

**Interfaces:**
- Consumes: Task 2 六个命名导出（逐字）；既有 chart/map/flow 接线模式。
- Produces: DOM 类 `.stick-title-input/.stick-data-input/.stick-edit-error`（Task 4 e2e 依赖 `.stick-data-input`）与 optgroup「火柴人」5 枚 option（e2e 依赖 `selectOption("stick-walk-across")`/`("stick-meet")` 可选）。

接线层无新单测（沿 P2-②③ 先例：守门 = typecheck + 全 web 套件 + biome；行为由 T4 e2e 断言）。

- [ ] **Step 1: 11 处编辑（全部用 Edit 工具，锚点逐字）**

1a. import 块——`shot-specs` import 之后（字母序 stick > shot）：

```tsx
import {
  applyStickTemplate,
  buildStickRevisePatch,
  draftStickFromSpec,
  isStickComponentId,
  STICK_TEMPLATES,
  type StickEditDraft,
} from "./stick-templates";
```

1b. `const EMPTY_FLOW_DRAFT: FlowEditDraft = { title: "", data: "" };` 之后：

```tsx
const EMPTY_STICK_DRAFT: StickEditDraft = { title: "", data: "" };
```

1c. `resolveAnyTemplate`——注释改「跨图表/地图/流程/火柴人四族」，`map` 步之后、`return { spec: null, error: ... }` 之前插：

```tsx
  const stick = applyStickTemplate(spec, templateId);
  if (stick.spec) return { spec: stick.spec, error: null };
```
（error 链不动——id 全未知时显示哪个「未知X模板」为装饰性，UI 下拉不产生未知 id。）

1d. state——`const [flowError, setFlowError] = useState<string | null>(null);` 之后：

```tsx
  const [stickDraft, setStickDraft] = useState<StickEditDraft>(() =>
    spec && isStickComponentId(spec.componentId)
      ? draftStickFromSpec(spec)
      : EMPTY_STICK_DRAFT,
  );
  const [stickError, setStickError] = useState<string | null>(null);
```

1e. effect——`setFlowDraft(...)` 块之后（`// eslint-disable` 行之前）：

```tsx
    setStickError(null);
    setStickDraft(
      nextSpec && isStickComponentId(nextSpec.componentId)
        ? draftStickFromSpec(nextSpec)
        : EMPTY_STICK_DRAFT,
    );
```

1f. onChange——`setFlowError(null);` 之后插 `setStickError(null);`；预填链 `else if (isFlowComponentId(...))` 分支之后：

```tsx
                } else if (isStickComponentId(applied.spec.componentId)) {
                  setStickDraft(draftStickFromSpec(applied.spec));
                }
```

1g. 标签——`组件模板（图表 / 地图 / 流程）` 改 `组件模板（图表 / 地图 / 流程 / 火柴人）`。

1h. optgroup——`流程` 组 `</optgroup>` 之后：

```tsx
              <optgroup label="火柴人">
                {STICK_TEMPLATES.map((template) => (
                  <option key={template.templateId} value={template.templateId}>
                    {template.label}
                  </option>
                ))}
              </optgroup>
```

1i. 编辑字段——flow 块 `) : null}` 之后：

```tsx
          {isStickComponentId(spec.componentId) ? (
            <>
              <label className="shot-edit-field">
                火柴人标题
                <input
                  className="stick-title-input"
                  maxLength={40}
                  value={stickDraft.title}
                  onChange={(event) =>
                    setStickDraft({ ...stickDraft, title: event.target.value })
                  }
                />
              </label>
              <label className="shot-edit-field">
                数据（每行 动作,起点x[,终点x]（动作 走/站/挥手/指/跳，坐标
                0..1000；终点缺省 = 起点））
                <textarea
                  className="stick-data-input"
                  rows={4}
                  value={stickDraft.data}
                  onChange={(event) =>
                    setStickDraft({ ...stickDraft, data: event.target.value })
                  }
                />
              </label>
              {stickError ? (
                <p className="stick-edit-error">{stickError}</p>
              ) : null}
            </>
          ) : null}
```

1j. apply 链——flowResult 校验块之后、`buildRevisePatch` 之前：

```tsx
                const stickResult = isStickComponentId(
                  (
                    flowResult?.spec ??
                    mapResult?.spec ??
                    chartResult?.spec ??
                    baseSpec
                  ).componentId,
                )
                  ? buildStickRevisePatch(
                      flowResult?.spec ??
                        mapResult?.spec ??
                        chartResult?.spec ??
                        baseSpec,
                      stickDraft,
                    )
                  : null;
                if (stickResult && (stickResult.error || !stickResult.spec)) {
                  setStickError(stickResult.error ?? "火柴人数据无效");
                  return;
                }
```

`buildRevisePatch` 第二参改：

```tsx
                const { patch, error } = buildRevisePatch(
                  draft,
                  stickResult?.spec ??
                    flowResult?.spec ??
                    mapResult?.spec ??
                    chartResult?.spec ??
                    baseSpec,
                );
```

成功路径 `setFlowError(null);` 之后插 `setStickError(null);`。注释「+ 图表/地图/流程数据」改「+ 图表/地图/流程/火柴人数据」。

- [ ] **Step 2: CSS**

`video-studio.css` 在 `.flow-edit-error { ... }` 块之后（`.shot-edit-actions` 之前）：

```css
/* P2-④ 火柴人编辑字段（沿流程控件同款外观） */
.stick-title-input {
  font-size: 13px;
  padding: 4px 8px;
  border: 1px solid #bfd6c8;
  border-radius: 6px;
  font-family: inherit;
}

.stick-data-input {
  font-size: 13px;
  padding: 6px 8px;
  border: 1px solid #bfd6c8;
  border-radius: 6px;
  min-height: 88px;
  resize: vertical;
  font-family: inherit;
}

.stick-edit-error {
  margin: 0;
  font-size: 12px;
  color: #a3230f;
}
```

- [ ] **Step 3: 守门（typecheck + 全套件 + biome）**

Run: `pnpm --filter @acs/web typecheck`
Expected: 0 错误。
Run: `pnpm --filter @acs/web test`
Expected: 108/108。
Run: `pnpm exec biome check apps/web/src/app/video-studio packages/video-scene/src`
Expected: 0 error（有 format 报错先 `--write` 修复并把纯格式拆独立 style 提交，沿 d7be40f 先例）。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/video-studio/shot-editor-card.tsx apps/web/src/app/video-studio/video-studio.css
git commit -m "feat(video-studio): 镜头编辑卡接入火柴人模板下拉（第四族 optgroup）与数据编辑

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: e2e VID-020 + A1 金标准 + 登记

**Files:**
- Create: `scripts/video/e2e-stick.mjs`
- Modify: `qa/registry.json`（VID-020，追加在 VID-019 之后）
- Modify: `AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md`（顶部条目）
- Create（本地、gitignore 不入库）: `artifacts/video-studio-stick/E2E_STICK.md`（证据记录）

**Interfaces:**
- Consumes: Task 1 componentId、Task 2 templateId（`stick-walk-across`/`stick-meet`）、Task 3 DOM 类（`.stick-data-input`、既有 `.chart-template-select`/`.shot-apply`/`.editor-save` 等）、P2-③ flow e2e（A1 子进程复跑）。
- Produces: VID-020 登记；e2e 自校验 A1（flow 哈希 = P2-③ 终评修复 `34bda10` 后已档 `24a625c7…`/`274f1d0f…`）。

- [ ] **Step 1: 写 e2e 脚本**

`scripts/video/e2e-stick.mjs` = `scripts/video/e2e-flow.mjs` 全文克隆后改以下各处（其余逐字保留，含 frameYavg/renderProject/waitForMessage/usageLines/sha256 工具）：

- 头注释改：

```js
#!/usr/bin/env node
// P2-④ 火柴人端到端闭环验收（VID-020，零 TTS 计费）：
//   浏览器新建→STEM 分镜（4 镜头 218 帧，水循环）→保存
//   →镜头 2 换 stick-walk-across（旁白并发编辑单次应用一并落库）→改人物数据→应用→保存
//   →镜头 3 换 stick-meet→改人物数据（动作词 + toX 缺省行）→应用→保存
//   →导出 JSON（结构断言：figures/动作词/坐标/旁白合并/时长保留）
//   →CLI render-scene 双画幅出片→双跑逐字节 SHA-256 一致
//   →火柴人帧 YAVG ≥100（帧 80 行进中 / 帧 140 三人梯次，双画幅）
//   →A1 金标准：flow e2e（VID-019）子进程复跑 = P2-③ 已档哈希（v5 追加无害）
//   →计费台账行数不变 + 浏览器控制台零 error。
// 前置: @acs/web dev server 已在 BASE_URL（:3210，建议经 scripts/dev/proxy-3211.mjs）；
//       packages/{video-document,video-scene} 已 build；ffmpeg 在 PATH。
// exit 0 = 闭环成立；任何一步失败 exit 1 并打印步骤名。
```

- `fail` 步名前缀 `[e2e-stick]`；`OUT_DIR = path.join(ROOT, "artifacts/video-studio-stick");`；所有 `console.log("[e2e-flow]` 改 `[e2e-stick]`；截图名 `stick-editor.png`。

- 段落 1（镜头 2）替换为：

```js
// —— 1. 镜头 2 换 stick-walk-across：旁白与换模板同草稿并发，单次应用一并落库
//        （P2-① 终评 I1 合并语义不回退）→ 二次应用改人物数据 ——
const card2 = page.locator(".shot-list > li").nth(1);
await card2.locator(".shot-edit-toggle").click();
await card2.locator(".shot-narration-input").fill("火柴人先走进画面。");
await card2.locator(".chart-template-select").selectOption("stick-walk-across");
await card2.locator(".shot-apply").click();
await card2
  .locator(".stick-data-input")
  .waitFor({ state: "visible", timeout: 10_000 })
  .catch(() => fail("火柴人编辑字段", "换模板后 .stick-data-input 未出现"));
await page
  .waitForFunction(
    (index) => {
      const el = document
        .querySelectorAll(".shot-list > li")
        [index]?.querySelector(".stick-data-input");
      return Boolean(el && el.value.includes("走,80,920"));
    },
    1,
    { timeout: 10_000, polling: 100 },
  )
  .catch(() => fail("模板预填", "stick-data-input 未回填模板默认数据"));
await card2.locator(".stick-data-input").fill("走,120,880");
await card2.locator(".shot-apply").click();
await page.click(".editor-save");
await waitForMessage(page, "已保存", "保存火柴人镜头");
```

- 段落 2（镜头 3）替换为：

```js
// —— 2. 镜头 3 换 stick-meet + 人物数据编辑（动作词 + toX 缺省行）——
const card3 = page.locator(".shot-list > li").nth(2);
await card3.locator(".shot-edit-toggle").click();
await card3.locator(".chart-template-select").selectOption("stick-meet");
await card3.locator(".shot-apply").click();
await card3
  .locator(".stick-data-input")
  .waitFor({ state: "visible", timeout: 10_000 })
  .catch(() => fail("相遇模板编辑字段", "换模板后 .stick-data-input 未出现"));
await page
  .waitForFunction(
    (index) => {
      const el = document
        .querySelectorAll(".shot-list > li")
        [index]?.querySelector(".stick-data-input");
      return Boolean(el && el.value.includes("走,80,420"));
    },
    2,
    { timeout: 10_000, polling: 100 },
  )
  .catch(() => fail("相遇模板预填", "stick-data-input 未回填模板默认数据"));
await card3
  .locator(".stick-data-input")
  .fill("走,80,420\n走,920,580\n指,500");
await card3.locator(".shot-apply").click();
await page.click(".editor-save");
await waitForMessage(page, "已保存", "保存相遇镜头");
```

- 段落 3（导出断言）替换为：

```js
const s2 = specOf(exported.shots[1]);
if (s2.componentId !== "stick-figure") fail("镜头 2 组件", s2.componentId);
if (JSON.stringify(s2.params.figures) !== '[{"action":"走","fromX":120,"toX":880}]')
  fail("镜头 2 人物", JSON.stringify(s2.params.figures));
if (s2.durationMs !== 3100)
  fail("时长保留", `镜头 2 durationMs=${s2.durationMs}`);
const working2 = exported.shots[1].contentVersions.find(
  (v) => v.versionId === exported.shots[1].workingVersionId,
);
if (working2?.narrationText !== "火柴人先走进画面。")
  fail("旁白并发合并", `narrationText=${working2?.narrationText ?? "(空)"}`);
const s3 = specOf(exported.shots[2]);
if (s3.componentId !== "stick-figure") fail("镜头 3 组件", s3.componentId);
const figures3 = s3.params.figures;
if (figures3.length !== 3) fail("镜头 3 人数", String(figures3.length));
if (JSON.stringify(figures3[0]) !== '{"action":"走","fromX":80,"toX":420}')
  fail("镜头 3 人物 0", JSON.stringify(figures3[0]));
if (JSON.stringify(figures3[2]) !== '{"action":"指","fromX":500,"toX":500}')
  fail("镜头 3 toX 缺省", JSON.stringify(figures3[2]));
if (s3.params.groundY !== 800) fail("镜头 3 groundY 保留", String(s3.params.groundY));
```
（`console.log` 编辑落库行同步改人物摘要；截图 path `stick-editor.png`。）

- 段落 4 注释改（帧口径）：

```js
// spans [2000,3100,2000,2000]ms @24fps → 总 218 帧：镜头 2 帧域 48..121，
// 镜头 3 帧域 122..169。帧 80（镜头 2 内 1333ms）：走 120→880 travelMs 2400
// → progress≈0.39 x≈416，行进中段；帧 140（镜头 3 内 750ms）：三人 delay
// 0/200/400 全过淡入窗（enterMs 400），fig0 x≈139 行进中。两帧均 YAVG ≥100。
```

- 段落 5 之后新增段落 6（A1 金标准，计费/控制台检查之后、`browser.close()` 之前——注意 flow 原文里 5 是最后一段，插在其后）：

```js
// —— 6. A1 金标准：flow e2e 子进程复跑 = P2-③ 已档哈希（v5 追加无害）——
const FLOW_HASHES = {
  landscape: "24a625c77f5299f7db10ed1ddb83ff7f17787f5c201a9f2a7ddb604456a0efaa",
  portrait: "274f1d0f21658de0266ab97b987b25dd37468bf82d387d5e68a5f300062fa4c5",
};
const flowRun = spawnSync(
  process.execPath,
  [path.join(ROOT, "scripts/video/e2e-flow.mjs")],
  { cwd: ROOT, encoding: "utf8", timeout: 600_000, env: { ...process.env } },
);
if (flowRun.status !== 0)
  fail("A1 flow 复跑", `${flowRun.stdout ?? ""}\n${flowRun.stderr ?? ""}`);
for (const [aspect, want] of Object.entries(FLOW_HASHES)) {
  const m = `${flowRun.stdout}`.match(
    new RegExp(`双跑一致: ${aspect} ([0-9a-f]{64})`),
  );
  if (!m || m[1] !== want)
    fail("A1 金标准", `${aspect}: ${m?.[1] ?? "(无输出)"} ≠ ${want}`);
}
console.log("[e2e-stick] A1: flow 复跑哈希 = P2-③ 已档（注册表 v5 追加无害）");
```
（`spawnSync`/`path` 已在文件头 import；`OK` 总结行加「A1 flow 金标准一致」。）

- [ ] **Step 2: registry + 前置构建**

`qa/registry.json` 在 VID-019 条目后追加（结构同 VID-019：tier `integration`、argv `["node","scripts/video/e2e-stick.mjs"]`、`requiresPorts: [3211]`、title `Video Studio stickman templates and edit loop (figure actions)`、checks 5 条英文：template dropdown fourth group applies stick-figure; data edit round-trips figures with action words; narration edit merges in single apply; renders both aspects deterministic with flow baseline unchanged; no TTS billing)。

Run: `pnpm --filter @acs/video-scene test`（tsc 重建 dist → dev/代理端拿到 v5）
Expected: 全绿。

- [ ] **Step 3: 跑 e2e（RED 语义：脚本若逻辑错则 exit 1）**

Run: `node scripts/video/e2e-stick.mjs`
Expected: exit 0；输出含 `[e2e-stick] OK:`、双画幅双跑一致 SHA、帧 80/140 YAVG≥100、`A1: flow 复跑哈希 = P2-③ 已档`。任何 FAIL 行 = 排查（沿 systematic-debugging，修脚本或实现——实现缺陷回对应任务补 RED 测试）。

- [ ] **Step 4: 回归 + 证据 + 登记**

Run: `pnpm --filter @acs/video-document test` → 71/71；`node --test scripts/video/*.test.mjs` → 57；`pnpm qa:validate` → validate/smoke 计数 +1（VID-020 入列）；`pnpm exec biome check apps/web/src/app/video-studio packages/video-scene/src scripts/video/e2e-stick.mjs` → 0 error。

写 `artifacts/video-studio-stick/E2E_STICK.md`（沿 E2E_FLOW.md 结构：链路/结果/产物与可复核性，含新双画幅 SHA-256、A1 flow 哈希、台账行数）。`CURRENT_STATE.md` 顶部插 P2-④ 条目（提交号、几何/动作表摘要、v5、模板清单、e2e 数字、回归计数）。

- [ ] **Step 5: Commit**

```bash
git add scripts/video/e2e-stick.mjs qa/registry.json AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md
git commit -m "feat(video-studio): P2-④ 火柴人收口——e2e VID-020、A1 金标准与登记

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

（`artifacts/video-studio-stick/` 按 gitignore 不入库。）

---

## Self-Review 记录（写完即查，问题就地改）

1. **Spec 覆盖**：R1→T1（组件+注册表）；R2→T1 测试 1-9（几何/动作/镜像/确定性）；R3→T1 测试 10；R4→T2+T3（模板/编辑/接线，e2e T4 断言闭环与合并）；R5→T4（YAVG/双跑/A1/零计费/登记）。错误表全表→T1 测试 10（组件侧）+T2 测试 6（工作台侧）。✓
2. **占位扫描**：无 TBD/TODO；T1 Step 1 的占位测试已显式标注删除。✓
3. **类型一致性**：`StickEditDraft`/`stickFigure`/`STICK_TEMPLATES` 等名在 T2 Produces 与 T3 消费逐字一致；e2e 消费 DOM 类与 T3 Produces 一致。✓
4. **Review Focus**：5 条各有归属测试/守门（见各条）。✓
