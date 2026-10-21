# Video Studio 分镜审阅环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让分镜「看得懂、改得动、改之前算得清」：确认卡逐镜头说清旁白，镜头说明（意图）随版本落库并可人工修订，改时长时当场算出整片帧数与相邻转场借帧是否失效。

**Architecture:** 三个纯逻辑单元先行（确认卡行模型、镜头说明归一化、时长影响计算），React 卡片只做渲染与接线。镜头说明复用 `ContentVersion.description`，不新增 schema 字段；时长影响用既有 `quantizeTimeline` / `resolveTransitionWindows` 计算，不另立帧数学。

**Tech Stack:** TypeScript ESM、Node 22 `node:test`、React 19 / Next 16 App Router、`@acs/video-document` 纯函数。

**Spec:** `docs/VIDEO_STUDIO_LAPER_STORY2BOARD_DESIGN_INPUT_2026-10-21.md` §3 验收点 2/3/4 + 2026-10-21 差距复核结论（A1 → C → A2 先行；B/E0/D/PDF/F 不在本计划内）。

## Global Constraints

- 只在 worktree 分支 `worktree-video-studio-p4-storyboard` 工作；主检出 `D:\codex\animate` 一个字都不许动。
- 不 push、不 merge：集成由用户执行。
- 绝不 stage `artifacts/`、`.superpowers/`、`qa/reports/`。
- 提交信息末尾固定 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 零 TTS 计费：`artifacts/tts-usage.jsonl` 必须保持 34 行。
- 所有用户可见字符串中文；不新增英文 UI 文案。
- TDD：先看测试红，再写实现；没有失败测试就不写生产代码。
- 不改 `@acs/video-document` 的 schema 版本；不新增 ADR。

## Review Focus

- 镜头说明清空后点应用：应显式报「镜头说明不能为空」并保持文档不动，而不是落一个空 description 让底层校验兜底。
- 镜头说明 200 字整：应逐字保存；201 字应被拒（`maxLength` 之外的粘贴路径也要拦住）。
- 应用分镜前确认卡显示的旁白，必须与确认后落入镜头的 `narrationText` 完全一致（同一规划快照）。
- 把带转场的相邻镜头改到极短：应在编辑时就提示借帧失效，而不是等到渲染期才抛错。
- 媒体 / 3D 臂改说明：说明必须随该版本落库，不因编辑臂不同而丢失或回退成「（人工修订）」后缀。

---

### Task 1: 确认卡逐镜头显示旁白

**Files:**
- Modify: `apps/web/src/app/video-studio/apply-plan.ts`（文件末尾追加）
- Modify: `apps/web/src/app/video-studio/page.tsx:461-473`
- Test: `apps/web/src/app/video-studio/apply-plan.test.ts`

**Interfaces:**
- Consumes: `StoryboardResult` / `StoryboardShot`（`planner.ts`，已存在）。
- Produces: `storyboardConfirmLines(storyboard): StoryboardConfirmLine[]`，供确认卡渲染。

- [ ] **Step 1: 写失败测试**

在 `apply-plan.test.ts` 追加（`planStoryboard` 从 `./planner.js` 导入）：

```ts
test("分镜确认卡逐镜头带出旁白与时长", () => {
  const storyboard = planStoryboard(
    "做一个30秒的STEM解说视频，主题是勾股定理，分4个镜头",
  );
  assert.ok(storyboard.ok);
  const lines = storyboardConfirmLines(storyboard);
  assert.equal(lines.length, 4);
  assert.equal(lines[0]!.index, 1);
  assert.equal(lines[0]!.label, "开场");
  assert.equal(lines[0]!.narrationText, "勾股定理。");
  assert.equal(lines[1]!.narrationText, "勾股定理，要点 1。");
  assert.equal(lines[3]!.narrationText, "谢谢观看。");
  assert.equal(lines[1]!.durationSeconds, storyboard.shots[1]!.plan.spec.durationMs / 1000);
  assert.equal(lines[1]!.renderHint, storyboard.shots[1]!.plan.renderHint);
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `cd apps/web && node --import tsx --test --test-name-pattern="分镜确认卡逐镜头带出旁白" src/app/video-studio/apply-plan.test.ts`
Expected: FAIL（`storyboardConfirmLines` 未定义 / 编译错误）。

- [ ] **Step 3: 实现行模型**

在 `apply-plan.ts` 末尾：

```ts
export type StoryboardConfirmLine = {
  index: number; // 1-based，渲染用
  label: string;
  durationSeconds: number;
  renderHint: string;
  narrationText: string;
};

// 确认卡与「确认后落库」共用同一规划快照：旁白就在 storyboard.shots 里，
// 不在 UI 层另拼一份——两处各拼一次就是漂移的入口。
export function storyboardConfirmLines(
  storyboard: StoryboardResult & { ok: true },
): StoryboardConfirmLine[] {
  return storyboard.shots.map((shot, index) => ({
    index: index + 1,
    label: shot.label,
    durationSeconds: shot.plan.spec.durationMs / 1000,
    renderHint: shot.plan.renderHint,
    narrationText: shot.narrationText,
  }));
}
```

- [ ] **Step 4: 跑测试确认绿**

Run: `pnpm --filter @acs/web test`
Expected: 全绿。

- [ ] **Step 5: 接进确认卡**

`page.tsx` 的分镜列表改为遍历 `storyboardConfirmLines(storyboard)`，标签沿用 `line.index` / `line.durationSeconds`，`line.renderHint` 保留原 `plan-shot-hint` 渲染，并在其后新增：

```tsx
<span className="plan-shot-narration">旁白：{line.narrationText}</span>
```

`video-studio.css` 在 `.plan-shot-hint` 附近加 `.plan-shot-narration { display: block; color: #5d7469; font-size: 0.85em; }`（与既有视觉一致，不引入新配色体系）。

- [ ] **Step 6: 全量校验并提交**

Run: `pnpm --filter @acs/web typecheck && pnpm --filter @acs/web test && pnpm exec biome check apps/web/src/app/video-studio`
Expected: 全部 exit 0。

```bash
git add apps/web/src/app/video-studio/apply-plan.ts apps/web/src/app/video-studio/apply-plan.test.ts apps/web/src/app/video-studio/page.tsx apps/web/src/app/video-studio/video-studio.css
git commit -m "feat(video-studio): 分镜确认卡逐镜头显示旁白" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: 镜头说明随内容版本落库并可人工修订

**Files:**
- Create: `apps/web/src/app/video-studio/component-labels.ts`
- Modify: `apps/web/src/app/video-studio/planner.ts`（`StoryboardShot` 与 `planStoryboard`）
- Modify: `apps/web/src/app/video-studio/apply-plan.ts`（改用共享标签、`applyStoryboard` 原样写 `shot.description`）
- Modify: `packages/video-document/src/operations.ts`（`reviseWorkingVersion` 接受 `description`）
- Modify: `apps/web/src/app/video-studio/shot-edit.ts`（草稿带 `description`、`attachDescription`）
- Modify: `apps/web/src/app/video-studio/shot-editor-card.tsx`（说明输入框 + 三个应用臂都带上说明）
- Test: `apps/web/src/app/video-studio/planner.test.ts`、`apps/web/src/app/video-studio/apply-plan.test.ts`、`apps/web/src/app/video-studio/shot-edit.test.ts`、`packages/video-document/src/operations.test.ts`

**Interfaces:**
- Produces:
  - `componentLabel(componentId: string): string`（`component-labels.ts`）
  - `StoryboardShot.description: string`
  - `reviseWorkingVersion(p, shotId, patch & { description?: string }, newVersionId, at?)`
  - `attachDescription<T extends object>(patch: T, raw: string): { patch: T & { description: string } } | { error: string }`

**镜头说明格式（逐字固定，测试按此断言）**，`title` 为规划标题：
- 开场 → `开场（文字动画）：标题「<title>」进入画面`
- 要点 N → `要点 N（文字动画）：标题「<title>」与副标题「要点 N」进入画面`
- 示意 N → `示意 N（图形动画）：模板图形依次入场，不含讲解文字`
- 结语 → `结语（文字动画）：标题「<title>」与副标题「谢谢观看」进入画面`

- [ ] **Step 1: 写失败测试（四组）**

`planner.test.ts`：

```ts
test("分镜每镜头产出可读说明（意图，而非组件名）", () => {
  const storyboard = planStoryboard(
    "做一个30秒的STEM解说视频，主题是勾股定理，分4个镜头",
  );
  assert.ok(storyboard.ok);
  assert.equal(storyboard.shots[0]!.description, "开场（文字动画）：标题「勾股定理」进入画面");
  assert.equal(storyboard.shots[1]!.description, "要点 1（文字动画）：标题「勾股定理」与副标题「要点 1」进入画面");
  assert.equal(storyboard.shots[2]!.description, "示意 1（图形动画）：模板图形依次入场，不含讲解文字");
  assert.equal(storyboard.shots[3]!.description, "结语（文字动画）：标题「勾股定理」与副标题「谢谢观看」进入画面");
  for (const shot of storyboard.shots) assert.ok(shot.description.length <= 200);
});
```

`apply-plan.test.ts`：应用分镜后，每个镜头工作版本的 `description` 与 `storyboard.shots[i].description` 逐字相等（不再由 apply 层重新拼）；既有断言旧格式的用例按新格式更新，**只改格式相关断言**。

`shot-edit.test.ts`：

```ts
test("镜头说明：草稿带出、附着时去空白、空与超长被拒", () => {
  const draft = draftFromWorking(
    { narrationText: "旁白", durationMs: 8000, description: "开场说明" },
    spec,
  );
  assert.equal(draft.description, "开场说明");
  assert.deepEqual(attachDescription({ narrationText: "旁白" }, "  开场说明  "), {
    patch: { narrationText: "旁白", description: "开场说明" },
  });
  const empty = attachDescription({}, "   ");
  assert.ok("error" in empty);
  assert.equal(empty.error, "镜头说明不能为空");
  const tooLong = attachDescription({}, "字".repeat(201));
  assert.ok("error" in tooLong);
  assert.equal(tooLong.error, "镜头说明不能超过 200 字符");
});
```

`packages/video-document/src/operations.test.ts`：

```ts
test("reviseWorkingVersion：显式说明逐字落库，空/超长拒绝", () => {
  // 基于已有 fixture 项目 p（工作版本 description 为既有值）；workingOf 为本地小助手：
  // 查 shot 的 workingVersionId 对应版本（`p.shots.find(...)` + `contentVersions.find(...)`）。
  const next = reviseWorkingVersion(p, "shot-1", { description: "新说明" }, "v-new");
  assert.equal(workingOf(next, "shot-1").description, "新说明");
  assert.throws(
    () => reviseWorkingVersion(p, "shot-1", { description: "  " }, "v-x"),
    /镜头说明须为 1\.\.200 字符/,
  );
  assert.throws(
    () => reviseWorkingVersion(p, "shot-1", { description: "字".repeat(201) }, "v-y"),
    /镜头说明须为 1\.\.200 字符/,
  );
  // 不传 description 时维持原「（人工修订）」后缀口径（既有测试已覆盖则不加）
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm --filter @acs/video-document build && pnpm --filter @acs/web test && pnpm --filter @acs/video-document test`
Expected: 上述测试失败（`description` 缺失 / `attachDescription` 未定义 / 未拒绝空说明）。
（`@acs/video-document` 的测试跑 `dist/**`，源码改动必须先 build。）

- [ ] **Step 3: 实现**

1. 新建 `component-labels.ts`，把 `apply-plan.ts` 里的 `COMPONENT_LABEL` 移入并导出 `componentLabel`（未知 id 原样返回）。`apply-plan.ts` 改用它，`firstShotDocument` 的说明保持 `「文字动画：<title>」` 旧格式（不在本计划改）。
2. `planner.ts`：`StoryboardShot` 增 `description: string`；在四个分支各定一个 `intent` 短句，分支外统一
   `const description = \`${label}（${componentLabel(componentId)}动画）：${intent}\`;`
   其中 `componentId = useShapes ? "basic-shapes" : "text-animation"` 上提到构造 spec 之前复用。
3. `apply-plan.ts`：`applyStoryboard` 的 `description: shot.description`，删掉该函数内的标签拼接。
4. `operations.ts`：patch 类型增 `description?: string`；进入构造前校验
   `if (patch.description !== undefined) { const d = patch.description.trim(); if (d.length === 0 || d.length > 200) throw new Error("镜头说明须为 1..200 字符"); }`；
   版本 `description: patch.description === undefined ? \`${base.description.slice(0, 160)}（人工修订）\` : patch.description.trim()`。
5. `shot-edit.ts`：`ShotEditDraft` 增 `description: string`；`WorkingLike` 增 `description: string`，`draftFromWorking` 带出（不 trim，保留用户原样）；导出 `attachDescription`（实现即上面测过的语义）。
6. `shot-editor-card.tsx`：
   - 两处 `draftFromWorking` 调用补 `description: working.description`；兜底草稿加 `description: ""`；
   - 展开表单在「旁白」标签前加：
     ```tsx
     <label className="shot-edit-field">
       镜头说明
       <input
         className="shot-description-input"
         maxLength={200}
         value={draft.description}
         onChange={(event) => setDraft({ ...draft, description: event.target.value })}
       />
     </label>
     ```
   - `onRevise` prop 的 patch 类型增 `description?: string`；
   - 三个调用点（媒体臂 `onRevise(built.patch)`、3D 臂内联对象、通用臂 `onRevise(patch)`）都改成先 `const attached = attachDescription(<patch>, draft.description);`，`"error" in attached` 时 `setEditError(attached.error)` 并 return，否则 `onRevise(attached.patch)`。
   - 卡片摘要既有的 `working.description` 显示不动（现在会显示新说明）。

- [ ] **Step 4: 跑测试确认绿**

Run: `pnpm --filter @acs/video-document build && pnpm --filter @acs/video-document test && pnpm --filter @acs/web test`
Expected: 全绿；既有 `（人工修订）` 后缀用例仍通过。

- [ ] **Step 5: 类型与格式**

Run: `pnpm --filter @acs/video-document build && pnpm --filter @acs/web typecheck && pnpm exec biome check apps/web/src/app/video-studio packages/video-document/src`
Expected: 全部 exit 0（必要时 `biome format --write` 后重跑）。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/app/video-studio/component-labels.ts apps/web/src/app/video-studio/planner.ts apps/web/src/app/video-studio/planner.test.ts apps/web/src/app/video-studio/apply-plan.ts apps/web/src/app/video-studio/apply-plan.test.ts apps/web/src/app/video-studio/shot-edit.ts apps/web/src/app/video-studio/shot-edit.test.ts apps/web/src/app/video-studio/shot-editor-card.tsx packages/video-document/src/operations.ts packages/video-document/src/operations.test.ts
git commit -m "feat(video-studio): 镜头说明随内容版本落库并可人工修订" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: 改时长时当场算清整片帧数与转场借帧

**Files:**
- Create: `apps/web/src/app/video-studio/duration-impact.ts`
- Test: `apps/web/src/app/video-studio/duration-impact.test.ts`
- Modify: `apps/web/src/app/video-studio/shot-editor-card.tsx`（新 prop `project`、影响提示）
- Modify: `apps/web/src/app/video-studio/page.tsx:582-591`（传 `project={document}`）
- Modify: `apps/web/src/app/video-studio/video-studio.css`

**Interfaces:**
- Consumes: `quantizeTimeline`、`resolveTransitionWindows`、`VideoProject`（均来自 `@acs/video-document`）。
- Produces:

```ts
export type DurationImpact = {
  changed: boolean;
  beforeFrames: number;
  afterFrames: number | null; // 无法量化（如零帧镜头）时 null，原因在 frameError
  frameError: string | null;
  transitionIssue: string | null;
};

export function describeDurationImpact(
  project: VideoProject,
  shotIndex: number,
  nextDurationMs: number,
  fps?: number, // 默认 24
): DurationImpact;
```

- [ ] **Step 1: 写失败测试**

`duration-impact.test.ts`（用字面量构造最小 `VideoProject`，每个镜头一个 working 版本；`transitions` 按需带）：

```ts
test("未改时长：changed=false 且前后帧数一致", () => {
  const project = projectWith([8000, 8000, 8000, 6000]);
  const impact = describeDurationImpact(project, 1, 8000);
  assert.equal(impact.changed, false);
  assert.equal(impact.beforeFrames, 720);
  assert.equal(impact.afterFrames, 720);
  assert.equal(impact.transitionIssue, null);
});

test("加长 1s：整片帧数按累计边界量化", () => {
  const impact = describeDurationImpact(projectWith([8000, 8000, 8000, 6000]), 0, 9000);
  assert.equal(impact.beforeFrames, 720);
  assert.equal(impact.afterFrames, 744); // 31s @24fps
});

test("缩到零帧：frameError 指名镜头，afterFrames 为 null", () => {
  const impact = describeDurationImpact(projectWith([8000, 8000, 8000, 6000]), 0, 1);
  assert.equal(impact.afterFrames, null);
  assert.match(impact.frameError ?? "", /第 1 个镜头.*为零帧/);
});

test("相邻转场借帧失效：给出可操作提示", () => {
  const project = projectWith([1000, 1000], [{ boundary: 0, durationMs: 1000 }]);
  const impact = describeDurationImpact(project, 0, 100);
  assert.match(impact.transitionIssue ?? "", /超出相邻 span/);
  assert.equal(impact.frameError, null);
});

test("无转场：不报转场问题", () => {
  const impact = describeDurationImpact(projectWith([1000, 1000]), 0, 100);
  assert.equal(impact.transitionIssue, null);
});

test("非相邻镜头变化：不误报远处转场", () => {
  const project = projectWith([1000, 1000, 1000], [{ boundary: 0, durationMs: 1000 }]);
  const impact = describeDurationImpact(project, 2, 100);
  assert.equal(impact.transitionIssue, null);
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `cd apps/web && node --import tsx --test --test-name-pattern="帧数|转场|零帧" src/app/video-studio/duration-impact.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `duration-impact.ts`**

- 当前时长取每个镜头 working 版本的 `durationMs`；`next` 只替换 `shotIndex`（`Math.round`）。
- `changed = next[shotIndex] !== current[shotIndex]`；`false` 时直接返回前后相同的量化结果，不碰转场。
- `beforeFrames = quantizeTimeline(current, fps).totalFrames`。
- `afterFrames`：`try` 量化 `next`；捕获错误时 `afterFrames = null`，`frameError = error.message`。
- 仅当 `afterFrames !== null`、`project.transitions?.length` 非零、且存在 `boundary === shotIndex - 1 || boundary === shotIndex` 的转场时，用 `next` 的 spans 调一次 `resolveTransitionWindows(project.transitions, spans, fps)`；`catch` 到错误则 `transitionIssue = error.message`，否则 `null`。错误来自全量转场，但只有相邻边界会因本次改动变化——注释写清这个前提。

- [ ] **Step 4: 跑测试确认绿**

Run: `pnpm --filter @acs/web test`
Expected: 全绿。

- [ ] **Step 5: 接进镜头卡**

- prop 增 `project: VideoProject`（`page.tsx` 传 `project={document}`）。
- 在既有 hooks 区加：
  ```ts
  const durationImpact = useMemo(() => {
    if (!canEdit) return null;
    const ms = Math.round(draft.durationSeconds * 1000);
    if (!Number.isFinite(ms) || ms < 1) return null;
    return describeDurationImpact(project, index, ms);
  }, [canEdit, project, index, draft.durationSeconds]);
  ```
- 在「时长（秒）」输入框之后（`!editingMedia && !editingThree` 块内）渲染：
  ```tsx
  {durationImpact?.changed ? (
    <p
      className={
        durationImpact.frameError || durationImpact.transitionIssue
          ? "shot-impact shot-impact-warn"
          : "shot-impact"
      }
    >
      整片帧数：{durationImpact.beforeFrames} →{" "}
      {durationImpact.afterFrames ?? "无法量化"} 帧 @24fps
      {durationImpact.frameError ? ` · ${durationImpact.frameError}` : ""}
      {durationImpact.transitionIssue ? ` · ${durationImpact.transitionIssue}` : ""}
    </p>
  ) : null}
  ```
- CSS：`.shot-impact { color: #5d7469; font-size: 0.85em; }`、`.shot-impact-warn { color: #a3423a; }`。

- [ ] **Step 6: 类型、格式、提交**

Run: `pnpm --filter @acs/web typecheck && pnpm exec biome check apps/web/src/app/video-studio`
Expected: exit 0。

```bash
git add apps/web/src/app/video-studio/duration-impact.ts apps/web/src/app/video-studio/duration-impact.test.ts apps/web/src/app/video-studio/shot-editor-card.tsx apps/web/src/app/video-studio/page.tsx apps/web/src/app/video-studio/video-studio.css
git commit -m "feat(video-studio): 改时长当场给出整片帧数与转场借帧影响" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: 状态文档与决策记录同步

**Files:**
- Modify: `AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md`
- Create: `docs/VIDEO_STUDIO_STORYBOARD_REVIEW_LOOP_2026-10-21.md`

- [ ] **Step 1: 重建决策记录**

写 `docs/VIDEO_STUDIO_STORYBOARD_REVIEW_LOOP_2026-10-21.md`（中文），内容：
- 本阶段落地：A1 确认卡旁白、A2 镜头说明（复用 `ContentVersion.description`，零 schema 变更）、C 时长影响（整片帧数 + 相邻转场借帧，实时）。
- 后续顺序与门禁（2026-10-21 复核结论，勿重开）：B（1–2 个关键镜头给两个候选版本，零 schema）→ E0（GIF/SVG DeliveryRecord 补 `outputRef`/`digest`）→ D（Style Bible，按 ADR 0003 独立版本化记录，须有真实样片证据才开工）→ PDF/大纲导出（按需）→ F（仅调研）。
- 明确不做的：第二个编辑器、确认卡只读之外的可编辑预告、启发式「内容适配」提示（只允许标注为不可靠的提示，不得当承诺）。
- 证据口径：帧数/借帧结论均来自 `quantizeTimeline` / `resolveTransitionWindows`，与渲染同源。

- [ ] **Step 2: 同步 CURRENT_STATE**

- 跑 `pnpm exec biome check .`，读输出里的「Checked N files」，把 `biome **378** 文件 clean` 更新为实际值。
- `scripts/video` 计数不变（152 = 145+7，本计划未增脚本）。
- 在「近期变更」区追加一段：本计划三任务的提交短 SHA、测试数量、`artifacts/tts-usage.jsonl` 仍 34 行。
- 不改与本次无关的历史段落。

- [ ] **Step 3: 全量验证并提交**

Run: `pnpm --filter @acs/video-document test && pnpm --filter @acs/web test && pnpm exec biome check . && wc -l artifacts/tts-usage.jsonl`
Expected: 测试全绿、biome clean、台账 34 行。

```bash
git add AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md docs/VIDEO_STUDIO_STORYBOARD_REVIEW_LOOP_2026-10-21.md
git commit -m "docs(video-studio): 记录分镜审阅环落地与后续顺序" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```
