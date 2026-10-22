# 关键镜头双候选（B）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让分镜镜头卡能把一个镜头的两个既有内容版本并排比较（说明、时长、整片帧数影响），并把选用落到既有工作版本指针上，零 schema。

**Architecture:** 新增一个纯函数模块 `candidate-compare.ts` 从 `shot.contentVersions` + `deriveStatus` 生成候选摘要与默认对比对；镜头卡新增一个两列对比面板，选用时复用 `describeDurationImpact` / `durationApplyError` 做零帧闸门，再调用既有 `rollbackWorkingVersion`。不新增文档字段、事件类型或渲染路径。

**Tech Stack:** TypeScript / React 19 / Next.js App Router / node:test / Biome / Playwright（playwright-core，headless Chromium）

**Spec:** `docs/superpowers/specs/2026-10-22-video-studio-dual-candidate-design.md`

## Global Constraints

- 零 schema 变更：不改 `VideoProject` / `Shot` / `ContentVersion` / `ShotEvent` 任何字段，不新增事件类型。
- 候选 = `shot.contentVersions`；选择 = `workingVersionId`；留痕 = `shot.events`（沿用 rollback 的 `audit` 事件，不改文案）。
- 帧数口径只走 `describeDurationImpact` / `durationApplyError`（`apps/web/src/app/video-studio/duration-impact.ts`），不另写帧数学；默认 fps 24。
- 零帧拦截文案前缀固定 `无法应用：`（与 C 一致）。
- 用户可见文案全部中文；新增样式类固定为 `.shot-compare-toggle`、`.shot-compare-panel`、`.shot-compare-column`、`.shot-compare-select`、`.shot-compare-choose`。
- **零 TTS 计费**：不运行任何 TTS 命令，不传 `--narration`。
- 只在隔离工作树内改动，不碰主检出；不 `git push`，不合并。
- 每个 commit 末尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 不暂存 `artifacts/`、`.superpowers/`、`qa/reports/`。
- 改完每个任务后跑：`pnpm --filter @acs/web test`、`pnpm --filter @acs/web typecheck`、`pnpm exec biome check .`。

## Review Focus

- **镜头只有一版 / 版本 id 悬空**：卡片必须照常可用，不渲染对比入口、不抛错。
- **右列切到与左列同一版本**：两侧下拉必须互相排除，不能出现「自己比自己」还点选用。
- **选用的候选会让整片新造零帧**：必须拦下（`无法应用：`），文档与工作版本不变。
- **工作版本被重做/修订/回滚改变**：对比面板必须重置为默认对，不能继续显示陈旧的两列。
- **锁定镜头**：选用仍允许（ADR 0003 人工路径）且留 `audit`；审批状态不被改写。

---

### Task 1: 候选摘要与默认对比对（纯函数）

**Files:**
- Create: `apps/web/src/app/video-studio/candidate-compare.ts`
- Test: `apps/web/src/app/video-studio/candidate-compare.test.ts`

**Interfaces:**
- Consumes: `deriveStatus(events, versionId)`、类型 `ContentVersion`、`Shot`、`ShotStatus`、`VideoProject`（均来自 `@acs/video-document`）；测试夹具可参照 `duration-impact.test.ts` 顶部的 `shotWith` / `projectWith`。
- Produces:
  - `export type CandidateSummary = { versionId: string; index: number; status: ShotStatus; description: string; durationMs: number; isWorking: boolean }`（`index` 1 起，与版本下拉一致）
  - `export function candidateSummaries(shot: Shot): CandidateSummary[]`
  - `export function defaultCandidatePair(shot: Shot): { leftId: string; rightId: string } | null`（少于 2 个版本返回 `null`；左 = 工作版本，右 = `contentVersions` 中最后一个非工作版本）
  - `export function candidateChoices(summaries: CandidateSummary[], excludedId: string | null): CandidateSummary[]`（排除另一列当前版本；`excludedId` 为 `null` 返回全部）
  - `export function statusLabel(status: ShotStatus): string`（`draft` → `草稿`，`candidate` → `候选`，`approved` → `已批准`）

- [ ] **Step 1: 写失败测试**

```ts
// candidate-compare.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import type { Shot, VideoProject } from "@acs/video-document";
import {
  candidateChoices,
  candidateSummaries,
  defaultCandidatePair,
  statusLabel,
} from "./candidate-compare.js";
import { describeDurationImpact, durationApplyError } from "./duration-impact.js";

// 夹具：一个镜头 + 若干内容版本；events 按版本依次 submitted。
function shotWithVersions(durations: number[]): Shot { /* 按 duration-impact.test.ts 的 shotWith 扩展 */ }

test("摘要：序号 1 起、状态由事件推导、工作版本标 isWorking", () => {
  const shot = shotWithVersions([2000, 6000]);
  const summaries = candidateSummaries(shot);
  assert.deepEqual(
    summaries.map((s) => [s.index, s.status, s.isWorking, s.durationMs]),
    [
      [1, "candidate", false, 2000],
      [2, "candidate", true, 6000],
    ],
  );
});

test("默认对：左=工作版本，右=最后一个非工作版本", () => {
  const shot = shotWithVersions([2000, 6000, 4000]);
  const pair = defaultCandidatePair(shot); // working = #3
  assert.equal(pair?.leftId, shot.contentVersions[2]!.versionId);
  assert.equal(pair?.rightId, shot.contentVersions[1]!.versionId);
});

test("默认对：只有一个版本返回 null", () => {
  assert.equal(defaultCandidatePair(shotWithVersions([2000])), null);
});

test("可选项排除另一列当前版本", () => {
  const summaries = candidateSummaries(shotWithVersions([2000, 6000, 4000]));
  const right = summaries[1]!;
  const choices = candidateChoices(summaries, right.versionId);
  assert.deepEqual(
    choices.map((s) => s.versionId),
    [summaries[0]!.versionId, summaries[2]!.versionId],
  );
  assert.equal(candidateChoices(summaries, null).length, 3);
});

test("状态文案", () => {
  assert.equal(statusLabel("draft"), "草稿");
  assert.equal(statusLabel("candidate"), "候选");
  assert.equal(statusLabel("approved"), "已批准");
});

test("与 C 闸门组合：选用的候选新造零帧时被拦", () => {
  // 两镜头 [1000, 40]；把镜头 1 换成 1ms 候选 → 整片第 1 镜零帧。
  const project: VideoProject = /* 两镜头夹具，参照 duration-impact.test.ts */;
  const impact = describeDurationImpact(project, 0, 1);
  assert.match(durationApplyError(impact) ?? "", /^无法应用：/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @acs/web exec node --import tsx --test src/app/video-studio/candidate-compare.test.ts`
Expected: FAIL，`Cannot find module './candidate-compare.js'` 或导出不存在。

- [ ] **Step 3: 实现 `candidate-compare.ts`**

实现要点（签名见 Interfaces）：`candidateSummaries` 用 `contentVersions.map((v, i) => ...)` 与 `deriveStatus(shot.events, v.versionId)`；`isWorking` 比较 `shot.workingVersionId`；`defaultCandidatePair` 取工作版本与 `[...contentVersions].reverse().find(v => v.versionId !== workingVersionId)`，任一缺失返回 `null`；`candidateChoices` 用 `excludedId === null ? summaries : summaries.filter(...)`；`statusLabel` 三值映射。文件头写一段注释说明「候选即既有内容版本，本模块不碰文档」。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @acs/web exec node --import tsx --test src/app/video-studio/candidate-compare.test.ts`
Expected: PASS（6 个用例）。

- [ ] **Step 5: 跑全量 web 测试与类型检查**

Run: `pnpm --filter @acs/web test`；`pnpm --filter @acs/web typecheck`
Expected: 全部 PASS，typecheck exit 0。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/app/video-studio/candidate-compare.ts apps/web/src/app/video-studio/candidate-compare.test.ts
git commit -m "feat(video-studio): 候选摘要与默认对比对纯函数"
```

---

### Task 2: 浏览器回归脚本（先红）

**Files:**
- Create: `scripts/video/e2e-candidate-compare.mjs`
- Modify: `qa/registry.json`（新增 `VID-027`，`tier: "integration"`、`cwd: "."`、`argv: ["node", "scripts/video/e2e-candidate-compare.mjs"]`、`requiresPorts: []`）

**Interfaces:**
- Consumes: 工作台的既有选择器约定——`html[data-studio-ready]`、`.project-import`（隐藏 `input[type=file]`）、`.shot-redo-input`、`.shot-redo-button`、`.shot-version-select`、`.shot-rollback`；导出按钮与项目列表的既有类名从 `e2e-zero-frame-repair.mjs` 复制用法。
- Produces: 可复跑脚本，exit 0 表示整条链路成立；产物写入未跟踪目录 `artifacts/video-studio-candidate-compare/`。

- [ ] **Step 1: 写脚本**

场景（单条主线，夹具 2 镜头 × 2000ms，`text-animation` spec，`submitted(human)` 事件，参照 `e2e-zero-frame-repair.mjs` 的 `makeShot` / `makeProject` / 导入辅助）：

1. 导入项目，等 `html[data-studio-ready]`，记录 TTS 台账行数（运行前后必须相等）。
2. 镜头 1 展开编辑 → 在 `.shot-redo-input` 输入 `做一个6秒的图形动画，标题是候选对比` → 点 `.shot-redo-button`；断言版本下拉出现 2 个选项且工作在 `#2`。
3. 点 `.shot-compare-toggle` → `.shot-compare-panel` 可见；断言两列都渲染、左列含 `当前`、右列帧数文本匹配 `/\d+ → \d+ 帧/`；两列说明文本不相同。
4. 锁定镜头 1（`.shot-lock-toggle`），断言卡片摘要出现 `· 锁定`；再选用右列（原拍法 #1）：点该列的 `.shot-compare-choose`；断言页面消息含 `已回滚到所选版本`，版本下拉的 `（工作）` 回到 `#1`，锁定仍为开（ADR 0003 人工路径允许）。
5. 保存（既有保存按钮），刷新页面，从项目列表重开该项目；断言镜头 1 的 `（工作）` 仍是 `#1`，版本下拉仍有 2 个选项，仍为锁定。
6. 导出 JSON 写入 `artifacts/video-studio-candidate-compare/export.json`，用 `validateVideoProject` 校验并断言镜头 1 `workingVersionId === contentVersions[0].versionId`、`contentVersions.length === 2`、事件含 `lock-changed` 与 `audit`（note 为 `回滚工作版本`）且没有新增 `approved`。
7. 断言两列下拉选项互斥（右列 option 集合不含左列当前值）。

- [ ] **Step 2: 跑脚本确认失败**

前置：`pnpm --filter @acs/web exec next dev --hostname 127.0.0.1 --port 3210` 已启动（或经 `scripts/dev/proxy-3211.mjs` 设 `BASE_URL`）；`packages/{video-document,video-scene}` 已 build。
Run: `node scripts/video/e2e-candidate-compare.mjs`
Expected: FAIL，第一个缺的是 `.shot-compare-toggle` 不可见。

- [ ] **Step 3: 注册 QA 用例并验证注册表**

在 `qa/registry.json` 增加 `VID-027`（标题：关键镜头双候选对比与选用；`passCriteria` 覆盖步骤 2–5 的断言）。
Run: `node scripts/qa/run-regression.mjs validate`
Expected: PASS，automated 86 / manual 52（当前 85/52）。

- [ ] **Step 4: 提交**

```bash
git add scripts/video/e2e-candidate-compare.mjs qa/registry.json
git commit -m "test(video-studio): 候选对比选用浏览器回归 VID-027"
```

---

### Task 3: 镜头卡对比面板（让回归变绿）

**Files:**
- Modify: `apps/web/src/app/video-studio/shot-editor-card.tsx`（版本行约 437–460 行；本地状态约 240–313 行）
- Modify: `apps/web/src/app/video-studio/video-studio.css`（`.shot-rollback` / `.shot-version-select` 附近）

**Interfaces:**
- Consumes: Task 1 的 `candidateSummaries`、`defaultCandidatePair`、`candidateChoices`、`statusLabel`、类型 `CandidateSummary`；`describeDurationImpact`、`durationApplyError`（`./duration-impact`）；props 中已有 `shot`、`index`、`project`、`onRollback`。
- Produces: 新 UI 选择器 `.shot-compare-toggle`、`.shot-compare-panel`、`.shot-compare-column`、`.shot-compare-select`、`.shot-compare-choose`。

- [ ] **Step 1: 加状态与重置**

```tsx
const pair = defaultCandidatePair(shot);
const summaries = candidateSummaries(shot);
const [compareOpen, setCompareOpen] = useState(false);
const [compareError, setCompareError] = useState<string | null>(null);
const [leftId, setLeftId] = useState(pair?.leftId ?? "");
const [rightId, setRightId] = useState(pair?.rightId ?? "");
// 工作版本变化（应用修订/重做/回滚）→ 对比面板回到默认对。
useEffect(() => {
  const next = defaultCandidatePair(shot);
  setLeftId(next?.leftId ?? "");
  setRightId(next?.rightId ?? "");
}, [shot.workingVersionId]);
```

- [ ] **Step 2: 渲染开关与两列面板**

版本行 `<select className="shot-version-select">` 之后加：

```tsx
{shot.contentVersions.length >= 2 ? (
  <button type="button" className="shot-compare-toggle"
    onClick={() => setCompareOpen(!compareOpen)}>
    {compareOpen ? "收起对比" : "对比候选"}
  </button>
) : null}
```

`compareOpen` 时在版本行下方渲染 `shot-compare-panel`：对 `[{ label: "候选 A", value: leftId, set: setLeftId, exclude: rightId }, { label: "候选 B", value: rightId, set: setRightId, exclude: leftId }]` 各渲染一列（`shot-compare-column`）：标题（`{label} #{index} {statusLabel(status)}`）、`shot-compare-select`（options 来自 `candidateChoices(summaries, exclude)`）、说明 `<p>`（`description`，`maxLength` 不截断）、时长（`${durationMs / 1000}s`）、帧数文本：

```tsx
const impact = describeDurationImpact(project, index, summary.durationMs);
const framesText = summary.isWorking
  ? `当前 ${impact.beforeFrames ?? "不可量化"} 帧`
  : `${impact.beforeFrames ?? "不可量化"} → ${impact.afterFrames ?? "不可量化"} 帧`;
```

选择处理：

```tsx
const choose = (summary: CandidateSummary) => {
  const impact = describeDurationImpact(project, index, summary.durationMs);
  const blocked = durationApplyError(impact);
  if (blocked) { setCompareError(blocked); return; }
  setCompareError(null);
  onRollback(summary.versionId);
};
```

按钮：`<button type="button" className="shot-compare-choose" disabled={summary.isWorking} onClick={() => choose(summary)}>选用此候选</button>`；`compareError` 用 `<p className="shot-edit-error">{compareError}</p>` 展示（复用既有类）。面板底部固定说明：「说明来自版本记录，不代表画面质量；选用只切换工作版本，不改变审批状态。」

- [ ] **Step 3: 加样式**

在 `video-studio.css` 的 `.shot-version-select` 附近新增五个类：面板 `display: grid; grid-template-columns: 1fr 1fr; gap: 12px`，窄屏 `grid-template-columns: 1fr`；列内边框与内边距沿用既有卡片的灰阶；按钮复用 `.shot-rollback` 的字号与圆角。

- [ ] **Step 4: 验证**

Run: `pnpm --filter @acs/web typecheck`；`pnpm --filter @acs/web test`；`pnpm exec biome check .`
Expected: typecheck exit 0，测试全绿，biome clean。

- [ ] **Step 5: 跑浏览器回归（由红转绿）**

Run: `node scripts/video/e2e-candidate-compare.mjs`
Expected: PASS，exit 0；TTS 台账行数前后一致。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/app/video-studio/shot-editor-card.tsx apps/web/src/app/video-studio/video-studio.css
git commit -m "feat(video-studio): 镜头卡候选对比面板与选用闸门"
```

---

### Task 4: 文档收口

**Files:**
- Modify: `docs/superpowers/specs/2026-10-22-video-studio-dual-candidate-design.md`（状态：设计已定 → 已实现并附证据）
- Modify: `AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md`（新增 B 条目）
- Modify: `docs/VIDEO_STUDIO_STORYBOARD_REVIEW_LOOP_2026-10-21.md`（§2 第 1 条 B 标记完成）

- [ ] **Step 1: 更新三份文档**

按要求写：B 落地范围（候选对比面板、选用闸门）、零 schema、证据（单测数、e2e `VID-027`、typecheck/biome/qa validate 数字）、明确不做（不出图、不调模型、不新增关键镜字段）。

- [ ] **Step 2: 跑 QA 注册表校验与全量测试**

Run: `node scripts/qa/run-regression.mjs validate`；`pnpm --filter @acs/web test`
Expected: validate 零错误；测试全绿。

- [ ] **Step 3: 提交**

```bash
git add docs/superpowers/specs/2026-10-22-video-studio-dual-candidate-design.md AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md docs/VIDEO_STUDIO_STORYBOARD_REVIEW_LOOP_2026-10-21.md
git commit -m "docs(video-studio): B 双候选落地收口"
```
