# Video Studio 转场（P1 Feature ④）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 镜头间 dip-to-black 转场：project 级 `transitions` 元数据 + 共享纯函数帧数学 + Remotion/预览双端叠层 + 工作台编辑 + e2e（VID-016）。

**Architecture:** 转场向相邻 span 内部借帧（对半 split 的黑色淡入/淡出），spans 连续性不变量不动；帧数学在 `@acs/video-document` 纯函数（预览/出片同源，沿 mapGlobalFrame 先例）；无 transitions 字段 → 渲染树与现状逐字节一致。

**Tech Stack:** TypeScript（video-document）、React/Remotion（TimelineScene 叠层）、Next.js 工作台（转场编辑区）、node --test、Playwright（e2e）、ffmpeg signalstats（暗帧像素断言）。

**Spec:** `docs/superpowers/specs/2026-10-18-video-studio-transitions-design.md`

## Global Constraints

- 帧确定性：opacity 来自纯帧数学（无随机/时钟）；带转场双跑出片逐字节一致（spec A4）。
- **无转场 = 字节不变**：`transitions` 缺省/空时 props 文件与 MP4 与现状逐字节一致（spec A1，对照 Feature ③ 已档哈希）。
- spans 连续性不变量不碰：转场借帧在 span 内部，`quantizeTimeline`/衔接断言零改动。
- `transitions` 为可变编排元数据（title 同级），不进只追加纪律（spec 裁定）。
- 单测零网络/零 ffmpeg/零浏览器；e2e 用 BASE_URL=http://127.0.0.1:3211（剥头代理）。
- 计费：全程无 TTS，`artifacts/tts-usage.jsonl` 行数不变。
- 媒体不入库（SHA-256 入证据 md）；biome `--write` 后再 commit；commit 尾 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 叠层级序（双端一致）：镜头层 → 黑色转场叠层 → 字幕层（字幕浮于暗场之上，沿字幕可读性先例）。

## Review Focus

1. 相邻 span 过短的转场（如 48 帧镜头配 2000ms）——装配期大声拒绝并指路缩短 durationMs，不静默钳制不裸栈（Task 1 测试 `span 不足抛错`）。
2. 同 boundary 重复 / 镜头删减后 boundary 悬空——schema 层拒绝（Task 1 测试 `重复 boundary`/`boundary 越界`）。
3. 无 transitions 的老项目——props 文件不多 `transitions` 键、MP4 哈希等于 Feature ③ 已档值（Task 2 哈希断言）。
4. 窗口边界帧的 opacity 精确值（首帧=0 斜率起点、左尾帧=1 全黑、右首帧=1、窗外恒 0）与窗口完全落在两侧 span 内（Task 1 精确值测试）。
5. 预览与出片同斜率同 split（共享 helper 单点定义；Task 3 草稿纯逻辑测试 + Task 4 e2e 暗帧 YAVG 断言双保险）。

---

### Task 1: video-document — 类型 + 校验 + 转场帧数学纯函数

**Files:**
- Modify: `packages/video-document/src/types.ts:84-97`（VideoProject 增可选字段 + 新类型）
- Modify: `packages/video-document/src/validate.ts:460`（deliveries 块后、return 前插 transitions 校验）
- Create: `packages/video-document/src/transitions.ts`
- Modify: `packages/video-document/src/index.ts`（加 `export * from "./transitions.js";`）
- Test: `packages/video-document/src/transitions.test.ts`（帧数学）
- Test: `packages/video-document/src/validate.test.ts`（追加 schema 校验段，复用文件内 `baseProject()`/`withSecondShot()` fixture——单镜头 baseProject 越界用、双镜头 withSecondShot 合法/重复用）

**Interfaces:**
- Produces:
  - `type TransitionKind = "fade"`
  - `type ShotTransition = { boundary: number; kind: TransitionKind; durationMs: number }`
  - `VideoProject.transitions?: ShotTransition[]`
  - `type TransitionWindow = { boundary: number; startFrame: number; frames: number; halfOut: number; halfIn: number }`
  - `resolveTransitionWindows(transitions: ShotTransition[], spans: Array<{ startFrame: number; frames: number }>, fps: number): TransitionWindow[]`（span 不足/帧数 <2 抛错）
  - `transitionOverlayAt(windows: TransitionWindow[], frame: number): number`（0..1，0=无叠加）
  - spec R2 的单函数签名细化为 resolve+query 两函数（装配一次、逐帧查询）；语义不变。

- [ ] **Step 1: 写失败测试** `packages/video-document/src/transitions.test.ts`

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveTransitionWindows,
  transitionOverlayAt,
} from "./transitions.js";

// spans：3 镜头 [48, 74, 48] → startFrame [0, 48, 122]，total 170。
const SPANS = [
  { startFrame: 0, frames: 48 },
  { startFrame: 48, frames: 74 },
  { startFrame: 122, frames: 48 },
];

test("resolveTransitionWindows 对半 split 且窗口完全在 span 内", () => {
  // 500ms @24fps → T=12 → halfOut=6（左尾 6 帧）、halfIn=6（右头 6 帧）
  const [w] = resolveTransitionWindows(
    [{ boundary: 0, kind: "fade", durationMs: 500 }],
    SPANS,
    24,
  );
  assert.equal(w.startFrame, 42); // 48 - 6
  assert.equal(w.frames, 12);
  assert.deepEqual([w.halfOut, w.halfIn], [6, 6]);
});

test("transitionOverlayAt 线性斜率与边界精确值", () => {
  const ws = resolveTransitionWindows(
    [{ boundary: 0, kind: "fade", durationMs: 500 }],
    SPANS,
    24,
  );
  assert.equal(transitionOverlayAt(ws, 41), 0); // 窗外
  assert.equal(transitionOverlayAt(ws, 42), 1 / 6); // 左窗首帧
  assert.equal(transitionOverlayAt(ws, 47), 1); // 左尾帧 = 全黑
  assert.equal(transitionOverlayAt(ws, 48), 1); // 右首帧 = 全黑
  assert.equal(transitionOverlayAt(ws, 53), 1 / 6); // 右窗末帧
  assert.equal(transitionOverlayAt(ws, 54), 0); // 窗外
});

test("transitionOverlayAt 奇数 T 时 halfOut=ceil/halfIn=floor", () => {
  // 300ms @24fps → T=round(7.2)=7 → halfOut=4, halfIn=3
  const ws = resolveTransitionWindows(
    [{ boundary: 1, kind: "fade", durationMs: 300 }],
    SPANS,
    24,
  );
  assert.deepEqual([ws[0].halfOut, ws[0].halfIn], [4, 3]);
  assert.equal(transitionOverlayAt(ws, 121), 1); // 左尾（122-1）
  assert.equal(transitionOverlayAt(ws, 122), 1); // 右首
  assert.equal(transitionOverlayAt(ws, 124), 1 / 3); // 右窗末（125 起为 0）
  assert.equal(transitionOverlayAt(ws, 125), 0);
});

test("resolveTransitionWindows span 不足大声拒绝并指路", () => {
  // 极端：两镜头各 3 帧 + 500ms → T=12, halfOut=6 ≥ 3 → 抛错
  const tiny = [
    { startFrame: 0, frames: 3 },
    { startFrame: 3, frames: 3 },
  ];
  assert.throws(
    () =>
      resolveTransitionWindows(
        [{ boundary: 0, kind: "fade", durationMs: 500 }],
        tiny,
        24,
      ),
    /缩短|durationMs/,
  );
});
```

`validate.test.ts` 追加（文件尾部，fixture 复用 `baseProject()`/`withSecondShot()`）：

```ts
// —— P1 转场（Feature ④ spec R1）：可变编排元数据，schema 层查形状/枚举/范围/重复 ——
test("transitions 合法条目通过并原样返回", () => {
  const project = withSecondShot(baseProject());
  project.transitions = [{ boundary: 0, kind: "fade", durationMs: 500 }];
  assert.deepEqual(
    validateVideoProject(project).transitions,
    project.transitions,
  );
});

test("transitions 单镜头 boundary 越界 → 拒绝并指路清理", () => {
  const project = baseProject(); // 单镜头：合法 0..-1 为空集
  project.transitions = [{ boundary: 0, kind: "fade", durationMs: 500 }];
  assert.throws(() => validateVideoProject(project), /boundary 越界/);
});

test("transitions kind/durationMs 非法 → 拒绝", () => {
  const project = withSecondShot(baseProject());
  project.transitions = [{ boundary: 0, kind: "wipe", durationMs: 500 }];
  assert.throws(() => validateVideoProject(project), /kind 须为 fade/);
  project.transitions = [{ boundary: 0, kind: "fade", durationMs: 99 }];
  assert.throws(() => validateVideoProject(project), /durationMs/);
  project.transitions = [{ boundary: 0, kind: "fade", durationMs: 2001 }];
  assert.throws(() => validateVideoProject(project), /durationMs/);
  project.transitions = [{ boundary: 0, kind: "fade", durationMs: 500.5 }];
  assert.throws(() => validateVideoProject(project), /durationMs/);
});

test("transitions 同 boundary 重复 → 拒绝", () => {
  const project = withSecondShot(baseProject());
  project.transitions = [
    { boundary: 0, kind: "fade", durationMs: 500 },
    { boundary: 0, kind: "fade", durationMs: 300 },
  ];
  assert.throws(() => validateVideoProject(project), /重复/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @acs/video-document run build && node --test packages/video-document/dist/transitions.test.js packages/video-document/dist/validate.test.js`
Expected: FAIL——transitions.test.js：`Cannot find module './transitions.js'`（或编译错）；validate.test.js 新增四条：`throws` 断言不触发（校验尚未拦截 transitions）。

- [ ] **Step 3: 实现**

`types.ts` 增：

```ts
// —— P1 转场（Feature ④ spec）：project 级编排元数据，可自由改写（title 同级），不进只追加纪律 ——
export type TransitionKind = "fade";
export type ShotTransition = {
  boundary: number; // 0 基：shots[boundary] 出场 → shots[boundary+1] 入场
  kind: TransitionKind;
  durationMs: number; // 100..2000
};
```

`VideoProject` 在 `deliveries` 后加 `transitions?: ShotTransition[];`。

`validate.ts`（deliveries 循环后、`return parsed as VideoProject;` 前；`isRecord`/`fail`/`MAX_ARRAY` 均为文件内既有助手）：

```ts
if (parsed.transitions !== undefined) {
  if (
    !Array.isArray(parsed.transitions) ||
    parsed.transitions.length > MAX_ARRAY
  ) {
    fail(`transitions must be an array of at most ${MAX_ARRAY} entries`);
  }
  const seen = new Set<number>();
  const maxBoundary = parsed.shots.length - 2;
  for (const [index, transition] of parsed.transitions.entries()) {
    const field = `transitions[${index}]`;
    if (!isRecord(transition)) fail(`${field} must be an object`);
    if (
      !Number.isInteger(transition.boundary) ||
      transition.boundary < 0 ||
      transition.boundary > maxBoundary
    ) {
      fail(`${field}.boundary 越界（合法 0..${maxBoundary}，镜头增删后需同步清理）`);
    }
    if (transition.kind !== "fade") fail(`${field}.kind 须为 fade`);
    if (
      !Number.isInteger(transition.durationMs) ||
      transition.durationMs < 100 ||
      transition.durationMs > 2000
    ) {
      fail(`${field}.durationMs 须为 100..2000 的整数毫秒`);
    }
    if (seen.has(transition.boundary as number)) {
      fail(`${field}.boundary 与前条重复（同一边界至多一条转场）`);
    }
    seen.add(transition.boundary as number);
  }
}
```

`transitions.ts`（新文件，完整实现）：

```ts
import type { ShotTransition } from "./types.js";

// —— P1 转场帧数学（Feature ④ spec R2）：dip-to-black 向相邻 span 内部借帧 ——
// 装配一次 resolveTransitionWindows（span 不足在此大声拒绝），逐帧只查
// transitionOverlayAt。纯函数、无随机：同输入同输出（帧确定性纪律）。
export type TransitionWindow = {
  boundary: number;
  startFrame: number; // 窗口全局首帧（左镜头尾部第一借帧）
  frames: number; // = halfOut + halfIn
  halfOut: number; // 左镜头尾部借帧数（ceil(T/2)）
  halfIn: number; // 右镜头头部借帧数（floor(T/2)）
};

export function resolveTransitionWindows(
  transitions: ShotTransition[],
  spans: Array<{ startFrame: number; frames: number }>,
  fps: number,
): TransitionWindow[] {
  return transitions.map((transition) => {
    const left = spans[transition.boundary];
    const right = spans[transition.boundary + 1];
    // schema 已保证 boundary 范围；装配期防御（spans 与 shots 错位属编程错误）
    if (!left || !right) {
      throw new Error(
        `transitions[${transition.boundary}] 对应的 span 不存在（spans 与镜头数错位）`,
      );
    }
    const total = Math.round((transition.durationMs * fps) / 1000);
    const halfOut = Math.ceil(total / 2);
    const halfIn = total - halfOut;
    if (halfOut >= left.frames || halfIn >= right.frames) {
      throw new Error(
        `镜头 ${transition.boundary + 1}→${transition.boundary + 2} 的转场 ${transition.durationMs}ms 借帧（${halfOut}+${halfIn}）超出相邻 span（${left.frames}+${right.frames} 帧）：缩短 durationMs 或加长镜头`,
      );
    }
    return {
      boundary: transition.boundary,
      startFrame: left.startFrame + left.frames - halfOut,
      frames: total,
      halfOut,
      halfIn,
    };
  });
}

// 0 = 无叠加；左窗线性升至 1（左尾帧全黑），右窗自 1 线性降（右首帧全黑）。
export function transitionOverlayAt(
  windows: TransitionWindow[],
  frame: number,
): number {
  let opacity = 0;
  for (const window of windows) {
    const offset = frame - window.startFrame;
    if (offset < 0 || offset >= window.frames) continue;
    const value =
      offset < window.halfOut
        ? (offset + 1) / window.halfOut
        : 1 - (offset - window.halfOut) / window.halfIn;
    opacity = Math.max(opacity, value);
  }
  return opacity;
}
```

`index.ts` 加一行 `export * from "./transitions.js";`。注意：`halfIn` 为 0（T=1，100ms 不会出现但防御）时右窗分支除零——`total >= 2` 由 durationMs≥100 & fps≥1 保证（100ms@24fps → T=2），无需额外分支；若想绝对防御可在 resolve 里 `if (total < 2) throw`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @acs/video-document run build && node --test "packages/video-document/dist/**/*.test.js"`
Expected: 既有 61 + 新增 8（帧数学 4 + 校验 4）全绿。

- [ ] **Step 5: Commit**

```bash
npx biome check --write packages/video-document/src/transitions.ts packages/video-document/src/transitions.test.ts packages/video-document/src/types.ts packages/video-document/src/validate.ts packages/video-document/src/validate.test.ts packages/video-document/src/index.ts
git add packages/video-document/src && git commit -m "feat(video-studio): 转场文档模型与帧数学——ShotTransition 校验 + dip-to-black 窗口纯函数"
```

---

### Task 2: TimelineScene 叠层 + render-scene 装配 + 无转场字节不变实证

**Files:**
- Modify: `packages/remotion-engine/src/scene-spec-composition.tsx:97-191`
- Modify: `scripts/video/render-scene.mjs:291-331`（timelineProps 增 transitions 透传 + manifest 摘要）

**Interfaces:**
- Consumes: Task 1 `ShotTransition`/`resolveTransitionWindows`/`transitionOverlayAt`（`@acs/video-document`）。
- Produces: `TimelineProps.transitions?: ShotTransition[]`；render-manifest 增 `transitions` 摘要段；A1 证据（无转场重渲哈希 = Feature ③ 已档值）。

- [ ] **Step 1: TimelineScene 叠层**

`TimelineProps` 增 `transitions?: ShotTransition[]`（import 自 `@acs/video-document`，与 `activeSubtitleCue` 同源）。`TimelineScene` 内：

```tsx
// P1 转场（Feature ④）：spans 由 shots 派生，装配一次窗口；无 transitions 时
// windows 为空数组 → 叠层恒 opacity 0 → 不渲染 → 渲染树与现状逐字节一致。
const transitionWindows = useMemo(
  () =>
    shots && shots.length > 1 && transitions && transitions.length > 0
      ? resolveTransitionWindows(
          transitions,
          shots.map((shot) => ({ startFrame: shot.startFrame, frames: shot.frames })),
          fps,
        )
      : [],
  [shots, transitions, fps],
);
const overlayOpacity = transitionOverlayAt(transitionWindows, frame);
```

渲染段（镜头层之后、字幕层之前）：

```tsx
{overlayOpacity > 0 ? (
  <AbsoluteFill style={{ backgroundColor: "#000", opacity: overlayOpacity }} />
) : null}
```

`useMemo`/`useCallback` 按需 import。**关键不变量**：`transitions` 缺省 → `overlayOpacity` 恒 0 → 条件渲染分支不进 DOM。

- [ ] **Step 2: render-scene 透传 + manifest 摘要**

`timelineProps` 构造后追加：

```js
// P1 转场（Feature ④）：project 级编排元数据透传（回读已过 validateVideoProject）。
if (Array.isArray(project.transitions) && project.transitions.length > 0) {
  timelineProps.transitions = project.transitions;
  // manifest 摘要：逐边界 kind/durationMs/换算帧窗（帧确定性证据口径）
  manifestMeta.transitions = project.transitions.map((transition) => {
    const left = timeline.shots[transition.boundary];
    const total = Math.round((transition.durationMs * FPS) / 1000);
    const halfOut = Math.ceil(total / 2);
    return {
      boundary: transition.boundary,
      kind: transition.kind,
      durationMs: transition.durationMs,
      startFrame: left.startFrame + left.frames - halfOut,
      frames: total,
    };
  });
}
```

（`manifestMeta` 为 render-manifest 写入处的对象名——实现时对齐实际变量名；span 不足的抛错在 TimelineScene 装配窗口时发生，CLI 以 Remotion 失败日志呈现，错误消息已指路。）**缺省不加键**：无 transitions 时 `timelineProps` 与 manifest 均不多字段（props 文件字节不变）。

- [ ] **Step 3: A1 无转场字节不变实证**

Run:
```bash
mkdir -p /tmp/t-a1 && cp artifacts/video-studio-shot-editor/baseline.video-project.json /tmp/t-a1/p.json && node scripts/video/render-scene.mjs --project /tmp/t-a1/p.json --out /tmp/t-a1/render && sha256sum /tmp/t-a1/render/*.mp4
```
Expected: landscape `bbda0997f8038e6b9b751e0528e9839ede2bb63612b1dc81636502db156e9f0f`、portrait `b1849dd5ab1d0391dbc574a23bdbf3bdba8e7327679810f90ae949d48bb5127a`（= `artifacts/video-studio-export/E2E_EXPORT.md` 已档值）。props-*.json 与已档件 diff 为空（无 transitions 键）。

- [ ] **Step 4: 构建回归**

Run: `pnpm --filter @acs/remotion-engine run build && pnpm --filter @acs/video-document run build`
Expected: 编译零错。

- [ ] **Step 5: Commit**

```bash
git add packages/remotion-engine/src/scene-spec-composition.tsx scripts/video/render-scene.mjs && git commit -m "feat(video-studio): TimelineScene 转场叠层与 render-scene 装配——缺省字段字节不变"
```

---

### Task 3: web —— 整片预览叠层 + 工作台转场编辑

**Files:**
- Create: `apps/web/src/app/video-studio/transitions-draft.ts`
- Test: `apps/web/src/app/video-studio/transitions-draft.test.ts`
- Modify: `apps/web/src/app/video-studio/scene-preview.tsx:148-254`
- Modify: `apps/web/src/app/video-studio/page.tsx`（shot-list 后插「转场」区 + TimelinePreview 传 transitions）

**Interfaces:**
- Consumes: Task 1 `ShotTransition`/`resolveTransitionWindows`/`transitionOverlayAt`；既有 `TimelinePreview`。
- Produces: `transitionsDraftFromProject(shots: number, transitions?: ShotTransition[]): TransitionDraftRow[]`；`buildTransitionsPatch(rows: TransitionDraftRow[]): { patch: ShotTransition[] | undefined; error: string | null }`；`TransitionDraftRow = { boundary: number; kind: "none" | "fade"; durationMs: number }`。

- [ ] **Step 1: 写失败测试** `transitions-draft.test.ts`

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTransitionsPatch,
  transitionsDraftFromProject,
} from "./transitions-draft.js";

test("transitionsDraftFromProject：每边界一行，缺省无转场，已有条目回填", () => {
  const rows = transitionsDraftFromProject(3, [
    { boundary: 1, kind: "fade", durationMs: 500 },
  ]);
  assert.deepEqual(rows, [
    { boundary: 0, kind: "none", durationMs: 500 },
    { boundary: 1, kind: "fade", durationMs: 500 },
    { boundary: 2, kind: "none", durationMs: 500 },
  ]);
});

test("transitionsDraftFromProject：镜头增删后越界条目丢弃（不抛错）", () => {
  const rows = transitionsDraftFromProject(2, [
    { boundary: 1, kind: "fade", durationMs: 500 },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "none");
});

test("buildTransitionsPatch：全无 → undefined（文档不加键）", () => {
  const rows = transitionsDraftFromProject(3, []);
  assert.equal(buildTransitionsPatch(rows).patch, undefined);
});

test("buildTransitionsPatch：合法 fade 行入 patch，越界时长行内拒绝", () => {
  const rows = transitionsDraftFromProject(2, [
    { boundary: 0, kind: "fade", durationMs: 500 },
  ]);
  const ok = buildTransitionsPatch(rows);
  assert.deepEqual(ok.patch, [{ boundary: 0, kind: "fade", durationMs: 500 }]);
  const bad = buildTransitionsPatch([
    { boundary: 0, kind: "fade", durationMs: 99 },
  ]);
  assert.equal(bad.patch, undefined);
  assert.match(bad.error!, /100..2000/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @acs/web test -- transitions-draft`
Expected: FAIL——模块不存在。

- [ ] **Step 3: 实现 `transitions-draft.ts`**

```ts
import type { ShotTransition } from "@acs/video-document";

// —— 转场编辑纯逻辑（Feature ④ spec R4）：组件只做渲染/状态接线 ——
export type TransitionDraftRow = {
  boundary: number;
  kind: "none" | "fade";
  durationMs: number;
};

const DEFAULT_MS = 500;

export function transitionsDraftFromProject(
  shotCount: number,
  transitions?: ShotTransition[],
): TransitionDraftRow[] {
  const byBoundary = new Map(
    (transitions ?? [])
      .filter((transition) => transition.boundary >= 0 && transition.boundary < shotCount - 1)
      .map((transition) => [transition.boundary, transition]),
  );
  return Array.from({ length: Math.max(shotCount - 1, 0) }, (_, boundary) => {
    const existing = byBoundary.get(boundary);
    return {
      boundary,
      kind: existing ? "fade" : "none",
      durationMs: existing?.durationMs ?? DEFAULT_MS,
    };
  });
}

export function buildTransitionsPatch(rows: TransitionDraftRow[]): {
  patch: ShotTransition[] | undefined;
  error: string | null;
} {
  const active = rows.filter((row) => row.kind === "fade");
  for (const row of active) {
    if (!Number.isInteger(row.durationMs) || row.durationMs < 100 || row.durationMs > 2000) {
      return { patch: undefined, error: `转场时长须为 100..2000 的整数毫秒（边界 ${row.boundary + 1}）` };
    }
  }
  if (active.length === 0) return { patch: undefined, error: null };
  return {
    patch: active.map((row) => ({
      boundary: row.boundary,
      kind: "fade" as const,
      durationMs: row.durationMs,
    })),
    error: null,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @acs/web test -- transitions-draft`
Expected: PASS 4/4。

- [ ] **Step 5: 预览叠层 + 工作台接线**

`scene-preview.tsx` `TimelinePreview` 增可选 prop `transitions?: ShotTransition[]`：

```tsx
// P1 转场：与出片同一 resolve/overlay helper（同斜率同 split）；无转场恒 0 不渲染。
const transitionWindows = useMemo(
  () =>
    transitions && transitions.length > 0 && items.length > 1
      ? resolveTransitionWindows(
          transitions,
          items.map((item) => ({ startFrame: item.startFrame, frames: item.frames })),
          PIECE_FPS,
        )
      : [],
  [items, transitions],
);
const overlayOpacity = transitionOverlayAt(transitionWindows, Math.floor(frame));
```

`.piece-stage` 内 `SpecCanvas` 之后、字幕之前：

```tsx
{overlayOpacity > 0 ? (
  <div className="transition-overlay" aria-hidden="true" style={{ opacity: overlayOpacity }} />
) : null}
```

（`transition-overlay` CSS：`position:absolute; inset:0; background:#000; pointer-events:none;`——加进既有样式表。）page.tsx 的 `<TimelinePreview ... transitions={editor.document.transitions} />`（对齐实际传参处）。

`page.tsx` 「镜头时间线」section 的 `</ol>`（shot-list）之后插「转场」区：state `transitionsRows`（进编辑器即 `transitionsDraftFromProject(document.shots.length, document.transitions)`，镜头数变化时重建）；每边界一行 `镜头 {i+1} → {i+2}` + select（`transition-kind`，无/淡入淡出）+ number input（`transition-duration`，100..2000）；变更即 `buildTransitionsPatch` 校验——合法则 `setEditor({ ...editor, document: { ...document, transitions: patch } })`（undefined 时删键），非法则行内 `transition-error` 文案不落文档。保存按钮既有流程不动（transitions 随文档持久化）。

- [ ] **Step 6: web 回归**

Run: `pnpm --filter @acs/web test`
Expected: 62 + 4 新增全绿（既有断言不受影响——新 section 是增量节点）。

- [ ] **Step 7: Commit**

```bash
npx biome check --write apps/web/src/app/video-studio/transitions-draft.ts apps/web/src/app/video-studio/transitions-draft.test.ts apps/web/src/app/video-studio/scene-preview.tsx apps/web/src/app/video-studio/page.tsx
git add apps/web/src/app/video-studio && git commit -m "feat(video-studio): 工作台转场编辑与整片预览叠层——共享帧数学双端一致"
```

---

### Task 4: e2e 转场全链 + VID-016 + 证据

**Files:**
- Create: `scripts/video/e2e-transitions.mjs`
- Create: `artifacts/video-studio-transitions/E2E_TRANSITIONS.md`
- Modify: `qa/registry.json`（VID-016，沿 VID-015 体例）

**Interfaces:**
- Consumes: Task 1–3 全部；`e2e-shot-editor.mjs` 的建项/保存/导出流程（Playwright + BASE_URL=http://127.0.0.1:3211）；Feature ③ 已档无转场哈希（A1 对照）。
- Produces: e2e 退出码 0 = spec A1–A5 成立；E2E_TRANSITIONS.md + VID-016。

- [ ] **Step 1: 写 e2e 脚本**（沿 e2e-shot-editor.mjs 体例：waitForReady/data-studio-ready、waitForMessage、零控制台 error）

链路：建项（「做一个8秒的STEM解说视频，主题是水循环，分4个镜头」→ 规划 → 确认应用）→ 保存 → **配转场**（boundary 0：select 选「淡入淡出」、duration 500 → 等 `.transition-error` 不存在 → 保存 v3）→ 导出 JSON（断言 `transitions` 字段形状）→ CLI render-scene 双画幅出片 → **暗帧断言**（ffmpeg signalstats YAVG：boundary 0 中点帧 47 全黑 YAVG ≤ 30；对照帧 20 YAVG ≥ 100）→ **双跑**：导出件复制重渲逐字节 SHA-256 一致 → **A1**：无转场基线（`artifacts/video-studio-shot-editor/baseline.video-project.json` 拷贝）重渲哈希 = Feature ③ 已档两值 → 计费台账行数不变 → 控制台零 error。

YAVG 提取（零新依赖）：

```js
function frameYavg(videoPath, frameNumber) {
  const out = spawnSync("ffmpeg", [
    "-v", "info", "-i", videoPath,
    "-vf", `select='eq(n,${frameNumber})',signalstats,metadata=print:key=lavfi.signalstats.YAVG`,
    "-f", "null", "-",
  ], { encoding: "utf8" });
  const match = out.stderr.match(/YAVG=([0-9.]+)/);
  if (!match) throw new Error(`YAVG 提取失败 @${frameNumber}`);
  return Number(match[1]);
}
```

- [ ] **Step 2: 跑 e2e 到退出 0**（需 :3210 dev + :3211 代理在跑；首跑暴露选择器/时序缝隙按实修）

Run: `node scripts/video/e2e-transitions.mjs`
Expected: 退出 0，打印 OK + 哈希清单 + 「计费零新增」。

- [ ] **Step 3: 证据文档**（沿 E2E_EXPORT.md 体例：链路/结果/入库件 vs 本地媒体 SHA-256 表/复跑方式/零计费声明；明确记录 A1 对照值与暗帧 YAVG 数值）

- [ ] **Step 4: VID-016 登记**（manual 段 VID-015 后：steps 含建项配转场保存导出/双画幅出片/暗帧 YAVG 断言/双跑一致/无转场基线哈希对照/计费不变；passCriteria 对应 A1–A5）

- [ ] **Step 5: Commit**

```bash
git add scripts/video/e2e-transitions.mjs artifacts/video-studio-transitions qa/registry.json && git commit -m "feat(video-studio): 转场 e2e——暗帧 YAVG 断言、双跑一致与无转场基线哈希对照（VID-016）"
```

---

### Task 5: CURRENT_STATE + 全回归

**Files:**
- Modify: `AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md`（顶部新条目）

- [ ] **Step 1: CURRENT_STATE 顶部条目**（沿 ③ 体例：spec/五任务提交号/数据模型裁定/帧数学/A1 金标准/e2e 结果/回归计数）

- [ ] **Step 2: 全回归**

Run: `pnpm --filter @acs/video-document run build && node --test "packages/video-document/dist/**/*.test.js" && pnpm --filter @acs/video-scene run build && node --test "packages/video-scene/dist/**/*.test.js" && pnpm --filter @acs/web test && node --test "scripts/video/*.test.mjs" && pnpm lint`
Expected: 全绿（video-document 61+新增、video-scene 33、web 62+4、scripts 57）。

- [ ] **Step 3: Commit**

```bash
git add AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md && git commit -m "feat(video-studio): 转场收口——状态文档与全回归"
```

---

## Self-Review 记录

1. **Spec coverage**：R1→Task 1；R2→Task 1（两函数细化已注明）；R3→Task 2（A1 实证）；R4→Task 3；R5→Task 4。错误表七行：五行 Task 1 测试、span 不足 Task 1+2、boundary 悬空 Task 3（draft 丢弃）+Task 1（校验拒绝）。
2. **占位扫描**：Task 1 校验测试已锚定 `validate.test.ts` 既有 `baseProject()`/`withSecondShot()` fixture（单镜头/双镜头两态）；Task 2 manifestMeta 注明对齐实际变量名；无 TBD。
3. **类型一致性**：`ShotTransition`/`TransitionWindow`/`resolveTransitionWindows`/`transitionOverlayAt`/`TransitionDraftRow`/`transitionsDraftFromProject`/`buildTransitionsPatch` 在 Produces 与消费者一致；`TimelineProps.transitions` 两端一致。
4. **Review Focus**：五条各有归属测试（Task 1 ×3、Task 2 哈希断言、Task 3 ×2 + Task 4 e2e）。
