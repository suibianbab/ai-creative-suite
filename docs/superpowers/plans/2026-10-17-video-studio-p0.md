# Video Studio P0 实施计划（平台脊柱 + 单场景出片闭环）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一句话生成 10–15 秒单场景文字/线描动画：分镜 JSON 与场景源可保存重开，横竖版 MP4 导出，同输入集双渲染解码帧一致（确定性 fitness function）。

**Architecture:** 三个新层次——`@acs/video-document`（ADR 0003 的纯 TS 文档模型：内容版本/事件/渲染记录三分 + 边界量化）；`@acs/video-scene`（声明式 scene_spec + 版本化组件注册表，组件是 (spec, frame) → SVG 描述树的纯函数，无 React 依赖）；渲染由 remotion-engine 的通用 `SceneSpec` Composition 承接（组件描述树 → React SVG），CLI 脚本出片与确定性校验。Web 工作台本地优先（IndexedDB 不可变文档版本，复用 image-studio local-projects 模式）。

**Tech Stack:** TypeScript strict、node:test（tsc 编译到 dist 后 `node --test dist/*.test.js`）、React 19.2、Remotion 4.0.534（版本锁定，禁止升级）、pnpm workspace、IndexedDB、FFmpeg/ffprobe（已装）。

**Spec:** `docs/adr/0003-video-studio-shot-schema.md`（数据契约，accepted）+ `docs/VIDEO_STUDIO_ALIGNMENT_REVIEW_2026-10-17.md`（P0 范围与验收）。执行者必须先读 ADR 0003 全文。

## Global Constraints

- Remotion 固定 `4.0.534`，React 固定 `19.2.0`；不新增其他运行时依赖（node:crypto/node:test/内置模块除外）。
- ADR 0003 不变量：禁止逐镜头取整（只能累计边界取整）；零帧镜头导出拒绝；事件只追加；内容版本不可变；交付钉住显式版本；`approved_version` 由事件推导不落库；锁定镜头拒绝 AI 改写、人工改写留审计事件。
- 渲染上下文禁网络、禁墙钟、禁未播种随机；随机只用 `seededRandom(spec.seed)`。
- 字体自托管：`packages/remotion-engine/assets/fonts/NotoSansSC-Regular.woff2`（OFL 许可，sha256 记录进渲染 manifest）；不加载任何 CDN。
- 组件渲染输入只有 `(spec, FrameContext)`；FrameContext 由渲染器注入（frame/fps/durationFrames/width/height/random）。
- 包结构照抄 `packages/image-document`：`package.json`（`@acs/video-*`、type: module、main/exports 指向 dist、`test: node --test dist/*.test.js`）+ `tsconfig.json`（直接复制 image-document 的改包名）。不要猜 tsconfig 内容，复制后改。
- 校验风格照抄 `image-project-store.ts`：手写 `isRecord` + 逐字段校验，不用 zod。
- Web UI 文案中文；所有用户可见错误给可操作提示。
- 提交信息格式 `feat(video-studio): ...`，结尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`；每个 Task 至少一个提交。
- `pnpm lint`（biome）与 `pnpm typecheck` 在每个任务收尾必须通过。
- 不改动 image-studio / photocraft 任何现有文件（工作区有未提交的 PhotoCraft 改动，不得混入本计划提交）。

## Review Focus

1. **极短镜头零帧**：3×1ms@24fps 边界全 0 → `quantizeTimeline` 必须抛 `ZeroFrameShotError`（含 shotIndex），不许静默丢或补帧 → Task 2 测试钉死。
2. **跨 fps 漂移累积**：30×1100ms 在 24/30fps 下总长都必须是 33.0s±1 帧 → Task 2 测试钉死（逐镜头取整会得到 32.5s，必须失败路径）。
3. **渲染不确定**（未播种随机、字体变化、容器元数据差异被误判为画面差异）：确定性校验比较 PNG 序列逐帧哈希（解码帧），不做容器字节比较 → Task 7。
4. **锁定镜头被 AI 改写**：`addCandidateVersion` 在 locked=true 时必须拒绝 → Task 3。
5. **指针失效**：`workingVersionId` 指向不存在的版本、或回滚后旧交付引用被破坏 → `validateVideoProject` 校验指针存在性；Task 3 测试回滚后 delivery 不变。

---

### Task 1: `@acs/video-document` 包骨架 + VideoProject v1 类型与校验

**Files:**
- Create: `packages/video-document/package.json`、`packages/video-document/tsconfig.json`（复制 `packages/image-document/` 同名文件，包名改 `@acs/video-document`）
- Create: `packages/video-document/src/types.ts`、`src/validate.ts`、`src/canonical-json.ts`、`src/index.ts`
- Test: `packages/video-document/src/validate.test.ts`

**Interfaces（后续任务依赖）:**
- Produces: 类型 `VideoProject`、`Shot`、`ContentVersion`、`ShotEvent`、`RenderRecord`、`DeliveryRecord`、`SceneSource`；`validateVideoProject(value: unknown): VideoProject`（非法抛 `VideoProjectValidationError`）；`canonicalJson(value: unknown): string`（键排序稳定序列化，供内容摘要用）；常量 `VIDEO_PROJECT_MAX_BYTES = 2 * 1024 * 1024`。

- [ ] **Step 1: 建 `src/types.ts`（ADR 0003 §1 的直接翻译）**

```ts
export type ShotStatus = "draft" | "candidate" | "approved";

export type SceneSource =
  | { type: "spec"; spec: unknown }
  | { type: "editor-binding"; engineId: string; engineVersion: string; assetId: string };

export type ContentVersion = {
  versionId: string;          // uuid
  createdAt: string;          // ISO 8601
  durationMs: number;         // 正整数
  description: string;        // 1..200 字符
  narrationText: string;      // 0..2000 字符
  sceneSource: SceneSource;
  provenance: {
    engineId: string;
    engineVersion: string;
    parentVersionId?: string;   // 重做链
    lineageParents?: string[];  // 拆分/合并父镜头
  };
};

export type ShotEvent =
  | { kind: "submitted"; versionId: string; at: string; actor: "ai" | "human" }
  | { kind: "approved"; versionId: string; at: string; actor: "human" }
  | { kind: "lock-changed"; locked: boolean; at: string; actor: "human" }
  | { kind: "audit"; note: string; at: string; actor: "human" };

export type Shot = {
  shotId: string;
  order: number;
  locked: boolean;
  workingVersionId: string;   // 指针存在性由 validate 校验
  contentVersions: ContentVersion[];
  events: ShotEvent[];
};

export type RenderRecord = {
  renderId: string;
  versionId: string;
  contentDigest: string;      // canonicalJson(contentVersion) 的 sha256，由渲染脚本写入
  engineId: string; engineVersion: string; rendererVersion: string;
  fps: number; width: number; height: number; codec: string;
  frames: number;
  fontDigests: Record<string, string>;
  outputAssetRef: string;     // 本地 P0 为输出文件相对路径
};

export type DeliveryRecord = {
  deliveryId: string; at: string;
  versionIds: string[]; renderIds: string[]; frameMap: number[];
};

export type AspectTarget = "landscape" | "portrait";

export type VideoProject = {
  schemaVersion: 1;
  id: string; title: string;
  brief: { sentence: string; aspectTargets: AspectTarget[] };
  shots: Shot[];
  renderRecords: RenderRecord[];
  deliveries: DeliveryRecord[];
  savedVersion: number;       // 文档版本，乐观并发用
};
```

- [ ] **Step 2: 写失败测试 `src/validate.test.ts`**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { validateVideoProject, type VideoProject } from "./validate.js";

const UUID = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b1001";
function baseProject(): VideoProject {
  const versionId = UUID;
  return {
    schemaVersion: 1, id: UUID, title: "p0", savedVersion: 1,
    brief: { sentence: "做一个12秒的文字动画，标题是云制作", aspectTargets: ["landscape", "portrait"] },
    shots: [{
      shotId: UUID, order: 0, locked: false, workingVersionId: versionId,
      contentVersions: [{ versionId, createdAt: "2026-10-17T00:00:00.000Z", durationMs: 12000,
        description: "文字动画", narrationText: "",
        sceneSource: { type: "spec", spec: { specVersion: 1, componentId: "text-animation", componentVersion: 1, durationMs: 12000, seed: 1, background: "#ffffff", params: { title: "云制作" } } },
        provenance: { engineId: "html-gsap", engineVersion: "0" } }],
      events: [{ kind: "submitted", versionId, at: "2026-10-17T00:00:00.000Z", actor: "human" }],
    }],
    renderRecords: [], deliveries: [],
  };
}

test("合法项目通过并原样返回", () => {
  const p = baseProject();
  assert.equal(validateVideoProject(p).id, p.id);
});
test("workingVersionId 指向不存在版本则拒绝", () => {
  const p = baseProject();
  p.shots[0].workingVersionId = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b1999";
  assert.throws(() => validateVideoProject(p), /working/);
});
test("durationMs 非正整数拒绝", () => {
  const p = baseProject();
  p.shots[0].contentVersions[0].durationMs = 12.5;
  assert.throws(() => validateVideoProject(p), /durationMs/);
});
test("事件引用不存在的版本拒绝", () => {
  const p = baseProject();
  p.shots[0].events.push({ kind: "approved", versionId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b1999", at: "2026-10-17T00:00:00.000Z", actor: "human" });
  assert.throws(() => validateVideoProject(p), /versionId/);
});
test("approved 事件 actor 不允许 ai", () => {
  const p = baseProject();
  (p.shots[0].events[0] as { actor: string }).actor = "ai";
  p.shots[0].events.push({ kind: "approved", versionId: UUID, at: "2026-10-17T00:00:00.000Z", actor: "human" });
  // submitted actor=ai 合法；再构造 approved actor=ai
  p.shots[0].events[1] = { ...p.shots[0].events[1], actor: "ai" } as never;
  assert.throws(() => validateVideoProject(p), /actor/);
});
```

- [ ] **Step 3: 运行确认失败** — `pnpm --filter @acs/video-document build && pnpm --filter @acs/video-document test`（先会因文件不存在失败，属预期）

- [ ] **Step 4: 实现 `src/validate.ts`（照抄 image-project-store.ts 手写校验风格）**

要点（完整实现按测试驱动补齐）：`isRecord` 助手；schemaVersion===1；UUID 正则同 image-project-store（`/^[0-9a-f]{8}-...$/i`）；`JSON.stringify` 后字节数 ≤ `VIDEO_PROJECT_MAX_BYTES`；每镜头：`workingVersionId` 必须 ∈ contentVersions 的 versionId；每事件 versionId（submitted/approved）必须存在；approved 事件 `actor === "human"`；durationMs 正整数 ≤ 600000；title 1..200 字符；aspectTargets 非空且去重；events/contentVersions 数组长度 ≤ 1000。错误消息含被检字段名（测试用正则匹配）。

```ts
// src/canonical-json.ts —— 稳定序列化：对象键排序，数组保序
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
```

`src/index.ts` 导出全部公共符号。`validate.ts` 顶部 `export class VideoProjectValidationError extends Error {}`。

- [ ] **Step 5: 测试通过 + lint/typecheck** — `pnpm --filter @acs/video-document test`、`pnpm lint`、`pnpm typecheck` 全绿
- [ ] **Step 6: 提交** — `git add packages/video-document && git commit -m "feat(video-studio): VideoProject 文档模型与校验（ADR 0003 三分契约）" `（结尾带 Co-Authored-By 行）

---

### Task 2: 时间轴量化 `quantizeTimeline`（累计边界取整 + 零帧拒绝）

**Files:**
- Create: `packages/video-document/src/quantize.ts`
- Test: `packages/video-document/src/quantize.test.ts`（index.ts 增加导出）

**Interfaces:**
- Consumes: 无（纯函数）
- Produces:

```ts
export class ZeroFrameShotError extends Error {
  constructor(public readonly shotIndex: number) { super(`第 ${shotIndex + 1} 个镜头在该帧率下为零帧：请加长时长或与相邻镜头合并`); }
}
export function roundHalfUp(x: number): number;
export function quantizeTimeline(durationsMs: number[], fps: number): {
  shots: Array<{ shotIndex: number; startFrame: number; frames: number }>;
  totalFrames: number;
};
```

- [ ] **Step 1: 失败测试（含 Review Focus 1、2 的两个用例）**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { quantizeTimeline, ZeroFrameShotError } from "./quantize.js";

test("30×1100ms 在 24fps 总长恰为 792 帧（33.0s），30fps 恰为 990 帧", () => {
  const durations = Array.from({ length: 30 }, () => 1100);
  assert.equal(quantizeTimeline(durations, 24).totalFrames, 792);
  assert.equal(quantizeTimeline(durations, 30).totalFrames, 990);
  const q = quantizeTimeline(durations, 24);
  // 边界取整的真实分布：792 = 18×26 + 12×27。
  // 逐镜头取整（每镜 round(26.4)=26）会得到 780 帧且不含 27 帧镜头——两个断言都排除该失败路径
  assert.equal(q.shots.filter((s) => s.frames === 27).length, 12);
  assert.equal(q.shots.filter((s) => s.frames === 26).length, 18);
});
test("每个切点距理想位置 ≤ 半帧", () => {
  const durations = [1100, 900, 2500, 400];
  const q = quantizeTimeline(durations, 24);
  let acc = 0;
  q.shots.forEach((s, i) => { acc += durations[i]; assert.ok(Math.abs(s.startFrame + s.frames - (acc * 24) / 1000) <= 0.5 + 1e-9); });
});
test("三个 1ms 镜头在 24fps 下抛 ZeroFrameShotError", () => {
  assert.throws(() => quantizeTimeline([1, 1, 1], 24), ZeroFrameShotError);
});
test("1100ms×30 在 24fps 下任意镜头不为 0 帧", () => {
  const q = quantizeTimeline(Array.from({ length: 30 }, () => 1100), 24);
  assert.ok(q.shots.every((s) => s.frames >= 1));
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**

```ts
export function roundHalfUp(x: number): number { return Math.floor(x + 0.5); }

export function quantizeTimeline(durationsMs: number[], fps: number) {
  if (!Array.isArray(durationsMs) || durationsMs.length === 0) throw new Error("durationsMs 不能为空");
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("fps 必须为正数");
  const boundary = [0];
  let cumulative = 0;
  durationsMs.forEach((d, i) => {
    if (!Number.isInteger(d) || d <= 0) throw new Error(`durationMs[${i}] 必须为正整数`);
    cumulative += d;
    boundary.push(roundHalfUp((cumulative * fps) / 1000));   // 累计边界取整，ADR 0003 §3.5
  });
  const shots = durationsMs.map((_, i) => {
    const frames = boundary[i + 1] - boundary[i];
    if (frames <= 0) throw new ZeroFrameShotError(i);        // 拒绝零帧镜头，不补帧不丢弃
    return { shotIndex: i, startFrame: boundary[i], frames };
  });
  return { shots, totalFrames: boundary[boundary.length - 1] };
}
```

- [ ] **Step 4: 测试通过 + lint/typecheck**
- [ ] **Step 5: 提交** — `feat(video-studio): 累计边界帧量化与零帧镜头拒绝`

---

### Task 3: 状态推导与指针操作（事件模型 + working/approved 语义）

**Files:**
- Create: `packages/video-document/src/events.ts`、`src/operations.ts`
- Test: `packages/video-document/src/events.test.ts`、`src/operations.test.ts`（index.ts 增加导出）

**Interfaces:**
- Consumes: Task 1 类型
- Produces:

```ts
// events.ts
export function deriveStatus(events: ShotEvent[], versionId: string): ShotStatus;      // 最新 submitted→candidate；其后有 approved→approved；从未 submitted→draft
export function approvedVersionId(events: ShotEvent[]): string | null;                  // 最新 approved 事件的 versionId
// operations.ts —— 全部纯函数，返回新 VideoProject，不修改入参
export function addCandidateVersion(p: VideoProject, shotId: string, version: ContentVersion): VideoProject;  // locked→抛 ShotLockedError；追加版本+submitted(ai) 事件，workingVersionId 指向新版本
export function approveVersion(p: VideoProject, shotId: string, versionId: string): VideoProject;             // 追加 approved(human) 事件
export function setLocked(p: VideoProject, shotId: string, locked: boolean): VideoProject;                    // 追加 lock-changed(human)
export function rollbackWorkingVersion(p: VideoProject, shotId: string, versionId: string): VideoProject;     // 指针指回旧版本；locked 镜头仍允许（人工路径），追加 audit 事件
export class ShotLockedError extends Error {}
```

- [ ] **Step 1: 失败测试**

```ts
// events.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { deriveStatus, approvedVersionId } from "./events.js";
const A = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b1001", B = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b1002";
const at = "2026-10-17T00:00:00.000Z";
test("未 submitted 为 draft；submitted 为 candidate；approved 后为 approved", () => {
  assert.equal(deriveStatus([], A), "draft");
  assert.equal(deriveStatus([{ kind: "submitted", versionId: A, at, actor: "ai" }], A), "candidate");
  const ev = [{ kind: "submitted", versionId: A, at, actor: "ai" } as const, { kind: "approved", versionId: A, at, actor: "human" } as const];
  assert.equal(deriveStatus(ev as never, A), "approved");
});
test("重做后旧版本仍是 approved，新版本是 candidate", () => {
  const ev = [
    { kind: "submitted", versionId: A, at, actor: "ai" },
    { kind: "approved", versionId: A, at, actor: "human" },
    { kind: "submitted", versionId: B, at, actor: "ai" },
  ] as never;
  assert.equal(deriveStatus(ev as never, A), "approved");
  assert.equal(deriveStatus(ev as never, B), "candidate");
  assert.equal(approvedVersionId(ev as never), A);
});
```

```ts
// operations.test.ts（复用 Task 1 的 baseProject 构造，复制到本文件）
test("锁定镜头拒绝 AI 重生成", () => {
  let p = setLocked(baseProject(), baseProject().shots[0].shotId, true);
  const v2 = { ...p.shots[0].contentVersions[0], versionId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b1002" };
  assert.throws(() => addCandidateVersion(p, p.shots[0].shotId, v2), ShotLockedError);
});
test("回滚 working 版本保留历史且旧 delivery 不变", () => {
  let p = baseProject();
  const v2 = { ...p.shots[0].contentVersions[0], versionId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b1002" };
  p = addCandidateVersion(p, p.shots[0].shotId, v2);
  p = { ...p, deliveries: [{ deliveryId: "d1", at: at, versionIds: [p.shots[0].contentVersions[0].versionId], renderIds: [], frameMap: [288] }] };
  const rolled = rollbackWorkingVersion(rolled0(p), p.shots[0].shotId, p.shots[0].contentVersions[0].versionId);
  assert.equal(rolled.shots[0].workingVersionId, rolled.shots[0].contentVersions[0].versionId);
  assert.equal(rolled.deliveries.length, 1);
  assert.equal(rolled.shots[0].contentVersions.length, 2); // 历史不丢
});
```

（注：测试里 `rolled0` 无需特殊构造，直接传 `p`；上面为笔误预防——执行时按直接传 `p` 写。）

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** — `deriveStatus`：过滤出引用该 versionId 的 submitted/approved 事件按序扫描；`operations.ts`：结构共享浅拷贝（`{...p, shots: p.shots.map(...)}`），事件 at 取调用方传入或 `new Date().toISOString()`（仅入参不带时间时；测试传固定 at），`rollbackWorkingVersion` 追加 `{kind:"audit", note:"回滚工作版本", actor:"human"}`。全部操作收尾跑 `validateVideoProject` 保证不变量。
- [ ] **Step 4: 测试通过 + lint/typecheck**
- [ ] **Step 5: 提交** — `feat(video-studio): 事件状态推导与版本指针操作`

---

### Task 4: `@acs/video-scene` 包：scene_spec 校验 + 组件注册表 + 播种随机

**Files:**
- Create: `packages/video-scene/package.json`、`tsconfig.json`（复制 video-document 的改包名）、`src/spec.ts`、`src/registry.ts`、`src/random.ts`、`src/svg.ts`、`src/index.ts`
- Test: `src/spec.test.ts`、`src/random.test.ts`

**Interfaces:**
- Produces:

```ts
// svg.ts —— 组件输出纯数据 SVG 树（无 React），预览与 Remotion 各自渲染
export type SvgNode = { tag: string; attrs: Record<string, string | number>; children?: SvgNode[]; text?: string };
// spec.ts
export type SceneSpec = {
  specVersion: 1; componentId: string; componentVersion: number;
  durationMs: number; seed: number; background: string; params: unknown;
};
export const MAX_SPEC_BYTES = 256 * 1024;
export function validateSceneSpec(value: unknown, registry: SceneRegistry): SceneSpec; // 未知 componentId/version 抛错；字节上限；durationMs 正整数
// registry.ts
export type FrameContext = { frame: number; fps: number; durationFrames: number; width: number; height: number; random: () => number };
export type SceneComponent = {
  componentId: string; version: number;
  validateParams(value: unknown): unknown;               // 每组件自己校验 params
  render(spec: SceneSpec, ctx: FrameContext): SvgNode;   // 纯函数：同一 (spec, ctx) 必须返回深度相等的结果
};
export type SceneRegistry = { get(componentId: string, version: number): SceneComponent; list(): SceneComponent[]; version: number };
export function createRegistry(components: SceneComponent[], registryVersion: number): SceneRegistry;
// random.ts
export function seededRandom(seed: number): () => number;  // mulberry32；同 seed 同序列
```

- [ ] **Step 1: 失败测试** — `spec.test.ts`：合法 spec 通过；`componentId: "nope"` 拒绝；`componentVersion: 99` 拒绝（注册表只有 version 1 的 stub 组件）；spec JSON 超 `MAX_SPEC_BYTES` 拒绝（构造大 params 字符串）；`background` 非 `#rrggbb` 拒绝；`seed` 非整数拒绝。`random.test.ts`：`seededRandom(7)()` 两次调用序列完全一致且 ∈[0,1)。
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**（校验风格同 Task 1；`random.ts` 用 mulberry32 标准实现）
- [ ] **Step 4: 测试通过 + lint/typecheck**
- [ ] **Step 5: 提交** — `feat(video-studio): scene_spec 校验、组件注册表与播种随机`

---

### Task 5: 三个 v1 场景组件（text-animation / line-drawing / basic-shapes）

**Files:**
- Create: `packages/video-scene/src/components/text-animation.ts`、`line-drawing.ts`、`basic-shapes.ts`、`src/easing.ts`、`src/default-registry.ts`
- Test: `src/components/text-animation.test.ts`、`line-drawing.test.ts`、`basic-shapes.test.ts`（index.ts 导出 `defaultRegistry` 与 `defineComponent`）

**Interfaces:**
- Consumes: Task 4 的 `SceneComponent`/`FrameContext`/`SvgNode`、`seededRandom`
- Produces: `defineComponent(c: SceneComponent): SceneComponent`；`defaultRegistry: SceneRegistry`（registryVersion 1，含三组件，全部 version 1）；`easeOutCubic(t: number): number`

组件契约（三份相同）：`render(spec, ctx)` 只读 spec 与 ctx；时间统一用 `tMs = (ctx.frame / ctx.fps) * 1000`；布局按 `ctx.width/height` 等比缩放（横竖版同一 spec 可渲染，竖版居中——P0 不做重排版，验收口径「横竖版分别检查」由样片人工审）。

- [ ] **Step 1: `easing.ts` + text-animation 失败测试**

```ts
// text-animation.test.ts 核心断言（其余按此风格补齐）
test("标题 0 帧时不可见（入场前），第 1 秒完全可见", () => {
  const spec = validSpec({ componentId: "text-animation", params: { title: "云制作", titleColor: "#111111", entrance: "fade-up", enterMs: 800 } });
  const ctx0 = ctx({ frame: 0 }); const ctx24 = ctx({ frame: 24 });
  assert.equal(opacity(renderNode(spec, ctx0, "title")), 0);
  assert.equal(opacity(renderNode(spec, ctx24, "title")), 1);
});
test("同 (spec, ctx) 两次渲染深度相等（纯函数）", () => {
  const spec = validSpec({});
  assert.deepEqual(render(spec, ctx({ frame: 12 })), render(spec, ctx({ frame: 12 })));
});
```

- [ ] **Step 2: 实现** — `text-animation`：params `{ title: string(1..80); subtitle?: string; titleColor/subtitleColor: #hex; entrance: "fade-up"|"scale-in"; enterMs: 200..3000 }`；输出 `<rect 背景>` + `<text title>` +（可选）`<text subtitle>`；fade-up = opacity·easeOutCubic + translateY(40→0px 按 ctx.height 比例)；scale-in = scale 0.8→1。副标题延迟 400ms。字号 = height/8（title）、height/14（subtitle），text-anchor middle，x=width/2。`line-drawing`：params `{ paths: string[](1..8 条 SVG path d)；strokeColor；strokeWidth: 1..20；revealMs: 500..10000 }`；每条 path 输出 `pathLength=1` + `stroke-dasharray=1` + `stroke-dashoffset = 1 - clamp(tMs/revealMs)`，easeOutCubic。`basic-shapes`：params `{ shapes: {kind:"rect"|"circle"|"triangle"; x,y,w,h: 0..1(归一化)；color；delayMs；enterMs}[](1..24) }`；每形状 opacity·scale 入场；triangle 用 polygon 点计算（纯数学）。每个组件 `validateParams` 手写全字段校验。`default-registry.ts`：`createRegistry([textAnimation, lineDrawing, basicShapes], 1)`。
- [ ] **Step 3: 三份组件测试通过（含纯函数断言：dashoffset 单调、形状顶点计算、参数校验拒绝负值/超界）+ lint/typecheck**
- [ ] **Step 4: 提交** — `feat(video-studio): 文字/线描/基础图形三个声明式场景组件`

---

### Task 6: remotion-engine 通用 SceneSpec Composition + 字体 + 出片脚本

**Files:**
- Create: `packages/remotion-engine/src/scene-spec-composition.tsx`、`packages/remotion-engine/assets/fonts/NotoSansSC-Regular.woff2`（下载）、`scripts/video/render-scene.mjs`
- Modify: `packages/remotion-engine/src/root.tsx`（追加两个 Composition）、`packages/remotion-engine/package.json`（deps 加 `"@acs/video-scene": "workspace:*"`）
- Test: 无浏览器单测；验收靠 Task 7 确定性脚本 + Task 10 样片

**Interfaces:**
- Consumes: Task 4/5 的 `defaultRegistry`、`validateSceneSpec`、`quantizeTimeline`（单镜头 `durationsMs=[spec.durationMs]`）
- Produces: Composition `SceneSpec-Landscape`（1280×720@24）与 `SceneSpec-Portrait`（720×1280@24），props `{ spec: SceneSpec }`；脚本用法 `node scripts/video/render-scene.mjs --project <path.json> --out <dir>` → 产出 `landscape.mp4`、`portrait.mp4`、`render-manifest.json`

- [ ] **Step 1: 下载字体并记录指纹** — 从 Google Fonts 静态资源下载 Noto Sans SC Regular（woff2，OFL），放入上述路径；`sha256sum` 记录输出值（Task 7 manifest 要用）；确认 < 8MB
- [ ] **Step 2: 写 `scene-spec-composition.tsx`**

```tsx
import { useEffect, useState } from "react";
import { AbsoluteFill, useVideoConfig, useCurrentFrame } from "remotion";
import { defaultRegistry, validateSceneSpec, seededRandom, type SceneSpec, type SvgNode } from "@acs/video-scene";
import fontCss from "./assets/fonts/font.css"; // 内容：@font-face { font-family: NotoSansSC; src: url("./NotoSansSC-Regular.woff2") format("woff2"); }

export function SvgTree({ node }: { node: SvgNode }) {
  return <node.tag {...(node.attrs as Record<string, string>)}>{node.text ?? node.children?.map((c, i) => <SvgTree key={i} node={c} />)}</node.tag>;
}

export const SceneSpecScene: React.FC<{ spec: SceneSpec }> = ({ spec }) => {
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();
  const component = defaultRegistry.get(spec.componentId, spec.componentVersion);
  const node = component.render(spec, { frame, fps, durationFrames: durationInFrames, width, height, random: seededRandom(spec.seed) });
  return <AbsoluteFill style={{ backgroundColor: spec.background }}><SvgTree node={node} /></AbsoluteFill>;
};
```

root.tsx 追加（`calculateMetadata` 按 spec 算帧数，quantize 用 Task 2 函数、fps 24）：

```tsx
import { SceneSpecScene } from "./scene-spec-composition";
// calculateMetadata 公共函数：
const sceneMeta = { fps: 24, calculateMetadata: ({ props }) => ({ durationInFrames: quantizeTimeline([props.spec.durationMs], 24).totalFrames }) };
<Composition id="SceneSpec-Landscape" component={SceneSpecScene} width={1280} height={720} {...sceneMeta} defaultProps={{ spec: undefined }} />
<Composition id="SceneSpec-Portrait" component={SceneSpecScene} width={720} height={1280} {...sceneMeta} defaultProps={{ spec: undefined }} />
```

- [ ] **Step 3: 写 `scripts/video/render-scene.mjs`** — 读项目 JSON → `validateVideoProject` → 取（P0 单镜头）working version 的 spec（`validateSceneSpec`）→ 对每个 aspectTarget：`pnpm --filter @acs/remotion-engine exec remotion render <CompositionId> <out.mp4> --props=<tmp json>`（Chrome 路径不存在时加 `--chrome-executable="C:/Program Files/Google/Chrome/Application/chrome.exe"`，与 render_form01.py 同款回退）→ ffprobe 校验 width/height/fps/duration → 写 `render-manifest.json`：`{ specDigest: sha256(canonicalJson(spec)), registryVersion: 1, componentId/Version, remotion: "4.0.534", fontDigests: { "NotoSansSC-Regular.woff2": <sha256> }, fps, width, height, frames, output }`。同时把 RenderRecord 追加回项目 JSON（`contentDigest` = sha256(canonicalJson(contentVersion))，`engineId: "remotion"`、`rendererVersion: remotion 版本`、`outputAssetRef` 输出相对路径）——追加后重跑 `validateVideoProject`。
- [ ] **Step 4: 手动冒烟** — 用 Task 5 测试里的合法 spec 构造最小项目 JSON，跑脚本，确认两个 MP4 产出、ffprobe 参数正确、manifest 完整
- [ ] **Step 5: lint/typecheck + 提交** — `feat(video-studio): SceneSpec 通用合成与双尺寸出片脚本`

---

### Task 7: 确定性 fitness function（双渲染逐帧哈希）

**Files:**
- Create: `scripts/video/verify-determinism.mjs`
- Modify: `package.json`（scripts 加 `"qa:video-determinism": "node scripts/video/verify-determinism.mjs"`）

**Interfaces:**
- Consumes: Task 6 渲染路径（`--sequence --image-format=png` 出 PNG 序列）
- Produces: exit 0 = 确定；exit 1 = 帧不一致（打印首个差异帧号）

- [ ] **Step 1: 实现** — 同一 spec 渲染两次到两个临时目录（PNG 序列）；对两个目录逐帧 `sha256` 比较；帧数不同即失败；最后打印 `输入集 manifest`（specDigest/registryVersion/remotion 版本/fontDigests/node 版本）供记录。**不做容器字节比较**（ADR：解码帧口径）。
- [ ] **Step 2: 验证** — 跑一次 exit 0；人为改 spec 一个字符再跑，确认两渲染仍各自确定（exit 0）但 manifest specDigest 变化——确定性是「同输入集」性质
- [ ] **Step 3: lint + 提交** — `feat(video-studio): 渲染确定性双跑校验脚本`

---

### Task 8: Web 工作台壳 + IndexedDB 本地项目

**Files:**
- Create: `apps/web/src/app/video-studio/page.tsx`、`apps/web/src/app/video-studio/video-studio.css`、`apps/web/src/app/video-studio/local-video-projects.ts`
- Modify: `apps/web/package.json`（deps 加 `"@acs/video-document": "workspace:*"`；devDeps 加 `tsx@^4.20.0`；scripts 加 `"test": "node --import tsx --test \\"src/app/video-studio/*.test.ts\\""`）

**Interfaces:**
- Consumes: `@acs/video-document` 的类型/校验/操作
- Produces: `saveVideoProject(doc: VideoProject): Promise<VideoProject>`（savedVersion+1；重放同版本幂等：同 id 同 savedVersion 直接返回）、`listVideoProjects(): Promise<Array<{id,title,updatedAt,savedVersion}>>`、`openVideoProject(id: string): Promise<VideoProject | null>`；页面路由 `/video-studio`

- [ ] **Step 1: 实现 `local-video-projects.ts`** — 照抄 image-studio `local-projects.ts` 的 IndexedDB 结构（库名 `acs-video-studio-local`，store `projects`，keyPath `id`）；保存前 `validateVideoProject`；并发语义：打开后保存时本地 savedVersion 落后于存储即抛 `VideoProjectConflictError`（提示刷新重开）
- [ ] **Step 2: 页面骨架** — 项目列表（标题/更新时间/打开）+「新建」进入编辑视图；编辑视图先只放占位标题与「保存」按钮（Task 9 接规划器与预览）；保存/重开浏览器实测
- [ ] **Step 3: typecheck + `pnpm --filter @acs/web test`（暂无测试文件，命令应通过）+ lint + 提交** — `feat(video-studio): 工作台壳与本地项目存取`

---

### Task 9: 规则规划器 + 确认环 + 帧预览

**Files:**
- Create: `apps/web/src/app/video-studio/planner.ts`、`apps/web/src/app/video-studio/planner.test.ts`、`apps/web/src/app/video-studio/scene-preview.tsx`
- Modify: `apps/web/src/app/video-studio/page.tsx`（接线）

**Interfaces:**
- Consumes: `@acs/video-scene` 的 `defaultRegistry`/`validateSceneSpec` 与组件渲染（浏览器侧加一个 15 行 `SvgTree` React 渲染器，或从 remotion-engine 复制——web 不依赖 remotion-engine，**复制小渲染器**）；`@acs/video-document` 的 `addCandidateVersion`
- Produces: `planFromSentence(sentence: string): { ok: true; spec: SceneSpec; title: string } | { ok: false; reason: string; guidance: string }`（纯函数）

P0 规则语法（文案在 guidance 里原样告诉用户，PhotoCraft M1 式「绝不猜」）：

```
做一个<秒数>秒的<文字|线描|图形>动画，标题是<文本>[，副标题是<文本>][，背景是<#hex>]
```

- [ ] **Step 1: 失败测试 `planner.test.ts`** — 合法句「做一个12秒的文字动画，标题是云制作，副标题是Video Studio」→ `{ok:true}`，spec.componentId==="text-animation"、durationMs===12000、params.title==="云制作"；「做一个8秒的线描动画」缺标题 → `{ok:false}` 且 guidance 含完整语法示例；「做一个12秒的视频」类型未知 → `{ok:false}`；秒数越界（<3 或 >30）→ `{ok:false}`；「帮我做个片头」完全不匹配 → `{ok:false}`（不静默猜）
- [ ] **Step 2: 实现 planner** — 单个正则 + 分段校验；构造 SceneSpec 后跑 `validateSceneSpec` 兜底；seed = 简单字符串哈希（同句同 seed，可复现）
- [ ] **Step 3: `scene-preview.tsx`** — props `{ spec }`；内部 rAF 驱动 frame 计数（`t = performance.now()` 仅用于预览时钟，**组件本身仍只吃 frame**），渲染 `SvgTree(component.render(spec, ctx))`；带播放/暂停与帧滑杆
- [ ] **Step 4: page.tsx 接线确认环** — 输入框 → `planFromSentence` → 失败显示 reason+guidance；成功显示 spec 摘要 + 预览 + 「确认应用」/「放弃」按钮；确认后按 Task 1 测试的 `baseProject` 结构直接构造初始文档（首镜头 = 初始内容版本 + `submitted(human)` 事件，`workingVersionId` 指向它；此时**不**用 `addCandidateVersion`——它作用于已存在镜头），随后可保存（Task 8 链路）；此后重做/审批走 Task 3 操作
- [ ] **Step 5: 测试通过 + typecheck + lint + 提交** — `feat(video-studio): 规则规划器、确认环与场景预览`

---

### Task 10: P0 收口样片 + QA 登记 + 文档

**Files:**
- Create: `artifacts/video-p0-sample-2026-10-17/REVIEW.md`
- Modify: `AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md`（顶部加一条 2026-10-17 P0 记录）、`qa/registry.json`（按现有条目结构新增用例）

- [ ] **Step 1: 端到端执行** — 浏览器新建项目、输入「做一个12秒的文字动画，标题是<自拟>，副标题是<自拟>」、确认、保存；导出脚本出横竖版 MP4；刷新浏览器重开项目确认分镜 JSON 与场景源完整
- [ ] **Step 2: 确定性校验** — `pnpm qa:video-determinism` exit 0；把输入集 manifest 贴入 REVIEW.md
- [ ] **Step 3: 线描样片再跑一轮** — 同上换 line-drawing 句式，验证第二组件端到端
- [ ] **Step 4: REVIEW.md 如实记录** — 输入句子、spec、引擎/组件/字体版本与摘要、导出参数、失败点（如有）、人工审片结论（横竖版分别看，注明竖版为居中缩放非重排版——ADR 验收允许但必须写明）；三态标注：本样片 = 样片验证
- [ ] **Step 5: qa/registry.json 登记** — 先读现有条目结构，新增同构条目（如 `VID-001` 确定性、`VID-002` 端到端样片）；若结构与本计划描述不符，以现有结构为准并在 CURRENT_STATE 注明
- [ ] **Step 6: lint/typecheck/qa:validate 全绿 + 提交** — `feat(video-studio): P0 单场景闭环样片与 QA 登记`

---

## 自查记录

- 规格覆盖：ADR 0003 §1（Task 1/3）、§2 执行边界（Task 4/5/6/7：声明式、纯函数、播种随机、禁网络——组件无 fetch/API、字体本地）、§3.1 文档版本存储（Task 8 savedVersion 乐观并发）、§3.5 量化（Task 2）、§1.7 指针（Task 3）；评审文档 P0 行五项（Task 1-10）与验收四要素（生成/保存重开/双尺寸/确定性）全部有任务对应。
- 占位符扫描：无 TBD；Task 3 测试代码中标注了一处笔误预防说明，执行时按说明写。
- 类型一致性：`SceneSpec`/`FrameContext`/`SvgNode`/`quantizeTimeline`/`validateVideoProject` 等跨任务签名已逐一核对一致。
- Review Focus 五项各有 owning task 测试（见各条目）。

## 范围说明（执行者须知）

- P0 本地优先：服务端 `video_projects` 迁移与 HTTP 存储属 P1 云端闭环，本计划不做（评审文档 D1 修订口径）。
- P0 规划器为确定性规则语法，LLM 规划升级属 P1（PhotoCraft M1 同路线：规则先行）。
- 竖版为同 spec 居中缩放，非重排版；样片 REVIEW.md 必须如实标注。
