# Video Studio D2 第一刀：DashScope TTS 旁白合成与有声出片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 多镜头项目的每个镜头旁白（narrationText）经 DashScope CosyVoice 合成为 WAV（含字级时间戳），整片出片带 AAC 音轨（画面帧与无旁白版逐像素一致）。

**Architecture:** 旁白文本在规划器落进 ContentVersion.narrationText（已有字段，零 schema 变更）；`scripts/video/tts-narration.mjs` 走 DashScope 流式 SSE 合成（字级时间戳随 sentence-begin 返回），音频+时间戳为旁置资产（shotId-versionId.wav/.words.json），render-scene 以 `--narration <dir>` 装配进 Timeline 合成的 `<Audio>`（Sequence 按镜头 startFrame 偏移）。计费走 JSONL 台账。

**Tech Stack:** Node fetch + SSE 手解析、cosyvoice-v3-flash + longanyang（spike 已验证字级时间戳）、Remotion `<Audio>`、ffprobe 音轨核对。

**Spec:** docs/VIDEO_STUDIO_ALIGNMENT_REVIEW_2026-10-17.md（P1 行「TTS 旁白 Provider 接入」、决策点 D2）；ADR 0003；spike 实测记录见 Task 2 注。

## Global Constraints

- **确定性（ADR 0003 §2.3/§2.5）**：音轨不得影响视频帧——同一项目「带旁白」与「不带旁白」渲染的视频帧必须逐像素一致（Task 5 验证）；时间戳/音频文件不入渲染上下文的随机源。
- **计费纪律**：单测零网络调用；真实计费调用只出现在 CLI 手工/E2E 步骤；累计 ≤¥50，逐笔记 `artifacts/tts-usage.jsonl`（date, request_id, model, characters, costCNY）；超出立即停。
- **密钥纪律**：DASHSCOPE_API_KEY 只从环境变量读；绝不写盘、绝不入 props/manifest/日志；info.txt 仅人工参考。
- **TDD**：每个行为先看失败再实现（Iron Law）；Biome 绿；单测从 apps/web cwd 或 repo root 按既有约定跑。
- **append-only**：不改 video-document schema（narrationText 已存在）；旁白资产为旁置文件，不进项目 JSON。
- **SSE 解码**：音频 base64 必须逐 chunk 解码后 Buffer.concat（拼接后一次性解码会错位，spike 实证）。

## Review Focus（本刀测试没覆盖、最容易咬人的五类输入）

1. narrationText 为空的镜头 → 跳过合成（不产空 wav、不调 API、不记费），渲染时该镜头无音轨。
2. narrationText 超长（>2000 字符上限或单次请求超限）→ 明确拒绝并点名镜头，不发起计费调用。
3. 合成音频时长 > 镜头量化帧时长 → 音轨按镜头 span 截断（Sequence durationInFrames），CLI 打印溢出警告（如实告知截断）。
4. API 失败/非 200/限流 → fail-fast 不写半截资产；request 级重试不自动做（成本可控原则），错误信息含 request_id 与 HTTP 状态。
5. Remotion `<Audio src>` 绝对路径在 CLI 渲染的可用性 → Task 4 首步 1 帧探针验证；不可用则回退 base64 data URI 进 props（资产 ≤8 镜头 × ~300KB，可承受）。

---

### Task 1: 规划器分镜旁白文本（narrationText 落档）

**Files:**
- Modify: `apps/web/src/app/video-studio/planner.ts`
- Modify: `apps/web/src/app/video-studio/apply-plan.ts`
- Test: `apps/web/src/app/video-studio/planner.test.ts`、`apply-plan.test.ts`

**Interfaces:**
- Produces: `StoryboardShot` 增 `narrationText: string`；`applyStoryboard` 落入 `ContentVersion.narrationText`（后续 Task 2 以 working version 的 narrationText 为合成输入）。

- [ ] **Step 1: 写失败测试**（planner.test.ts +1）：分镜规划 4 镜头，断言各 shot.narrationText 非空且诚实对应可见文本：开场=`水循环`（title 本身），结语=`谢谢观看`，中镜头为镜头可见文案（要点 N/示意 N 模板句）。
- [ ] **Step 2: 跑测试看失败**（`node --import tsx --test src/app/video-studio/planner.test.ts` from apps/web）：期望 narrationText 断言 not ok（字段缺失）。
- [ ] **Step 3: 实现**：planner.ts 每个 shot 构造 narrationText（= 该镜头画面实际展示的朗读文本，取自已有 title/label 事实，不虚构）；apply-plan.ts 写入 ContentVersion.narrationText（替换现有空串占位）。
- [ ] **Step 4: apply-plan.test.ts +1**：断言应用后 shots[].contentVersions[0].narrationText 与 storyboard 一致（RED 同步先看）。
- [ ] **Step 5: 全 web 套件跑绿 + 提交** `feat(video-studio): 分镜旁白文本落档 narrationText`。

### Task 2: TTS 客户端（SSE 解析纯函数 + 合成 CLI + 计费台账）

**Files:**
- Create: `scripts/video/tts-sse.ts`（不行——scripts 用 mjs）→ `scripts/video/tts-sse.mjs`（纯函数：parseTtsSse(text) → {requestId, audioChunks: Buffer[], sentences: [{index, words:[…]}], usage}；estimateTtsCostCny(characters, model)；buildNarrationJobs(project) → [{shotIndex, shotId, versionId, text}]，空 text 过滤、超长>2000 拒绝 throw 点名镜头）
- Create: `scripts/video/tts-narration.mjs`（CLI：--project --out [--voice longanyang] [--model cosyvoice-v3-flash]；env DASHSCOPE_API_KEY；逐镜头流式合成 → `<out>/<shotId>-<versionId>.wav` + `.words.json`（句/字时间戳原样存盘）；usage append `artifacts/tts-usage.jsonl`）
- Test: `scripts/video/tts-sse.test.mjs`（合成小 fixture 镜像真实 SSE 事件形态：sentence-begin 带 words、sentence-synthesis 带 base64 audio、sentence-end、usage；单测零网络）

**Interfaces:**
- Consumes: Task 1 的 narrationText（working version）。
- Produces: `parseTtsCostCny`、`buildNarrationJobs`、`parseTtsSse`（Task 4/5 与台账复用）；资产命名约定 `<shotId>-<versionId>.wav|.words.json`（Task 4 消费）。

- [ ] **Step 1: 写失败测试** tts-sse.test.mjs：① parseTtsSse 解析合成 fixture（2 synthesis chunk + begin/end）→ audio 拼接字节正确（逐 chunk 解码）、words 时间戳结构保留、usage 提取；② estimateTtsCostCny(34, "cosyvoice-v3-flash") === 0.0034（¥1/万字符，汉字=2 计费字符由服务端 usage 为准——估算仅供台账预算 sanity）；③ buildNarrationJobs：空 narrationText 镜头被过滤、无镜头项目 throw、>2000 字符 throw 点名镜头索引。
- [ ] **Step 2: 跑失败**（`node --test scripts/video/tts-sse.test.mjs`）：module not found。
- [ ] **Step 3: 实现** tts-sse.mjs（SSE 手解析：`data:` 行 JSON.parse，audio.data 逐 chunk Buffer.from 后收集；容错非 JSON 行）+ tts-narration.mjs（fetch SSE：X-DashScope-SSE: enable + word_timestamp_enabled: true 入 input；非 200 → 抛含状态与 request_id；wav 落盘前先完整合成；words.json 含 request_id/model/voice/usage/sentences）。
- [ ] **Step 4: 跑绿 + 手工冒烟（计费，预计 ≤¥0.01）**：对 artifacts/video-studio-multishot/e2e.video-project.json 跑 CLI（env key 由会话注入），核对 wav 时长=words 末字 end_time（spike 同口径）、.words.json 结构、tts-usage.jsonl 追加两行。
- [ ] **Step 5: 提交** `feat(video): DashScope TTS 旁白合成 CLI 与字级时间戳解析`。

### Task 3: Timeline 合成音频轨（remotion-engine）

**Files:**
- Modify: `packages/remotion-engine/src/scene-spec-composition.tsx`（TimelineShotProps 增可选 `narration?: {audioSrc: string}`；TimelineScene 内 `<Sequence from={startFrame} durationInFrames={frames}><Audio src={audioSrc} /></Sequence>`，无 narration 不渲染 Sequence）
- Modify: `packages/remotion-engine/src/root.tsx`（defaultProps 不变；calculateMetadata 不变）

**Interfaces:**
- Produces: shots[].narration.audioSrc（Task 4 装配绝对路径；探针失败则 data URI）。

- [ ] **Step 1: typecheck**（`pnpm --filter @acs/remotion-engine typecheck`）——本包无组件测试基建，行为由 Task 4 探针 + Task 5 E2E 覆盖（与 P1 Task 4 同裁决）。
- [ ] **Step 2: 提交** `feat(remotion-engine): Timeline 合成镜头旁白音轨`。

### Task 4: render-scene 装配旁白 + 音轨探针与核对

**Files:**
- Modify: `scripts/video/render-scene.mjs`（`--narration <dir>`：按 shotId-versionId 找 wav，缺文件=该镜头无旁白（打印提示）；props 注入 narration.audioSrc=绝对路径；ffprobe 核对增 audio 流 aac 存在 + duration 与视频一致 ±0.1s；溢出镜头（wav 时长 > span/fps）打印截断警告；manifest.aspects[aspect].narration = [{shotIndex, versionId, audioBytes, durationMs, wordsFile}]）
- Test: `scripts/video/render-scene.narration.test.mjs`（纯函数：buildNarrationEntries(project, dir, timeline) → 装配/缺失/溢出警告逻辑，不跑 Remotion）

**Interfaces:**
- Consumes: Task 2 资产命名约定；Task 3 narration props。
- Produces: `--narration` 出片路径（Task 5 E2E）；manifest.narration（证据）。

- [ ] **Step 1: 写失败测试**（buildNarrationEntries：3 镜头项目+旁置目录 2 个 wav → 2 entries + 1 缺失提示；wav 时长超 span → overflow 标记；span 换算 ms 用帧数/fps）。
- [ ] **Step 2: 失败 → 实现 → 绿**。
- [ ] **Step 3: 探针（Review Focus #5，本地渲染零计费）**：1 镜头迷你项目 + spike wav（本机已有）渲染 6 帧，验证绝对路径 `<Audio src>` 出片成功且 mp4 含 aac 流；失败则改 data URI 方案并记录 Ruling。
- [ ] **Step 4: 真实出片冒烟**：对 e2e 项目全量 `--narration` 出片，ffprobe 双画幅 aac/时长核对，**并重跑一次不带 --narration 的渲染抽帧对比视频帧逐像素一致**（确定性 Global Constraint）。
- [ ] **Step 5: 提交** `feat(video): 整片出片装配旁白音轨与逐镜头时间戳档案`。

### Task 5: 端到端有声闭环 + 收口证据

**Files:**
- Create: `scripts/video/e2e-narrated.mjs`（工作台分镜（含旁白文本在镜头卡可见）→ 保存导出 → tts-narration CLI（计费 ~34×4 字符 ≈ ¥0.03）→ render-scene --narration → ffprobe aac + duration → 浏览器导入回显；控制台零 error；SHA-256 + usage 台账打印）
- Modify: `qa/registry.json`（VID-010 automated: tts-sse 单测；VID-011 manual: 有声闭环）
- Create: `artifacts/video-studio-narrated/E2E_NARRATED.md`（含计费台账逐笔表）
- Modify: `AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md`

- [ ] **Step 1: E2E 脚本 + 跑通**（BASE_URL :3210；计费金额入台账）。
- [ ] **Step 2: 证据 md（SHA-256 表 + 计费逐笔 + 可复核性声明：媒体/音频本地不入库）+ registry + CURRENT_STATE。**
- [ ] **Step 3: 全量回归**（lint/typecheck/包与 web/scripts 测试/qa:validate/qa:video-determinism/e2e-closed-loop/e2e-multishot/e2e-narrated）。
- [ ] **Step 4: 提交** `feat(video-studio): 有声多镜头端到端闭环与 D2 第一刀收口证据` 并 push origin worktree-video-studio-p1。
