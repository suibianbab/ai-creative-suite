# Video Studio 分镜编辑器设计（P1 Feature ②：逐镜头调画面/旁白/字幕、单镜头重做）

- 日期：2026-10-18
- 状态：proposed（会话常设指令「你按顺序全部开发吧」+「只要 token 没消耗完就一直干」授权连续推进）
- 上游：`docs/VIDEO_STUDIO_ALIGNMENT_REVIEW_2026-10-17.md` P1 行「分镜编辑器（逐镜头调画面/旁白/字幕、单镜头重做）」
- 继承约束：字幕轨 spec（2026-10-18）「分镜编辑器（下一刀）编辑 `narrationText`，字幕自动跟随，单一事实源」
- 权威依据：ADR 0003（镜头 schema/事件语义/锁定规则）、ADR 0001（核心数据边界）

## 1. 背景与问题

工作台（`apps/web/src/app/video-studio/page.tsx`）目前的镜头卡是**只读**的：`shot-order` / `shot-description` / `shot-narration` / `shot-duration` 四个 span，只能看不能改。想改一个镜头的旁白文案、换背景色、调时长或整体重做，唯一路径是重新规划整句分镜再另存——粒度错误，且丢弃已有版本历史。

`packages/video-document` 已备好版本演化操作（`addCandidateVersion` / `approveVersion` / `setLocked` / `rollbackWorkingVersion`），但 UI 从未接线；且**人工修订路径没有对应纯函数**——`addCandidateVersion` 是机器重做语义（锁定即拒），人直接改正文走不了它。

## 2. 目标与非目标

**目标（P1 行拆解）**

- R1 旁白编辑：逐镜头改 `narrationText` → 追加新 ContentVersion（人工路径），字幕自动跟随。
- R2 画面编辑：逐镜头改 SceneSpec 的可编辑面——背景色、时长、文字动画标题/副标题、线描/图形模板换一枚（seed 重抽）。
- R3 单镜头重做：对单个镜头输入一句单镜头指令 → `planFromSentence` 重规划 → 追加候选版本（机器路径，锁定拒绝）。
- R4 版本治理可见：镜头卡上可见版本历史、可回滚 working 指针、可锁定/解锁（既有纯函数接线）。
- R5 溢出提示：旁白改长后若语速估计超出镜头时长，编辑器明说并给一键对齐（复用 `speechAwareDurationMs`）。

**非目标（明确不做）**

- 不做字幕直接编辑——字幕是 `narrationText` 的投影（单一事实源，字幕轨 spec 已定）。
- 不做镜头增删/重排——分镜应用（追加）已覆盖新增；删除/重排是另一刀。
- 不在浏览器里做 TTS 重合成——计费链路留在 CLI（`scripts/video/tts-narration.mjs`），编辑器只改文档。
- 不接 `approveVersion` UI——审批事件当前无消费方（YAGNI）；重做产生的 submitted(ai) 版本靠回滚治理。
- 不做 editor-binding 场景源的可视化编辑——仅 spec 场景源可编辑，其余镜头卡降级为只读（沿用 `shotWorkingSpec` 的降级语义）。

## 3. 架构与数据流

三层各司其职，与既有模式一致（纯函数包 + 薄 UI + e2e 脚本）：

```
┌─ web 编辑器（draft 本地状态）────────────────────────────┐
│ shot-editor-card.tsx：草稿 → 校验（hex/时长/标题）        │
│   ├ 旁白/画面修订 → reviseWorkingVersion(patch)  [新]     │
│   ├ 重做 → planFromSentence → addCandidateVersion [既有]  │
│   ├ 回滚 → rollbackWorkingVersion               [既有]    │
│   └ 锁定 → setLocked                             [既有]    │
└──────────────────────────────────────────────────────┘
          ↓ 追加式演化（validate 收尾）
   VideoProject 文档（保存/导出/CLI 渲染 unchanged）
          ↓ 投影
   字幕 = buildSubtitleCues(narrationText, words)（自动跟随，零新代码）
```

**关键裁决（依 ADR 0003 §1.3）**

- 人工修订 = 新 ContentVersion + `submitted(human)` 事件（与初始创建/分镜应用同型）；**锁定镜头允许人工修订**，且额外追加 `audit` 事件（ADR 原文：locked 镜头人工编辑 "produce a new content version plus an explicit audit event"）。
- 单镜头重做 = 机器生成候选 → `addCandidateVersion` 原样复用（`submitted(ai)`、锁定抛 `ShotLockedError`、working 指针前移）。重做只换画面，不携带旁白——旁白归 R1 管。
- 修订的 base 恒为当前 working 版本（不是任意历史版本）；改历史先回滚再修订，两步人工、两串事件，不合并。

## 4. API 设计

### 4.1 `packages/video-document/src/operations.ts` — 新增 `reviseWorkingVersion`

```ts
// 人工修订：以当前 working 版本为 base 追加新 ContentVersion + submitted(human)。
// 锁定镜头允许（ADR 0003 §1.3 人工路径），此时再追加 audit 事件留痕。
// patch.spec 由调用方先用 video-scene 的 validateSceneSpec + 组件注册表校验过
// （video-document 不依赖 video-scene，spec 在本包内是 unknown）。
export function reviseWorkingVersion(
  p: VideoProject,
  shotId: string,
  patch: { narrationText?: string; spec?: unknown },
  newVersionId: string,
  at = new Date().toISOString(),
): VideoProject
```

语义细节：

- 新版本字段：`versionId = newVersionId`；`createdAt = at`；未 patch 的字段从 working 版本原样继承。
- `patch.spec` 给出时：`sceneSource = { type: "spec", spec }`，且 `durationMs = (spec as {durationMs:number}).durationMs`（spec 与版本时长同步，与 tts-duration-align 同规）。
- `provenance = { engineId: "human-edit", engineVersion: "1", parentVersionId: <working.versionId> }`。
- 描述：旁白修订时 `description = 原描述.slice(0,160) + "（人工修订）"`；spec 修订时同式。均为 1..200 截断安全。
- 事件：先 `submitted(human)`；若 `shot.locked` 再 `audit { note: "人工修订（锁定镜头）" }`。
- `workingVersionId` 前移到新版本；收尾 `validateVideoProject`（失败即抛，入参不动——纯函数语义与包内其他操作一致）。
- `narrationText` 边界 0..2000（validate 兜底）；空串合法（该镜头无旁白）。

### 4.2 `apps/web/src/app/video-studio/planner.ts` — 新增 `reseedSpecParams`

```ts
// 换模板：对 line-drawing / basic-shapes 用新 seed 从模板表重生成 params；
// text-animation 的 params（标题/副标题）不经此路（走标题输入框）。
// 返回新 spec 对象（不改入参）；durationMs/background 保留原值。
export function reseedSpecParams(spec: SceneSpec, seed: number): SceneSpec
```

- 复用私有 `lineDrawingParams` / `basicShapesParams`（模板表单一事实源）；`componentId` 非这两类时原样返回 spec 克隆。
- UI 的「换一枚模板」按钮：`seed = (spec.seed + 1)`（模板表按 `seed % len` 抽取，+1 即换下一枚，循环自然回绕）。

### 4.3 `apps/web/src/app/video-studio/shot-editor-card.tsx` — 新组件

```ts
export type ShotEditorCardProps = {
  shot: Shot;                      // 来自 @acs/video-document
  index: number;                   // 显示序号（1 起）
  frames: number;                  // 量化帧数（时间线展示）
  editable: boolean;               // shotWorkingSpec 降级为 null 时 false → 只读卡
  onRevise: (patch: { narrationText?: string; spec?: unknown }) => void;
  onRedo: (directive: string) => void;      // 重做指令交给上层 planFromSentence
  onRollback: (versionId: string) => void;
  onToggleLock: (locked: boolean) => void;
  redoError: string | null;        // ShotLockedError 等重做失败信息（上层置）
};
```

卡片结构（既有只读信息保留 + 展开式编辑区）：

- 收起态 = 现有四个 span + 「编辑」按钮 + 锁定标记 + 版本选择器。
- 展开态表单（本地 draft state，**不直接碰 document**，点「应用修订」才回调 `onRevise`）：
  - 旁白 `textarea.shot-narration-input`（0..2000）；
  - 背景色 `input.shot-bg-input`（`#rrggbb`，失焦校验）；
  - 时长 `input.shot-duration-input`（秒，0.1 步进 → ms 取整，边界 1..600000ms）；
  - text-animation：标题/副标题 `input.shot-title-input` / `input.shot-subtitle-input`（标题非空）；
  - line-drawing / basic-shapes：「换一枚模板」按钮 + 当前模板序号（`(seed % 表长) + 1 / 表长`）；
  - R5 溢出提示：`speechAwareDurationMs(draftDurationMs, draftNarration) > draftDurationMs` 时显示「旁白按语速需 X.Xs，超出当前 Ys」+「按语速对齐」按钮（把时长草稿改成估计值）；
  - 「应用修订」/「取消」；行内错误 `p.shot-edit-error`（校验失败不回调）。
- 重做区：指令输入 + 「重做此镜头」按钮 → `onRedo(directive)`；上层把 `planFromSentence` 的失败 reason 或 `ShotLockedError` 文案写进 `redoError` 展示。
- 版本历史：`select.shot-version-select`（选项 = 版本序号 + 描述截断）+「回滚到此版本」按钮 → `onRollback`；当前 working 高亮。
- 锁定：`checkbox.shot-lock-toggle` → `onToggleLock`。

### 4.4 `page.tsx` 接线

- `shot-list` 内的只读 `<li>` 换成 `<ShotEditorCard>`（只读信息不丢：组件内含）。
- 回调实现：`reviseWorkingVersion(document, shotId, patch, randomUUID())` → `setEditor({ document: next, message: "镜头 N 已修订（v…）" })`；重做 = `planFromSentence(directive)` 失败置 `redoError`，成功则构造 ContentVersion（narrationText 继承当前 working、`sceneSource.spec = plan.spec`、`provenance = { engineId: "planner-rules", engineVersion: "1", parentVersionId }`）走 `addCandidateVersion`，`ShotLockedError` 捕获置 `redoError`（文案含「先解锁」）。
- 修订/重做/回滚/锁定都只改内存 document，**「保存」才落盘**（savedVersion 计数语义不变）。

## 5. 错误处理

| 情形 | 行为 |
| --- | --- |
| 背景色非法（非 `#rrggbb`） | 行内错误，不回调 |
| 时长越界（<1ms 或 >600000ms，或秒输入 ≤0） | 行内错误，不回调 |
| text-animation 标题为空 | 行内错误，不回调 |
| `reviseWorkingVersion` 收尾 validate 抛错 | 上层 catch → message 区显示（文档不变） |
| 重做指令不合句式 | `planFromSentence` reason + guidance 显示在 `redoError` |
| 锁定镜头重做 | `ShotLockedError` → `redoError`「镜头已锁定，先解锁再重做」 |
| `shotWorkingSpec` 降级（非 spec 场景源） | `editable=false`，卡片只读（与整片预览降级同语义） |
| 旁白溢出（语速估计 > 时长） | 不阻断——R5 提示 + 一键对齐；硬兜底仍在 CLI 渲染默认拒绝 |

## 6. 测试策略

单测零网络、零计费；e2e 走真实浏览器但不碰 TTS（本刀无新合成，计费 ¥0）。

1. `packages/video-document/src/operations.test.ts`（追加）：`reviseWorkingVersion` —— 追加不改历史版本、事件序（submitted human；locked 时再 + audit）、指针前移、spec patch 时 durationMs 同步、parentVersionId 链、validate 失败抛错且入参不变（structuredClone 断言）、narrationText 空串合法。
2. `apps/web/src/app/video-studio/planner.test.ts`（追加）：`reseedSpecParams` —— 两类组件 params 与模板表按 seed 对齐、text-animation 原样返回、入参不被改。
3. `apps/web/src/app/video-studio/shot-editor-card.test.tsx`（新建，沿 web 既有测试栈）：渲染既有镜头、draft 编辑 + 应用回调携带已校验 patch、非法输入行内报错且不回调、锁定镜头仍可修订（按钮可用）、重做回调与 redoError 展示、版本选择回滚回调、降级只读。
4. e2e `scripts/video/e2e-shot-editor.mjs`（新建，模式沿 e2e-multishot）：建 4 镜头项目 → 改镜头 2 旁白（版本 1→2，事件 submitted human，字幕药丸文本随改）→ 改背景+时长（spec 字段断言）→ 换模板（seed+1）→ 锁镜头 1 → 重做被拒（文案含「解锁」）→ 解锁 → 重做成（submitted ai，版本 +1，旁白继承）→ 锁定镜头 1 人工修订成功（audit 事件在）→ 回滚镜头 2 到 v1 → 保存 → 导出 JSON 断言结构（版本数、事件序、applications 不变）→ 截图 + 控制台零 error。产物入 `artifacts/video-studio-shot-editor/`（媒体不入库，SHA-256 证据制）。

## 7. 验收标准

- A1 四个 P1 子项全部可操作：旁白改、画面改（背景/时长/标题/模板）、单镜头重做、版本回滚 + 锁定。
- A2 一切编辑走追加式版本演化：历史版本字节不变（e2e 导出件断言），事件序符合 ADR 0003。
- A3 锁定语义正确：锁定拒机器重做、允人工修订（audit 留痕）。
- A4 字幕单一事实源：改旁白后预览字幕随之变化，无任何 cue 独立存储。
- A5 保存/导出/CLI 渲染链路不受影响（render-scene 对新版本照常出片——e2e 至少跑通一次渲染冒烟）。
- A6 单测绿、`pnpm lint` 绿、e2e 退出码 0、控制台零 error、计费零新增。

## 8. 风险与对策

- **page.tsx 膨胀**：编辑 UI 全部进新组件文件，page.tsx 只做接线（预计 +60 行以内）。
- **spec 编辑破坏渲染**：所有 spec patch 先过 `validateSceneSpec` + 组件注册表再进文档；e2e 渲染冒烟兜底。
- **版本堆积**：重做/修订都产新版本，e2e 显式覆盖回滚路径；版本选择器按时间序展示避免迷路。
- **时长改动与已合成旁白失配**：资产按 versionId 键控，新版本 = 新键，旧 wav 不会被误用；溢出兜底仍在 CLI（默认拒绝 + `--allow-truncate`）。
