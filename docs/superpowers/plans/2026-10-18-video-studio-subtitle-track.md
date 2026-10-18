# Video Studio 字幕轨 + 旁白溢出收口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 有声解说成片自带硬字幕（字级时间戳对齐、横竖双画幅、白底场景可读），旁白溢出不再默认静默截断（规划期语速预估 + 合成期时长对齐，截断改为 `--allow-truncate` 显式选择）。

**Architecture:** 字幕是 `narrationText` × words.json 字级时间戳的**派生投影**（R1：文档 schema 零新增）。纯函数 `buildSubtitleCues`/`activeSubtitleCue` 放 `@acs/video-document`，web 预览（均匀近似）与 CLI 导出（精确时间戳）共用；`@acs/remotion-engine` 只收 plain cue 数组做哑渲染，缺 `subtitles` props 时输出与现状逐字节一致。溢出收口双管：planner 按实测校准的语速常数（`400ms 起始 + 300ms/字`）取 `max(等分, 语音预估)`；tts-narration 合成后实测兜底——超出版本时长的镜头写「时长对齐」新 ContentVersion（只追加演进）并重键资产。

**Tech Stack:** TypeScript（video-document / remotion-engine / web）、Node CLI（scripts/video/*.mjs）、Remotion 渲染、DashScope CosyVoice（仅 e2e 计费复跑）。

**Spec:** `docs/superpowers/specs/2026-10-18-video-studio-subtitle-track-design.md`

## Global Constraints

- pnpm 11.19.0 经 fnm 的 Bash shell 可用；**PowerShell 直呼 pnpm 是 9.0.0 报 ERR_PNPM_BAD_PM_VERSION**——一律走 Bash 工具。
- web 侧 tsx 单测必须在 `apps/web` 目录跑：`pnpm test`；脚本侧在仓库根：`node --test "scripts/video/*.test.mjs"`；包侧 `pnpm --filter <pkg> build && pnpm --filter <pkg> test`。
- **单测零网络**；只有 Task 7 的 e2e 复跑走 DashScope（~¥0.0037，预算闸累计 ≤¥50，台账 `artifacts/tts-usage.jsonl`）。
- `DASHSCOPE_API_KEY` 只从环境读，绝不写盘/入产物/入日志。
- 每个 TDD 步骤先看 RED 再 GREEN；提交前 `pnpm format` + `pnpm lint` 过；commit 尾行 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 媒体证据不入库（gitignore 约定），SHA-256 锚定进 .md；Codex 同机复核。
- 渲染确定性纪律：无 `subtitles` props 的渲染输出必须与现状**逐字节一致**（帧确定性复跑验证）。

## Review Focus

1. **白底场景字幕不可见**——场景背景多为 `#ffffff`，白字+描边对比不足。样式定为半透明深色药丸底（`rgba(27,25,23,0.55)` 圆角衬白字，横竖画幅均易读）。钉在 Task 2 样式实现 + Task 7 e2e 底带暗像素断言。
2. **words.json 缺失/损坏**——合成历史项目可能无字级时间戳或 JSON 损坏。读取失败/为空/时间戳非法时**回退均匀分布**（告警不阻断），cue 时长超 span 时钳到 spanMs。钉在 Task 6 `readSubtitleCues` 测试（坏 JSON/空句/超尾钳制三个反例）。
3. **cue 越过镜头边界**——`--allow-truncate` 路径下音轨截断但 cue 时间戳仍到 2640ms。装配时 `endMs = min(endMs, spanMs)`。钉在 Task 6。
4. **时长膨胀失控**——用户要 8s、语音需要 9.1s 是正确的容纳；但确认卡必须如实预告实际总时长（现有 `describeStoryboardAppend` 读实际 totalMs，随 Task 3 自动成立）。钉在 Task 3 测试（totalMs = Σ speech-aware）。
5. **对齐产生的新 versionId 与资产重键脱节**——新版本若无对应 wav/words 资产则下次渲染「缺资产」。Task 5 重键与版本构造同批完成（rename 成功才写档），测试钉「对齐后每条新 versionId 都有资产映射」。 

---

### Task 1: `buildSubtitleCues` / `activeSubtitleCue` 纯函数（@acs/video-document）

**Files:**
- Create: `packages/video-document/src/subtitles.ts`
- Create: `packages/video-document/src/subtitles.test.ts`
- Modify: `packages/video-document/src/index.ts`（加一行导出）

**Interfaces:**
- Produces: `type SubtitleCue = { text: string; startMs: number; endMs: number }`；`type SubtitleWordTiming = { text: string; beginMs: number; endMs: number }`；`const SUBTITLE_MAX_CUE_CHARS = 10`；`function buildSubtitleCues(input: { narrationText: string; words?: SubtitleWordTiming[]; spanMs?: number }): SubtitleCue[]`；`function activeSubtitleCue(cues: SubtitleCue[], localMs: number): SubtitleCue | undefined`。Task 2/4/6 消费。

- [ ] **Step 1: 写失败测试**（`subtitles.test.ts`）

```ts
// 字幕 cue 构建（spec R2）：有时间戳走字级精确，无时间戳按字符均匀近似；
// 停顿标点切句、≤10 字合并、时序单调、半开区间活跃判定。
import assert from "node:assert/strict";
import test from "node:test";
import {
  activeSubtitleCue,
  buildSubtitleCues,
} from "./subtitles.js";

const WORDS = "水循环，要点、一。"
  .split("")
  .map((text, i) => ({ text, beginMs: 360 + i * 260, endMs: 360 + i * 260 + 200 }));

test("字级时间戳：标点切句成两条 cue，时间取首末字", () => {
  const cues = buildSubtitleCues({
    narrationText: "水循环，要点、一。",
    words: WORDS,
  });
  assert.deepEqual(
    cues.map((c) => c.text),
    ["水循环，", "要点、一。"],
  );
  assert.equal(cues[0]!.startMs, WORDS[0]!.beginMs);
  assert.equal(cues[0]!.endMs, WORDS[4]!.endMs);
  assert.equal(cues[1]!.startMs, WORDS[5]!.beginMs);
  assert.equal(cues[1]!.endMs, WORDS[8]!.endMs);
});

test("无标点超 10 字：按上限断开（10+1）", () => {
  const text = "一二三四五六七八九十甲";
  const words = text
    .split("")
    .map((t, i) => ({ text: t, beginMs: i * 250, endMs: i * 250 + 200 }));
  const cues = buildSubtitleCues({ narrationText: text, words });
  assert.deepEqual(
    cues.map((c) => c.text),
    ["一二三四五六七八九十", "甲"],
  );
});

test("words 为空数组且给 spanMs → 均匀分布（近似路径）", () => {
  const cues = buildSubtitleCues({
    narrationText: "水循环。",
    words: [],
    spanMs: 1600,
  });
  assert.equal(cues.length, 1);
  assert.equal(cues[0]!.text, "水循环。");
  assert.equal(cues[0]!.startMs, 0);
  assert.equal(cues[0]!.endMs, 1600);
});

test("均匀分布多 cue：时序单调不重叠且 Σ 覆盖 span", () => {
  const text = "一二三，四五六。";
  const cues = buildSubtitleCues({ narrationText: text, spanMs: 2400 });
  assert.deepEqual(
    cues.map((c) => c.text),
    ["一二三，", "四五六。"],
  );
  assert.equal(cues[0]!.startMs, 0);
  assert.ok(cues[0]!.endMs <= cues[1]!.startMs);
  assert.equal(cues[cues.length - 1]!.endMs, 2400);
});

test("空白旁白 → 无 cue；无 words 无 spanMs → 无 cue", () => {
  assert.deepEqual(buildSubtitleCues({ narrationText: "  " }), []);
  assert.deepEqual(buildSubtitleCues({ narrationText: "水循环。", words: [] }), []);
});

test("非法时间戳字（begin≥end）被剔除后仍可用则用，全废则回退均匀", () => {
  const bad = "水循环。".split("").map((text) => ({
    text,
    beginMs: 500,
    endMs: 400,
  }));
  const cues = buildSubtitleCues({ narrationText: "水循环。", words: bad, spanMs: 1200 });
  assert.equal(cues.length, 1); // 回退均匀
  assert.equal(cues[0]!.endMs, 1200);
});

test("activeSubtitleCue：半开区间，t=endMs 时下一条/无", () => {
  const cues = [
    { text: "甲", startMs: 0, endMs: 500 },
    { text: "乙", startMs: 500, endMs: 900 },
  ];
  assert.equal(activeSubtitleCue(cues, 499)!.text, "甲");
  assert.equal(activeSubtitleCue(cues, 500)!.text, "乙");
  assert.equal(activeSubtitleCue(cues, 900), undefined);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/video-document && pnpm build 2>&1 | tail -1 && node --test dist/subtitles.test.js 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: build 报 `subtitles.js` 不存在（或 test 文件编译失败）。

- [ ] **Step 3: 最小实现**（`subtitles.ts`）

```ts
// 字幕 cue 构建（spec R1/R2）：字幕是 narrationText × 字级时间戳的派生投影，
// 不入 VideoProject schema。导出路径（CLI）给 words 精确时间戳；浏览器预览
// 只给 spanMs 走字符均匀分布（近似，UI 标注）。
export type SubtitleCue = { text: string; startMs: number; endMs: number };
export type SubtitleWordTiming = {
  text: string;
  beginMs: number;
  endMs: number;
};

export const SUBTITLE_MAX_CUE_CHARS = 10;
const PAUSE_MARKS = new Set(["，", "！", "？", "；", "、", "。"]);

function isCueBreakChar(text: string): boolean {
  return PAUSE_MARKS.has(text);
}

// 连续字累积成 cue：遇停顿标点收口；不遇则 ≤SUBTITLE_MAX_CUE_CHARS 断开。
function groupIntoCues(
  units: { text: string; startMs: number; endMs: number }[],
): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let buffer: typeof units = [];
  const flush = () => {
    if (buffer.length === 0) return;
    cues.push({
      text: buffer.map((unit) => unit.text).join(""),
      startMs: buffer[0]!.startMs,
      endMs: buffer[buffer.length - 1]!.endMs,
    });
    buffer = [];
  };
  for (const unit of units) {
    buffer.push(unit);
    const chars = buffer.reduce((n, item) => n + [...item.text].length, 0);
    if (isCueBreakChar(unit.text) || chars >= SUBTITLE_MAX_CUE_CHARS) flush();
  }
  flush();
  return cues;
}

export function buildSubtitleCues(input: {
  narrationText: string;
  words?: SubtitleWordTiming[];
  spanMs?: number;
}): SubtitleCue[] {
  const text = input.narrationText.trim();
  if (text.length === 0) return [];
  const words = (input.words ?? []).filter(
    (word) =>
      typeof word.beginMs === "number" &&
      typeof word.endMs === "number" &&
      Number.isFinite(word.beginMs) &&
      word.endMs > word.beginMs,
  );
  if (words.length > 0) {
    return groupIntoCues(
      words.map((word) => ({
        text: word.text,
        startMs: word.beginMs,
        endMs: word.endMs,
      })),
    );
  }
  if (input.spanMs === undefined) return [];
  // 均匀近似：字符均分 span，累计取整保证末条 endMs == spanMs。
  const chars = [...text];
  const units = chars.map((char, index) => ({
    text: char,
    startMs: Math.round((input.spanMs! * index) / chars.length),
    endMs: Math.round((input.spanMs! * (index + 1)) / chars.length),
  }));
  return groupIntoCues(units);
}

export function activeSubtitleCue(
  cues: SubtitleCue[],
  localMs: number,
): SubtitleCue | undefined {
  return cues.find((cue) => localMs >= cue.startMs && localMs < cue.endMs);
}
```

`index.ts` 加：`export * from "./subtitles.js";`

- [ ] **Step 4: 跑测试确认通过 + 包全量**

Run: `cd packages/video-document && pnpm build 2>&1 | tail -1 && node --test "dist/**/*.test.js" 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: 47 + 7 = 54/54。

- [ ] **Step 5: Commit**

```bash
git add packages/video-document/src/subtitles.ts packages/video-document/src/subtitles.test.ts packages/video-document/src/index.ts
git commit -m "feat(video-document): 字幕 cue 纯函数——字级精确/均匀近似双路径"
```

---

### Task 2: TimelineScene 字幕渲染层（@acs/remotion-engine）

**Files:**
- Modify: `packages/remotion-engine/src/scene-spec-composition.tsx`（`TimelineShotProps` + 渲染分支，约 :94-150 区域）
- Test: 逻辑纯函数已在 Task 1 覆盖；本任务补 `TimelineShotProps` 类型编译级验证（typecheck）+ 无字幕渲染不变式（由 Task 7 帧确定性复跑实证）

**Interfaces:**
- Consumes: `SubtitleCue` / `activeSubtitleCue` from `@acs/video-document`（engine package.json 已有 `"@acs/video-document": "workspace:*"`，无需加依赖）。
- Produces: `TimelineShotProps.subtitles?: { cues: SubtitleCue[] }`。Task 6 装配消费。

- [ ] **Step 1: 改 `TimelineShotProps` + 渲染分支**

```tsx
// scene-spec-composition.tsx 顶部 import 增加：
import { activeSubtitleCue, type SubtitleCue } from "@acs/video-document";

// TimelineShotProps 增字段（narration 之后）：
  // P1 字幕轨（spec R3）：cues 为镜头本地时间（音频从镜头起点播，同口径）。
  // 缺省不渲染字幕分支——输出与 D2 现状逐字节一致（帧确定性纪律）。
  subtitles?: { cues: SubtitleCue[] };
```

组件内 `const active = shots.find(...)` 之后、`return` 之前加：

```tsx
  // 字幕层（spec R3）：全局帧 → 活跃镜头本地毫秒 → 活跃 cue。白底场景
  // 用半透明深色药丸衬白字（Review Focus #1），横竖按画幅高度定字号。
  const subtitleCue = active.subtitles
    ? activeSubtitleCue(
        active.subtitles.cues,
        ((frame - active.startFrame) / fps) * 1000,
      )
    : undefined;
```

`return` 的 JSX 里 `{renderSpecLayer(active.spec, {...})}` 之后追加（Fragment 内、渲染层之上）：

```tsx
      {subtitleCue ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: "8%",
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              background: "rgba(27,25,23,0.55)",
              borderRadius: Math.round(height * 0.018),
              padding: `${Math.round(height * 0.008)}px ${Math.round(height * 0.022)}px`,
              color: "#ffffff",
              fontWeight: 600,
              fontSize: Math.round(height * (width > height ? 0.05 : 0.045)),
              lineHeight: 1.35,
              whiteSpace: "nowrap",
            }}
          >
            {subtitleCue.text}
          </span>
        </div>
      ) : null}
```

- [ ] **Step 2: 构建 + 全仓 typecheck**

Run: `cd packages/remotion-engine && pnpm build 2>&1 | tail -1 && cd ../.. && pnpm typecheck 2>&1 | tail -2`
Expected: 构建无错；typecheck Done。

- [ ] **Step 3: 无字幕渲染不变式实证（D2 既有产物对照）**

Run: `cd "D:/codex/animate/.claude/worktrees/video-studio-p0" && node scripts/video/e2e-multishot.mjs 2>&1 | grep "SHA-256" -A3`
Expected: landscape/portrait MP4 SHA-256 仍为 `e4df78e9…` / `85bac1b8…`（multishot 无 narration → 无 subtitles props → 逐字节一致）。

- [ ] **Step 4: Commit**

```bash
git add packages/remotion-engine/src/scene-spec-composition.tsx
git commit -m "feat(remotion-engine): TimelineScene 可选字幕层——药丸底白字，缺省逐字节不变"
```

---

### Task 3: planner 语速感知时长（apps/web）

**Files:**
- Modify: `apps/web/src/app/video-studio/planner.ts`（`splitShotDurations` 附近 + `planStoryboard` map 内部，约 :237-371）
- Test: `apps/web/src/app/video-studio/planner.test.ts`

**Interfaces:**
- Produces: `const SPEECH_LEAD_IN_MS = 400`；`const SPEECH_MS_PER_CHAR = 300`；`function speechAwareDurationMs(baseMs: number, narrationText: string): number`。Task 7 e2e 期望值消费（整片总时长 = Σ speech-aware）。

- [ ] **Step 1: 写失败测试**（planner.test.ts 追加）

```ts
// 语速感知时长（spec R4 规划期）：镜头时长 = max(等分, 400ms + 300ms/字)。
// 用户总时长是目标值，容纳旁白优先；totalMs 如实反映 Σ 实际。
test("speechAwareDurationMs：短旁白取等分，长旁白取语音预估", () => {
  expect(speechAwareDurationMs(2000, "水。")).toBe(2000); // 400+300 < 2000
  expect(speechAwareDurationMs(2000, "水循环，要点 1。")).toBe(
    400 + "水循环，要点 1。".length * 300,
  );
  expect(speechAwareDurationMs(2000, "   ")).toBe(2000); // 空白=无声
});

test("planStoryboard：3 秒 4 镜头水循环 → 要点镜头扩到语音时长，totalMs=Σ实际", () => {
  const result = planStoryboard("做一个3秒的STEM解说视频，主题是水循环，分4个镜头");
  assert.ok(result.ok);
  const durations = result.shots.map((shot) => shot.plan.spec.durationMs);
  // 镜头序：开场(水循环。4字→1600<750? 不, 等分750) 示意1 要点1 结语
  // 等分 750ms；开场/示意/结语 4~5 字 → 1600/1900ms；要点1 九字 → 3100ms
  for (const [i, ms] of durations.entries()) {
    const text = result.shots[i]!.narrationText;
    expect(ms).toBeGreaterThanOrEqual(400 + [...text].length * 300 - 1);
  }
  expect(result.totalMs).toBe(durations.reduce((a, b) => a + b, 0));
  expect(result.totalMs).toBeGreaterThan(3000);
});
```

（按该文件既有 import/断言风格接入：`import assert`/`expect` 以文件现状为准——文件用 `node:test` + `assert`，则 `assert.equal` 替换 `expect`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: 新增 2 条 fail（speechAwareDurationMs 未定义）。

- [ ] **Step 3: 实现**

`planner.ts` 在 `splitShotDurations` 后加：

```ts
// 语速常数（spec R4，2026-10-18 实测校准）：现有 4 条 words.json 样本
// lastEnd ≈ 400ms 起始 + 300ms/字 全覆盖（最大过冲 19%，保守方向正确——
// 宁可镜头略长也不截语音）。
export const SPEECH_LEAD_IN_MS = 400;
export const SPEECH_MS_PER_CHAR = 300;

export function speechAwareDurationMs(
  baseMs: number,
  narrationText: string,
): number {
  const chars = [...narrationText.trim()].length;
  if (chars === 0) return baseMs;
  return Math.max(baseMs, SPEECH_LEAD_IN_MS + chars * SPEECH_MS_PER_CHAR);
}
```

`planStoryboard` 改造（保持分支逻辑不动，只挪时长计算位置）：
1. 删掉 map 前的 `const durations = splitShotDurations(totalMs, shotCount);` 与 map 参数 `durations.map((durationMs, index)`——改为 `Array.from({ length: shotCount }, (_, index) => {...})`，分支内先定 `narrationText`，分支后：`const durationMs = speechAwareDurationMs(splitBaseMs, narrationText);`（`splitBaseMs = splitShotDurations(totalMs, shotCount)[index]`，map 前先 `const split = splitShotDurations(totalMs, shotCount);`）。
2. 零帧预检挪到 shots 构造之后：`quantizeTimeline(shots.map((s) => s.plan.spec.durationMs), STORYBOARD_FPS)`。
3. 返回值 `totalMs` 改为 `shots.reduce((sum, s) => sum + s.plan.spec.durationMs, 0)`。

- [ ] **Step 4: 跑测试确认通过 + web 全量**

Run: `cd apps/web && pnpm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: 45 + 2 = 47/47（若既有分镜测试断言 8s 等分时长，按实际值更新——镜头变长是本任务语义）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/video-studio/planner.ts apps/web/src/app/video-studio/planner.test.ts
git commit -m "feat(video-studio): 分镜规划语速感知时长——镜头取 max(等分, 语音预估)"
```

---

### Task 4: 工作台预览字幕层（apps/web）

**Files:**
- Modify: `apps/web/src/app/video-studio/scene-preview.tsx`（`TimelinePreviewItem` + 渲染，约 :144-215）
- Modify: `apps/web/src/app/video-studio/page.tsx`（items 构造处传 `narrationText`）
- Modify: `apps/web/src/app/video-studio/video-studio.css`（`.preview-subtitle` + `.piece-preview` 容器查询）
- Test: 纯函数已覆盖；本任务为渲染接线（typecheck + 手动/e2e 验证）

**Interfaces:**
- Consumes: Task 1 `buildSubtitleCues` / `activeSubtitleCue`（web 已依赖 `@acs/video-document`）。
- Produces: `TimelinePreviewItem.narrationText?: string`。

- [ ] **Step 1: `TimelinePreviewItem` 增字段并渲染**

```tsx
export type TimelinePreviewItem = {
  spec: SceneSpec;
  startFrame: number;
  frames: number;
  // 字幕近似层（spec R3 预览侧）：无字级时间戳，均匀分布；出片走精确时间戳。
  narrationText?: string;
};
```

`TimelinePreview` 内 `const mapping = ...` 之后：

```tsx
  const activeCue = useMemo(() => {
    if (!active?.narrationText) return undefined;
    const cues = buildSubtitleCues({
      narrationText: active.narrationText,
      spanMs: active.spec.durationMs,
    });
    return activeSubtitleCue(cues, (mapping.localFrame / PIECE_FPS) * 1000);
  }, [active, mapping.localFrame]);
```

`<SpecCanvas …>` 之后（同一容器内叠加）：

```tsx
      {activeCue ? (
        <div className="preview-subtitle" aria-hidden="true">
          {activeCue.text}
        </div>
      ) : null}
```

（`useMemo` 按 React 现行 import 风格补进文件头。）

- [ ] **Step 2: page.tsx 传参**

items 构造处（`.map` 内）加：`narrationText: workingVersion?.narrationText`（按该处取 working 版本的既有变量名接入；无旁白 → undefined → 无字幕）。

- [ ] **Step 3: CSS**

```css
/* 字幕近似层：与出片同构（药丸底白字），预览容器宽度按 cq 缩放 */
.piece-preview {
  container-type: inline-size;
}
.preview-subtitle {
  position: absolute;
  bottom: 8%;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  pointer-events: none;
}
.preview-subtitle > span 替代方案（直接作用在内容上）:
.preview-subtitle {
  …上方属性…
  width: fit-content;
  margin: 0 auto;
  background: rgba(27, 25, 23, 0.55);
  border-radius: 0.4cqw;
  padding: 0.5cqh 1.6cqw;
  color: #fff;
  font-weight: 600;
  font-size: 4cqw;
  white-space: nowrap;
}
```

（实现时二选一：外层 flex + 内层 span 与 engine JSX 同构，或如上单元素；以渲染对齐 engine 为准。）

- [ ] **Step 4: typecheck + 手动烟测**

Run: `cd "D:/codex/animate/.claude/worktrees/video-studio-p0" && pnpm typecheck 2>&1 | tail -1`
Expected: Done。dev server 上打开含旁白项目，预览底部见药丸字幕（人工/截图核验一次，dev server `PORT=3210 pnpm --filter @acs/web dev`）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/video-studio/scene-preview.tsx apps/web/src/app/video-studio/page.tsx apps/web/src/app/video-studio/video-studio.css
git commit -m "feat(video-studio): 整片预览字幕近似层——均匀分布，样式同出片"
```

---

### Task 5: tts-narration 溢出时长对齐（scripts/video）

**Files:**
- Modify: `scripts/video/tts-sse.mjs`（纯函数层：`wavDurationMs` / `planDurationAlignments`）
- Modify: `scripts/video/tts-narration.mjs`（CLI 接线：对齐 + 资产重键 + `--allow-truncate` + 文档写回）
- Test: `scripts/video/tts-sse.test.mjs`（扩展）

**Interfaces:**
- Consumes: `@acs/video-document` 的 `assertAppendOnlyEvolution` / `validateVideoProject`（render-scene 写回同款 import 方式）。
- Produces: `function wavDurationMs(wav: Buffer): number`（PCM16/24k mono 头解析）；`function planDurationAlignments(project, wavMsByBase): Array<{ shotIndex, shotId, versionId, oldDurationMs, wavMs, newDurationMs }>`（`wavMsByBase: Map<string, number>` 键 `${shotId}-${versionId}`；`newDurationMs = wavMs + 50` 取整——50ms 尾样保护防 Sequence 恰好截尾）。Task 6 的默认拒绝与之配套。

- [ ] **Step 1: 写失败测试**（tts-sse.test.mjs 追加；WAV 头按 RIFF/PCM16/24000 手工构造最小 buffer）

```js
// —— 时长对齐（spec R4 合成期兜底）——
test("wavDurationMs：PCM16 24k mono 头解析", () => {
  const buf = Buffer.alloc(44);
  buf.write("RIFF", 0); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(24000, 24);
  buf.writeUInt32LE(48000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(48000 * 2, 40); // 2 秒
  assert.equal(wavDurationMs(buf), 2000);
});

test("planDurationAlignments：只报超出的镜头，newDurationMs=wav+50", () => {
  const project = { shots: [{ shotId: "s1", workingVersionId: "v1",
    contentVersions: [{ versionId: "v1", durationMs: 2000 }], events: [] }] };
  const wav = new Map([["s1-v1", 2640]]);
  const plan = planDurationAlignments(project, wav);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].newDurationMs, 2690);
  const ok = new Map([["s1-v1", 1500]]);
  assert.equal(planDurationAlignments(project, ok).length, 0);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd "D:/codex/animate/.claude/worktrees/video-studio-p0" && node --test scripts/video/tts-sse.test.mjs 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: 新增 2 fail（函数未导出）。

- [ ] **Step 3: 实现（tts-sse.mjs 追加）**

```js
// —— 时长对齐纯函数层（spec R4）——
export function wavDurationMs(wav) {
  if (wav.subarray(0, 4).toString("ascii") !== "RIFF") {
    throw new Error("wavDurationMs: 非 RIFF 开头");
  }
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.subarray(offset, offset + 4).toString("ascii");
    const size = wav.readUInt32LE(offset + 4);
    if (id === "data") {
      const byteRate = wav.readUInt32LE(28); // fmt 块字段：字节/秒
      return Math.round((size / byteRate) * 1000);
    }
    offset += 8 + size + (size % 2); // chunk 按 2 字节对齐
  }
  throw new Error("wavDurationMs: 无 data 块");
}

export function planDurationAlignments(project, wavMsByBase) {
  const plan = [];
  for (const [shotIndex, shot] of project.shots.entries()) {
    const version = shot.contentVersions.find(
      (candidate) => candidate.versionId === shot.workingVersionId,
    );
    if (!version) continue;
    const wavMs = wavMsByBase.get(`${shot.shotId}-${version.versionId}`);
    if (wavMs === undefined || wavMs + 50 <= version.durationMs) continue;
    plan.push({
      shotIndex,
      shotId: shot.shotId,
      versionId: version.versionId,
      oldDurationMs: version.durationMs,
      wavMs,
      newDurationMs: Math.ceil(wavMs + 50),
    });
  }
  return plan;
}
```

- [ ] **Step 4: CLI 接线（tts-narration.mjs）**

1. parseArgs options 加 `allowTruncate: { type: "boolean" }`。
2. 每个 job 合成落盘后记录 `wavMsByBase.set(base, wavDurationMs(wav))`。
3. 全部 job 完成后（`--allow-truncate` 未设时）：

```js
const plan = planDurationAlignments(project, wavMsByBase);
if (plan.length > 0) {
  for (const item of plan) {
    const shot = project.shots[item.shotIndex];
    const old = shot.contentVersions.find((v) => v.versionId === item.versionId);
    const newVersionId = crypto.randomUUID();
    const aligned = structuredClone(old);
    aligned.versionId = newVersionId;
    aligned.createdAt = new Date().toISOString();
    aligned.durationMs = item.newDurationMs;
    if (aligned.sceneSource.type === "spec")
      aligned.sceneSource.spec.durationMs = item.newDurationMs;
    aligned.provenance = {
      engineId: "tts-duration-align",
      engineVersion: "1",
      parentVersionId: item.versionId,
    };
    shot.contentVersions.push(aligned);
    shot.events.push({ kind: "submitted", versionId: newVersionId,
      at: aligned.createdAt, actor: "ai" });
    shot.workingVersionId = newVersionId;
    // 资产重键（rename 成功才写档——Review Focus #5）
    renameSync(path.join(values.out, `${item.shotId}-${item.versionId}.wav`),
      path.join(values.out, `${item.shotId}-${newVersionId}.wav`));
    renameSync(path.join(values.out, `${item.shotId}-${item.versionId}.words.json`),
      path.join(values.out, `${item.shotId}-${newVersionId}.words.json`));
    console.log(`[tts-narration] 镜头 ${item.shotIndex + 1} 时长对齐: ` +
      `${item.oldDurationMs}ms → ${item.newDurationMs}ms（旁白 ${item.wavMs}ms）`);
  }
  project.savedVersion += 1;
  const previous = validateVideoProject(JSON.parse(readFileSync(values.project, "utf8")));
  const next = validateVideoProject(project);
  assertAppendOnlyEvolution(previous, next);
  atomicWriteFile(values.project, `${JSON.stringify(next, null, 2)}\n`);
}
```

（import 补：`renameSync` from node:fs、`randomUUID` from node:crypto、validate/evolve from `@acs/video-document` dist——与 render-scene.mjs 同款 import 路径；`project` 变量为文件顶部已读的解析对象，写回前重读旧档做演进对照。）
`--allow-truncate` 设置时：`console.warn` 保留截断告警语义（不写档）。

- [ ] **Step 5: 跑测试确认通过 + 脚本全量**

Run: `cd "D:/codex/animate/.claude/worktrees/video-studio-p0" && node --test "scripts/video/*.test.mjs" 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: 25 + 2 = 27/27。

- [ ] **Step 6: Commit**

```bash
git add scripts/video/tts-sse.mjs scripts/video/tts-narration.mjs scripts/video/tts-sse.test.mjs
git commit -m "feat(video-tts): 旁白溢出时长对齐——新 ContentVersion 只追加演进 + 资产重键"
```

---

### Task 6: render-scene 字幕装配 + 溢出默认拒绝（scripts/video）

**Files:**
- Modify: `scripts/video/tts-sse.mjs`（`readSubtitleCues(dir, base, narrationText, spanMs)`）
- Modify: `scripts/video/render-scene.mjs`（cues 进 props + manifest 摘要 + 默认拒绝）
- Test: `scripts/video/render-scene.narration.test.mjs`（扩展）

**Interfaces:**
- Consumes: Task 1 `buildSubtitleCues`；Task 5 `planDurationAlignments` 语义（默认拒绝配套）。
- Produces: `function readSubtitleCues(dir, base, narrationText, spanMs): { cues: SubtitleCue[]; fallback: boolean }`（words.json 读不到/坏 JSON/全非法时间戳 → 均匀分布 `fallback: true`；cue `endMs` 钳到 `spanMs`——Review Focus #2/#3）。manifest `aspects[aspect].subtitleCues: Array<{ shotIndex, cues: number, textSha256: string }>`。Task 7 e2e 消费。

- [ ] **Step 1: 写失败测试**（render-scene.narration.test.mjs 追加；tmp 目录写 words.json 样本）

```js
test("readSubtitleCues：words.json 精确路径 + 均匀回退 + 超尾钳制", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "subcues-"));
  const base = "s1-v1";
  writeFileSync(path.join(dir, `${base}.words.json`), JSON.stringify(
    { sentences: [{ index: 0, words: [
      { text: "水", begin_time: 360, end_time: 560 },
      { text: "。", begin_time: 560, end_time: 700 },
    ] }] }));
  const exact = readSubtitleCues(dir, base, "水。", 2000);
  assert.equal(exact.fallback, false);
  assert.equal(exact.cues[0].endMs, 700);

  const missing = readSubtitleCues(dir, "s2-v2", "水。", 1600); // 无文件 → 均匀
  assert.equal(missing.fallback, true);
  assert.equal(missing.cues[0].endMs, 1600);

  writeFileSync(path.join(dir, `s3-v3.words.json`), "{ 不是 JSON");
  const corrupt = readSubtitleCues(dir, "s3-v3", "水。", 1600);
  assert.equal(corrupt.fallback, true);

  // 超尾钳制：span 500ms 但字级到 700ms → endMs 钳到 500
  const clamped = readSubtitleCues(dir, base, "水。", 500);
  assert.equal(clamped.cues[clamped.cues.length - 1].endMs, 500);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test scripts/video/render-scene.narration.test.mjs 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: 新增 1 fail。

- [ ] **Step 3: 实现（tts-sse.mjs 追加）**

```js
// 字幕 cue 读取（spec R2/R3 + Review Focus #2/#3）：words.json 坏/缺 → 均匀
// 近似（fallback=true 供上层告警）；cue 越过 span 钳到 span（--allow-truncate
// 路径音轨截断，字幕不能悬空显示到不存在的帧）。
export function readSubtitleCues(dir, base, narrationText, spanMs) {
  let words;
  try {
    const parsed = JSON.parse(readFileSync(path.join(dir, `${base}.words.json`), "utf8"));
    words = (parsed.sentences ?? []).flatMap((sentence) =>
      (sentence.words ?? []).map((word) => ({
        text: String(word.text ?? ""),
        beginMs: Number(word.begin_time),
        endMs: Number(word.end_time),
      })),
    );
  } catch {
    words = [];
  }
  const built = buildSubtitleCues({ narrationText, words, spanMs });
  const fallback = words.length === 0 && narrationText.trim().length > 0;
  const cues = built.map((cue) => ({
    ...cue,
    endMs: Math.min(cue.endMs, spanMs),
    startMs: Math.min(cue.startMs, spanMs),
  })).filter((cue) => cue.endMs > cue.startMs);
  return { cues, fallback };
}
```

（import 补 `buildSubtitleCues`——按 tts-sse.mjs 现有跨包 import 风格。）

- [ ] **Step 4: render-scene 接线**

1. parseArgs 加 `allowTruncate: { type: "boolean" }`。
2. `buildNarrationEntries` 调用后、spawn 服务前：`if (assembled.warnings.length > 0 && !values.allowTruncate) fail(...)`——默认拒绝渲染，fail 文案给出「先重跑 tts-narration 对齐，或显式 --allow-truncate」两条出路（原 warnings 逐条列出）。
3. `timelineProps` 装配处，有 narration 资产的镜头加：

```js
const subtitle = readSubtitleCues(narrationDir, base,
  shotEntries[span.shotIndex].version.narrationText ?? "",
  Math.round((span.frames / FPS) * 1000));
if (subtitle.fallback)
  console.warn(`[render-scene] 镜头 ${span.shotIndex + 1} 无字级时间戳，字幕按均匀近似`);
...(subtitle.cues.length > 0 ? { subtitles: { cues: subtitle.cues } } : {}),
```

（`narrationDir`/`base` 取装配块既有变量；`narrationByShot` entry 已含 audioSrc 与 shotIndex。）

4. manifest `aspects[aspect]` 的 narration 块之后加：

```js
    ...(subtitleSummary.length > 0 ? { subtitleCues: subtitleSummary } : {}),
```

`subtitleSummary` 在 props 装配前一次性构造：`Array<{ shotIndex, cues: number, textSha256: sha256(cues.map((c) => c.text).join("\n")) }>`（`sha256` 用 render-scene 既有 createHash 管道）。

- [ ] **Step 5: 跑测试 + 脚本全量**

Run: `node --test "scripts/video/*.test.mjs" 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: 27 + 1 = 28/28。

- [ ] **Step 6: Commit**

```bash
git add scripts/video/tts-sse.mjs scripts/video/render-scene.mjs scripts/video/render-scene.narration.test.mjs
git commit -m "feat(video-render): 字幕装配进整片 props + manifest 摘要；旁白溢出默认拒绝渲染"
```

---

### Task 7: e2e 扩展 + 全量回归 + 证据/文档落档

**Files:**
- Modify: `scripts/video/e2e-narrated.mjs`（字幕断言 + 时长期望更新）
- Modify: `artifacts/video-studio-narrated/E2E_NARRATED.md`（证据刷新）
- Modify: `AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md`（状态段）
- Modify: QA 台账（VID-012/013 登记，按 `pnpm qa:validate` 台账文件实名）

**Interfaces:**
- Consumes: Task 3（整片总时长 = Σ speech-aware，断言按实际值计算不写死）、Task 6（manifest.subtitleCues）、Task 2（药丸字幕 → 底带暗像素）。

- [ ] **Step 1: e2e-narrated.mjs 断言扩展**

1. 既有时长/音频断言改为从 manifest 与实际 totalMs 推导（不写死 8s——speech-aware 后整片 ≈9.1s）。
2. render 完成后：

```js
// 字幕烧录核验（spec R5）：manifest 摘要 + 底带暗像素（药丸底在白背景上
// 产生 <200 亮度像素；对照 pre-cue 时刻应≈0）。
const manifest = JSON.parse(readFileSync(path.join(OUT_DIR, "e2e-render", "render-manifest.json"), "utf8"));
const anyAspect = manifest.aspects[Object.keys(manifest.aspects)[0]];
assert.ok(anyAspect.subtitleCues?.length >= 3, "manifest 缺 subtitleCues 摘要");
function bottomBandDarkRatio(mp4, tSeconds) {
  const out = path.join(OUT_DIR, `band-${tSeconds}.gray`);
  spawnSync("ffmpeg", ["-y", "-ss", String(tSeconds), "-i", mp4, "-frames:v", "1",
    "-vf", "crop=iw:ih*0.10:0:ih*0.80,format=gray", "-f", "rawvideo", out],
    { stdio: "ignore" });
  const buf = readFileSync(out);
  let dark = 0;
  for (const byte of buf) if (byte < 200) dark += 1;
  return dark / buf.length;
}
const landscapeMp4 = path.join(OUT_DIR, "e2e-render", "landscape.mp4");
const cueTime = 1.5;   // 首镜头旁白进行中（首字 ~0.36s 起）
const preCueTime = 0.1; // 首字之前，画面底部应为纯背景
assert.ok(bottomBandDarkRatio(landscapeMp4, cueTime) > 0.01,
  "cue 时刻底带应有药丸暗像素");
assert.ok(bottomBandDarkRatio(landscapeMp4, preCueTime) < 0.005,
  "pre-cue 时刻底带应无字幕");
```

（`crop=iw:ih*0.10:0:ih*0.80` 取底部 80%~90% 带区；阈值按白底实测留量，跑通后固化。）

- [ ] **Step 2: 复跑 e2e-narrated（计费 ~¥0.0037）**

Run: `node scripts/video/e2e-narrated.mjs 2>&1 | tail -10`
Expected: 全链路一次通过；控制台零错误；字幕两断言过；计费台账追加且 ≤¥50。

- [ ] **Step 3: 全量回归**

Run（Bash，逐条）：
1. `cd packages/video-document && pnpm build && node --test "dist/**/*.test.js"` → 54/54
2. `cd packages/video-scene && pnpm build && node --test "dist/**/*.test.js"` → 33/33
3. `cd apps/web && pnpm test` → 47/47
4. 根：`node --test "scripts/video/*.test.mjs"` → 28/28
5. `pnpm typecheck` / `pnpm format && pnpm lint` → 全过
6. `node scripts/video/e2e-multishot.mjs` → MP4 哈希仍 `e4df78e9…`/`85bac1b8…`（无字幕路径逐字节不变）
7. `node scripts/video/e2e-closed-loop.mjs` → 绿

- [ ] **Step 4: 证据/文档**

1. `E2E_NARRATED.md`：新运行哈希表（json/manifest/png/mp4/wav）、字幕帧证据（cue 时刻 band PNG 存档 + SHA-256）、计费台账累计行更新。
2. `CURRENT_STATE.md` 顶部新段：字幕轨 + 溢出收口（含语速常数校准数据、药丸样式裁决、--allow-truncate 语义）。
3. QA 台账 VID-012（字幕轨）/ VID-013（溢出收口）登记，`pnpm qa:validate` 过。

- [ ] **Step 5: Commit**

```bash
git add scripts/video/e2e-narrated.mjs artifacts/video-studio-narrated/E2E_NARRATED.md AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md <QA 台账文件>
git commit -m "feat(video-studio): 字幕轨 e2e 收口——烧录核验、证据与 QA 登记"
```

---

## Self-Review 记录

1. **Spec 覆盖**：R1（Task 1 派生轨+纯函数）、R2（Task 1/6）、R3（Task 2/4）、R4（Task 3/5/6 三层）、R5（Task 7 + 各任务单测）、R6（Global Constraints 计费/密钥行）——全覆盖。
2. **占位符扫描**：Task 4 Step 3 CSS 给了两种写法但都完整；Task 6 Step 4 第 3 点 `base` 变量指明取装配块既有变量——实现时定位，无 TBD。
3. **类型一致性**：`SubtitleCue`/`SubtitleWordTiming`/`buildSubtitleCues`/`activeSubtitleCue` 跨任务签名一致；`subtitles?: { cues }` props 与 Task 6 注入一致；`planDurationAlignments` 返回结构与 tts-narration 消费一致。
4. **Review Focus**：五条各有钉测试（#1→Task 2/7；#2→Task 6；#3→Task 6；#4→Task 3；#5→Task 5 rename-before-write 顺序 + Step 1 无直接测试，改为 CLI 实现顺序约束——接受，理由：集成路径由 e2e-narrated 全链路覆盖）。
