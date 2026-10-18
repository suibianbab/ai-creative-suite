# Video Studio 分镜编辑器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 工作台镜头卡从只读升级为可编辑：旁白/画面修订（人工版本）、单镜头重做（机器候选）、版本回滚与锁定，字幕随旁白自动跟随。

**Architecture:** 新纯函数 `reviseWorkingVersion`（video-document，人工路径）+ `reseedSpecParams`（web planner，模板换枚）+ 新组件 `ShotEditorCard`（草稿态表单，应用才落文档）；重做/回滚/锁定复用既有操作。e2e 走真实浏览器，零 TTS 计费。

**Tech Stack:** TypeScript ESM、node:test（包测试）、@acs/web 既有测试栈（vitest + testing-library）、Playwright（e2e）、Remotion（渲染冒烟）。

**Spec:** `docs/superpowers/specs/2026-10-18-video-studio-shot-editor-design.md`

## Global Constraints

- 版本演化只追加：历史 ContentVersion 字节不变；事件序符合 ADR 0003 §1.3（人工修订 = submitted(human)，锁定镜头再 + audit；机器重做 = submitted(ai)，锁定拒绝）。
- 字幕单一事实源：cue 不独立存储，全从 `narrationText` 投影；本刀不给字幕任何独立编辑面。
- video-document 不依赖 video-scene：spec 在该包内是 `unknown`，校验留在 web 层（`validateSceneSpec` + 组件注册表）。
- `savedVersion` 只在文档保存时递增（既有语义）；编辑操作只改内存 document。
- 单测零网络零计费；e2e 不做 TTS 合成（本刀计费 ¥0）。
- 密钥永不落盘；`DASHSCOPE_API_KEY` 只从 env（本刀不需要）。
- 媒体不入库，SHA-256 证据制；commit 尾注 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 测试命令：包测试 `pnpm --filter @acs/<pkg> run build && node --test "packages/<pkg>/dist/**/*.test.js"`；web `pnpm --filter @acs/web test`；lint `pnpm lint`；biome 自fix `npx biome check --write <files>`。

## Review Focus

1. 锁定镜头上人工修订仍可用且留 audit 事件（UI 不因锁定禁用修订表单）——Task 3 测试 `locked shot allows human revise`。
2. spec patch 时 ContentVersion.durationMs 与 spec.durationMs 失同步（改时长只改一处）——Task 1 测试 `spec patch syncs durationMs`。
3. 非法草稿（坏 hex / 时长越界 / 空标题）点了应用也不碰文档——Task 3 测试 `invalid draft does not call onRevise`。
4. 重做在锁定镜头被拒且 UI 文案指路解锁，而不是裸抛异常——Task 4 测试 `redo locked shot shows unlock hint`。
5. `reseedSpecParams` 对 text-animation 误改 params（标题输入才是它的编辑面）——Task 2 测试 `text-animation spec returned unchanged`。

---

### Task 1: `reviseWorkingVersion`（video-document 人工修订纯函数）

**Files:**
- Modify: `packages/video-document/src/operations.ts`
- Modify: `packages/video-document/src/index.ts`（如需导出）
- Test: `packages/video-document/src/operations.test.ts`

**Interfaces:**
- Produces: `reviseWorkingVersion(p: VideoProject, shotId: string, patch: { narrationText?: string; spec?: unknown }, newVersionId: string, at?: string): VideoProject`——供 Task 4 page.tsx 调用。

- [ ] **Step 1: 写失败测试**

在 `operations.test.ts` 追加（fixture 沿文件内既有造数函数，若其 id 非 UUID 导致 validate 拒绝，则新建本地 `editableProject()` 用真 UUID + description 1..200 + durationMs 合法，参照 tts-sse.test.mjs 的 alignableProject 模式）：

```ts
test("reviseWorkingVersion appends human-submitted version and moves pointer", () => {
  const p = editableProject(); // 1 shot, versionId V1, narrationText "旧旁白"
  const next = reviseWorkingVersion(p, SHOT_ID, { narrationText: "新旁白。" }, V2, T);
  const shot = next.shots[0]!;
  assert.equal(shot.contentVersions.length, 2);
  assert.equal(shot.workingVersionId, V2);
  const v2 = shot.contentVersions[1]!;
  assert.equal(v2.narrationText, "新旁白。");
  assert.equal(v2.durationMs, shot.contentVersions[0]!.durationMs); // 未 patch spec → 继承
  assert.equal(v2.provenance.engineId, "human-edit");
  assert.equal(v2.provenance.parentVersionId, V1);
  assert.deepEqual(shot.events.at(-1), { kind: "submitted", versionId: V2, at: T, actor: "human" });
  // 入参不动
  assert.equal(p.shots[0]!.contentVersions.length, 1);
});

test("reviseWorkingVersion on locked shot appends audit event too", () => {
  const locked = setLocked(editableProject(), SHOT_ID, true, T0);
  const next = reviseWorkingVersion(locked, SHOT_ID, { narrationText: "锁定下改。" }, V2, T);
  const events = next.shots[0]!.events;
  assert.deepEqual(events.at(-2), { kind: "submitted", versionId: V2, at: T, actor: "human" });
  assert.deepEqual(events.at(-1), { kind: "audit", note: "人工修订（锁定镜头）", at: T, actor: "human" });
});

test("reviseWorkingVersion spec patch syncs durationMs and sceneSource", () => {
  const spec = { specVersion: 1, componentId: "text-animation", componentVersion: "1", durationMs: 3000, seed: 1, background: "#ffffff", params: {} };
  const next = reviseWorkingVersion(editableProject(), SHOT_ID, { spec }, V2, T);
  const v2 = next.shots[0]!.contentVersions[1]!;
  assert.equal(v2.durationMs, 3000);
  assert.deepEqual(v2.sceneSource, { type: "spec", spec });
  // 描述带修订标记且 ≤200
  assert.ok(v2.description.length <= 200 && v2.description.includes("人工修订"));
});

test("reviseWorkingVersion throws on unknown shot and keeps input intact", () => {
  const p = editableProject();
  assert.throws(() => reviseWorkingVersion(p, "no-such-shot", { narrationText: "x" }, V2, T), /不存在/);
  assert.equal(p.shots[0]!.contentVersions.length, 1);
});

test("reviseWorkingVersion empty narration is legal", () => {
  const next = reviseWorkingVersion(editableProject(), SHOT_ID, { narrationText: "" }, V2, T);
  assert.equal(next.shots[0]!.contentVersions[1]!.narrationText, "");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @acs/video-document run build && node --test packages/video-document/dist/operations.test.js`
Expected: FAIL——`reviseWorkingVersion is not defined`（或 import 报错）。

- [ ] **Step 3: 最小实现**

`operations.ts` 追加（放 rollbackWorkingVersion 之后）：

```ts
// 人工修订（分镜编辑器）：以当前 working 版本为 base 追加新 ContentVersion +
// submitted(human)。锁定镜头允许（ADR 0003 §1.3 人工路径），并追加 audit 事件
// 留痕。patch.spec 由调用方先用 video-scene 校验过（本包内 spec 是 unknown）。
export function reviseWorkingVersion(
  p: VideoProject,
  shotId: string,
  patch: { narrationText?: string; spec?: unknown },
  newVersionId: string,
  at = new Date().toISOString(),
): VideoProject {
  const shot = p.shots.find((s) => s.shotId === shotId);
  if (!shot) throw new Error(`shotId ${shotId} 不存在`);
  const base = shot.contentVersions.find(
    (v) => v.versionId === shot.workingVersionId,
  );
  if (!base) throw new Error(`镜头 ${shotId} 的工作版本 ${shot.workingVersionId} 不存在`);
  const nextSpec = patch.spec;
  const version: ContentVersion = {
    ...base,
    versionId: newVersionId,
    createdAt: at,
    durationMs: nextSpec === undefined
      ? base.durationMs
      : (nextSpec as { durationMs: number }).durationMs,
    description: `${base.description.slice(0, 160)}（人工修订）`,
    narrationText: patch.narrationText ?? base.narrationText,
    sceneSource: nextSpec === undefined ? base.sceneSource : { type: "spec", spec: nextSpec },
    provenance: {
      ...base.provenance,
      engineId: "human-edit",
      engineVersion: "1",
      parentVersionId: base.versionId,
    },
  };
  return updateShot(p, shotId, (s) => ({
    ...s,
    contentVersions: [...s.contentVersions, version],
    events: [
      ...s.events,
      { kind: "submitted", versionId: newVersionId, at, actor: "human" as const },
      ...(s.locked
        ? [{ kind: "audit" as const, note: "人工修订（锁定镜头）", at, actor: "human" as const }]
        : []),
    ],
    workingVersionId: newVersionId,
  }));
}
```

`index.ts` 若按名导出操作则补 `reviseWorkingVersion`。

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2。
Expected: PASS（新增 5 例 + 既有全绿）。

- [ ] **Step 5: 提交**

```bash
git add packages/video-document/src/operations.ts packages/video-document/src/index.ts packages/video-document/src/operations.test.ts
git commit -m "feat(video-document): reviseWorkingVersion 人工修订纯函数——锁定镜头 audit 留痕、spec patch 同步时长"
```

---

### Task 2: `reseedSpecParams`（planner 模板换枚）

**Files:**
- Modify: `apps/web/src/app/video-studio/planner.ts`
- Test: `apps/web/src/app/video-studio/planner.test.ts`

**Interfaces:**
- Consumes: `lineDrawingParams(seed)` / `basicShapesParams(seed)`（planner.ts 私有，直接用）。
- Produces: `reseedSpecParams(spec: SceneSpec, seed: number): SceneSpec`——Task 3 编辑逻辑用；同时导出 `LINE_TEMPLATE_LABELS` / `SHAPE_TEMPLATE_LABELS`（模板表长供测试断言回绕）。

- [ ] **Step 1: 写失败测试**

`planner.test.ts` 追加：

```ts
test("reseedSpecParams regenerates line-drawing params from template tables", () => {
  const plan = planFromSentence("做一个10秒的线描动画，标题是水循环");
  assert.ok(plan.ok);
  const reseeded = reseedSpecParams(plan.spec, plan.spec.seed + 1);
  assert.equal(reseeded.seed, plan.spec.seed + 1);
  assert.deepEqual(reseeded.params, lineDrawingParamsFor(plan.spec.seed + 1)); // 见下
  assert.equal(reseeded.durationMs, plan.spec.durationMs); // 保留时长/背景
  assert.equal(reseeded.background, plan.spec.background);
  assert.notDeepEqual(reseeded.params, plan.spec.params); // 确实换了
});

test("reseedSpecParams regenerates basic-shapes params", () => {
  const plan = planFromSentence("做一个10秒的图形动画，标题是水循环");
  assert.ok(plan.ok);
  const reseeded = reseedSpecParams(plan.spec, plan.spec.seed + 1);
  assert.equal(reseeded.seed, plan.spec.seed + 1);
  assert.deepEqual(reseeded.params, basicShapesParamsFor(plan.spec.seed + 1));
});

test("reseedSpecParams leaves text-animation unchanged", () => {
  const plan = planFromSentence("做一个10秒的文字动画，标题是水循环");
  assert.ok(plan.ok);
  const reseeded = reseedSpecParams(plan.spec, 999);
  assert.deepEqual(reseeded, { ...plan.spec, seed: 999 }); // 仅 seed 记录变，params 不动
});
```

注：测试不引用私有 `lineDrawingParams`——期望值用**不动点断言**推导：`reseedSpecParams(spec, spec.seed).params` 应还原 `plan.spec.params`（同 seed 同模板）；换枚用 `seed+1` 时 params 变化；回绕用导出的 `LINE_TEMPLATE_LABELS.length`：`reseedSpecParams(spec, seed + len).params` deep-equal `reseedSpecParams(spec, seed).params`。测试按此写。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @acs/web test -- planner`
Expected: FAIL——`reseedSpecParams is not defined`。

- [ ] **Step 3: 最小实现**

`planner.ts` 在 `specSummary` 附近追加：

```ts
// 换模板（分镜编辑器）：对 line-drawing / basic-shapes 用新 seed 从模板表
// 重生成 params（模板表单一事实源）；text-animation 的 params 是标题/副标题，
// 不经此路。返回新 spec，不改入参；durationMs/background/组件版本保留。
export function reseedSpecParams(spec: SceneSpec, seed: number): SceneSpec {
  if (spec.componentId === "line-drawing") {
    return { ...spec, seed, params: lineDrawingParams(seed) };
  }
  if (spec.componentId === "basic-shapes") {
    return { ...spec, seed, params: basicShapesParams(seed) };
  }
  return { ...spec, seed };
}
```

同时导出 `LINE_TEMPLATE_LABELS` / `SHAPE_TEMPLATE_LABELS`（`export const`，供测试断言回绕与 UI 显示模板序号）。

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2。
Expected: PASS（新增 3 例 + planner 既有全绿）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/app/video-studio/planner.ts apps/web/src/app/video-studio/planner.test.ts
git commit -m "feat(video-studio): reseedSpecParams 模板换枚——seed 重抽走模板表单一事实源"
```

---

### Task 3: 镜头编辑纯逻辑 + `ShotEditorCard` 组件（草稿态表单）

web 测试栈是 `node --import tsx --test "src/app/video-studio/*.test.ts"`——纯函数测试、无 DOM 渲染（沿 piece-preview.test.ts 模式）。可测逻辑全部进纯模块 `shot-edit.ts`，组件只做渲染/状态接线，行为由 Task 5 e2e 验证。

**Files:**
- Create: `apps/web/src/app/video-studio/shot-edit.ts`（纯逻辑：草稿构造 + 校验）
- Create: `apps/web/src/app/video-studio/shot-edit.test.ts`
- Create: `apps/web/src/app/video-studio/shot-editor-card.tsx`（组件）
- Modify: `apps/web/src/app/video-studio/video-studio.css`

**Interfaces:**
- Consumes: `reseedSpecParams(spec, seed)`（Task 2）、`speechAwareDurationMs(baseMs, narrationText)`（planner 既有）、`SceneSpec` 类型（`shotWorkingSpec` 的降级语义由上层算好 `editable` 传入）。
- Produces:
  - `type ShotEditDraft = { narrationText: string; background: string; durationSeconds: number; title: string; subtitle: string; templateAdvanced: boolean }`
  - `draftFromWorking(working: { narrationText: string; durationMs: number }, spec: SceneSpec): ShotEditDraft`
  - `buildRevisePatch(draft: ShotEditDraft, spec: SceneSpec): { patch: { narrationText?: string; spec?: unknown } | null; error: string | null }`
  - `speechOverflowMs(draft: ShotEditDraft): number`（>0 = 旁白按语速超时长）
  - `ShotEditorCard`（props 见 spec §4.3）——Task 4 page.tsx 消费。

- [ ] **Step 1: 写失败测试**

`shot-edit.test.ts`（沿 node:test + assert/strict，spec/planFromSentence 造真实 spec）：

```ts
test("draftFromWorking seeds draft from working version and spec", () => {
  const plan = planFromSentence("做一个10秒的文字动画，标题是水循环");
  assert.ok(plan.ok);
  const draft = draftFromWorking({ narrationText: "水循环。", durationMs: 10000 }, plan.spec);
  assert.equal(draft.narrationText, "水循环。");
  assert.equal(draft.background, plan.spec.background);
  assert.equal(draft.durationSeconds, 10);
  assert.equal(draft.title, "水循环");
  assert.equal(draft.templateAdvanced, false);
});

test("buildRevisePatch rejects bad hex background", () => {
  const { patch, error } = buildRevisePatch(draft({ background: "#12gzz5" }), baseSpec());
  assert.equal(patch, null);
  assert.match(error!, /背景色/);
});

test("buildRevisePatch rejects out-of-range duration", () => {
  assert.equal(buildRevisePatch(draft({ durationSeconds: 0 }), baseSpec()).patch, null);
  assert.match(buildRevisePatch(draft({ durationSeconds: 700 }), baseSpec()).error!, /时长/);
});

test("buildRevisePatch requires non-empty title for text-animation", () => {
  const spec = textSpec(); // componentId text-animation，params.title "水循环"
  const { patch, error } = buildRevisePatch(draft({ title: "  " }), spec);
  assert.equal(patch, null);
  assert.match(error!, /标题/);
});

test("buildRevisePatch builds full spec patch with new background/duration/title", () => {
  const spec = textSpec();
  const { patch, error } = buildRevisePatch(draft({ background: "#102030", durationSeconds: 3.5, title: "蒸发" }), spec);
  assert.equal(error, null);
  assert.equal(patch!.spec!.background, "#102030");
  assert.equal(patch!.spec!.durationMs, 3500);
  assert.equal(patch!.spec!.params.title, "蒸发");
  assert.equal(patch!.narrationText, draft().narrationText);
});

test("buildRevisePatch template advance reseeds params via +1 seed", () => {
  const plan = planFromSentence("做一个10秒的线描动画，标题是水循环");
  assert.ok(plan.ok);
  const { patch, error } = buildRevisePatch(draft({ templateAdvanced: true }), plan.spec);
  assert.equal(error, null);
  assert.equal(patch!.spec!.seed, plan.spec.seed + 1);
  assert.deepEqual(patch!.spec!.params, reseedSpecParams(plan.spec, plan.spec.seed + 1).params);
  assert.notDeepEqual(patch!.spec!.params, plan.spec.params);
});

test("buildRevisePatch without template advance keeps params and seed", () => {
  const plan = planFromSentence("做一个10秒的图形动画，标题是水循环");
  assert.ok(plan.ok);
  const { patch, error } = buildRevisePatch(draft({ background: "#abcdef" }), plan.spec);
  assert.equal(error, null);
  assert.equal(patch!.spec!.seed, plan.spec.seed);
  assert.deepEqual(patch!.spec!.params, plan.spec.params);
});

test("speechOverflowMs positive only when speech estimate exceeds duration", () => {
  // 5 字旁白 → 400 + 5*300 = 1900ms；2s 时长 → 不溢出（0）；1s 时长 → 900 溢出
  assert.equal(speechOverflowMs(draft({ narrationText: "一二三四五。", durationSeconds: 2 })), 0);
  assert.equal(speechOverflowMs(draft({ narrationText: "一二三四五。", durationSeconds: 1 })), 900);
});
```

（`draft(overrides)` / `baseSpec()` / `textSpec()` 为文件内小工厂；`baseSpec()` 用 planFromSentence 的线描结果即可。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @acs/web test -- shot-edit`
Expected: FAIL——`Cannot find module ./shot-edit.js`。

- [ ] **Step 3: 最小实现**

`shot-edit.ts`（零 react 依赖）：

```ts
import type { SceneSpec } from "@acs/video-scene";
import { reseedSpecParams, speechAwareDurationMs } from "./planner.js";

export type ShotEditDraft = {
  narrationText: string;
  background: string;
  durationSeconds: number;
  title: string;
  subtitle: string;
  templateAdvanced: boolean;
};

const HEX = /^#[0-9a-fA-F]{6}$/;

type WorkingLike = { narrationText: string; durationMs: number };

type TextParams = { title?: string; subtitle?: string };

// 草稿初值：旁白/时长来自 working 版本，画面字段来自 spec。
export function draftFromWorking(working: WorkingLike, spec: SceneSpec): ShotEditDraft {
  const params = (spec.componentId === "text-animation" ? spec.params : {}) as TextParams;
  return {
    narrationText: working.narrationText,
    background: spec.background,
    durationSeconds: working.durationMs / 1000,
    title: params.title ?? "",
    subtitle: params.subtitle ?? "",
    templateAdvanced: false,
  };
}

// 语速溢出（分镜编辑器 R5）：>0 表示旁白按语速估计超出当前时长草稿。
export function speechOverflowMs(draft: ShotEditDraft): number {
  const durationMs = Math.round(draft.durationSeconds * 1000);
  return speechAwareDurationMs(durationMs, draft.narrationText) - durationMs;
}

// 草稿 → 已校验 patch；有错误则 patch 为 null（文档不被碰）。
export function buildRevisePatch(
  draft: ShotEditDraft,
  spec: SceneSpec,
): { patch: { narrationText?: string; spec?: unknown } | null; error: string | null } {
  if (!HEX.test(draft.background)) {
    return { patch: null, error: "背景色须为 #rrggbb 六位十六进制" };
  }
  const durationMs = Math.round(draft.durationSeconds * 1000);
  if (!Number.isFinite(durationMs) || durationMs < 1 || durationMs > 600000) {
    return { patch: null, error: "时长须在 0.001s–600s 之间" };
  }
  let seed = spec.seed;
  let params = spec.params;
  if (spec.componentId === "text-animation") {
    if (draft.title.trim().length === 0) {
      return { patch: null, error: "文字动画标题不能为空" };
    }
    const prev = spec.params as TextParams;
    params = { ...prev, title: draft.title, ...(draft.subtitle ? { subtitle: draft.subtitle } : {}) };
  } else if (draft.templateAdvanced) {
    seed = spec.seed + 1;
    params = reseedSpecParams(spec, seed).params;
  }
  const nextSpec: SceneSpec = { ...spec, seed, background: draft.background, durationMs, params };
  return { patch: { narrationText: draft.narrationText, spec: nextSpec }, error: null };
}
```

`shot-editor-card.tsx` 组件（渲染 + 状态，逻辑全走 shot-edit.ts）：

```tsx
"use client";
import { useState } from "react";
import type { Shot } from "@acs/video-document";
import { buildRevisePatch, draftFromWorking, speechOverflowMs, type ShotEditDraft } from "./shot-edit.js";
import { LINE_TEMPLATE_LABELS, SHAPE_TEMPLATE_LABELS } from "./planner.js";
import { shotWorkingSpec } from "./shot-specs.js";

export type ShotEditorCardProps = {
  shot: Shot;
  index: number;
  frames: number;
  editable: boolean;
  onRevise: (patch: { narrationText?: string; spec?: unknown }) => void;
  onRedo: (directive: string) => void;
  onRollback: (versionId: string) => void;
  onToggleLock: (locked: boolean) => void;
  redoError: string | null;
};
```

主体：收起态 = 既有只读信息（order/锁定标记/描述/旁白/时长/帧数）+「编辑」按钮（`editable=false` 时不渲染编辑/重做区，仅只读信息 + 版本选择器）；展开态 = spec §4.3 全部控件：旁白 textarea、背景色 input、时长 input（秒 0.1 step）、text-animation 标题/副标题 input、非 text-animation 的「换一枚模板」按钮（点击把 `templateAdvanced` 置 true 并即时预览下一枚序号 `(seed+1) % 表长 + 1`）、溢出提示（`speechOverflowMs(draft) > 0` 时 `按语速需 X.Xs，超出当前 Y.Ys` +「按语速对齐」按钮改 durationSeconds 草稿）、「应用修订」（buildRevisePatch 有 error → 行内 `.shot-edit-error` 不回调；无 error → onRevise）、取消（重置草稿回初值）；重做区（指令 input + 「重做此镜头」按钮 → onRedo(directive)，redoError 展示）；版本 select（选项 `#i 描述截断`，working 高亮）+「回滚到此版本」；锁 checkbox。draft 用 `useState<ShotEditDraft>`，spec 变化时以 working/spec 重建（`key` 或 useEffect 保守重置——沿组件现状选最简）。

CSS 类名按 spec §4.3（`shot-edit-toggle` / `shot-narration-input` / `shot-bg-input` / `shot-duration-input` / `shot-title-input` / `shot-subtitle-input` / `shot-edit-error` / `shot-version-select` / `shot-lock-toggle` / `shot-redo-input` / `shot-redo-button` / `shot-apply` / `shot-cancel` / `shot-template-button` / `shot-overflow-note`），样式追加进 `video-studio.css` 沿既有风格。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @acs/web test -- shot-edit && pnpm --filter @acs/web run build`
Expected: 测试 PASS（新增 8 例）；构建零错（组件 TSX 编译过）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/app/video-studio/shot-edit.ts apps/web/src/app/video-studio/shot-edit.test.ts apps/web/src/app/video-studio/shot-editor-card.tsx apps/web/src/app/video-studio/video-studio.css
git commit -m "feat(video-studio): 镜头编辑纯逻辑 + ShotEditorCard——校验后回调、模板换枚、语速溢出提示"
```

---

### Task 4: page.tsx 接线（修订/重做/回滚/锁定进文档）

**Files:**
- Modify: `apps/web/src/app/video-studio/page.tsx`
- Test: `apps/web/src/app/video-studio/page.tsx`（不直接测页面；逻辑经纯函数与组件测试覆盖，本任务验证走 Step 3 的构建 + 既有套件 + e2e）

**Interfaces:**
- Consumes: `reviseWorkingVersion`（Task 1）、`ShotEditorCard` + `shot-edit.ts`（Task 3）、`planFromSentence` / `addCandidateVersion` / `rollbackWorkingVersion` / `setLocked`（既有）。
- Produces: 完整可用的分镜编辑器 UI。

- [ ] **Step 1: 接线实现**

page.tsx 内（`editor-shots` section）：

1. `shot-list` 的只读 `<li>` 换成 `<ShotEditorCard>`：`editable={shotSpecs[index] !== null}`、`frames={pieceTimeline!.shots[index]!.frames}`、四个回调见下。
2. `onRevise`：`try { const next = reviseWorkingVersion(document, shot.shotId, patch, crypto.randomUUID()); setEditor({ ...editor, document: next, message: \`镜头 ${index+1} 已修订（版本 …${patch.spec ? "画面" : "旁白"}）\` }); } catch (e) { setEditor({ ...editor, message: e instanceof Error ? e.message : "修订失败" }); }`。
3. `onRedo`：`const plan = planFromSentence(directive); if (!plan.ok) { setRedoErrors(...plan.reason + 指引) } else { 构造 ContentVersion：versionId=crypto.randomUUID()、createdAt=now、durationMs=plan.spec.durationMs、description=\`${label}动画（重做）：${plan.title}\`、narrationText=当前 working 的 narrationText 原样继承、sceneSource={type:"spec",spec:plan.spec}、provenance={engineId:"planner-rules",engineVersion:"1",parentVersionId:当前 working.versionId}；try addCandidateVersion catch ShotLockedError → redoError「镜头已锁定，先解锁再重做」 }`。redoError 状态：`useState<Record<string, string|null>>`（按 shotId）。
4. `onRollback`：`rollbackWorkingVersion(document, shotId, versionId)` → setEditor + message「已回滚镜头 N」。
5. `onToggleLock`：`setLocked(document, shotId, locked)` → setEditor。
6. 重做成功后清该 shotId 的 redoError。

- [ ] **Step 2: 构建与既有套件**

Run: `pnpm --filter @acs/web run build && pnpm --filter @acs/web test`
Expected: 构建零错；全部测试绿（含 Task 1–3）。

- [ ] **Step 3: 手动冒烟（dev server 已在 :3210/:3211 跑）**

浏览器代理不便交互验证的项留给 e2e（Task 5）；此处只验证页面可加载无编译错：`curl -s http://127.0.0.1:3210/video-studio | head`（或 fetch status 200）。
Expected: 200。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/app/video-studio/page.tsx
git commit -m "feat(video-studio): 分镜编辑器接线——镜头卡修订/重做/回滚/锁定进追加式文档"
```

---

### Task 5: e2e + 渲染冒烟 + 证据与 QA 登记

**Files:**
- Create: `scripts/video/e2e-shot-editor.mjs`
- Create: `artifacts/video-studio-shot-editor/E2E_SHOT_EDITOR.md`
- Modify: `qa/registry.json`（VID-014）
- Modify: `AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md`

**Interfaces:**
- Consumes: e2e-multishot.mjs 的浏览器/选择器模式、`node scripts/dev/proxy-3211.mjs` 代理、render-scene CLI。
- Produces: 验收证据（A1–A6）。

- [ ] **Step 1: 写 e2e 脚本**

沿 e2e-multishot 结构（launch → BASE_URL → 新建 → 填分镜句「做一个8秒的STEM解说视频，主题是水循环，分4个镜头」→ 规划 → 确认应用 → 保存 → 逐项操作 + 断言）。断言清单：

1. 初始：4 镜头卡可见，镜头 2 旁白「水循环，要点 1。」。
2. 修订旁白：展开镜头 2 编辑 → 旁白 textarea 改「水循环，三个要点。」→ 应用 → message 含「已修订」；**预览字幕随改**（整片预览到镜头 2 相位时字幕药丸文本含「三个要点」——A4 单一事实源断言）；导出 JSON 断言 `contentVersions.length === 2`、events 末条 `submitted/human`、历史 v1 字节不变（narrationText 仍「水循环，要点 1。」）。
3. 修订画面：镜头 1 背景改 `#102030`、时长改 3.5s → 应用 → 导出 JSON 断言 `spec.background === "#102030"`、`durationMs === 3500` 且版本 `durationMs === 3500`；**时间线重量化**（镜头 1 span 2000→3500ms，帧数 48→84，总帧数相应增加）。
4. 换模板：镜头 2（text-animation 则跳过换枚断言，改选一个 line-drawing/basic-shapes 镜头——分镜 4 镜头里要点镜头是 text-animation？实际组件由规划决定，脚本选第一个非 text-animation 镜头，若无则对 text-animation 断言标题编辑）→「换一枚模板」→ 应用 → `spec.seed === 原+1`。
5. 锁定 + 重做被拒：锁镜头 1 → 重做指令「做一个10秒的图形动画，标题是循环」→ redoError 含「解锁」；解锁后重做成功 → 该镜头版本 +1、events 末条 `submitted/ai`、narrationText 继承。
6. 锁定下人工修订：再锁镜头 1 → 旁白改「锁定下的人工修订。」→ 应用成功 → events 含 `audit`（note 人工修订）。
7. 回滚：镜头 2 版本 select 选 v1 → 回滚 → workingVersionId === v1 的 versionId。
8. 保存（savedVersion 递增）→ 导出 JSON 落 `artifacts/video-studio-shot-editor/e2e.video-project.json`。
9. 渲染冒烟：`node scripts/video/render-scene.mjs --project <导出件> --out artifacts/video-studio-shot-editor/e2e-render`（无 --narration，零计费）→ 退出码 0、RenderRecord 回写、双画幅出片。
10. 截图编辑器展开态 `shot-editor-card.png`；控制台零 error 门禁；全程 console error 收集器沿既有模式。
11. 计费断言：`artifacts/tts-usage.jsonl` 行数不变。

- [ ] **Step 2: 跑 e2e（dev server :3210 + 代理 :3211 已运行）**

Run: `node scripts/video/e2e-shot-editor.mjs`（环境 `BASE_URL=http://127.0.0.1:3211`）
Expected: 退出码 0，全部断言过。

- [ ] **Step 3: 证据落档**

`E2E_SHOT_EDITOR.md`：链路、结果、计费零新增声明、入库/不入库产物 SHA-256 表（沿 E2E_MULTISHOT 格式）、复跑方式。`qa/registry.json` 加 VID-014（分镜编辑器：旁白/画面修订、单镜头重做、锁定语义、回滚；fixture 列 buildRevisePatch/reviseWorkingVersion/reseedSpecParams/e2e）。CURRENT_STATE.md 顶部加本刀小节。

- [ ] **Step 4: 全量回归**

Run: `pnpm --filter @acs/video-document run build && node --test "packages/video-document/dist/**/*.test.js" && pnpm --filter @acs/video-scene run build && node --test "packages/video-scene/dist/**/*.test.js" && pnpm --filter @acs/web test && node --test "scripts/video/*.test.mjs" && pnpm lint`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add scripts/video/e2e-shot-editor.mjs artifacts/video-studio-shot-editor qa/registry.json AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md
git commit -m "feat(video-studio): 分镜编辑器 e2e 收口——修订/重做/锁定/回滚全链路证据与 VID-014"
```
