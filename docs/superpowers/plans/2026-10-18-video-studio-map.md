# Video Studio P2-② 地图动画（示意网格地图 + 路径行程）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 video-scene 追加两个地图题材组件（map-grid 示意网格地图 / map-journey 路径行程）并接入工作台起点模板与数据编辑，零新依赖、零计费，e2e VID-018 收口。

**Architecture:** 程序化 SVG 手写（沿 P2-① 图表三件套先例：1000×1000 设计空间嵌套 svg、纯 render、validateParams 中文消息）；注册表 v2→v3 只追加；工作台经新纯逻辑模块 `map-templates.ts`（沿 `chart-templates.ts` 模式）接模板下拉 optgroup 分组与数据编辑；planner 零改动。e2e 以 dataviz e2e 媒体哈希为新 A1 金标准。

**Tech Stack:** TypeScript · node:test（packages 内）· React/Next（web 接线）· Playwright + ffmpeg signalstats（e2e）。

**Spec:** `docs/superpowers/specs/2026-10-18-video-studio-map-design.md`（权威依据，任务内冲突以 spec 为准）

## Global Constraints

- 零新依赖：不引 d3-geo/GeoJSON/任何 npm 包（spec 方案裁定；真实轮廓另刀评估）。
- 注册表只追加：`defaultRegistry` v2→**v3**，一次 bump 覆盖 Task 1/2（分支原子落地）；不改旧组件。
- 帧确定性：render 纯函数，禁墙钟/未播种随机/网络；同 spec 同帧双调 `deepEqual`（`determinism-gate.test.ts` 自动扫描 `src/components/*.ts`）。
- 坐标边界 0..1000（设计空间内）、value 0..1e12、颜色 `#rrggbb`、enterMs/drawMs 整数 200..6000（spec 数据模型）。
- planner 零改动（spec 裁定：地图进画面唯一路径 = 工作台模板选择）。
- 工作台非法编辑行内报错、不落 patch（C1 语义）；模板应用与并发草稿编辑合并落库（P2-① 终评 I1 语义，不得回退）。
- 媒体不入库（mp4/png/gitignore）；e2e 全程零 TTS 计费（台账行数不变）。
- 提交尾注 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 测试命令：video-scene `pnpm --filter @acs/video-scene run build` 后 `node --test packages/video-scene/dist/**/*.test.js`；web `pnpm --filter @acs/web test`；新文件过 `npx biome check --write`。

## Review Focus

1. **重合点/零长行程**（origin 与 destination 同坐标）→ 采样弧长 total=0 → marker 停起点、attrs 无 NaN —— Task 2 测试「重合点守卫」。
2. **单区域网格**（regions 仅 1 个）→ maxRow/maxCol 正常、块居中、cell 不除零 —— Task 1 测试「单区域几何」。
3. **数据行字段自身含逗号**（如标签 `甲,一`）→ 从右取字段解析、round-trip 不丢字 —— Task 3 测试「含逗号标签 round-trip」。
4. **journey 裸坐标行 / 首末行缺名称**（中间点可无名称，起终点必须有）→ 行号错误定位、裸行 waypoint 无标签 —— Task 3 测试「裸坐标与起终点名称必填」。
5. **模板换装并发编辑合并**（换地图模板时同草稿旁白/背景/时长 + 地图数据一起落）→ 不静默丢弃（I1 语义不回退）—— Task 5 e2e「旁白并发合并」断言。

---

### Task 1: map-grid 组件（示意网格地图）

**Files:**
- Create: `packages/video-scene/src/components/map-grid.ts`
- Test: `packages/video-scene/src/components/map-grid.test.ts`
- Modify: `packages/video-scene/src/default-registry.ts`（追加 mapGrid，bump v3）
- Modify: `packages/video-scene/src/index.ts`（追加 export）

**Interfaces:**
- Consumes: `../easing.js` 的 `clamp01`/`easeOutCubic`；`../text-width.js` 的 `fitFontSize`；`../registry.js` 的 `FrameContext`/`SceneComponent`/`SceneSpecLike`；`../svg.js` 的 `SvgNode`。
- Produces: `export const mapGrid: SceneComponent`（componentId `"map-grid"`，version 1）；模块内 `export function hexLerp(from, to, t)`（仅模块级导出供测试，不入 index.ts 公共 API）。params 形状见 spec（regions 1..24 个 `{label 1..8, row 0..7 整数, col 0..7 整数, value? 0..1e12}`、baseColor/highlightColor/textColor、enterMs）。Task 3 的模板与 Task 5 的 e2e 消费此形状。

- [ ] **Step 1: 写失败测试**

`packages/video-scene/src/components/map-grid.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { FrameContext } from "../registry.js";
import type { SvgNode } from "../svg.js";
import { hexLerp, mapGrid } from "./map-grid.js";

// collect 为各组件测试私有惯例（bar/line/counter 同款），不跨文件共享
function collect(node: SvgNode, tag: string, out: SvgNode[] = []): SvgNode[] {
  if (node.tag === tag) out.push(node);
  for (const child of node.children ?? []) collect(child, tag, out);
  return out;
}

const BASE = {
  title: "六大区分布",
  regions: [
    { label: "甲", row: 0, col: 0, value: 10 },
    { label: "乙", row: 1, col: 2, value: 50 },
  ],
  baseColor: "#000000",
  highlightColor: "#ffffff",
  textColor: "#1b2c29",
  enterMs: 200,
};

function specWith(params: unknown) {
  return { componentId: "map-grid", componentVersion: 1, params, seed: 1, background: "#ffffff", durationMs: 3000 };
}
function makeCtx(overrides: Partial<FrameContext> = {}): FrameContext {
  return { frame: 24, fps: 24, width: 1920, height: 1080, ...overrides } as FrameContext;
}

test("校验表：越界输入逐项拒绝", () => {
  const cases: Array<[unknown, RegExp]> = [
    [{ ...BASE, regions: [] }, /regions 必须是 1\.\.24 个/],
    [{ ...BASE, regions: Array.from({ length: 25 }, (_, i) => ({ label: `R${i}`, row: 0, col: 0 })) }, /regions 必须是 1\.\.24 个/],
    [{ ...BASE, regions: [{ label: "", row: 0, col: 0 }] }, /label 必须是 1\.\.8 个字符/],
    [{ ...BASE, regions: [{ label: "九字标签超限了", row: 0, col: 0 }] }, /label 必须是 1\.\.8 个字符/],
    [{ ...BASE, regions: [{ label: "甲", row: 1.5, col: 0 }] }, /row \/ col 必须是 0\.\.7 的整数/],
    [{ ...BASE, regions: [{ label: "甲", row: 0, col: 8 }] }, /row \/ col 必须是 0\.\.7 的整数/],
    [{ ...BASE, regions: [{ label: "甲", row: 0, col: 0, value: -1 }] }, /value 必须是 0\.\.1e12 的数/],
    [{ ...BASE, baseColor: "red" }, /baseColor 必须是 #rrggbb/],
    [{ ...BASE, enterMs: 100 }, /enterMs 必须是 200\.\.6000 的整数/],
    [{ ...BASE, title: "x".repeat(41) }, /title 必须是 ≤40 个字符/],
  ];
  for (const [params, re] of cases) {
    assert.throws(() => mapGrid.validateParams(params), re);
  }
});

test("hexLerp：端点、中点、越界钳制", () => {
  assert.equal(hexLerp("#000000", "#ffffff", 0), "#000000");
  assert.equal(hexLerp("#000000", "#ffffff", 1), "#ffffff");
  assert.equal(hexLerp("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(hexLerp("#000000", "#ffffff", 2), "#ffffff");
  assert.equal(hexLerp("#102030", "#304050", 0.5), "#203040");
});

test("网格几何：row/col 唯一决定块位置与尺寸，网格整体居中", () => {
  // 区 x 140..860（宽 720）、y 220..820（高 600）；rows=2, cols=3
  // cell = min(720/3, 600/2) = 240；块 = 240×0.86 = 206.4
  // ox = 140 + (720-720)/2 = 140；oy = 220 + (600-480)/2 = 280
  const node = mapGrid.render(specWith(BASE) as never, makeCtx());
  const rects = collect(node, "rect");
  // 背景 rect + 2 块
  assert.equal(rects.length, 3);
  const a = rects[1]!.attrs;
  const b = rects[2]!.attrs;
  // 甲 (0,0)：cx = 140+120=260, cy = 280+120=400
  assert.equal(a.x, 260 - 206.4 / 2);
  assert.equal(a.y, 400 - 206.4 / 2);
  assert.equal(a.width, 206.4);
  assert.equal(a.height, 206.4);
  // 乙 (1,2)：cx = 140+2×240+120=640, cy = 280+240+120=640
  assert.equal(b.x, 640 - 206.4 / 2);
  assert.equal(b.y, 640 - 206.4 / 2);
});

test("单区域几何：不除零、块居中", () => {
  const node = mapGrid.render(
    specWith({ ...BASE, regions: [{ label: "孤", row: 0, col: 0 }] }) as never,
    makeCtx(),
  );
  const rects = collect(node, "rect");
  // rows=1, cols=1 → cell = min(720,600)=600；块 516；ox=140+60=200, oy=220
  assert.equal(rects[1]!.attrs.width, 516);
  assert.ok(!JSON.stringify(node).includes("NaN"));
});

test("无值区域全 baseColor；value=0 也映射 baseColor（t=0）", () => {
  const noValue = mapGrid.render(
    specWith({ ...BASE, regions: [{ label: "甲", row: 0, col: 0 }] }) as never,
    makeCtx(),
  );
  assert.equal(collect(noValue, "rect")[1]!.attrs.fill, "#000000");
  const zero = mapGrid.render(
    specWith({ ...BASE, regions: [{ label: "甲", row: 0, col: 0, value: 0 }] }) as never,
    makeCtx(),
  );
  assert.equal(collect(zero, "rect")[1]!.attrs.fill, "#000000");
});

test("choropleth：value/maxValue 决定插值色（max 本身 t=1/1.1）", () => {
  const node = mapGrid.render(specWith(BASE) as never, makeCtx({ frame: 24 * 5 }));
  const fills = collect(node, "rect").slice(1).map((r) => r.attrs.fill);
  // maxValue = 50×1.1 = 55 → 乙 t = 50/55 = 10/11
  assert.equal(fills[1], hexLerp("#000000", "#ffffff", 10 / 11));
});

test("梯次淡入：逐块 90ms 延迟；标签在块完成后 300ms 淡入", () => {
  // enterMs=200；tMs=100 → 甲 appear=easeOutCubic(0.5)≈0.875，乙 delay=90 → easeOutCubic(0.05)≈0.1426
  const mid = mapGrid.render(specWith(BASE) as never, makeCtx({ frame: 2.4 }));
  const opacities = collect(mid, "rect").slice(1).map((r) => r.attrs.opacity);
  assert.ok(Math.abs((opacities[0] as number) - 0.875) < 1e-9);
  assert.ok(Math.abs((opacities[1] as number) - (1 - 0.95 ** 3)) < 1e-9);
  const midTexts = collect(mid, "text").map((t) => t.attrs.opacity);
  assert.equal(midTexts.filter((o) => (o as number) === 0).length >= 1, true);
  const end = mapGrid.render(specWith(BASE) as never, makeCtx({ frame: 24 * 3 }));
  assert.deepEqual(
    collect(end, "rect").slice(1).map((r) => r.attrs.opacity),
    [1, 1],
  );
  assert.deepEqual(
    collect(end, "text").filter((t) => t.text !== BASE.title).map((t) => t.attrs.opacity),
    [1, 1],
  );
});

test("纯函数：同 spec 同帧双调 deepEqual", () => {
  const s = specWith(BASE) as never;
  assert.deepEqual(mapGrid.render(s, makeCtx({ frame: 13 })), mapGrid.render(s, makeCtx({ frame: 13 })));
});

test("全零值守卫：maxValue 归一 1、无 NaN", () => {
  const node = mapGrid.render(
    specWith({ ...BASE, regions: [
      { label: "甲", row: 0, col: 0, value: 0 },
      { label: "乙", row: 0, col: 1, value: 0 },
    ] }) as never,
    makeCtx({ frame: 24 * 3 }),
  );
  assert.ok(!JSON.stringify(node).includes("NaN"));
});
```

注：`FrameContext.frame` 类型为 `number`（registry.ts:6），非整数限定——测试里 `frame: 2.4, fps: 24` → tMs=100 合法且确定（tMs 数学连续，不依赖取整）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @acs/video-scene run build && node --test packages/video-scene/dist/components/map-grid.test.js`
Expected: FAIL —— `Cannot find module './map-grid.js'`（或等价模块缺失错误）。

- [ ] **Step 3: 实现 map-grid**

`packages/video-scene/src/components/map-grid.ts`：

```ts
import { clamp01, easeOutCubic } from "../easing.js";
import type {
  FrameContext,
  SceneComponent,
  SceneSpecLike,
} from "../registry.js";
import type { SvgNode } from "../svg.js";
import { fitFontSize } from "../text-width.js";

// 示意网格地图（tile-grid cartogram）v1：区域方块按 row/col 网格排布（示意
// 表达，非真实地理轮廓——spec 裁定零依赖），可选数值 choropleth 着色。逐块
// 90ms 梯次淡入 + 微缩放；标签在块完成后 300ms 淡入。1000×1000 设计空间嵌套
// svg viewBox；render 纯函数，禁墙钟/随机/网络。

type MapGridParams = {
  title: string;
  regions: Array<{
    label: string;
    row: number;
    col: number;
    value?: number;
  }>;
  baseColor: string;
  highlightColor: string;
  textColor: string;
  enterMs: number; // 200..6000
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DESIGN_SPACE = 1000;
// 网格区（设计空间坐标）：x 140..860，y 220..820
const LEFT = 140;
const RIGHT = 860;
const TOP = 220;
const BOTTOM = 820;
const AREA_W = RIGHT - LEFT;
const AREA_H = BOTTOM - TOP;
const BLOCK_RATIO = 0.86;
const STAGGER_MS = 90;
const LABEL_FADE_MS = 300;
const MAX_REGIONS = 24;
const MAX_VALUE = 1e12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

// choropleth 插值：from→to 按 t（先钳 [0,1]）线性混合，输出 #rrggbb。
export function hexLerp(from: string, to: string, t: number): string {
  const x = clamp01(t);
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const mixed = a.map((v, i) => Math.round(v + (b[i]! - v) * x));
  return `#${mixed.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function validateParams(value: unknown): MapGridParams {
  if (!isRecord(value)) throw new Error("map-grid params 必须是对象");
  if (typeof value.title !== "string" || value.title.length > 40) {
    throw new Error("map-grid params.title 必须是 ≤40 个字符");
  }
  if (
    !Array.isArray(value.regions) ||
    value.regions.length < 1 ||
    value.regions.length > MAX_REGIONS
  ) {
    throw new Error(
      `map-grid params.regions 必须是 1..${MAX_REGIONS} 个 {label, row, col, value?}`,
    );
  }
  value.regions.forEach((region, i) => {
    if (!isRecord(region))
      throw new Error(`map-grid params.regions[${i}] 必须是对象`);
    if (
      typeof region.label !== "string" ||
      region.label.length < 1 ||
      region.label.length > 8
    ) {
      throw new Error(
        `map-grid params.regions[${i}].label 必须是 1..8 个字符`,
      );
    }
    for (const key of ["row", "col"] as const) {
      const v = region[key];
      if (
        typeof v !== "number" ||
        !Number.isInteger(v) ||
        v < 0 ||
        v > 7
      ) {
        throw new Error(
          `map-grid params.regions[${i}].row / col 必须是 0..7 的整数`,
        );
      }
    }
    if (region.value !== undefined) {
      const v = region.value;
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        v < 0 ||
        v > MAX_VALUE
      ) {
        throw new Error(
          `map-grid params.regions[${i}].value 必须是 0..${MAX_VALUE} 的数`,
        );
      }
    }
  });
  if (!isHexColor(value.baseColor))
    throw new Error("map-grid params.baseColor 必须是 #rrggbb");
  if (!isHexColor(value.highlightColor))
    throw new Error("map-grid params.highlightColor 必须是 #rrggbb");
  if (!isHexColor(value.textColor))
    throw new Error("map-grid params.textColor 必须是 #rrggbb");
  if (
    !Number.isInteger(value.enterMs) ||
    (value.enterMs as number) < 200 ||
    (value.enterMs as number) > 6000
  ) {
    throw new Error("map-grid params.enterMs 必须是 200..6000 的整数");
  }
  return value as MapGridParams;
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const params = spec.params as MapGridParams;
  const tMs = (ctx.frame / ctx.fps) * 1000;

  const values = params.regions
    .map((r) => r.value)
    .filter((v): v is number => v !== undefined);
  const hasValues = values.length > 0;
  // choropleth 上限 = max×1.1；全零归一为 1 防除零（同 bar-chart 口径）
  const maxValue = hasValues ? Math.max(...values) * 1.1 || 1 : 1;

  const rows = Math.max(...params.regions.map((r) => r.row)) + 1;
  const cols = Math.max(...params.regions.map((r) => r.col)) + 1;
  const cell = Math.min(AREA_W / cols, AREA_H / rows);
  const block = cell * BLOCK_RATIO;
  // 网格整体在网格区内居中
  const ox = LEFT + (AREA_W - cell * cols) / 2;
  const oy = TOP + (AREA_H - cell * rows) / 2;

  const blocks: SvgNode[] = [];
  const labels: SvgNode[] = [];
  params.regions.forEach((region, i) => {
    const delay = i * STAGGER_MS;
    const appear = easeOutCubic(clamp01((tMs - delay) / params.enterMs));
    const cx = ox + region.col * cell + cell / 2;
    const cy = oy + region.row * cell + cell / 2;
    const fill =
      hasValues && region.value !== undefined
        ? hexLerp(params.baseColor, params.highlightColor, region.value / maxValue)
        : params.baseColor;
    blocks.push({
      tag: "rect",
      attrs: {
        x: cx - block / 2,
        y: cy - block / 2,
        width: block,
        height: block,
        rx: 10,
        fill,
        opacity: appear,
        // 微缩放：0.9 → 1（绕块中心）
        transform: `translate(${cx} ${cy}) scale(${(0.9 + 0.1 * appear).toFixed(4)}) translate(${-cx} ${-cy})`,
      },
    });
    const fontSize = fitFontSize(22, region.label, block * 0.8);
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
      text: region.label,
    });
  });

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
          ...blocks,
          ...labels,
        ],
      },
    ],
  };
}

export const mapGrid: SceneComponent = {
  componentId: "map-grid",
  version: 1,
  validateParams,
  render,
};
```

`packages/video-scene/src/default-registry.ts`：import 追加 `import { mapGrid } from "./components/map-grid.js";`（按字母序排在 lineDrawing 之后？按文件既有 import 排序规则插入），数组改为 `[textAnimation, lineDrawing, basicShapes, barChart, lineChart, numberCounter, mapGrid]`，第二参 `2` → `3`。

`packages/video-scene/src/index.ts`：按字母序追加 `export * as mapGrid from "./components/map-grid.js";`（对照 line-chart/bar-chart 的既有导出写法）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @acs/video-scene run build && node --test "packages/video-scene/dist/**/*.test.js"`
Expected: PASS 全绿（58 + 本文件新增 ≈ 9，含既有 58 无回归）。

- [ ] **Step 5: Biome + Commit**

Run: `npx biome check --write packages/video-scene/src/components/map-grid.ts packages/video-scene/src/components/map-grid.test.ts packages/video-scene/src/default-registry.ts packages/video-scene/src/index.ts` 后重跑 Step 4 确认仍绿。

```bash
git add packages/video-scene/src/components/map-grid.ts packages/video-scene/src/components/map-grid.test.ts packages/video-scene/src/default-registry.ts packages/video-scene/src/index.ts
git commit -m "feat(video-scene): map-grid 示意网格地图组件 v1（choropleth 着色）+ 注册表 v3

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: map-journey 组件（路径行程）

**Files:**
- Create: `packages/video-scene/src/components/map-journey.ts`
- Test: `packages/video-scene/src/components/map-journey.test.ts`
- Modify: `packages/video-scene/src/default-registry.ts`（追加 mapJourney，仍 v3）
- Modify: `packages/video-scene/src/index.ts`（追加 export）

**Interfaces:**
- Consumes: 同 Task 1 的基础导入。
- Produces: `export const mapJourney: SceneComponent`（componentId `"map-journey"`，version 1）。params 见 spec（origin/destination `{label 1..8, x 0..1000, y 0..1000}` 必填、waypoints 0..6 个 `{label? ≤8, x, y}`、routeColor/markerColor/pinColor/textColor、drawMs）。Task 3/5 消费此形状。

- [ ] **Step 1: 写失败测试**

`packages/video-scene/src/components/map-journey.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { FrameContext } from "../registry.js";
import { mapJourney } from "./map-journey.js";

function collect(node: { tag: string; children?: unknown[]; [k: string]: unknown }, tag: string, out: Array<Record<string, unknown> & { tag: string }> = []) {
  if (node.tag === tag) out.push(node as never);
  for (const child of ((node as { children?: Array<unknown> }).children ?? []) as unknown[])
    collect(child as never, tag, out);
  return out;
}

const BASE = {
  title: "两城行程",
  origin: { label: "甲城", x: 200, y: 500 },
  destination: { label: "乙城", x: 800, y: 500 },
  waypoints: [],
  routeColor: "#2f6f4f",
  markerColor: "#d9822b",
  pinColor: "#c0392b",
  textColor: "#1b2c29",
  drawMs: 1000,
};
const BASE_WP = {
  ...BASE,
  origin: { label: "甲城", x: 200, y: 500 },
  destination: { label: "丁城", x: 800, y: 500 },
  waypoints: [
    { label: "乙站", x: 400, y: 400 },
    { label: "丙站", x: 600, y: 600 },
  ],
};

function specWith(params: unknown) {
  return { componentId: "map-journey", componentVersion: 1, params, seed: 1, background: "#ffffff", durationMs: 3000 };
}
function ctxAt(ms: number): FrameContext {
  // frame 类型为 number（非整数限定）：分数帧 → tMs 精确等于 ms
  return { frame: (ms / 1000) * 24, fps: 24, width: 1920, height: 1080 } as FrameContext;
}

test("校验表：越界输入逐项拒绝", () => {
  const cases: Array<[unknown, RegExp]> = [
    [{ ...BASE, origin: { label: "", x: 1, y: 1 } }, /origin 必须是 \{label, x, y\}/],
    [{ ...BASE, destination: { label: "乙", x: -5, y: 1 } }, /destination\.\S* 必须是 0\.\.1000 的数|x \/ y 必须是 0\.\.1000 的数/],
    [{ ...BASE, waypoints: Array.from({ length: 7 }, () => ({ x: 1, y: 1 })) }, /waypoints 必须是 0\.\.6 个/],
    [{ ...BASE, waypoints: [{ x: 100, y: 2001 }] }, /x \/ y 必须是 0\.\.1000 的数/],
    [{ ...BASE, routeColor: "#12345" }, /routeColor 必须是 #rrggbb/],
    [{ ...BASE, drawMs: 199 }, /drawMs 必须是 200\.\.6000 的整数/],
    [{ ...BASE, title: "t".repeat(41) }, /title 必须是 ≤40 个字符/],
  ];
  for (const [params, re] of cases) assert.throws(() => mapJourney.validateParams(params), re);
});

test("两点直线路径：d 为 M + 单段 C；marker 等速走弧长（直线可精确断言）", () => {
  const node = mapJourney.render(specWith(BASE) as never, ctxAt(0));
  const paths = collect(node, "path").filter((p) => (p.attrs as { d?: string }).d);
  assert.equal(paths.length, 1);
  const d = paths[0]!.attrs.d as string;
  assert.ok(d.startsWith("M 200.00,500.00 C"));
  assert.equal(d.split(" C ").length, 2);
  // progress=easeOutCubic(0.5)=0.875 → 弧长 0.875×600 → x = 200+525=725
  const mid = mapJourney.render(specWith(BASE) as never, ctxAt(500));
  const marker = collect(mid, "circle").find(
    (c) => (c.attrs as { fill?: string }).fill === BASE.markerColor,
  )!;
  assert.equal(marker.attrs.cx, 725);
  // 末帧 marker 到终点
  const end = mapJourney.render(specWith(BASE) as never, ctxAt(2000));
  const endMarker = collect(end, "circle").find(
    (c) => (c.attrs as { fill?: string }).fill === BASE.markerColor,
  )!;
  assert.equal(endMarker.attrs.cx, 800);
});

test("描画进度：dashoffset 1 → 中间 ∈(0,1) → 0", () => {
  const route = (ms: number) =>
    (collect(mapJourney.render(specWith(BASE) as never, ctxAt(ms)), "path")
      .find((p) => (p.attrs as { d?: string }).d)!.attrs as Record<string, number | string>);
  assert.equal(route(0)["stroke-dashoffset"], 1);
  const mid = route(500)["stroke-dashoffset"] as number;
  assert.ok(mid > 0 && mid < 1, `mid=${mid}`);
  assert.equal(route(2000)["stroke-dashoffset"], 0);
});

test("waypoint 圆标时窗：末帧全部 r=9（含末点 frac 钳制）", () => {
  const end = mapJourney.render(specWith(BASE_WP) as never, ctxAt(3000));
  const radii = collect(end, "circle")
    .filter((c) => (c.attrs as { fill?: string }).fill === BASE.routeColor)
    .map((c) => c.attrs.r);
  assert.deepEqual(radii, [9, 9]);
});

test("图钉落下窗口：起点 0..20%、终点 60..80%", () => {
  // tMs=100（drawMs×0.1）：origin pinP=easeOutCubic(0.5)≈0.875；dest pin=0
  const early = mapJourney.render(specWith(BASE) as never, ctxAt(100));
  const pins = collect(early, "g").filter((g) => typeof (g.attrs as { transform?: string }).transform?.toString().startsWith("translate"));
  assert.equal(pins.length, 2);
  assert.ok(Math.abs(((pins[0]!.attrs.opacity as number) ?? 0) - 0.875) < 1e-9);
  assert.equal(pins[1]!.attrs.opacity, 0);
  // 末帧：两钉 opacity 1、scale 1
  const end = mapJourney.render(specWith(BASE) as never, ctxAt(2000));
  const endPins = collect(end, "g").filter((g) => typeof (g.attrs as { transform?: string }).transform === "string");
  assert.deepEqual(endPins.map((p) => p.attrs.opacity), [1, 1]);
  for (const p of endPins)
    assert.ok((p.attrs.transform as string).includes("scale(1.0000)"));
});

test("重合点守卫：origin==destination 无 NaN、marker 停起点", () => {
  const node = mapJourney.render(
    specWith({ ...BASE, destination: { label: "乙城", x: 200, y: 500 } }) as never,
    ctxAt(2000),
  );
  assert.ok(!JSON.stringify(node).includes("NaN"));
  const marker = collect(node, "circle").find(
    (c) => (c.attrs as { fill?: string }).fill === BASE.markerColor,
  )!;
  assert.equal(marker.attrs.cx, 200);
});

test("纯函数：同 spec 同帧双调 deepEqual", () => {
  const s = specWith(BASE_WP) as never;
  assert.deepEqual(mapJourney.render(s, ctxAt(350)), mapJourney.render(s, ctxAt(350)));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @acs/video-scene run build && node --test packages/video-scene/dist/components/map-journey.test.js`
Expected: FAIL —— `Cannot find module './map-journey.js'`。

- [ ] **Step 3: 实现 map-journey**

`packages/video-scene/src/components/map-journey.ts`：

```ts
import { clamp01, easeOutCubic } from "../easing.js";
import type {
  FrameContext,
  SceneComponent,
  SceneSpecLike,
} from "../registry.js";
import type { SvgNode } from "../svg.js";
import { fitFontSize } from "../text-width.js";

// 路径行程组件 v1：起终点图钉 + Catmull-Rom 样条（τ=0.5，端点复制法转
// cubic bezier）整条描画（pathLength=1 + dashoffset，同 line-drawing 口径）
// + 移动标记等速走采样弧长（每段 24 采样折线累计，与 line-chart 圆标同一
// 数学先例；视觉误差 <1px）+ 途经点圆标（越点 5% 进度窗口弹出，末点 frac
// 钳 1−窗口——P2-① Task 3 Ruling）。1000×1000 设计空间嵌套 svg viewBox；
// render 纯函数，禁墙钟/随机/网络。

type JPoint = { label?: string; x: number; y: number };
type MapJourneyParams = {
  title: string;
  origin: { label: string; x: number; y: number };
  destination: { label: string; x: number; y: number };
  waypoints: JPoint[];
  routeColor: string;
  markerColor: string;
  pinColor: string;
  textColor: string;
  drawMs: number; // 200..6000
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DESIGN_SPACE = 1000;
const MARKER_R = 9;
const MARKER_WINDOW = 0.05;
const SEGMENT_SAMPLES = 24;
const MAX_WAYPOINTS = 6;
const COORD_MAX = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function validatePoint(
  value: unknown,
  at: string,
  labelRequired: boolean,
): void {
  if (!isRecord(value))
    throw new Error(`map-journey params.${at} 必须是 {label, x, y}`);
  if (labelRequired) {
    if (
      typeof value.label !== "string" ||
      value.label.length < 1 ||
      value.label.length > 8
    ) {
      throw new Error(`map-journey params.${at}.label 必须是 1..8 个字符`);
    }
  } else if (
    value.label !== undefined &&
    (typeof value.label !== "string" || value.label.length > 8)
  ) {
    throw new Error(`map-journey params.${at}.label 必须是 ≤8 个字符`);
  }
  for (const key of ["x", "y"] as const) {
    const v = value[key];
    if (
      typeof v !== "number" ||
      !Number.isFinite(v) ||
      v < 0 ||
      v > COORD_MAX
    ) {
      throw new Error(`map-journey params.${at}.x / y 必须是 0..1000 的数`);
    }
  }
}

function validateParams(value: unknown): MapJourneyParams {
  if (!isRecord(value)) throw new Error("map-journey params 必须是对象");
  if (typeof value.title !== "string" || value.title.length > 40) {
    throw new Error("map-journey params.title 必须是 ≤40 个字符");
  }
  validatePoint(value.origin, "origin", true);
  validatePoint(value.destination, "destination", true);
  if (!Array.isArray(value.waypoints) || value.waypoints.length > MAX_WAYPOINTS) {
    throw new Error(
      `map-journey params.waypoints 必须是 0..${MAX_WAYPOINTS} 个 {label?, x, y}`,
    );
  }
  value.waypoints.forEach((wp, i) => validatePoint(wp, `waypoints[${i}]`, false));
  for (const key of ["routeColor", "markerColor", "pinColor", "textColor"] as const) {
    if (!isHexColor(value[key]))
      throw new Error(`map-journey params.${key} 必须是 #rrggbb`);
  }
  if (
    !Number.isInteger(value.drawMs) ||
    (value.drawMs as number) < 200 ||
    (value.drawMs as number) > 6000
  ) {
    throw new Error("map-journey params.drawMs 必须是 200..6000 的整数");
  }
  return value as MapJourneyParams;
}

// Catmull-Rom（τ=0.5）→ 每段 cubic bezier 控制点。
function segmentControl(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
): [{ x: number; y: number }, { x: number; y: number }] {
  return [
    { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
    { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
  ];
}

function cubicAt(
  p0: { x: number; y: number },
  c1: { x: number; y: number },
  c2: { x: number; y: number },
  p1: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const u = 1 - t;
  return {
    x:
      u * u * u * p0.x +
      3 * u * u * t * c1.x +
      3 * u * t * t * c2.x +
      t * t * t * p1.x,
    y:
      u * u * u * p0.y +
      3 * u * u * t * c1.y +
      3 * u * t * t * c2.y +
      t * t * t * p1.y,
  };
}

// 弧长 s 处的采样折线插值点（samples/cum 等长，cum 单调不减）。
function pointAtArc(
  samples: Array<{ x: number; y: number }>,
  cum: number[],
  s: number,
): { x: number; y: number } {
  let k = 0;
  while (k < cum.length - 2 && cum[k + 1]! < s) k += 1;
  const span = cum[k + 1]! - cum[k]! || 1;
  const f = clamp01((s - cum[k]!) / span);
  const a = samples[k]!;
  const b = samples[k + 1]!;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

function pin(
  x: number,
  y: number,
  progress01: number,
  color: string,
): SvgNode {
  // 落下：scale 1.6 → 1 + 淡入
  const scale = 1 + 0.6 * (1 - progress01);
  return {
    tag: "g",
    attrs: {
      transform: `translate(${x} ${y}) scale(${scale.toFixed(4)})`,
      opacity: progress01,
    },
    children: [
      { tag: "circle", attrs: { cx: 0, cy: 0, r: 10, fill: color } },
      { tag: "circle", attrs: { cx: 0, cy: 0, r: 4, fill: "#ffffff" } },
    ],
  };
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const params = spec.params as MapJourneyParams;
  const tMs = (ctx.frame / ctx.fps) * 1000;
  const progress = easeOutCubic(clamp01(tMs / params.drawMs));

  const pts: Array<{ x: number; y: number }> = [
    params.origin,
    ...params.waypoints,
    params.destination,
  ];
  // 路径 d + 分段
  let d = `M ${pts[0]!.x.toFixed(2)},${pts[0]!.y.toFixed(2)}`;
  const segments: Array<{
    p0: { x: number; y: number };
    c1: { x: number; y: number };
    c2: { x: number; y: number };
    p1: { x: number; y: number };
  }> = [];
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p3 = pts[i + 2] ?? pts[i + 1]!;
    const [c1, c2] = segmentControl(p0, pts[i]!, pts[i + 1]!, p3);
    segments.push({ p0: pts[i]!, c1, c2, p1: pts[i + 1]! });
    d += ` C ${c1.x.toFixed(2)},${c1.y.toFixed(2)} ${c2.x.toFixed(2)},${c2.y.toFixed(2)} ${pts[i + 1]!.x.toFixed(2)},${pts[i + 1]!.y.toFixed(2)}`;
  }
  // 采样折线与累计弧长（每段 24 采样）
  const samples: Array<{ x: number; y: number }> = [
    { x: pts[0]!.x, y: pts[0]!.y },
  ];
  const cum: number[] = [0];
  for (const seg of segments) {
    for (let k = 1; k <= SEGMENT_SAMPLES; k += 1) {
      const pt = cubicAt(seg.p0, seg.c1, seg.c2, seg.p1, k / SEGMENT_SAMPLES);
      const prev = samples[samples.length - 1]!;
      samples.push(pt);
      cum.push(cum[cum.length - 1]! + Math.hypot(pt.x - prev.x, pt.y - prev.y));
    }
  }
  // 重合点守卫：全同点 total=0 → 1（marker 停起点，不除零）
  const total = cum[cum.length - 1]! || 1;

  // 途经点圆标（含 frac 钳制，末点在描画收尾窗口弹出）
  const waypointMarkers: SvgNode[] = params.waypoints.map((wp, j) => {
    const sampleIndex = (j + 1) * SEGMENT_SAMPLES;
    const frac = Math.min(cum[sampleIndex]! / total, 1 - MARKER_WINDOW);
    const appear = easeOutCubic(clamp01((progress - frac) / MARKER_WINDOW));
    return { tag: "circle", attrs: { cx: wp.x, cy: wp.y, r: MARKER_R * appear, fill: params.routeColor } };
  });

  // 移动标记（等速走弧长）
  const markerPos = pointAtArc(samples, cum, progress * total);

  // 图钉窗口：起点 0..20%、终点 60..80%（drawMs 计）
  const originPin = easeOutCubic(clamp01(tMs / (params.drawMs * 0.2)));
  const destPin = easeOutCubic(
    clamp01((tMs - params.drawMs * 0.6) / (params.drawMs * 0.2)),
  );

  // 浅网格底纹：5×5（100..900 步 200），先于一切内容
  const gridLines: SvgNode[] = [];
  for (let v = 100; v <= 900; v += 200) {
    gridLines.push({
      tag: "line",
      attrs: { x1: v, y1: 100, x2: v, y2: 900, stroke: params.textColor, opacity: 0.08, "stroke-width": 2 },
    });
    gridLines.push({
      tag: "line",
      attrs: { x1: 100, y1: v, x2: 900, y2: v, stroke: params.textColor, opacity: 0.08, "stroke-width": 2 },
    });
  }

  const pointLabel = (
    label: string,
    x: number,
    y: number,
    opacity: number,
  ): SvgNode => ({
    tag: "text",
    attrs: {
      x,
      y: y + 34,
      "font-size": fitFontSize(24, label, 220),
      fill: params.textColor,
      "text-anchor": "middle",
      opacity,
    },
    text: label,
  });

  const labels: SvgNode[] = [
    pointLabel(params.origin.label, params.origin.x, params.origin.y, originPin),
    ...params.waypoints.map((wp, j) => {
      const sampleIndex = (j + 1) * SEGMENT_SAMPLES;
      const frac = Math.min(cum[sampleIndex]! / total, 1 - MARKER_WINDOW);
      return pointLabel(
        wp.label ?? "",
        wp.x,
        wp.y,
        wp.label === undefined ? 0 : clamp01((progress - frac) / MARKER_WINDOW),
      );
    }),
    pointLabel(params.destination.label, params.destination.x, params.destination.y, destPin),
  ].filter((node) => (node.text as string).length > 0);

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
          ...gridLines,
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
            tag: "path",
            attrs: {
              d,
              fill: "none",
              stroke: params.routeColor,
              "stroke-width": 8,
              "stroke-linecap": "round",
              pathLength: 1,
              "stroke-dasharray": 1,
              "stroke-dashoffset": Number((1 - progress).toFixed(4)),
            },
          },
          ...waypointMarkers,
          pin(params.origin.x, params.origin.y, originPin, params.pinColor),
          pin(params.destination.x, params.destination.y, destPin, params.pinColor),
          {
            tag: "circle",
            attrs: {
              cx: Number(markerPos.x.toFixed(2)),
              cy: Number(markerPos.y.toFixed(2)),
              r: 12,
              fill: params.markerColor,
              stroke: "#ffffff",
              "stroke-width": 3,
            },
          },
          ...labels,
        ],
      },
    ],
  };
}

export const mapJourney: SceneComponent = {
  componentId: "map-journey",
  version: 1,
  validateParams,
  render,
};
```

`default-registry.ts`：import + 数组追加 `mapJourney`（在 mapGrid 后）；`index.ts` 同 Step 方式追加 export。**registryVersion 仍为 3（Task 1 已 bump，一次覆盖两任务）。**

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @acs/video-scene run build && node --test "packages/video-scene/dist/**/*.test.js"`
Expected: PASS 全绿（Task 1 后计数 + 本文件 ≈ 7）。

- [ ] **Step 5: Biome + Commit**

```bash
git add packages/video-scene/src/components/map-journey.ts packages/video-scene/src/components/map-journey.test.ts packages/video-scene/src/default-registry.ts packages/video-scene/src/index.ts
git commit -m "feat(video-scene): map-journey 路径行程组件 v1（样条描画+弧长标记+图钉）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: map-templates 模板与数据编辑纯逻辑（web）

**Files:**
- Create: `apps/web/src/app/video-studio/map-templates.ts`
- Test: `apps/web/src/app/video-studio/map-templates.test.ts`

**Interfaces:**
- Consumes: `@acs/video-scene` 的 `defaultRegistry`/`SceneSpec`/`validateSceneSpec`；Task 1/2 的 params 形状。
- Produces:
  - `export type MapTemplate = { templateId: string; componentId: "map-grid" | "map-journey"; label: string; params: Record<string, unknown> }`
  - `export const MAP_TEMPLATES: MapTemplate[]`（5 枚）
  - `export function isMapComponentId(componentId: string): boolean`
  - `export function applyMapTemplate(spec: SceneSpec, templateId: string): { spec: SceneSpec; error: null } | { spec: null; error: string }`
  - `export type MapEditDraft = { title: string; data: string }`
  - `export function draftMapFromSpec(spec: SceneSpec): MapEditDraft`
  - `export function buildMapRevisePatch(spec: SceneSpec, draft: MapEditDraft): { spec: SceneSpec; error: null } | { spec: null; error: string }`
  - Task 4 消费以上全部签名。

- [ ] **Step 1: 写失败测试**

`apps/web/src/app/video-studio/map-templates.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { SceneSpec } from "@acs/video-scene";
import {
  applyMapTemplate,
  buildMapRevisePatch,
  draftMapFromSpec,
  MAP_TEMPLATES,
} from "./map-templates";

const SPEC: SceneSpec = {
  componentId: "text-animation",
  componentVersion: 1,
  seed: 7,
  background: "#f5f0e6",
  durationMs: 3000,
  params: { title: "原标题", subtitle: "副标题" },
};

test("模板应用：保留 durationMs/background/seed，深拷贝不污染模板库", () => {
  const applied = applyMapTemplate(SPEC, "grid-china-6");
  assert.equal(applied.error, null);
  assert.equal(applied.spec!.componentId, "map-grid");
  assert.equal(applied.spec!.seed, 7);
  assert.equal(applied.spec!.background, "#f5f0e6");
  assert.equal(applied.spec!.durationMs, 3000);
  applied.spec!.params.regions[0].label = "污染";
  assert.notEqual(MAP_TEMPLATES.find((t) => t.templateId === "grid-china-6")!.params.regions[0].label, "污染");
});

test("未知 templateId 报错", () => {
  const applied = applyMapTemplate(SPEC, "nope");
  assert.equal(applied.spec, null);
  assert.equal(applied.error, "未知地图模板 nope");
});

test("grid draft round-trip：有值/无值混合", () => {
  const applied = applyMapTemplate(SPEC, "grid-china-6").spec!;
  const draft = draftMapFromSpec(applied);
  assert.equal(draft.title, "六大区分布示意");
  assert.ok(draft.data.includes("华北,0,1"));
  const rebuilt = buildMapRevisePatch(applied, draft);
  assert.equal(rebuilt.error, null);
  assert.deepEqual(rebuilt.spec!.params.regions, applied.params.regions);
  assert.equal(rebuilt.spec!.params.title, applied.params.title);
});

test("journey draft round-trip：waypoint 无标签 → 裸坐标行", () => {
  const applied = applyMapTemplate(SPEC, "journey-route").spec!;
  applied.params.waypoints = [{ x: 400, y: 400 }];
  const draft = draftMapFromSpec(applied);
  assert.ok(draft.data.includes("\n400,400") || draft.data.includes("400,400"));
  const rebuilt = buildMapRevisePatch(applied, draft);
  assert.equal(rebuilt.error, null);
  assert.deepEqual(rebuilt.spec!.params.waypoints, [{ x: 400, y: 400 }]);
});

test("含逗号标签 round-trip：从右取字段不丢字", () => {
  const applied = applyMapTemplate(SPEC, "grid-china-6").spec!;
  const draft = draftMapFromSpec(applied);
  draft.data = "甲,乙,0,1,30\n丙,1,2\n丁,戊,3,4";
  const rebuilt = buildMapRevisePatch(applied, draft);
  assert.equal(rebuilt.error, null);
  assert.deepEqual(rebuilt.spec!.params.regions[0], { label: "甲,乙", row: 0, col: 1, value: 30 });
  assert.deepEqual(rebuilt.spec!.params.regions[1], { label: "丙", row: 1, col: 2 });
  // 无值 + 标签含逗号：尾三不全数值 → 无值读法（label 吸收逗号）
  assert.deepEqual(rebuilt.spec!.params.regions[2], { label: "丁,戊", row: 3, col: 4 });
});

test("journey 解析：首末行名称必填（行号错误）、裸坐标行为无标签 waypoint", () => {
  const applied = applyMapTemplate(SPEC, "journey-route").spec!;
  const bad = buildMapRevisePatch(applied, { title: "t", data: "200,400\n上海,660,720" });
  assert.equal(bad.spec, null);
  assert.ok(bad.error!.includes("第 1 行"), bad.error);
  const ok = buildMapRevisePatch(applied, {
    title: "t",
    data: "甲,200,400\n500,300\n丙,800,600",
  });
  assert.equal(ok.error, null);
  assert.equal(ok.spec!.params.origin.label, "甲");
  assert.deepEqual(ok.spec!.params.waypoints, [{ x: 500, y: 300 }]);
  assert.equal(ok.spec!.params.destination.label, "丙");
});

test("行号错误 + CRLF/空行/trim 容忍", () => {
  const applied = applyMapTemplate(SPEC, "grid-china-6").spec!;
  const bad = buildMapRevisePatch(applied, { title: "t", data: "甲,0,0\n乙,9,1" });
  assert.equal(bad.spec, null);
  assert.ok(bad.error!.includes("第 2 行"), bad.error);
  const ok = buildMapRevisePatch(applied, {
    title: " t ",
    data: "\r\n  甲,0,0,10  \r\n\r\n乙,0,1 \n",
  });
  assert.equal(ok.error, null);
  assert.equal(ok.spec!.params.title, " t ");
  assert.deepEqual(ok.spec!.params.regions, [
    { label: "甲", row: 0, col: 0, value: 10 },
    { label: "乙", row: 0, col: 1 },
  ]);
});

test("合并保留颜色/时长字段；非法数值不落 patch", () => {
  const applied = applyMapTemplate(SPEC, "grid-china-6").spec!;
  const ok = buildMapRevisePatch(applied, { title: "新题", data: "甲,0,0" });
  assert.equal(ok.error, null);
  assert.equal(ok.spec!.params.baseColor, applied.params.baseColor);
  assert.equal(ok.spec!.params.enterMs, applied.params.enterMs);
  const badValue = buildMapRevisePatch(applied, { title: "t", data: "甲,0,0,-5" });
  assert.equal(badValue.spec, null);
  assert.ok(badValue.error!.includes("第 1 行"), badValue.error);
});

test("空数据行数不足报错（grid 至少 1 行、journey 至少 2 行）", () => {
  const grid = applyMapTemplate(SPEC, "grid-china-6").spec!;
  assert.equal(buildMapRevisePatch(grid, { title: "t", data: "  \n " }).error, "地图数据至少需要一行");
  const journey = applyMapTemplate(SPEC, "journey-route").spec!;
  const one = buildMapRevisePatch(journey, { title: "t", data: "甲,200,400" });
  assert.equal(one.error, "行程数据至少需要起终点两行");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @acs/web test`
Expected: FAIL —— `Cannot find module './map-templates'`。

- [ ] **Step 3: 实现 map-templates.ts**

`apps/web/src/app/video-studio/map-templates.ts`：

```ts
// P2-② 地图动画：地图起点模板与数据编辑纯逻辑（沿 chart-templates.ts 模式）。
// 模板参数过 validateSceneSpec 兜底；非法数据行内报错、不落 patch（C1 语义）。

import {
  defaultRegistry,
  type SceneSpec,
  validateSceneSpec,
} from "@acs/video-scene";

export type MapTemplate = {
  templateId: string;
  componentId: "map-grid" | "map-journey";
  label: string;
  params: Record<string, unknown>;
};

const GRID_COLORS = {
  baseColor: "#c9d7d2",
  highlightColor: "#2f6f4f",
  textColor: "#1b2c29",
};
const JOURNEY_COLORS = {
  routeColor: "#2f6f4f",
  markerColor: "#d9822b",
  pinColor: "#c0392b",
  textColor: "#1b2c29",
};

export const MAP_TEMPLATES: MapTemplate[] = [
  {
    templateId: "grid-china-6",
    componentId: "map-grid",
    label: "中国六分区示意",
    params: {
      title: "六大区分布示意",
      regions: [
        { label: "东北", row: 0, col: 0, value: 9 },
        { label: "华北", row: 0, col: 1, value: 32 },
        { label: "西北", row: 1, col: 0, value: 12 },
        { label: "华东", row: 1, col: 2, value: 45 },
        { label: "西南", row: 2, col: 1, value: 18 },
        { label: "华南", row: 2, col: 2, value: 28 },
      ],
      ...GRID_COLORS,
      enterMs: 1200,
    },
  },
  {
    templateId: "grid-world-6",
    componentId: "map-grid",
    label: "世界六大区示意",
    params: {
      title: "世界大区示意",
      regions: [
        { label: "北美", row: 0, col: 0, value: 26 },
        { label: "欧洲", row: 0, col: 1, value: 30 },
        { label: "亚洲", row: 0, col: 2, value: 48 },
        { label: "南美", row: 1, col: 0, value: 16 },
        { label: "非洲", row: 1, col: 1, value: 22 },
        { label: "大洋", row: 1, col: 2, value: 8 },
      ],
      ...GRID_COLORS,
      enterMs: 1200,
    },
  },
  {
    templateId: "grid-hotspot",
    componentId: "map-grid",
    label: "网格热点突出",
    params: {
      title: "重点区域突出",
      regions: [
        { label: "A区", row: 0, col: 0, value: 10 },
        { label: "B区", row: 0, col: 1, value: 8 },
        { label: "C区", row: 0, col: 2, value: 9 },
        { label: "D区", row: 1, col: 0, value: 50 },
        { label: "E区", row: 1, col: 1, value: 12 },
        { label: "F区", row: 1, col: 2, value: 11 },
      ],
      ...GRID_COLORS,
      enterMs: 1200,
    },
  },
  {
    templateId: "journey-route",
    componentId: "map-journey",
    label: "两城行程",
    params: {
      title: "两城行程",
      origin: { label: "北京", x: 240, y: 420 },
      destination: { label: "上海", x: 660, y: 720 },
      waypoints: [],
      ...JOURNEY_COLORS,
      drawMs: 1600,
    },
  },
  {
    templateId: "journey-multi",
    componentId: "map-journey",
    label: "多站行程",
    params: {
      title: "多站行程",
      origin: { label: "成都", x: 300, y: 560 },
      destination: { label: "上海", x: 700, y: 740 },
      waypoints: [
        { label: "西安", x: 430, y: 380 },
        { label: "武汉", x: 560, y: 560 },
      ],
      ...JOURNEY_COLORS,
      drawMs: 2000,
    },
  },
];

export function isMapComponentId(componentId: string): boolean {
  return componentId === "map-grid" || componentId === "map-journey";
}

export function applyMapTemplate(
  spec: SceneSpec,
  templateId: string,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  const template = MAP_TEMPLATES.find((t) => t.templateId === templateId);
  if (!template) return { spec: null, error: `未知地图模板 ${templateId}` };
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

export type MapEditDraft = {
  title: string;
  data: string; // grid：每行 `标签,行,列[,数值]`；journey：每行 `名称,x,y`（首行起点、末行终点、中间途经；名称可省为裸 `x,y`）
};

export function draftMapFromSpec(spec: SceneSpec): MapEditDraft {
  const params = spec.params as {
    title?: string;
    regions?: Array<{ label: string; row: number; col: number; value?: number }>;
    origin?: { label: string; x: number; y: number };
    destination?: { label: string; x: number; y: number };
    waypoints?: Array<{ label?: string; x: number; y: number }>;
  };
  if (spec.componentId === "map-grid") {
    return {
      title: params.title ?? "",
      data: (params.regions ?? [])
        .map((r) =>
          r.value === undefined
            ? `${r.label},${r.row},${r.col}`
            : `${r.label},${r.row},${r.col},${r.value}`,
        )
        .join("\n"),
    };
  }
  const points = [
    params.origin ?? { label: "", x: 0, y: 0 },
    ...(params.waypoints ?? []),
    params.destination ?? { label: "", x: 0, y: 0 },
  ];
  return {
    title: params.title ?? "",
    data: points
      .map((p) =>
        p.label === undefined ? `${p.x},${p.y}` : `${p.label},${p.x},${p.y}`,
      )
      .join("\n"),
  };
}

// 行解析：从右取字段（标签自身可含逗号）。消歧规则（确定性）：
// 尾三字段全为合法数值（行/列 int 0..7、value 0..1e12）→ 带值读法
//   [.. label, row, col, value]；否则尾两字段合法 → 无值读法 [.. label, row, col]。
// 即「甲,0,1,2」读作 value=2 而非标签「甲,0」——文档化取舍。
function validRowCol(v: number): boolean {
  return Number.isInteger(v) && v >= 0 && v <= 7;
}
function parseGridLine(
  line: string,
): { label: string; row: number; col: number; value?: number } | null {
  const parts = line.split(",").map((p) => p.trim());
  if (parts.length < 3) return null;
  const labelOf = (rest: string[]) => rest.join(",").trim();
  // 带值读法：[...label, row, col, value]（尾三全数值才成立）
  if (parts.length >= 4) {
    const row = Number(parts[parts.length - 3]!);
    const col = Number(parts[parts.length - 2]!);
    const value = Number(parts[parts.length - 1]!);
    const label = labelOf(parts.slice(0, -3));
    if (
      validRowCol(row) &&
      validRowCol(col) &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 1e12 &&
      label.length >= 1 &&
      label.length <= 8
    ) {
      return { label, row, col, value };
    }
  }
  // 无值读法：[...label, row, col]
  const row = Number(parts[parts.length - 2]!);
  const col = Number(parts[parts.length - 1]!);
  const label = labelOf(parts.slice(0, -2));
  if (validRowCol(row) && validRowCol(col) && label.length >= 1 && label.length <= 8) {
    return { label, row, col };
  }
  return null;
}

function parseJourneyLine(
  line: string,
): { label: string | null; x: number; y: number } | null {
  const parts = line.split(",");
  if (parts.length < 2 || parts.length > 3) return null;
  const y = Number(parts.pop()!.trim());
  const x = Number(parts.pop()!.trim());
  const label = parts.length > 0 ? parts.join(",").trim() : "";
  if (label.length > 8) return null;
  if (!Number.isFinite(x) || x < 0 || x > 1000) return null;
  if (!Number.isFinite(y) || y < 0 || y > 1000) return null;
  return { label: label.length > 0 ? label : null, x, y };
}

function splitLines(data: string): string[] {
  return data
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function buildMapRevisePatch(
  spec: SceneSpec,
  draft: MapEditDraft,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  if (!isMapComponentId(spec.componentId)) {
    return { spec: null, error: "当前镜头组件不是地图组件" };
  }
  const lines = splitLines(draft.data);
  let params: Record<string, unknown>;
  if (spec.componentId === "map-grid") {
    if (lines.length < 1) return { spec: null, error: "地图数据至少需要一行" };
    if (lines.length > 24)
      return { spec: null, error: "地图数据最多 24 行（区域上限）" };
    const regions: Array<{ label: string; row: number; col: number; value?: number }> = [];
    for (let i = 0; i < lines.length; i += 1) {
      const parsed = parseGridLine(lines[i]!);
      if (!parsed) {
        return {
          spec: null,
          error: `第 ${i + 1} 行：标签,行,列[,数值] 格式不符（标签 1..8 字符，行/列 0..7 整数，数值 0..1e12）`,
        };
      }
      regions.push(parsed);
    }
    params = { ...(spec.params as Record<string, unknown>), title: draft.title, regions };
  } else {
    if (lines.length < 2)
      return { spec: null, error: "行程数据至少需要起终点两行" };
    if (lines.length > 8)
      return { spec: null, error: "行程数据最多 8 行（起终点 + 途经点上限）" };
    const points = [];
    for (let i = 0; i < lines.length; i += 1) {
      const parsed = parseJourneyLine(lines[i]!);
      if (!parsed) {
        return {
          spec: null,
          error: `第 ${i + 1} 行：名称,x,y 或 x,y 格式不符（名称 ≤8 字符，坐标 0..1000）`,
        };
      }
      points.push(parsed);
    }
    const first = points[0]!;
    const last = points[points.length - 1]!;
    if (first.label === null)
      return { spec: null, error: "第 1 行：起点名称不能为空" };
    if (last.label === null)
      return {
        spec: null,
        error: `第 ${lines.length} 行：终点名称不能为空`,
      };
    params = {
      ...(spec.params as Record<string, unknown>),
      title: draft.title,
      origin: { label: first.label, x: first.x, y: first.y },
      waypoints: points
        .slice(1, -1)
        .map((p) => (p.label === null ? { x: p.x, y: p.y } : { label: p.label, x: p.x, y: p.y })),
      destination: { label: last.label, x: last.x, y: last.y },
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
Expected: PASS 全绿（83 + 本文件 ≈ 9）。

- [ ] **Step 5: Biome + Commit**

```bash
git add apps/web/src/app/video-studio/map-templates.ts apps/web/src/app/video-studio/map-templates.test.ts
git commit -m "feat(video-studio): map-templates 5 枚起点模板与数据编辑纯逻辑

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: 镜头编辑卡接入地图模板下拉与数据编辑

**Files:**
- Modify: `apps/web/src/app/video-studio/shot-editor-card.tsx`
- Modify: `apps/web/src/app/video-studio/video-studio.css`

**Interfaces:**
- Consumes: Task 3 的 `MAP_TEMPLATES`/`applyMapTemplate`/`isMapComponentId`/`MapEditDraft`/`draftMapFromSpec`/`buildMapRevisePatch`；既有 chart-templates 全套与 P2-① I1 合并语义。
- Produces: DOM 选择器——模板下拉仍为 `.chart-template-select`（内部 optgroup 分组「图表」「地图」）；地图标题输入 `.map-title-input`、地图数据 textarea `.map-data-input`、错误段落 `.map-edit-error`。Task 5 e2e 消费这些选择器。

- [ ] **Step 1: shot-editor-card.tsx 接线**

修改点（对照 P2-① 终评后现状）：

1. import 追加：

```tsx
import {
  applyMapTemplate,
  buildMapRevisePatch,
  draftMapFromSpec,
  isMapComponentId,
  MAP_TEMPLATES,
  type MapEditDraft,
} from "./map-templates";
```

2. 模块级常量与助手（`EMPTY_CHART_DRAFT` 旁；文件顶部如尚未 import `SceneSpec` 则补 `import type { SceneSpec } from "@acs/video-scene";`）：

```tsx
const EMPTY_MAP_DRAFT: MapEditDraft = { title: "", data: "" };

// 模板下拉跨图表/地图两族解析：先按图表找，找不到再按地图找。
function resolveAnyTemplate(
  spec: SceneSpec,
  templateId: string,
): { spec: SceneSpec | null; error: string | null } {
  const chart = applyChartTemplate(spec, templateId);
  if (chart.spec) return { spec: chart.spec, error: null };
  const map = applyMapTemplate(spec, templateId);
  if (map.spec) return { spec: map.spec, error: null };
  return { spec: null, error: map.error ?? chart.error };
}
```

3. 组件内状态追加（chartError 之后）：

```tsx
const [mapDraft, setMapDraft] = useState<MapEditDraft>(() =>
  spec && isMapComponentId(spec.componentId)
    ? draftMapFromSpec(spec)
    : EMPTY_MAP_DRAFT,
);
const [mapError, setMapError] = useState<string | null>(null);
```

4. working 版本切换 effect 内（`setChartDraft(...)` 之后）追加同构重置：

```tsx
setMapError(null);
setMapDraft(
  nextSpec && isMapComponentId(nextSpec.componentId)
    ? draftMapFromSpec(nextSpec)
    : EMPTY_MAP_DRAFT,
);
```

5. 模板下拉 `<select className="chart-template-select">` 的 options 改为 optgroup 分组：

```tsx
<option value="">— 保持当前组件 —</option>
<optgroup label="图表">
  {CHART_TEMPLATES.map((template) => (
    <option key={template.templateId} value={template.templateId}>
      {template.label}
    </option>
  ))}
</optgroup>
<optgroup label="地图">
  {MAP_TEMPLATES.map((template) => (
    <option key={template.templateId} value={template.templateId}>
      {template.label}
    </option>
  ))}
</optgroup>
```

onChange 改为（预填对应族草稿）：

```tsx
onChange={(event) => {
  const templateId = event.target.value;
  setPendingTemplateId(templateId);
  setChartError(null);
  setMapError(null);
  if (!templateId) return;
  const applied = resolveAnyTemplate(spec, templateId);
  if (applied.error || !applied.spec) {
    setChartError(applied.error ?? "模板无效");
    return;
  }
  // 选中即预填该模板数据到编辑字段（应用时才落文档）
  if (isChartComponentId(applied.spec.componentId)) {
    setChartDraft(draftChartFromSpec(applied.spec));
  } else if (isMapComponentId(applied.spec.componentId)) {
    setMapDraft(draftMapFromSpec(applied.spec));
  }
}}
```

6. 应用按钮 onClick（P2-① I1 合并语义）扩展地图分支——完整替换体：

```tsx
onClick={() => {
  // 换模板 = 以模板 spec 为基底；与同草稿的并发编辑（旁白/背景/
  // 时长 + 图表/地图数据——选中模板时已预填该模板默认值）一次应用
  // 一并落库，不静默丢弃（P2-① 终评 I1 合并语义）。
  let baseSpec = spec;
  if (pendingTemplateId) {
    const applied = resolveAnyTemplate(spec, pendingTemplateId);
    if (applied.error || !applied.spec) {
      setEditError(applied.error ?? "模板无效");
      return;
    }
    baseSpec = applied.spec;
  }
  const chartResult = isChartComponentId(baseSpec.componentId)
    ? buildChartRevisePatch(baseSpec, chartDraft)
    : null;
  if (chartResult && (chartResult.error || !chartResult.spec)) {
    setChartError(chartResult.error ?? "图表数据无效");
    return;
  }
  const mapResult = isMapComponentId(
    (chartResult?.spec ?? baseSpec).componentId,
  )
    ? buildMapRevisePatch(chartResult?.spec ?? baseSpec, mapDraft)
    : null;
  if (mapResult && (mapResult.error || !mapResult.spec)) {
    setMapError(mapResult.error ?? "地图数据无效");
    return;
  }
  const { patch, error } = buildRevisePatch(
    draft,
    mapResult?.spec ?? chartResult?.spec ?? baseSpec,
  );
  if (error || !patch) {
    setEditError(error ?? "草稿无效");
    return;
  }
  setEditError(null);
  setChartError(null);
  setMapError(null);
  onRevise(patch);
}}
```

7. 图表编辑字段块之后追加地图编辑字段块（`{isMapComponentId(spec.componentId) ? (...) : null}`，含 `.map-edit-error`）：

```tsx
{isMapComponentId(spec.componentId) ? (
  <>
    <label className="shot-edit-field">
      地图标题
      <input
        className="map-title-input"
        maxLength={40}
        value={mapDraft.title}
        onChange={(event) =>
          setMapDraft({ ...mapDraft, title: event.target.value })
        }
      />
    </label>
    <label className="shot-edit-field">
      数据（每行{" "}
      {spec.componentId === "map-grid"
        ? "标签,行,列[,数值]（行/列 0..7）"
        : "名称,x,y（首行起点、末行终点，中间为途经；可省名称）"}
      ）
      <textarea
        className="map-data-input"
        rows={6}
        value={mapDraft.data}
        onChange={(event) =>
          setMapDraft({ ...mapDraft, data: event.target.value })
        }
      />
    </label>
    {mapError ? <p className="map-edit-error">{mapError}</p> : null}
  </>
) : null}
```

- [ ] **Step 2: CSS 追加**

`video-studio.css` 在既有图表控件规则块后追加（选择器并入同款声明，保持一致外观）：

```css
.map-title-input,
.map-data-input {
  width: 100%;
  box-sizing: border-box;
  background: #ffffff;
  color: #1b2c29;
}
.map-edit-error {
  color: #b03a2e;
  font-size: 13px;
  margin: 4px 0 0;
}
```

（对照 `.chart-*` 既有规则块的实际声明属性对齐——若图表块还有 padding/border 等，一并复制保持一致。）

- [ ] **Step 3: 静态检查 + web 全量**

Run: `pnpm --filter @acs/web test` 与 `pnpm --filter @acs/web run typecheck` 与 `npx biome check --write apps/web/src/app/video-studio/shot-editor-card.tsx`
Expected: web 83+Task3 新增全绿；typecheck 无错。

- [ ] **Step 4: 手动冒烟（dev 在跑则浏览器由 Task 5 e2e 覆盖，此处只做构建级验证）**

Run: `pnpm --filter @acs/web run build`（或项目既有的构建检查命令）
Expected: 构建成功。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/video-studio/shot-editor-card.tsx apps/web/src/app/video-studio/video-studio.css
git commit -m "feat(video-studio): 镜头编辑卡接入地图模板下拉（optgroup 分组）与数据编辑

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: e2e VID-018 + 收口（证据、QA 登记、状态文档、金标准复跑）

**Files:**
- Create: `scripts/video/e2e-map.mjs`
- Create: `artifacts/video-studio-map/E2E_MAP.md`（提交；mp4/png 不提交）
- Modify: `qa/registry.json`（VID-018，沿 VID-017 条目格式）
- Modify: `AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md`（顶部条目）

**Interfaces:**
- Consumes: Task 4 的 DOM 选择器（`.chart-template-select`/`.map-data-input`/`.map-title-input`）；`scripts/video/render-scene.mjs --project --out`；e2e-dataviz.mjs 的工具函数口径。
- Produces: 退出码 0 = 闭环成立；证据哈希表；A1 = dataviz e2e 媒体哈希复跑不变。

- [ ] **Step 1: 写 e2e 脚本**

`scripts/video/e2e-map.mjs`（结构沿 e2e-dataviz.mjs：`fail`/`sha256`/`usageLines`/`frameYavg`/`renderProject`/`waitForMessage` 工具函数原样复制，OUT_DIR 改 `artifacts/video-studio-map`，USAGE_LEDGER 同路径）。核心差异段：

```js
const SENTENCE = "做一个8秒的STEM解说视频，主题是水循环，分4个镜头";
// spans 2000/3100/2000/2000ms @24fps → [48,74,48,48]，总 218 帧
// 镜头 2 帧域 48..121；镜头 3 帧域 122..169

// —— 1. 镜头 2 换 grid-china-6 + 旁白并发（I1 合并语义不回退）——
const card2 = page.locator(".shot-list > li").nth(1);
await card2.locator(".shot-edit-toggle").click();
await card2.locator(".shot-narration-input").fill("降水看分布，行程看路线。");
await card2.locator(".chart-template-select").selectOption("grid-china-6");
await card2.locator(".shot-apply").click();
await card2
  .locator(".map-data-input")
  .waitFor({ state: "visible", timeout: 10_000 })
  .catch(() => fail("地图编辑字段", "换模板后 .map-data-input 未出现"));
await page
  .waitForFunction(
    (index) => {
      const el = document
        .querySelectorAll(".shot-list > li")
        [index]?.querySelector(".map-data-input");
      return Boolean(el && el.value.includes("华北,0,1"));
    },
    1,
    { timeout: 10_000, polling: 100 },
  )
  .catch(() => fail("模板预填", "map-data-input 未回填模板默认数据"));
await card2.locator(".map-data-input").fill("东城,0,0,30\n西城,0,1,20\n南城,1,0,25");
await card2.locator(".shot-apply").click();
await page.click(".editor-save");
await waitForMessage(page, "已保存", "保存网格地图镜头");

// —— 2. 镜头 3 换 journey-route + 数据编辑 ——
const card3 = page.locator(".shot-list > li").nth(2);
await card3.locator(".shot-edit-toggle").click();
await card3.locator(".chart-template-select").selectOption("journey-route");
await card3.locator(".shot-apply").click();
await card3
  .locator(".map-data-input")
  .waitFor({ state: "visible", timeout: 10_000 })
  .catch(() => fail("行程编辑字段", "换模板后 .map-data-input 未出现"));
await page
  .waitForFunction(
    (index) => {
      const el = document
        .querySelectorAll(".shot-list > li")
        [index]?.querySelector(".map-data-input");
      return Boolean(el && el.value.includes("北京,240,420"));
    },
    2,
    { timeout: 10_000, polling: 100 },
  )
  .catch(() => fail("行程预填", "map-data-input 未回填模板默认数据"));
await card3.locator(".map-data-input").fill("甲,200,400\n乙,500,300\n丙,800,600");
await card3.locator(".shot-apply").click();
await page.click(".editor-save");
await waitForMessage(page, "已保存", "保存行程镜头");

// —— 3. 导出 + 结构断言 ——
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 15_000 }),
  page.click(".editor-export"),
]);
await download.saveAs(EXPORTED);
const exported = JSON.parse(readFileSync(EXPORTED, "utf8"));
const specOf = (shot) =>
  shot.contentVersions.find((v) => v.versionId === shot.workingVersionId)
    .sceneSource.spec;
const s2 = specOf(exported.shots[1]);
if (s2.componentId !== "map-grid") fail("镜头 2 组件", s2.componentId);
const regions = s2.params.regions
  .map((r) => `${r.label},${r.row},${r.col}${r.value === undefined ? "" : `,${r.value}`}`)
  .join("|");
if (regions !== "东城,0,0,30|西城,0,1,20|南城,1,0,25")
  fail("镜头 2 数据", regions);
const working2 = exported.shots[1].contentVersions.find(
  (v) => v.versionId === exported.shots[1].workingVersionId,
);
if (working2?.narrationText !== "降水看分布，行程看路线。")
  fail("旁白并发合并", `narrationText=${working2?.narrationText ?? "(空)"}`);
const s3 = specOf(exported.shots[2]);
if (s3.componentId !== "map-journey") fail("镜头 3 组件", s3.componentId);
if (
  s3.params.origin.label !== "甲" || s3.params.origin.x !== 200 ||
  s3.params.waypoints.length !== 1 || s3.params.waypoints[0].x !== 500 ||
  s3.params.destination.label !== "丙" || s3.params.destination.x !== 800
)
  fail("镜头 3 数据", JSON.stringify(s3.params));
if (s2.durationMs !== 3100) fail("时长保留", `镜头 2 durationMs=${s2.durationMs}`);
await page.screenshot({ path: path.join(OUT_DIR, "map-editor.png"), fullPage: true });
console.log(
  `[e2e-map] 编辑落库: 项目 ${exported.id} v${exported.savedVersion}，镜头2=${s2.componentId}(${regions})，镜头3=${s3.componentId}(甲→乙→丙)`,
);
```

渲染/双跑/YAVG/计费/控制台/哈希表段沿 e2e-dataviz.mjs 原样（帧 80/140、双画幅、`render/`+`rerun/`）。帧注释如实写：帧 80（镜头 2 内 1333ms > enterMs 1200 + 梯次 2×90，三块全部到位）；帧 140（镜头 3 内 750ms，描画后段 easeOutCubic(750/1600)≈0.83，白底）。

文件头注释：`// P2-② 地图动画端到端闭环验收（VID-018，零 TTS 计费）：…（链路一行化，同 e2e-dataviz 风格）`。

- [ ] **Step 2: 跑 e2e**

前置：:3210 dev + :3211 代理已在跑；packages/{video-document,video-scene} 已 build。
Run: `BASE_URL=http://localhost:3211 node scripts/video/e2e-map.mjs`
Expected: exit 0，双画幅双跑一致哈希打印。

- [ ] **Step 3: 跨轮复跑一次**

再执行一遍，记录两轮哈希四元组各自一致。
Expected: 同轮双跑一致；跨轮一致（同机同版本）。

- [ ] **Step 4: 证据文档 + QA 登记 + CURRENT_STATE**

`artifacts/video-studio-map/E2E_MAP.md`：目的、前置、命令、判据（结构断言/YAVG ≥100/双跑一致/计费不变/零 error）、哈希表（landscape/portrait）、YAVG 口径沿 VID-016/017、媒体不入库如实声明（沿 E2E_DATAVIZ.md 格式）。

`qa/registry.json`：沿 VID-017 条目格式在 automated 数组尾追加：

```json
{
  "id": "VID-018",
  "tier": "integration",
  "title": "Video Studio map templates and edit loop (grid/journey)",
  "cwd": ".",
  "argv": ["node", "scripts/video/e2e-map.mjs"],
  "requiresPorts": [3211],
  "checks": [
    "模板换装（grid-china-6 / journey-route）与数据编辑落库，旁白/时长保留",
    "导出结构断言（regions/origin/waypoints/destination 逐字段）",
    "CLI 双画幅出片，地图帧 YAVG ≥100（帧 80/140）",
    "双跑 + 跨轮 SHA-256 逐字节一致",
    "计费台账行数不变、浏览器控制台零 error"
  ]
}
```

`CURRENT_STATE.md` 顶部新增 P2-② 条目（一段：两组件+注册表 v3+模板与编辑+接线 optgroup+VID-018+A1 金标准+回归计数）。

- [ ] **Step 5: 全回归四套 + 静态 + qa**

Run（依次）:
- `pnpm --filter @acs/video-document run build && node --test "packages/video-document/dist/**/*.test.js"` → 71
- `pnpm --filter @acs/video-scene run build && node --test "packages/video-scene/dist/**/*.test.js"` → 58 + Task1/2 新增
- `pnpm --filter @acs/web test` → 83 + Task3 新增
- `node --test scripts/video/*.test.mjs` → 57
- `pnpm --filter @acs/web run typecheck`
- `pnpm run qa:validate` → "78 automated and 51 manual cases"（VID-018 登记 +1 自动化）

- [ ] **Step 6: dataviz e2e 复跑（A1 金标准）**

Run: `BASE_URL=http://localhost:3211 node scripts/video/e2e-dataviz.mjs`
Expected: exit 0；媒体哈希 = P2-① 已档 `3c6950b9…`（landscape）/`36f64db7…`（portrait）逐字节一致（组件追加不改旧渲染）。再生的本地 JSON/媒体不入库、无已跟踪文件被改动（`git status` 确认干净；若有已跟踪证据文件被再生则 `git restore` 回库态，沿 7f44a66 先例）。

- [ ] **Step 7: Commit（提交 .md/.json/.mjs，不含 mp4/png）**

```bash
git add scripts/video/e2e-map.mjs artifacts/video-studio-map/E2E_MAP.md qa/registry.json AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md
git commit -m "feat(video-studio): P2-② 地图动画收口——e2e VID-018、证据与登记

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## 执行后（executing-plans 收尾，不在本计划任务内）

最终全分支评审（opus，review-package）→ 按效应重定级 → ONE fix pass（每修 RED→GREEN + 全绿）→ ledger minors/rulings → 删除计划工作区 → finishing-a-development-branch（集成决定归用户）。
