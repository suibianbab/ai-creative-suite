# Video Studio P2-⑤ 手绘（sketch-note 手绘强调组件）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 追加手绘风格强调组件 `sketch-note`（正弦抖动 + 双描 + 逐字写入的闭式几何）到组件注册表 v6，接入工作台第五族起点模板与数据编辑，e2e VID-021 收口。

**Architecture:** 沿 P2-①..④ 四刀模式三段落地——packages/video-scene 纯渲染组件（闭式几何、零新依赖、帧确定性）；apps/web `sketch-templates.ts` 纯逻辑（5 枚模板 + 行格式编辑）；shot-editor-card 接线（第五 optgroup + 应用链第五位）。e2e 复刻 e2e-stick 骨架，A1 金标准换 stick e2e（VID-020）复跑。

**Tech Stack:** TypeScript · node:test · Remotion（仅 e2e 出片）· Playwright（仅 e2e）· ffmpeg signalstats（帧亮度）。

**Spec:** `docs/superpowers/specs/2026-10-18-video-studio-sketch-design.md`

## Global Constraints

- 注册表只追加：`defaultRegistry` v5→v6（`stickFigure` 后追加 `sketchNote`），不改旧组件；旧 spec 重渲字节不变（A1 钉死）。
- 组件 render 纯函数：禁墙钟 / 未播种随机 / 网络；抖动是点位置与条目序号的正弦闭式函数。
- 单测零网络；e2e 零 TTS 计费（无 `--narration`）。
- 模板时序预算：全部模板 `160 + (N−1)·staggerMs + writeMs + drawMs ≤ 2000`（P2-③ 34bda10 教训，测试钉死）。
- 媒体不入库；证据 = 分支内脚本/测试/登记 + 本地 SHA-256（E2E_SKETCH.md）。
- 错误消息中文、带定位；工作台非法编辑行内报错不清文档（C1 语义）。
- 规划器零改动（手绘进画面唯一路径 = 工作台模板下拉）。
- 提交尾注 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。

## Review Focus

1. **逐字写入边界**：`visible = min(len, ceil(clamp01((tMs−delay)/writeMs)·len))`——p=0 时 0 字、p 微正时至少 1 字、p=1 时全量；增补平面字符（emoji）按码点计数不劈半。T1 测试 2/8 钉死（Array.from 切片）。
2. **弧长描画与抖动确定性**：dashoffset = 1−clamp01(p)（toFixed(4)）；第二遍迟 80ms；抖动 sin 输入含条目序号 i（相邻条目错相）；全树无随机源。T1 测试 4/6/10 钉死（d 串逐点、双 dashoffset、deepEqual）。
3. **从右取字段解析**：`文本[,强调]` 末段恰为枚举词才剥离（文本可含逗号）；`,下划线`（首逗号）整行作文本；`甲,无` 显式合法。T2 测试 4/6 钉死。
4. **空行/CRLF/trim 与行号**：splitLines 容错后行号按非空行重排；超长（>12 码点）行内错误带行号。T2 测试 5/6 钉死。
5. **apply 链 sketch 接位**：sketchResult 必须接在 stickResult 之后、baseSpec 链 `sketch ?? stick ?? flow ?? map ?? chart ?? base`——接错序静默丢手绘数据。T3 无单测（接线层），e2e T4 导出断言（items 逐字段）覆盖；typecheck + 全 web 套件守门。

---

### Task 1: sketch-note 组件 + 注册表 v6

**Files:**
- Create: `packages/video-scene/src/components/sketch-note.ts`
- Test: `packages/video-scene/src/components/sketch-note.test.ts`
- Modify: `packages/video-scene/src/default-registry.ts`
- Modify: `packages/video-scene/src/index.ts`

**Interfaces:**
- Consumes: `clamp01`（../easing.js）、`emUnits`/`fitFontSize`（../text-width.ts）、`SceneComponent`/`FrameContext`/`SceneSpecLike`（../registry.js）、`SvgNode`（../svg.js）。
- Produces: `sketchNote: SceneComponent`（componentId `"sketch-note"`、version 1）；`defaultRegistry` v6；`index.ts` 命名再导出 `export { sketchNote }`。

- [ ] **Step 1: 写失败测试**

`packages/video-scene/src/components/sketch-note.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { FrameContext } from "../registry.js";
import type { SvgNode } from "../svg.js";
import { sketchNote } from "./sketch-note.js";

// collect 为各组件测试私有惯例（bar/line/map/flow/stick 同款），不跨文件共享
function collect(node: SvgNode, tag: string, out: SvgNode[] = []): SvgNode[] {
  if (node.tag === tag) out.push(node);
  for (const child of node.children ?? []) collect(child, tag, out);
  return out;
}

const BASE = {
  title: "手绘要点",
  items: [{ text: "要点一", emphasis: "下划线" }],
  inkColor: "#2f2f2f",
  accentColor: "#e05a2b",
  writeMs: 400,
  drawMs: 420,
  staggerMs: 200,
};

function specWith(params: unknown) {
  return {
    componentId: "sketch-note",
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
// tMs = frame/fps×1000；at(770) → 770ms 等，测试全部走可整除断言值
const at = (tMs: number) =>
  sketchNote.render(
    specWith(BASE),
    makeCtx({ frame: (tMs / 1000) * 24 }) as never,
  );
// svg 内第 i 条目的文本节点（svg children = [标题, ...items]，文本同序）
const itemText = (root: SvgNode, i: number) => collect(root, "text")[i + 1]!;

test("校验表：越界/非法输入逐项拒绝（消息逐字）", () => {
  const cases: Array<[unknown, RegExp]> = [
    ["not-object", /sketch-note params 必须是对象/],
    [{ ...BASE, title: "x".repeat(41) }, /title 必须是 ≤40 个字符/],
    [{ ...BASE, items: [] }, /items 必须是 1\.\.5 个/],
    [
      {
        ...BASE,
        items: Array.from({ length: 6 }, () => ({
          text: "甲",
          emphasis: "无",
        })),
      },
      /items 必须是 1\.\.5 个/,
    ],
    [{ ...BASE, items: ["甲"] }, /items\[0\] 必须是对象/],
    [
      { ...BASE, items: [{ text: "", emphasis: "无" }] },
      /text 必须是 1\.\.12 个字符/,
    ],
    [
      { ...BASE, items: [{ text: "x".repeat(13), emphasis: "无" }] },
      /text 必须是 1\.\.12 个字符/,
    ],
    [
      { ...BASE, items: [{ text: "甲", emphasis: "框" }] },
      /emphasis 必须是 下划线\/圈\/无/,
    ],
    [{ ...BASE, writeMs: 199 }, /writeMs 必须是 200\.\.6000 的整数/],
    [{ ...BASE, drawMs: 6000.5 }, /drawMs 必须是 200\.\.6000 的整数/],
    [{ ...BASE, staggerMs: 119 }, /staggerMs 必须是 120\.\.1200 的整数/],
    [{ ...BASE, staggerMs: "200" }, /staggerMs 必须是 120\.\.1200 的整数/],
    [{ ...BASE, inkColor: "#12345" }, /inkColor 必须是 #rrggbb/],
    [{ ...BASE, accentColor: "red" }, /accentColor 必须是 #rrggbb/],
  ];
  for (const [params, pattern] of cases) {
    assert.throws(
      () => sketchNote.validateParams(params),
      pattern,
      `input: ${JSON.stringify(params).slice(0, 80)}`,
    );
  }
  // 合法最小输入不抛（返回原值）
  assert.equal(sketchNote.validateParams(BASE), BASE);
});

test("逐字写入：p=0 零字 / p=0.5 两字 / p=1 全量 / 单字条目至少一字", () => {
  const spec = specWith({
    ...BASE,
    items: [{ text: "四字文本", emphasis: "无" }],
  });
  const render = (tMs: number) =>
    sketchNote.render(spec, makeCtx({ frame: (tMs / 1000) * 24 }) as never);
  assert.equal(itemText(render(160), 0).text, ""); // delay=160, p=0
  assert.equal(itemText(render(360), 0).text, "四字"); // p=0.5 → ceil(2)
  assert.equal(itemText(render(560), 0).text, "四字文本"); // p=1
  const single = specWith({
    ...BASE,
    items: [{ text: "词", emphasis: "无" }],
  });
  const one = sketchNote.render(
    single,
    makeCtx({ frame: 4.8 }) as never,
  ); // tMs=200, p=0.1 → ceil(0.1)=1
  assert.equal(itemText(one, 0).text, "词");
});

test("标题淡入：tMs=150 半透明、tMs≥300 全显", () => {
  const half = at(150);
  assert.ok(
    Math.abs(
      (collect(half, "text")[0]!.attrs.opacity as number) - 0.5,
    ) < 1e-9,
  );
  const full = at(300);
  assert.equal(collect(full, "text")[0]!.attrs.opacity, 1);
});

test("下划线几何与双描：抖动点序逐字、相位差 π/2、dashoffset 分速", () => {
  // "要点一" 3 CJK → em=3、fontSize=40、width=120 → left=416/right=584/seg=21
  // 一遍 y = 290 + 3.2·sin(2π(2u))；二遍 y = 290 + 2.4·sin(2π(2u)+π/2)
  const root = at(770); // delay 160 + write 400 + draw 210 → p1=0.5、p2=130/420
  const paths = collect(root, "path");
  assert.equal(paths.length, 2);
  assert.equal(
    paths[0]!.attrs.d,
    "M 416.00,290.00 L 437.00,293.20 L 458.00,290.00 L 479.00,286.80 L 500.00,290.00 L 521.00,293.20 L 542.00,290.00 L 563.00,286.80 L 584.00,290.00",
  );
  assert.ok((paths[1]!.attrs.d as string).includes(" L 458.00,287.60"));
  assert.equal(paths[0]!.attrs["stroke-width"], 6);
  assert.equal(paths[0]!.attrs.stroke, "#e05a2b");
  assert.equal(paths[0]!.attrs["stroke-dashoffset"], 0.5);
  assert.equal(paths[1]!.attrs["stroke-dashoffset"], 0.6905); // 1−130/420
  assert.equal(paths[1]!.attrs.opacity, 0.8);
});

test("圈几何：rx 随文本宽、首点抖动值、闭环回到首点", () => {
  const one = specWith({ ...BASE, items: [{ text: "词", emphasis: "圈" }] });
  const r1 = sketchNote.render(one, makeCtx({ frame: 24 }) as never);
  const d1 = collect(r1, "path")[0]!.attrs.d as string;
  // rx = 40/2+34 = 54；k=0: θ=−0.4、j=4·sin(−1.2)=−3.728 → (546.30, 244.32)
  assert.ok(d1.startsWith("M 546.30,244.32"));
  assert.ok(d1.endsWith(" L 546.30,244.32")); // k=20 闭环（3θ 周期性）
  assert.equal(collect(r1, "path")[0]!.attrs["stroke-width"], 5);
  const four = specWith({
    ...BASE,
    items: [{ text: "四字文本", emphasis: "圈" }],
  });
  const r4 = sketchNote.render(four, makeCtx({ frame: 24 }) as never);
  // width=160 → rx=114 → k=0 x = 500+(114−3.728)·cos(−0.4) = 601.57
  assert.ok(
    (collect(r4, "path")[0]!.attrs.d as string).startsWith("M 601.57,244.32"),
  );
});

test("梯次与进度：item0 收笔 dashoffset 0、item2 描画中 0.9048 / 二遍 1", () => {
  const spec = specWith({
    ...BASE,
    items: [
      { text: "甲甲", emphasis: "下划线" },
      { text: "乙乙", emphasis: "下划线" },
      { text: "丙丙", emphasis: "下划线" },
    ],
  });
  const root = sketchNote.render(spec, makeCtx({ frame: 24 }) as never); // tMs=1000
  const paths = collect(root, "path");
  assert.equal(paths.length, 6); // 3 条目 × 双描
  assert.equal(paths[0]!.attrs["stroke-dashoffset"], 0); // item0 收笔 980ms
  assert.equal(paths[4]!.attrs["stroke-dashoffset"], 0.9048); // (1000−960)/420
  assert.equal(paths[5]!.attrs["stroke-dashoffset"], 1); // 二遍 1040ms 才起笔
});

test("无强调条目：零 path、文本仍逐字写入", () => {
  // 注意：BASE 条目是下划线——本测试必须换 emphasis 无 的 spec
  const spec = specWith({
    ...BASE,
    items: [{ text: "要点一", emphasis: "无" }],
  });
  const root = sketchNote.render(spec, makeCtx({ frame: 13.44 }) as never); // tMs=560
  assert.equal(collect(root, "path").length, 0);
  assert.equal(itemText(root, 0).text, "要点一");
});

test("增补平面字符：emoji 按码点计数不劈半", () => {
  const spec = specWith({
    ...BASE,
    items: [{ text: "😀😀", emphasis: "无" }],
  });
  const root = sketchNote.render(spec, makeCtx({ frame: 8.64 }) as never); // p=0.5
  assert.equal(itemText(root, 0).text, "😀");
});

test("tMs=0 边界：标题零透明、条目零字、三组俱在、全树无 NaN", () => {
  const spec = specWith({
    ...BASE,
    items: [
      { text: "甲", emphasis: "下划线" },
      { text: "乙", emphasis: "圈" },
      { text: "丙", emphasis: "无" },
    ],
  });
  const root = sketchNote.render(spec, makeCtx({ frame: 0 }) as never);
  assert.equal(collect(root, "text")[0]!.attrs.opacity, 0);
  assert.equal(itemText(root, 0).text, "");
  assert.equal(collect(root, "g").filter((g) => "transform" in g.attrs).length, 0); // 条目组无 transform（非火柴人式定位组）
  assert.equal(collect(root, "text").length, 4); // 标题 + 3 条目
  assert.equal(JSON.stringify(root).includes("NaN"), false);
});

test("帧确定性：同 spec 同 ctx 双调 deepEqual", () => {
  const spec = specWith({
    ...BASE,
    items: [
      { text: "混排甲", emphasis: "下划线" },
      { text: "混排乙", emphasis: "圈" },
    ],
  });
  const ctx = makeCtx({ frame: 17.28 });
  assert.deepEqual(
    sketchNote.render(spec, ctx as never),
    sketchNote.render(spec, ctx as never),
  );
});
```

注意：测试 9 里「条目组无 transform」断言的 collect 结果为 0——sketch-note 条目组 `attrs: {}`（纵向定位由 itemY 直接写入坐标，不是 translate 组），与火柴人不同；该断言钉住「组无 transform」这一结构事实，防止误搬火柴人模式。

- [ ] **Step 2: 跑测试确认 RED**

Run: `pnpm --filter @acs/video-scene test`
Expected: tsc 硬失败 `TS2307: Cannot find module './components/sketch-note.js'`（video-scene 测试跑编译后 dist，缺模块编译不过；同 P2-④ Task 1 RED 形态）。若得到的是文件级 not ok 而非 TS2307，同根因（模块缺失），记录实际形态即可。

- [ ] **Step 3: 写实现**

`packages/video-scene/src/components/sketch-note.ts`：

```ts
import { clamp01 } from "../easing.js";
import type {
  FrameContext,
  SceneComponent,
  SceneSpecLike,
} from "../registry.js";
import type { SvgNode } from "../svg.js";
import { emUnits, fitFontSize } from "../text-width.js";

// 手绘笔记强调 v1：闭式手绘几何——正弦抖动（点位置与条目序号的纯函数，
// 无随机源）+ 双描（第二遍相位差 π/2、幅度 0.75×、不透明度 0.8）+ 逐字
// 写入（前缀子串，Array.from 按码点切片）。强调笔画描画沿 line-drawing
// 口径（pathLength=1 + dasharray 1 + dashoffset 1−p）。条目 i 时序：
// delay=160+i×staggerMs；文本写入 [delay, delay+writeMs]；笔画描画
// [delay+writeMs, delay+writeMs+drawMs]（第二遍迟 80ms）。
// render 纯函数：禁墙钟/未播种随机/网络。

const EMPHASIS = ["下划线", "圈", "无"] as const;
type SketchEmphasis = (typeof EMPHASIS)[number];
type SketchItem = { text: string; emphasis: SketchEmphasis };
type SketchNoteParams = {
  title: string;
  items: SketchItem[];
  inkColor: string;
  accentColor: string;
  writeMs: number; // 200..6000
  drawMs: number; // 200..6000
  staggerMs: number; // 120..1200
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DESIGN_SPACE = 1000;
const ITEM_Y0 = 260;
const ITEM_DY = 130;
const START_MS = 160;
const TITLE_FADE_MS = 300;
const TEXT_BASE_FONT = 40;
const TEXT_MAX_WIDTH = 700;
const UNDER_GAP = 24;
const UNDER_DY = 30;
const UNDER_SEGS = 8;
const UNDER_AMP = 3.2;
const UNDER_AMP2 = 2.4;
const CIRCLE_SEGS = 20;
const CIRCLE_PAD_X = 34;
const CIRCLE_RY = 44;
const CIRCLE_START = -0.4;
const CIRCLE_AMP = 4;
const CIRCLE_AMP2 = 3;
const SECOND_DELAY_MS = 80;
const SECOND_OPACITY = 0.8;
const MAX_ITEMS = 5;
const MAX_TEXT = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function validateParams(value: unknown): SketchNoteParams {
  if (!isRecord(value)) throw new Error("sketch-note params 必须是对象");
  if (typeof value.title !== "string" || value.title.length > 40) {
    throw new Error("sketch-note params.title 必须是 ≤40 个字符");
  }
  if (
    !Array.isArray(value.items) ||
    value.items.length < 1 ||
    value.items.length > MAX_ITEMS
  ) {
    throw new Error(
      `sketch-note params.items 必须是 1..${MAX_ITEMS} 个 {text, emphasis}`,
    );
  }
  value.items.forEach((item, i) => {
    if (!isRecord(item)) {
      throw new Error(`sketch-note params.items[${i}] 必须是对象`);
    }
    // 与 render 同口径：按码点计数（emoji 不劈半）
    const chars = typeof item.text === "string" ? Array.from(item.text) : [];
    if (chars.length < 1 || chars.length > MAX_TEXT) {
      throw new Error(
        `sketch-note params.items[${i}].text 必须是 1..${MAX_TEXT} 个字符`,
      );
    }
    if (
      typeof item.emphasis !== "string" ||
      !(EMPHASIS as readonly string[]).includes(item.emphasis)
    ) {
      throw new Error(
        `sketch-note params.items[${i}].emphasis 必须是 下划线/圈/无`,
      );
    }
  });
  for (const key of ["inkColor", "accentColor"] as const) {
    if (!isHexColor(value[key])) {
      throw new Error(`sketch-note params.${key} 必须是 #rrggbb`);
    }
  }
  for (const key of ["writeMs", "drawMs"] as const) {
    const v = value[key];
    if (!Number.isInteger(v) || (v as number) < 200 || (v as number) > 6000) {
      throw new Error(`sketch-note params.${key} 必须是 200..6000 的整数`);
    }
  }
  const stagger = value.staggerMs;
  if (
    !Number.isInteger(stagger) ||
    (stagger as number) < 120 ||
    (stagger as number) > 1200
  ) {
    throw new Error("sketch-note params.staggerMs 必须是 120..1200 的整数");
  }
  return value as SketchNoteParams;
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const params = spec.params as SketchNoteParams;
  const tMs = (ctx.frame / ctx.fps) * 1000;

  const itemGroups: SvgNode[] = params.items.map((item, i) => {
    const delay = START_MS + i * params.staggerMs;
    const chars = Array.from(item.text);
    const visible = Math.min(
      chars.length,
      Math.ceil(clamp01((tMs - delay) / params.writeMs) * chars.length),
    );
    const fontSize = fitFontSize(TEXT_BASE_FONT, item.text, TEXT_MAX_WIDTH);
    const width = emUnits(item.text) * fontSize;
    const itemY = ITEM_Y0 + i * ITEM_DY;
    const strokes: SvgNode[] = [];
    if (item.emphasis !== "无") {
      const first: Array<[number, number]> = [];
      const second: Array<[number, number]> = [];
      if (item.emphasis === "下划线") {
        const left = 500 - width / 2 - UNDER_GAP;
        const right = 500 + width / 2 + UNDER_GAP;
        const y = itemY + UNDER_DY;
        for (let k = 0; k <= UNDER_SEGS; k += 1) {
          const u = k / UNDER_SEGS;
          const x = left + (right - left) * u;
          const phase = 2 * Math.PI * (2 * u + 0.35 * i);
          first.push([x, y + UNDER_AMP * Math.sin(phase)]);
          second.push([x, y + UNDER_AMP2 * Math.sin(phase + Math.PI / 2)]);
        }
      } else {
        const rx = width / 2 + CIRCLE_PAD_X;
        for (let k = 0; k <= CIRCLE_SEGS; k += 1) {
          const theta = CIRCLE_START + (2 * Math.PI * k) / CIRCLE_SEGS;
          const base = 3 * theta + 0.35 * i;
          const j = CIRCLE_AMP * Math.sin(base);
          const j2 = CIRCLE_AMP2 * Math.sin(base + Math.PI / 2);
          first.push([
            500 + (rx + j) * Math.cos(theta),
            itemY + (CIRCLE_RY + j) * Math.sin(theta),
          ]);
          second.push([
            500 + (rx + j2) * Math.cos(theta),
            itemY + (CIRCLE_RY + j2) * Math.sin(theta),
          ]);
        }
      }
      const toD = (points: Array<[number, number]>) =>
        `M ${points
          .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
          .join(" L ")}`;
      const p1 = clamp01((tMs - delay - params.writeMs) / params.drawMs);
      const p2 = clamp01(
        (tMs - delay - params.writeMs - SECOND_DELAY_MS) / params.drawMs,
      );
      const strokeWidth = item.emphasis === "圈" ? 5 : 6;
      strokes.push(
        {
          tag: "path",
          attrs: {
            d: toD(first),
            fill: "none",
            stroke: params.accentColor,
            "stroke-width": strokeWidth,
            "stroke-linecap": "round",
            pathLength: 1,
            "stroke-dasharray": 1,
            "stroke-dashoffset": Number((1 - p1).toFixed(4)),
          },
        },
        {
          tag: "path",
          attrs: {
            d: toD(second),
            fill: "none",
            stroke: params.accentColor,
            "stroke-width": strokeWidth,
            "stroke-linecap": "round",
            pathLength: 1,
            "stroke-dasharray": 1,
            "stroke-dashoffset": Number((1 - p2).toFixed(4)),
            opacity: SECOND_OPACITY,
          },
        },
      );
    }
    return {
      tag: "g",
      attrs: {},
      children: [
        {
          tag: "text",
          attrs: {
            x: 500,
            y: itemY,
            "font-size": fontSize,
            fill: params.inkColor,
            "text-anchor": "middle",
            "dominant-baseline": "middle",
          },
          text: chars.slice(0, visible).join(""),
        },
        ...strokes,
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
              fill: params.inkColor,
              "text-anchor": "middle",
              "dominant-baseline": "middle",
              opacity: clamp01(tMs / TITLE_FADE_MS),
            },
            text: params.title,
          },
          ...itemGroups,
        ],
      },
    ],
  };
}

export const sketchNote: SceneComponent = {
  componentId: "sketch-note",
  version: 1,
  validateParams,
  render,
};
```

`packages/video-scene/src/default-registry.ts`：import 行加在 import 块的字母序位置（`numberCounter` 之后、`stickFigure` 之前——s < st）：

```ts
import { sketchNote } from "./components/sketch-note.js";
```

（实际放在 import 块字母序位置：`numberCounter` 之后、`stickFigure` 之前。）注释块追加一行：

```ts
// v6（P2-⑤ 手绘）：追加 sketch-note，同一分支内原子落地。
```

数组 `stickFigure,` 之后追加 `sketchNote,`；`createRegistry(…, 5)` 第二参改 `6`。

`packages/video-scene/src/index.ts`：在 `stick-figure` 导出行之后追加：

```ts
export { sketchNote } from "./components/sketch-note.js";
```

- [ ] **Step 4: 跑测试确认 GREEN**

Run: `pnpm --filter @acs/video-scene test`
Expected: 103 + 10 新 = **113/113 pass**（0 fail）。任何断言失败 → 核对几何常量推导（下划线 416..584/seg 21、圈 546.30/244.32 与 601.57、dashoffset 0.6905/0.9048）后修实现，不改测试断言值（除非断言自身算错——按 executing-plans 裁定流程记 Ruling）。

- [ ] **Step 5: 回归 + 提交**

Run: `pnpm --filter @acs/video-document test` → 71/71。
Run: `pnpm exec biome check packages/video-scene/src` → 0 error（长行如报 format 错跑 `--write` 修格式，行为零变化；若产生改动，独立 style 提交沿 8385190 先例）。

```bash
git add packages/video-scene/src/components/sketch-note.ts packages/video-scene/src/components/sketch-note.test.ts packages/video-scene/src/default-registry.ts packages/video-scene/src/index.ts
git commit -m "feat(video-scene): sketch-note 手绘强调组件（闭式抖动+双描+逐字写入）与注册表 v6

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: sketch-templates 模板与编辑纯逻辑

**Files:**
- Create: `apps/web/src/app/video-studio/sketch-templates.ts`
- Test: `apps/web/src/app/video-studio/sketch-templates.test.ts`

**Interfaces:**
- Consumes: Task 1 `componentId "sketch-note"` 入 `defaultRegistry` v6（validateSceneSpec 兜底走 v6）。
- Produces: `SKETCH_TEMPLATES`、`isSketchComponentId`、`applySketchTemplate`、`SketchEditDraft { title, data }`、`draftSketchFromSpec`、`buildSketchRevisePatch`（签名与语义同 stick-templates 六导出族）。

- [ ] **Step 1: 写失败测试**

`apps/web/src/app/video-studio/sketch-templates.test.ts`：

```ts
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
    const items = applied.spec!.params.items as Array<unknown>;
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
  (applied.spec!.params.items as Array<{ text: string }>)[0]!.text = "篡改";
  const again = applySketchTemplate(SPEC, "sketch-underline-3");
  assert.equal(
    (again.spec!.params.items as Array<{ text: string }>)[0]!.text,
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
  assert.deepEqual(back.spec!.params.items, [
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
    assert.deepEqual(back.spec!.params.items, [want]);
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
    data: "甲\n超过十二个字符的文本行甲",
  });
  assert.equal(long.error, "第 2 行：文本必须是 1..12 个字符");
});

test("CRLF/空行/trim 容错", () => {
  const back = buildSketchRevisePatch(SKETCH_SPEC as unknown as SceneSpec, {
    title: "t",
    data: "甲, 下划线 \r\n\r\n 乙 \n  丙,圈",
  });
  assert.equal(back.error, null);
  assert.deepEqual(back.spec!.params.items, [
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
  assert.equal(back.spec!.params.title, "新标题");
  assert.deepEqual(back.spec!.params.items, [
    { text: "新文本", emphasis: "圈" },
  ]);
  assert.equal(back.spec!.params.inkColor, "#2f2f2f");
  assert.equal(back.spec!.params.accentColor, "#e05a2b");
  assert.equal(back.spec!.params.writeMs, 480);
  assert.equal(back.spec!.params.drawMs, 420);
  assert.equal(back.spec!.params.staggerMs, 240);
  const wrong = buildSketchRevisePatch(SPEC, { title: "t", data: "甲" });
  assert.equal(wrong.error, "当前镜头组件不是手绘组件");
  assert.equal(isSketchComponentId("sketch-note"), true);
  assert.equal(isSketchComponentId("stick-figure"), false);
});
```

- [ ] **Step 2: 跑测试确认 RED**

Run: `pnpm --filter @acs/web test`
Expected: 文件级 not ok——`sketch-templates.test.ts` 编译/加载失败（模块不存在）。web 测试跑 tsx 源码，RED 形态是文件级失败（同 P2-④ Task 2）。

- [ ] **Step 3: 写实现**

`apps/web/src/app/video-studio/sketch-templates.ts`：

```ts
// P2-⑤ 手绘：起点模板与数据编辑纯逻辑（沿 stick-templates.ts 模式）。
// 模板参数过 validateSceneSpec 兜底；非法数据行内报错、不落 patch（C1 语义）。

import {
  defaultRegistry,
  type SceneSpec,
  validateSceneSpec,
} from "@acs/video-scene";

export type SketchTemplate = {
  templateId: string;
  componentId: "sketch-note";
  label: string;
  params: Record<string, unknown>;
};

const SKETCH_COLORS = {
  inkColor: "#2f2f2f",
  accentColor: "#e05a2b",
};

export const SKETCH_TEMPLATES: SketchTemplate[] = [
  {
    templateId: "sketch-underline-3",
    componentId: "sketch-note",
    label: "三要点下划线",
    params: {
      title: "三大要点",
      items: [
        { text: "要点一", emphasis: "下划线" },
        { text: "要点二", emphasis: "下划线" },
        { text: "要点三", emphasis: "下划线" },
      ],
      ...SKETCH_COLORS,
      writeMs: 480,
      drawMs: 420,
      staggerMs: 240,
    },
  },
  {
    templateId: "sketch-circle-key",
    componentId: "sketch-note",
    label: "关键词画圈",
    params: {
      title: "关键要点",
      items: [
        { text: "核心结论", emphasis: "圈" },
        { text: "支撑依据", emphasis: "下划线" },
      ],
      ...SKETCH_COLORS,
      writeMs: 480,
      drawMs: 420,
      staggerMs: 240,
    },
  },
  {
    templateId: "sketch-list-5",
    componentId: "sketch-note",
    label: "五条手写清单",
    params: {
      title: "行动清单",
      items: [
        { text: "做计划", emphasis: "无" },
        { text: "勤记录", emphasis: "无" },
        { text: "常复盘", emphasis: "无" },
        { text: "多输出", emphasis: "无" },
        { text: "重迭代", emphasis: "无" },
      ],
      ...SKETCH_COLORS,
      writeMs: 400,
      drawMs: 360,
      staggerMs: 200,
    },
  },
  {
    templateId: "sketch-highlight-mix",
    componentId: "sketch-note",
    label: "混排强调",
    params: {
      title: "混合强调",
      items: [
        { text: "重点结论", emphasis: "下划线" },
        { text: "关键数字", emphasis: "圈" },
        { text: "补充说明", emphasis: "无" },
      ],
      ...SKETCH_COLORS,
      writeMs: 480,
      drawMs: 420,
      staggerMs: 240,
    },
  },
  {
    templateId: "sketch-one-word",
    componentId: "sketch-note",
    label: "单关键词大圈",
    params: {
      title: "一句话结论",
      items: [{ text: "增长 300%", emphasis: "圈" }],
      ...SKETCH_COLORS,
      writeMs: 480,
      drawMs: 420,
      staggerMs: 240,
    },
  },
];

export function isSketchComponentId(componentId: string): boolean {
  return componentId === "sketch-note";
}

export function applySketchTemplate(
  spec: SceneSpec,
  templateId: string,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  const template = SKETCH_TEMPLATES.find((t) => t.templateId === templateId);
  if (!template) return { spec: null, error: `未知手绘模板 ${templateId}` };
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

export type SketchEditDraft = {
  title: string;
  // 每行一条 `文本[,下划线|圈]`——从右取字段：末段恰为强调词读强调，
  // 否则整行是文本（文本可含逗号）；强调缺省 = 无
  data: string;
};

export function draftSketchFromSpec(spec: SceneSpec): SketchEditDraft {
  const params = spec.params as {
    title?: string;
    items?: Array<{ text: string; emphasis: string }>;
  };
  return {
    title: params.title ?? "",
    data: (params.items ?? [])
      .map((item) =>
        item.emphasis === "无" ? item.text : `${item.text},${item.emphasis}`,
      )
      .join("\n"),
  };
}

const EMPHASIS_WORDS = new Set(["下划线", "圈", "无"]);
const MAX_ITEMS = 5;
const MAX_TEXT = 12;

function splitLines(data: string): string[] {
  return data
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// 从右取字段：最后一个逗号后的段是强调词则剥离（idx>0 保证文本非空前缀），
// 否则整行为文本
function parseItemLine(line: string): { text: string; emphasis: string } {
  const idx = line.lastIndexOf(",");
  if (idx > 0) {
    const tail = line.slice(idx + 1).trim();
    if (EMPHASIS_WORDS.has(tail)) {
      return { text: line.slice(0, idx).trim(), emphasis: tail };
    }
  }
  return { text: line, emphasis: "无" };
}

export function buildSketchRevisePatch(
  spec: SceneSpec,
  draft: SketchEditDraft,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  if (!isSketchComponentId(spec.componentId)) {
    return { spec: null, error: "当前镜头组件不是手绘组件" };
  }
  const lines = splitLines(draft.data);
  if (lines.length < 1) {
    return { spec: null, error: "手绘至少需要一行（1 条文本）" };
  }
  if (lines.length > MAX_ITEMS) {
    return { spec: null, error: `手绘最多 ${MAX_ITEMS} 行（条目上限）` };
  }
  const items: Array<{ text: string; emphasis: string }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const parsed = parseItemLine(lines[i]!);
    const chars = Array.from(parsed.text);
    if (chars.length < 1 || chars.length > MAX_TEXT) {
      return {
        spec: null,
        error: `第 ${i + 1} 行：文本必须是 1..${MAX_TEXT} 个字符`,
      };
    }
    items.push(parsed);
  }
  const params = {
    ...(spec.params as Record<string, unknown>),
    title: draft.title,
    items,
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

（注意：`chars.length < 1` 分支当前解析形状下不可达（idx>0 守卫 + splitLines 滤空）——保留为格式演进守卫，validateSceneSpec 兜底同款语义；无需专门测试覆盖。）

- [ ] **Step 4: 跑测试确认 GREEN**

Run: `pnpm --filter @acs/web test`
Expected: 109 + 7 新 = **116/116 pass**。
Run: `pnpm --filter @acs/web typecheck` → 0 错。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/app/video-studio/sketch-templates.ts apps/web/src/app/video-studio/sketch-templates.test.ts
git commit -m "feat(video-studio): sketch-templates 五枚起点模板与从右取字段数据编辑

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: 镜头编辑卡接线（第五族 optgroup + 应用链第五位）

**Files:**
- Modify: `apps/web/src/app/video-studio/shot-editor-card.tsx`（12 处）
- Modify: `apps/web/src/app/video-studio/video-studio.css`（一组块）

**Interfaces:**
- Consumes: Task 2 六导出（`SKETCH_TEMPLATES`/`isSketchComponentId`/`applySketchTemplate`/`SketchEditDraft`/`draftSketchFromSpec`/`buildSketchRevisePatch`）；既有 `.chart-template-select`/`.shot-apply`/`.editor-save` DOM。
- Produces: 下拉第五族 optgroup「手绘」；`.sketch-title-input`/`.sketch-data-input`/`.sketch-edit-error` DOM（e2e T4 消费）。

- [ ] **Step 1: 12 处编辑（应用链 smoke 由全 web 套件 + typecheck 守门，接线层无新单测——沿 P2-④ Task 3 先例）**

1. import 块（`stick-templates` import 之后）：

```ts
import {
  applySketchTemplate,
  buildSketchRevisePatch,
  draftSketchFromSpec,
  isSketchComponentId,
  SKETCH_TEMPLATES,
  type SketchEditDraft,
} from "./sketch-templates";
```

2. `EMPTY_STICK_DRAFT` 之后：`const EMPTY_SKETCH_DRAFT: SketchEditDraft = { title: "", data: "" };`
3. `resolveAnyTemplate` 内 stick 步之后追加（注释同步「五族」；错误链 `flow.error ?? map.error ?? chart.error` 不动）：

```ts
  const sketch = applySketchTemplate(spec, templateId);
  if (sketch.spec) return { spec: sketch.spec, error: null };
```

4. 状态（`stickError` 之后）：

```ts
  const [sketchDraft, setSketchDraft] = useState<SketchEditDraft>(() =>
    spec && isSketchComponentId(spec.componentId)
      ? draftSketchFromSpec(spec)
      : EMPTY_SKETCH_DRAFT,
  );
  const [sketchError, setSketchError] = useState<string | null>(null);
```

5. working 版本 effect（stick 重置块之后）：

```ts
    setSketchError(null);
    setSketchDraft(
      nextSpec && isSketchComponentId(nextSpec.componentId)
        ? draftSketchFromSpec(nextSpec)
        : EMPTY_SKETCH_DRAFT,
    );
```

6. 模板 onChange：`setStickError(null);` 后加 `setSketchError(null);`；预填 else-if 链尾追加：

```ts
                } else if (isSketchComponentId(applied.spec.componentId)) {
                  setSketchDraft(draftSketchFromSpec(applied.spec));
                }
```

7. label 改：`组件模板（图表 / 地图 / 流程 / 火柴人 / 手绘）`
8. optgroup「火柴人」之后：

```jsx
              <optgroup label="手绘">
                {SKETCH_TEMPLATES.map((template) => (
                  <option key={template.templateId} value={template.templateId}>
                    {template.label}
                  </option>
                ))}
              </optgroup>
```

9. 编辑字段（stick 字段块之后、overflowMs 之前）：

```jsx
          {isSketchComponentId(spec.componentId) ? (
            <>
              <label className="shot-edit-field">
                手绘标题
                <input
                  className="sketch-title-input"
                  maxLength={40}
                  value={sketchDraft.title}
                  onChange={(event) =>
                    setSketchDraft({ ...sketchDraft, title: event.target.value })
                  }
                />
              </label>
              <label className="shot-edit-field">
                数据（每行 文本[,下划线|圈]（强调缺省无，文本可含逗号））
                <textarea
                  className="sketch-data-input"
                  rows={5}
                  value={sketchDraft.data}
                  onChange={(event) =>
                    setSketchDraft({ ...sketchDraft, data: event.target.value })
                  }
                />
              </label>
              {sketchError ? (
                <p className="sketch-edit-error">{sketchError}</p>
              ) : null}
            </>
          ) : null}
```

10. 应用链：stickResult 块之后、`buildRevisePatch` 之前：

```ts
                const sketchResult = isSketchComponentId(
                  (
                    stickResult?.spec ??
                    flowResult?.spec ??
                    mapResult?.spec ??
                    chartResult?.spec ??
                    baseSpec
                  ).componentId,
                )
                  ? buildSketchRevisePatch(
                      stickResult?.spec ??
                        flowResult?.spec ??
                        mapResult?.spec ??
                        chartResult?.spec ??
                        baseSpec,
                      sketchDraft,
                    )
                  : null;
                if (sketchResult && (sketchResult.error || !sketchResult.spec)) {
                  setSketchError(sketchResult.error ?? "手绘数据无效");
                  return;
                }
```

11. `buildRevisePatch` 基底链改为 `sketchResult?.spec ?? stickResult?.spec ?? flowResult?.spec ?? mapResult?.spec ?? chartResult?.spec ?? baseSpec`；成功清理块 `setStickError(null);` 后加 `setSketchError(null);`；应用按钮上注释「图表/地图/流程/火柴人数据」改「…/火柴人/手绘数据」。
12. 文件顶注释模块清单 `stick-templates.ts` 后补 `/ sketch-templates.ts`（纯注释一致性）。

`video-studio.css`（`.stick-edit-error` 块之后）：

```css
/* P2-⑤ 手绘编辑字段（沿火柴人控件同款外观） */
.sketch-title-input {
  font-size: 13px;
  padding: 4px 8px;
  border: 1px solid #bfd6c8;
  border-radius: 6px;
  font-family: inherit;
}

.sketch-data-input {
  font-size: 13px;
  padding: 6px 8px;
  border: 1px solid #bfd6c8;
  border-radius: 6px;
  min-height: 96px;
  resize: vertical;
  font-family: inherit;
}

.sketch-edit-error {
  margin: 0;
  font-size: 12px;
  color: #a3230f;
}
```

- [ ] **Step 2: 全套守门**

Run: `pnpm --filter @acs/web test` → 116/116；`pnpm --filter @acs/web typecheck` → 0 错；`pnpm exec biome check apps/web/src/app/video-studio` → 0 error（format 报错 --write 修，先例同上）。
Run: `pnpm --filter @acs/video-scene test` → 113/113（复跑确认接线零触碰组件）。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/app/video-studio/shot-editor-card.tsx apps/web/src/app/video-studio/video-studio.css
git commit -m "feat(video-studio): 镜头编辑卡接入手绘模板下拉（第五族 optgroup）与数据编辑

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: e2e VID-021 + A1 金标准 + 登记

**Files:**
- Create: `scripts/video/e2e-sketch.mjs`
- Modify: `qa/registry.json`（VID-021，追加在 VID-020 之后）
- Modify: `AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md`（顶部条目）
- Create（本地、gitignore 不入库）: `artifacts/video-studio-sketch/E2E_SKETCH.md`（证据记录）

**Interfaces:**
- Consumes: Task 1 componentId、Task 2 templateId（`sketch-underline-3`/`sketch-highlight-mix`）、Task 3 DOM 类（`.sketch-data-input`、既有 `.chart-template-select`/`.shot-apply`/`.editor-save` 等）、P2-④ stick e2e（A1 子进程复跑）。
- Produces: VID-021 登记；e2e 自校验 A1（stick 哈希 = P2-④ 已档 `1b12050d…`/`6e59b169…`）。

- [ ] **Step 1: 写 e2e 脚本**

`scripts/video/e2e-sketch.mjs` = `scripts/video/e2e-stick.mjs` 全文克隆后改以下各处（其余逐字保留，含 frameYavg/renderProject/waitForMessage/usageLines/sha256 工具）：

- 头注释改：

```js
#!/usr/bin/env node
// P2-⑤ 手绘端到端闭环验收（VID-021，零 TTS 计费）：
//   浏览器新建→STEM 分镜（4 镜头 218 帧，水循环）→保存
//   →镜头 2 换 sketch-underline-3（旁白并发编辑单次应用一并落库）→改文本数据→应用→保存
//   →镜头 3 换 sketch-highlight-mix→改文本数据（含逗号文本 + 尾缀强调）→应用→保存
//   →导出 JSON（结构断言：items/强调词/文本/旁白合并/时长保留）
//   →CLI render-scene 双画幅出片→双跑逐字节 SHA-256 一致
//   →手绘帧 YAVG ≥100（帧 80 条目收笔在画 / 帧 140 首条目描画中，双画幅）
//   →A1 金标准：stick e2e（VID-020）子进程复跑 = P2-④ 已档哈希（v6 追加无害）
//   →计费台账行数不变 + 浏览器控制台零 error。
// 前置: @acs/web dev server 已在 BASE_URL（:3210，建议经 scripts/dev/proxy-3211.mjs）；
//       packages/{video-document,video-scene} 已 build；ffmpeg 在 PATH。
// exit 0 = 闭环成立；任何一步失败 exit 1 并打印步骤名。
```

- `fail` 步名前缀 `[e2e-sketch]`；`OUT_DIR = path.join(ROOT, "artifacts/video-studio-sketch");`；所有 `console.log("[e2e-stick]` 改 `[e2e-sketch]`；截图名 `sketch-editor.png`。

- 段落 1（镜头 2）替换为：

```js
// —— 1. 镜头 2 换 sketch-underline-3：旁白与换模板同草稿并发，单次应用一并落库
//        （P2-① 终评 I1 合并语义不回退）→ 二次应用改文本数据 ——
const card2 = page.locator(".shot-list > li").nth(1);
await card2.locator(".shot-edit-toggle").click();
await card2.locator(".shot-narration-input").fill("手绘要点写出来。");
await card2.locator(".chart-template-select").selectOption("sketch-underline-3");
await card2.locator(".shot-apply").click();
await card2
  .locator(".sketch-data-input")
  .waitFor({ state: "visible", timeout: 10_000 })
  .catch(() => fail("手绘编辑字段", "换模板后 .sketch-data-input 未出现"));
await page
  .waitForFunction(
    (index) => {
      const el = document
        .querySelectorAll(".shot-list > li")
        [index]?.querySelector(".sketch-data-input");
      return Boolean(el && el.value.includes("要点一,下划线"));
    },
    1,
    { timeout: 10_000, polling: 100 },
  )
  .catch(() => fail("模板预填", "sketch-data-input 未回填模板默认数据"));
await card2.locator(".sketch-data-input").fill("重点甲,下划线");
await card2.locator(".shot-apply").click();
await page.click(".editor-save");
await waitForMessage(page, "已保存", "保存手绘镜头");
```

- 段落 2（镜头 3）替换为：

```js
// —— 2. 镜头 3 换 sketch-highlight-mix + 文本数据编辑（含逗号文本 + 尾缀强调）——
const card3 = page.locator(".shot-list > li").nth(2);
await card3.locator(".shot-edit-toggle").click();
await card3.locator(".chart-template-select").selectOption("sketch-highlight-mix");
await card3.locator(".shot-apply").click();
await card3
  .locator(".sketch-data-input")
  .waitFor({ state: "visible", timeout: 10_000 })
  .catch(() => fail("混排模板编辑字段", "换模板后 .sketch-data-input 未出现"));
await page
  .waitForFunction(
    (index) => {
      const el = document
        .querySelectorAll(".shot-list > li")
        [index]?.querySelector(".sketch-data-input");
      return Boolean(el && el.value.includes("重点结论,下划线"));
    },
    2,
    { timeout: 10_000, polling: 100 },
  )
  .catch(() => fail("混排模板预填", "sketch-data-input 未回填模板默认数据"));
await card3
  .locator(".sketch-data-input")
  .fill("重点乙,下划线\n关键,丙,圈\n补充丁");
await card3.locator(".shot-apply").click();
await page.click(".editor-save");
await waitForMessage(page, "已保存", "保存混排镜头");
```

（「关键,丙,圈」钉从右取字段：文本 =「关键,丙」、强调 = 圈——e2e 级解析断言。）

- 段落 3（导出断言）替换为：

```js
const s2 = specOf(exported.shots[1]);
if (s2.componentId !== "sketch-note") fail("镜头 2 组件", s2.componentId);
if (JSON.stringify(s2.params.items) !== '[{"text":"重点甲","emphasis":"下划线"}]')
  fail("镜头 2 条目", JSON.stringify(s2.params.items));
if (s2.durationMs !== 3100)
  fail("时长保留", `镜头 2 durationMs=${s2.durationMs}`);
const working2 = exported.shots[1].contentVersions.find(
  (v) => v.versionId === exported.shots[1].workingVersionId,
);
if (working2?.narrationText !== "手绘要点写出来。")
  fail("旁白并发合并", `narrationText=${working2?.narrationText ?? "(空)"}`);
const s3 = specOf(exported.shots[2]);
if (s3.componentId !== "sketch-note") fail("镜头 3 组件", s3.componentId);
const items3 = s3.params.items;
if (items3.length !== 3) fail("镜头 3 条目数", String(items3.length));
if (JSON.stringify(items3[1]) !== '{"text":"关键,丙","emphasis":"圈"}')
  fail("镜头 3 含逗号文本", JSON.stringify(items3[1]));
if (JSON.stringify(items3[2]) !== '{"text":"补充丁","emphasis":"无"}')
  fail("镜头 3 强调缺省", JSON.stringify(items3[2]));
if (s3.params.inkColor !== "#2f2f2f")
  fail("镜头 3 inkColor 保留", String(s3.params.inkColor));
```

（`console.log` 编辑落库行同步改条目摘要；截图 path `sketch-editor.png`。）

- 段落 4 注释改（帧口径）：

```js
// spans [2000,3100,2000,2000]ms @24fps → 总 218 帧：镜头 2 帧域 48..121，
// 镜头 3 帧域 122..169。帧 80（镜头 2 内 1333ms）：sketch-underline-3 三条目
// delay 160/400/640 + write 480 + draw 420 → 条目 0/1 已收笔（1060/1300ms）、
// 条目 2 描画中（p≈0.51），画面有字有笔画；帧 140（镜头 3 内 733ms）：
// sketch-highlight-mix 条目 0（delay 160）文本写完（640ms）、下划线描画中
// （p≈0.22），条目 1 写入中。两帧均 YAVG ≥100。
```

- 段落 6（A1 金标准，计费/控制台检查之后、`browser.close()` 之前）：

```js
// —— 6. A1 金标准：stick e2e 子进程复跑 = P2-④ 已档哈希（v6 追加无害）——
const STICK_HASHES = {
  landscape: "1b12050d84f70dd01736a2d0e2bfcead2013efb69bb3db31719c9e55d9d62e24",
  portrait: "6e59b16919d4b3616b9310cdd2d5c71c631ab55c705175d5d0eecd392e80be71",
};
const stickRun = spawnSync(
  process.execPath,
  [path.join(ROOT, "scripts/video/e2e-stick.mjs")],
  { cwd: ROOT, encoding: "utf8", timeout: 900_000, env: { ...process.env } },
);
if (stickRun.status !== 0)
  fail("A1 stick 复跑", `${stickRun.stdout ?? ""}\n${stickRun.stderr ?? ""}`);
for (const [aspect, want] of Object.entries(STICK_HASHES)) {
  const m = `${stickRun.stdout}`.match(
    new RegExp(`双跑一致: ${aspect} ([0-9a-f]{64})`),
  );
  if (!m || m[1] !== want)
    fail("A1 金标准", `${aspect}: ${m?.[1] ?? "(无输出)"} ≠ ${want}`);
}
console.log("[e2e-sketch] A1: stick 复跑哈希 = P2-④ 已档（注册表 v6 追加无害）");
```

（timeout 900_000：stick e2e 内嵌 flow A1 子进程链，实跑 ~8 分钟，上限放宽到 15 分钟。`OK` 总结行加「A1 stick 金标准一致」。SHA-256 列表文件名换 `e2e.video-project.json`/`render/*.mp4`/`sketch-editor.png`。）

- [ ] **Step 2: registry + 前置构建**

`qa/registry.json` 在 VID-020 条目后追加（结构同 VID-020：tier `integration`、argv `["node","scripts/video/e2e-sketch.mjs"]`、`requiresPorts: [3211]`、title `Video Studio hand-sketch templates and edit loop (write-on emphasis)`、checks 5 条英文：template dropdown fifth group applies sketch-note; data edit round-trips items with from-right emphasis parsing incl. comma-bearing text; narration edit merges in single apply; renders both aspects deterministic with stick baseline unchanged via VID-020 rerun v6 append harmless; no TTS billing)。

Run: `pnpm --filter @acs/video-scene test`（tsc 重建 dist → dev/代理端拿到 v6）
Expected: 全绿。

- [ ] **Step 3: 跑 e2e（RED 语义：脚本若逻辑错则 exit 1）**

Run: `node scripts/video/e2e-sketch.mjs`
Expected: exit 0；输出含 `[e2e-sketch] OK:`、双画幅双跑一致 SHA、帧 80/140 YAVG≥100、`A1: stick 复跑哈希 = P2-④ 已档`。任何 FAIL 行 = 排查（沿 systematic-debugging，修脚本或实现——实现缺陷回对应任务补 RED 测试）。

- [ ] **Step 4: 回归 + 证据 + 登记**

Run: `pnpm --filter @acs/video-document test` → 71/71；`node --test scripts/video/*.test.mjs` → 57；`pnpm qa:validate` → validate/smoke 计数 +1（VID-021 入列，81 automated）；`pnpm exec biome check apps/web/src/app/video-studio packages/video-scene/src scripts/video/e2e-sketch.mjs` → 0 error。

写 `artifacts/video-studio-sketch/E2E_SKETCH.md`（沿 E2E_STICK.md 结构：链路/结果/产物与可复核性，含新双画幅 SHA-256、A1 stick 哈希、台账行数）。`CURRENT_STATE.md` 顶部插 P2-⑤ 条目（提交号、闭式手绘几何摘要、v6、模板清单、e2e 数字、回归计数）。

- [ ] **Step 5: Commit**

```bash
git add scripts/video/e2e-sketch.mjs qa/registry.json AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md
git commit -m "feat(video-studio): P2-⑤ 手绘收口——e2e VID-021、A1 金标准与登记

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

（`artifacts/video-studio-sketch/` 按 gitignore 不入库。）

---

## Self-Review 记录（写完即查，问题就地改）

1. **Spec 覆盖**：R1→T1（组件+v6+index）；R2→T1 测试 2-8（写入/几何/双描/梯次/emoji/确定性）；R3→T1 测试 1 + T2 测试 1（时序预算）；R4→T2+T3（模板/编辑/接线，e2e T4 断言闭环与合并）；R5→T4（YAVG/双跑/A1/零计费/登记）。错误表全表→T1 测试 1（组件侧）+T2 测试 5/7（工作台侧）。✓
2. **占位扫描**：无 TBD/TODO；全部代码块完整可抄。✓
3. **类型一致性**：`SketchEditDraft`/`sketchNote`/`SKETCH_TEMPLATES` 等名在 T2 Produces 与 T3 消费逐字一致；e2e 消费 DOM 类与 T3 Produces 一致；A1 哈希与 P2-④ E2E_STICK.md 已档值逐字一致。✓
4. **Review Focus**：5 条各有归属测试/守门（见各条）。✓
5. **预算复核**：sketch-underline-3/circle-key/highlight-mix/one-word = 160+2×240+480+420 = 1540 / 160+240+480+420 = 1300 / 1540 / 1060；sketch-list-5 = 160+4×200+400+360 = 1720——全部 ≤2000。✓
