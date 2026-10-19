# Video Studio P2.5-T3：媒体镜头编辑与预览 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 工作台可上传素材入账本、镜头可切「媒体镜头」编辑入出点/fit/focal/声音、整片预览用 `<video>` 渲染媒体镜头（缺失降级占位）。

**Architecture:** 三层：video-document `reviseWorkingVersion` 增 `mediaClip` patch 通道（op 层算 durationMs）；web 四个纯逻辑模块（`media-assets.ts` 素材面板 / `media-clip-templates.ts` 第七族编辑 / `apply-template.ts` 六族共体提取 / `media-preview.ts` 裁切与 seek 数学）；组件接线（page 装配 + 素材面板、scene-preview `<video>` 渲染、shot-editor-card 媒体臂）。零渲染路径（T4）、零 e2e（T6）。

**Tech Stack:** TypeScript、node:test、Next 16（App Router，params 是 Promise——apps/web AGENTS.md）、React 19 hooks。

**Spec:** `docs/superpowers/specs/2026-10-19-video-studio-media-preview-edit-design.md`（规则表 R/U/M/P/X 编号在任务中引用）。

## Global Constraints

- 工作树 `D:/codex/animate/.claude/worktrees/video-studio-p0`（分支 `worktree-video-studio-p2`）；主检出 `D:\codex\animate` 用户管理，勿动。
- 媒体域新增错误消息全中文（spec §3）；数组/UUID/ISO 级沿用英文现案。
- 测试零网络：web 测试 `node --import tsx --test`（不打真服务）；video-document 测试跑 `dist`（改完先 `pnpm --filter @acs/video-document build`）；web 依赖 video-document 构建产物（跨包改动后先 `pnpm run build` 根构建）。
- 组件不单测（house style）：组件只做渲染/状态接线，行为全在纯逻辑模块（`.test.ts` 同目录）。
- 提交尾部 `Co-Authored-By: Claude Code <noreply@anthropic.com>`；biome clean；`artifacts/tts-usage.jsonl` 台账 34 行不变（零计费）。
- 既有回归零改动全绿：web 143 / video-document 104 / video-scene 131 / media-store 31 / scripts。

## Review Focus

（spec 未逐字点名、但最可能咬人的输入类；每行的钉死测试已挂到归属任务）

1. **`?variant=proxy` 但 proxy 文件已被删**——预期回退 original 200 而非 404（P5 回退语义）→ Task 2 测试「proxy 缺失回退」。
2. **media-clip 指向已不在账本的资产**（账本手工删等）——预期 `buildMediaRevisePatch` 大声拒，**不静默换首条素材**→ Task 5 测试「素材不存在拒」。
3. **focal 文本全角「５０」/ 前导零「0050」**——前导零是合法 50，全角被 `^[0-9]+$` 拒（不是 `Number()` 静默 0）→ Task 5 测试两形态各一断言。
4. **cover 但素材与画布同比例（无溢出）**——objectPosition 须归一 `50% 50%`，focalX 不生效（否则画面偏移）→ Task 6 测试「无溢出归一」。
5. **narration-only patch 落在 media 版本上**——sceneSource 与 durationMs 必须原样保留（不得丢媒体源变回 spec）→ Task 1 测试「narration-only 保留媒体源」。

---

### Task 1: video-document `reviseWorkingVersion` mediaClip 通道（R1/R2）

**Files:**
- Modify: `packages/video-document/src/operations.ts:97-159`
- Test: `packages/video-document/src/operations.test.ts`（追加，勿动既有）

**Interfaces:**
- Consumes: `validateVideoProject`（updateShot 收尾已跑——C1 资产在账本 / C4 durationMs=outMs−inMs 由它拦，R2 后盾）。
- Produces:
  ```ts
  export type MediaClipPatch = {
    mediaAssetId: string; inMs: number; outMs: number;
    fit: "cover" | "contain"; focalX: number; audio: "mute" | "keep";
  };
  // reviseWorkingVersion patch 参数第三成员：
  patch: { narrationText?: string; spec?: unknown; mediaClip?: MediaClipPatch }
  ```
  Task 8/9 的 `onRevise` patch 类型与此对齐。

- [ ] **Step 1: 写失败测试（追加到 operations.test.ts 末尾）**

```ts
// —— P2.5-T3：mediaClip patch 通道（spec §2.1 R1/R2）——
import type { MediaAsset } from "./types.js";

const T3AT = "2026-10-19T00:00:00.000Z";
const UUID3 = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b1004";
const ASSET_ID = "1f0b13a2-6c63-4d3d-9a52-a70f6a3b2001";

function mediaAsset(): MediaAsset {
  return {
    assetId: ASSET_ID,
    createdAt: T3AT,
    origin: { kind: "local-upload", fileName: "clip.mp4" },
    original: {
      sha256: "a".repeat(64), bytes: 100, durationMs: 5000,
      width: 1920, height: 1080, fps: 24, codec: "h264",
      hasAudio: false, storeKey: "aaaaaaaaaaaaaaaa.mp4",
    },
  };
}

const CLIP = {
  mediaAssetId: ASSET_ID, inMs: 500, outMs: 2500,
  fit: "cover" as const, focalX: 0.5, audio: "mute" as const,
};

test("mediaClip patch：落 media-clip sceneSource，durationMs=outMs−inMs，human provenance，narration 覆盖继承", () => {
  const p = { ...baseProject(), mediaAssets: [mediaAsset()] };
  const next = reviseWorkingVersion(p, p.shots[0]!.shotId, { mediaClip: CLIP, narrationText: "旁白" }, UUID3, T3AT);
  const version = next.shots[0]!.contentVersions.at(-1)!;
  assert.equal(version.versionId, UUID3);
  assert.equal(version.durationMs, 2000); // op 计算，不是调用方给的
  assert.deepEqual(version.sceneSource, { type: "media-clip", ...CLIP });
  assert.equal(version.narrationText, "旁白");
  assert.equal(version.provenance.engineId, "human-edit");
  assert.equal(version.provenance.parentVersionId, p.shots[0]!.workingVersionId);
  assert.equal(next.shots[0]!.workingVersionId, UUID3);
  assert.equal(next.mediaAssets?.length, 1); // op 不动账本
});

test("mediaClip patch：锁定镜头允许且追加 audit 事件（沿 spec 路径语义）", () => {
  let p = { ...baseProject(), mediaAssets: [mediaAsset()] };
  p = setLocked(p, p.shots[0]!.shotId, true, T3AT);
  const next = reviseWorkingVersion(p, p.shots[0]!.shotId, { mediaClip: CLIP }, UUID3, T3AT);
  const events = next.shots[0]!.events;
  assert.equal(events.at(-1)!.kind, "audit");
});

test("spec 与 mediaClip 同时给出 → 大声抛（互斥）", () => {
  const p = { ...baseProject(), mediaAssets: [mediaAsset()] };
  assert.throws(
    () => reviseWorkingVersion(p, p.shots[0]!.shotId, { mediaClip: CLIP, spec: { durationMs: 1000 } }, UUID3, T3AT),
    /互斥/,
  );
});

test("narration-only patch 落在 media 版本上 → sceneSource 与 durationMs 原样保留（不得丢媒体源）", () => {
  let p: ReturnType<typeof baseProject> = { ...baseProject(), mediaAssets: [mediaAsset()] };
  p = reviseWorkingVersion(p, p.shots[0]!.shotId, { mediaClip: CLIP }, UUID3, T3AT);
  const next = reviseWorkingVersion(p, p.shots[0]!.shotId, { narrationText: "只改旁白" }, "0b0b13a2-6c63-4d3d-9a52-a70f6a3b1005", T3AT);
  const version = next.shots[0]!.contentVersions.at(-1)!;
  assert.equal(version.sceneSource.type, "media-clip");
  assert.equal(version.durationMs, 2000);
  assert.equal(version.narrationText, "只改旁白");
});

test("mediaClip：资产不在账本 → validate 拦（R2 后盾，C1）", () => {
  const p = baseProject(); // 无 mediaAssets
  assert.throws(
    () => reviseWorkingVersion(p, p.shots[0]!.shotId, { mediaClip: CLIP }, UUID3, T3AT),
    /mediaAssets 账本/,
  );
});

test("mediaClip：出点越界（outMs > 素材时长）→ validate 拦（C1 越界门）", () => {
  const p = { ...baseProject(), mediaAssets: [mediaAsset()] };
  assert.throws(
    () => reviseWorkingVersion(p, p.shots[0]!.shotId, { mediaClip: { ...CLIP, inMs: 4900, outMs: 5100 } }, UUID3, T3AT),
    /出入点越界/,
  );
});

test("mediaClip：出点−入点不足 200ms → validate 拦（C1 下限门）", () => {
  const p = { ...baseProject(), mediaAssets: [mediaAsset()] };
  assert.throws(
    () => reviseWorkingVersion(p, p.shots[0]!.shotId, { mediaClip: { ...CLIP, inMs: 1000, outMs: 1050 } }, UUID3, T3AT),
    /出入点越界/,
  );
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm --filter @acs/video-document build && pnpm --filter @acs/video-document test 2>&1 | tail -20`
Expected: 新 7 条 FAIL（`mediaClip` 未知成员——TS 编译即失败或运行期 sceneSource 仍为 spec 断言失败）；既有 104 PASS。

- [ ] **Step 3: 实现（operations.ts）**

类型导出加在 `ShotLockedError` 之后：

```ts
// P2.5-T3（spec §2.1 R1）：mediaClip patch——工作台媒体镜头的人工修订通道。
// durationMs 由 op 计算（outMs−inMs），调用方不得自带（C4 单一事实源）。
export type MediaClipPatch = {
  mediaAssetId: string;
  inMs: number;
  outMs: number;
  fit: "cover" | "contain";
  focalX: number;
  audio: "mute" | "keep";
};
```

`reviseWorkingVersion` 签名 patch 参数改为 `{ narrationText?: string; spec?: unknown; mediaClip?: MediaClipPatch }`；`base` 存在性检查后加互斥门：

```ts
  if (patch.spec !== undefined && patch.mediaClip !== undefined) {
    throw new Error("spec 与 mediaClip 互斥：一次修订只能指定一种场景源");
  }
```

`durationMs` 三分支：

```ts
    durationMs:
      patch.mediaClip !== undefined
        ? patch.mediaClip.outMs - patch.mediaClip.inMs
        : patch.spec === undefined
          ? base.durationMs
          : (patch.spec as { durationMs: number }).durationMs,
```

`sceneSource` 三分支：

```ts
    sceneSource:
      patch.mediaClip !== undefined
        ? { type: "media-clip", ...patch.mediaClip }
        : patch.spec === undefined
          ? base.sceneSource
          : { type: "spec", spec: patch.spec },
```

（函数头注释「patch.spec 由调用方先校验」补一句：mediaClip 字段由 validate 后盾拦 C1-C6。）

- [ ] **Step 4: 跑测试验证通过**

Run: `pnpm --filter @acs/video-document build && pnpm --filter @acs/video-document test 2>&1 | tail -5`
Expected: 111 pass（104 既有 + 7 新）。

- [ ] **Step 5: Commit**

```bash
git add packages/video-document/src/operations.ts packages/video-document/src/operations.test.ts
git commit -m "feat(video-document): reviseWorkingVersion 增 mediaClip patch 通道（T3 R1/R2）——op 计算 durationMs、spec/mediaClip 互斥、validate 后盾

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: GET `?variant=proxy`（P5）

**Files:**
- Modify: `apps/web/src/app/api/media/file/[storeKey]/route.ts:64-108`
- Test: `apps/web/src/app/api/media/file/[storeKey]/route.test.ts`（追加）

**Interfaces:**
- Consumes: 既有 `originalPath`/`proxyPath`/`resolveStoreRoot`；既有 `get()` 测试助手。
- Produces: `GET <storeKey>?variant=proxy` → proxy 优先、original 回退；缺省行为不变。Task 3 `mediaSrcUrl` 依赖此语义。

- [ ] **Step 1: 写失败测试（追加到 route.test.ts 末尾）**

```ts
// —— P2.5-T3 P5：variant=proxy 代理优先（预览 src 用，≤1280 浏览器安全 codec）——
async function getWithQuery(storeKey: string, query: string): Promise<Response> {
  return GET(
    new Request(`http://localhost:3210/api/media/file/${storeKey}${query}`),
    { params: Promise.resolve({ storeKey }) },
  );
}

test("P5：variant=proxy → proxy 优先命中；proxy 文件被删 → 回退 original 200（不是 404）", async () => {
  const previousStore = process.env.ACS_MEDIA_STORE;
  const store = mkdtempSync(path.join(tmpdir(), "acs-get-proxy-variant-"));
  process.env.ACS_MEDIA_STORE = store;
  try {
    const file = path.join(WORK, "src.mp4");
    if (!existsSync(file)) {
      const spawned = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=640x360:rate=24", "-pix_fmt", "yuv420p", file], { encoding: "utf8" });
      assert.equal(spawned.status, 0, spawned.stderr);
    }
    const result = await ingestMediaFile({ bytes: readFileSync(file), fileName: "src.mp4", root: store });
    assert.ok(result.ok);
    const storeKey = result.asset.original.storeKey;
    mkdirSync(path.join(store, "proxy"), { recursive: true });
    const proxyFile = path.join(store, "proxy", `${storeKey.slice(0, 16)}.proxy.mp4`);
    writeFileSync(proxyFile, Buffer.from("proxy-bytes"));

    const byVariant = await getWithQuery(storeKey, "?variant=proxy");
    assert.equal(byVariant.status, 200);
    assert.equal(byVariant.headers.get("content-type"), "video/mp4");
    assert.deepEqual(Buffer.from(await byVariant.arrayBuffer()), Buffer.from("proxy-bytes"));

    // 缺省（无 variant）→ original 优先不变（X：既有行为逐字节保持）
    const byDefault = await getWithQuery(storeKey, "");
    assert.deepEqual(Buffer.from(await byDefault.arrayBuffer()), readFileSync(path.join(store, "original", storeKey)));

    // proxy 被删 → variant 回退 original 200（Review Focus #1）
    rmSync(proxyFile);
    const fallback = await getWithQuery(storeKey, "?variant=proxy");
    assert.equal(fallback.status, 200);
    assert.deepEqual(Buffer.from(await fallback.arrayBuffer()), readFileSync(path.join(store, "original", storeKey)));
  } finally {
    if (previousStore === undefined) delete process.env.ACS_MEDIA_STORE;
    else process.env.ACS_MEDIA_STORE = previousStore;
  }
});
```

（文件头 import 若缺 `existsSync` 则补进既有 `node:fs` import。）

- [ ] **Step 2: 跑测试验证失败**

Run: `node --import tsx --test "src/app/api/media/file/**/*.test.ts"`（在 apps/web 下；或 `pnpm --filter @acs/web test` 后看尾部）
Expected: 新测试 FAIL——`byVariant` 返回 original 字节（当前无 variant 语义）。

- [ ] **Step 3: 实现（route.ts）**

GET 内、`contentType` 检查之后，把固定候选数组换成按 variant 排序：

```ts
  // P2.5-T3 P5：?variant=proxy → proxy 优先（预览 src），original 回退；
  // 缺省 original 优先（既有行为不变）。
  const preferProxy =
    new URL(request.url).searchParams.get("variant") === "proxy";
  const candidates = preferProxy
    ? ([[proxy, "video/mp4"] as const, [original, contentType] as const])
    : ([[original, contentType] as const, [proxy, "video/mp4"] as const]);
  for (const candidate of candidates) {
```

（循环体不动；文件头注释补 variant 一句。）

- [ ] **Step 4: 跑测试验证通过**

Run: `pnpm --filter @acs/web test 2>&1 | tail -5`
Expected: 全绿（143 既有 + 本文件新增；新增 1 条含 4 组断言）。

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/api/media/file/[storeKey]/route.ts" "apps/web/src/app/api/media/file/[storeKey]/route.test.ts"
git commit -m "feat(media-api): GET 增 ?variant=proxy 代理优先回退 original（T3 P5）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: 素材面板纯逻辑 `media-assets.ts`（U1/U2/U3，R3 语义）

**Files:**
- Create: `apps/web/src/app/video-studio/media-assets.ts`
- Create: `apps/web/src/app/video-studio/media-assets.test.ts`

**Interfaces:**
- Consumes: `MediaAsset`（@acs/video-document，types.ts:126-158）。
- Produces（Task 8 MediaPanel / Task 9 卡片素材下拉用）:
  ```ts
  appendMediaAsset(assets: MediaAsset[] | undefined, asset: MediaAsset): MediaAsset[]
  mediaSrcUrl(asset: MediaAsset): string
  assetLabel(asset: MediaAsset, all: MediaAsset[]): string
  ```

- [ ] **Step 1: 写失败测试（media-assets.test.ts 全新文件）**

```ts
// P2.5-T3 U 表：账本追加（不 mutate/重复拒）、预览 src（proxy 优先）、标签。
import assert from "node:assert/strict";
import test from "node:test";
import type { MediaAsset } from "@acs/video-document";
import { appendMediaAsset, assetLabel, mediaSrcUrl } from "./media-assets";

function asset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    assetId: "1f0b13a2-6c63-4d3d-9a52-a70f6a3b2001",
    createdAt: "2026-10-19T00:00:00.000Z",
    origin: { kind: "local-upload", fileName: "clip.mp4" },
    original: {
      sha256: "a".repeat(64), bytes: 100, durationMs: 5200,
      width: 1920, height: 1080, fps: 24, codec: "h264",
      hasAudio: false, storeKey: "aaaaaaaaaaaaaaaa.mp4",
    },
    ...overrides,
  };
}

test("U1：undefined 账本 → [asset]；既有账本追加返回新数组（不 mutate）", () => {
  const first = asset();
  assert.deepEqual(appendMediaAsset(undefined, first), [first]);
  const second = asset({ assetId: "1f0b13a2-6c63-4d3d-9a52-a70f6a3b2002" });
  const before: MediaAsset[] = [first];
  const after = appendMediaAsset(before, second);
  assert.equal(after.length, 2);
  assert.equal(before.length, 1, "入参数组不得被修改");
});

test("U1：重复 assetId → 大声抛（防御；T2 randomUUID 正常不撞）", () => {
  const first = asset();
  assert.throws(() => appendMediaAsset([first], first), /已在账本/);
});

test("U2：有 proxy → ?variant=proxy；无 proxy → 直连 original", () => {
  assert.equal(mediaSrcUrl(asset()), "/api/media/file/aaaaaaaaaaaaaaaa.mp4");
  const withProxy = asset({
    proxy: { sha256: "b".repeat(64), bytes: 50, width: 1280, height: 720, note: "ffmpeg" },
  });
  assert.equal(mediaSrcUrl(withProxy), "/api/media/file/aaaaaaaaaaaaaaaa.mp4?variant=proxy");
});

test("U3：标签含文件名/画幅/时长一位小数/本地上传", () => {
  assert.equal(
    assetLabel(asset(), [asset()]),
    "「clip.mp4」 1920×1080 · 5.2s · 本地上传",
  );
});

test("U3：同 storeKey 多条 → 追注（同内容已在册）（R3：各自成条不去重）", () => {
  const a = asset();
  const b = asset({ assetId: "1f0b13a2-6c63-4d3d-9a52-a70f6a3b2002", origin: { kind: "local-upload", fileName: "again.mp4" } });
  assert.equal(assetLabel(b, [a, b]), "「again.mp4」 1920×1080 · 5.2s · 本地上传（同内容已在册）");
  assert.equal(assetLabel(a, [a]), "「clip.mp4」 1920×1080 · 5.2s · 本地上传", "单条不注");
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `node --import tsx --test src/app/video-studio/media-assets.test.ts`（apps/web 下）
Expected: FAIL——模块不存在（Cannot find module）。

- [ ] **Step 3: 实现（media-assets.ts 全新文件）**

```ts
// P2.5-T3 素材面板纯逻辑（spec §2.2 U 表）：账本追加、预览 src（proxy 优先，
// 依赖 GET ?variant=proxy 的回退语义）、列表标签。组件只做渲染/状态接线。
import type { MediaAsset } from "@acs/video-document";

export function appendMediaAsset(
  assets: MediaAsset[] | undefined,
  asset: MediaAsset,
): MediaAsset[] {
  if ((assets ?? []).some((existing) => existing.assetId === asset.assetId)) {
    throw new Error(`素材 ${asset.assetId} 已在账本中（assetId 必须唯一）`);
  }
  return [...(assets ?? []), asset];
}

export function mediaSrcUrl(asset: MediaAsset): string {
  return `/api/media/file/${asset.original.storeKey}${
    asset.proxy ? "?variant=proxy" : ""
  }`;
}

export function assetLabel(asset: MediaAsset, all: MediaAsset[]): string {
  const fileName =
    asset.origin.kind === "local-upload"
      ? asset.origin.fileName
      : asset.origin.sourcePageUrl;
  const duplicate =
    all.filter(
      (existing) => existing.original.storeKey === asset.original.storeKey,
    ).length > 1;
  return `「${fileName}」 ${asset.original.width}×${asset.original.height} · ${(
    asset.original.durationMs / 1000
  ).toFixed(1)}s · 本地上传${duplicate ? "（同内容已在册）" : ""}`;
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `node --import tsx --test src/app/video-studio/media-assets.test.ts`
Expected: 5 pass。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/video-studio/media-assets.ts apps/web/src/app/video-studio/media-assets.test.ts
git commit -m "feat(video-studio): 素材面板纯逻辑 appendMediaAsset/mediaSrcUrl/assetLabel（T3 U 表）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: `apply-template.ts` 六族共体提取 + 薄包装（§1 裁定，X3）

**Files:**
- Create: `apps/web/src/app/video-studio/apply-template.ts`
- Create: `apps/web/src/app/video-studio/apply-template.test.ts`
- Modify: `apps/web/src/app/video-studio/{chart,map,flow,stick,sketch,loading}-templates.ts`（各只改 `applyXTemplate` 函数体）

**Interfaces:**
- Consumes: `defaultRegistry`/`SceneSpec`/`validateSceneSpec`（@acs/video-scene）；六族既有 `*_TEMPLATES` 数组。
- Produces:
  ```ts
  applySceneTemplate(
    templates: readonly { templateId: string; componentId: SceneSpec["componentId"]; params: Record<string, unknown> }[],
    spec: SceneSpec, templateId: string, unknownTemplateLabel: string,
  ): { spec: SceneSpec; error: null } | { spec: null; error: string }
  ```
  六族 `applyXTemplate` 签名/报错文案**不变**（既有测试零改动全绿 = 等价证明）。

- [ ] **Step 1: 写失败测试（apply-template.test.ts 全新）**

```ts
// P2.5-T3：apply 基底提取（spec §1 裁定）——机械共体：找模板→深拷贝→validate 门。
import assert from "node:assert/strict";
import test from "node:test";
import type { SceneSpec } from "@acs/video-scene";
import { applySceneTemplate } from "./apply-template";
import { CHART_TEMPLATES } from "./chart-templates";

const BASE: SceneSpec = {
  specVersion: 1, componentId: "text-animation", componentVersion: 1,
  durationMs: 2000, seed: 7, background: "#ffffff",
  params: { title: "旧标题" },
};

test("未知模板 → `${label} ${templateId}`（文案由调用方给）", () => {
  const result = applySceneTemplate(CHART_TEMPLATES, BASE, "nope", "未知测试模板");
  assert.equal(result.error, "未知测试模板 nope");
  assert.equal(result.spec, null);
});

test("合法模板 → 换组件且 params 深拷贝（改产物不回流模板库）", () => {
  const result = applySceneTemplate(CHART_TEMPLATES, BASE, "counter-kpi", "未知图表模板");
  assert.ok(result.spec);
  assert.equal(result.spec.componentId, "number-counter");
  assert.equal(result.spec.componentVersion, 1);
  assert.equal(result.spec.seed, 7, "seed 沿基底");
  const template = CHART_TEMPLATES.find((t) => t.templateId === "counter-kpi")!;
  const before = JSON.stringify(template.params);
  (result.spec.params as Record<string, unknown>).title = "被我改掉";
  assert.equal(JSON.stringify(template.params), before, "模板参数不得被污染");
});

test("模板 params 非法 → validateSceneSpec 消息透传", () => {
  const bad = [{ templateId: "bad", componentId: "bar-chart", params: {} }];
  const result = applySceneTemplate(bad, BASE, "bad", "未知图表模板");
  assert.ok(result.error);
  assert.notEqual(result.error, "未知图表模板 bad");
});
```

（若 `SceneSpec` 类型没有 `specVersion` 字段或字段名不同——以 video-scene 实际类型为准增删；测试里 `BASE` 对齐 chart-templates.test.ts 的既有 spec 夹具写法。）

- [ ] **Step 2: 跑测试验证失败**

Run: `node --import tsx --test src/app/video-studio/apply-template.test.ts`
Expected: FAIL——Cannot find module './apply-template'。

- [ ] **Step 3: 实现（apply-template.ts 全新 + 六族改薄包装）**

```ts
// P2.5-T3 六族 applyXTemplate 机械共体提取（spec §1 裁定）：找模板 → 深拷贝
// params → validateSceneSpec 门。六族保留薄包装（签名与报错文案不变，既有
// 测试零改动即等价证明）；第七族（媒体）产物是 ContentVersion 级 patch，
// 与 spec params 不同类，不入此基底。
import {
  defaultRegistry,
  type SceneSpec,
  validateSceneSpec,
} from "@acs/video-scene";

export type TemplateLike = {
  templateId: string;
  componentId: SceneSpec["componentId"];
  params: Record<string, unknown>;
};

export function applySceneTemplate(
  templates: readonly TemplateLike[],
  spec: SceneSpec,
  templateId: string,
  unknownTemplateLabel: string,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  const template = templates.find((t) => t.templateId === templateId);
  if (!template) {
    return { spec: null, error: `${unknownTemplateLabel} ${templateId}` };
  }
  // 深拷贝：编辑产物不得回流污染模板库
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
```

六族 `applyXTemplate` 函数体替换为单行转发（以 chart 为例，其余五族同构，label 分别为 `未知图表模板`/`未知地图模板`/`未知流程模板`/`未知火柴人模板`/`未知手绘模板`/`未知加载模板`）：

```ts
export function applyChartTemplate(
  spec: SceneSpec,
  templateId: string,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  return applySceneTemplate(CHART_TEMPLATES, spec, templateId, "未知图表模板");
}
```

（各文件顶部补 `import { applySceneTemplate } from "./apply-template";`；若某族模板数组的 componentId 是本地字面量联合类型与 `SceneSpec["componentId"]` 不直接兼容，在其数组类型上保持原样——`TemplateLike` 以结构兼容为准，必要时在该族加 `satisfies`。）

- [ ] **Step 4: 跑测试验证通过（含六族零改动回归）**

Run: `pnpm --filter @acs/web test 2>&1 | tail -5`
Expected: 全绿——六族既有测试零改动通过（等价证明）+ 新 3 条。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/video-studio/apply-template.ts apps/web/src/app/video-studio/apply-template.test.ts apps/web/src/app/video-studio/chart-templates.ts apps/web/src/app/video-studio/map-templates.ts apps/web/src/app/video-studio/flow-templates.ts apps/web/src/app/video-studio/stick-templates.ts apps/web/src/app/video-studio/sketch-templates.ts apps/web/src/app/video-studio/loading-templates.ts
git commit -m "refactor(video-studio): 提取 applySceneTemplate 六族共体（T3 §1 裁定，X3 等价证明）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: 第七族编辑纯逻辑 `media-clip-templates.ts`（M1-M5）

**Files:**
- Create: `apps/web/src/app/video-studio/media-clip-templates.ts`
- Create: `apps/web/src/app/video-studio/media-clip-templates.test.ts`

**Interfaces:**
- Consumes: `MediaAsset`/`SceneSource`（@acs/video-document）；`speechAwareDurationMs`（./planner，shot-edit.ts:46-49 同款语速模型——M5 复用同一速度模型）。
- Produces（Task 9 卡片媒体臂用）:
  ```ts
  export const MEDIA_TEMPLATE_ID = "media-clip";
  export type MediaEditDraft = { assetId: string; inMsText: string; outMsText: string; fit: "cover" | "contain"; focalPercentText: string; audio: "mute" | "keep" };
  draftMediaFromVersion(working: { sceneSource: SceneSource; durationMs: number } | undefined, assets: MediaAsset[]): { draft: MediaEditDraft | null; error: string | null }
  buildMediaRevisePatch(draft: MediaEditDraft, assets: MediaAsset[], narrationText: string): { patch: { narrationText: string; mediaClip: MediaClipPatch } | null; error: string | null; warnings: string[] }
  ```

- [ ] **Step 1: 写失败测试（media-clip-templates.test.ts 全新）**

```ts
// P2.5-T3 M 表：草稿回填/默认值、行内校验全负路径、整帧与语速软预警。
import assert from "node:assert/strict";
import test from "node:test";
import type { MediaAsset } from "@acs/video-document";
import { buildMediaRevisePatch, draftMediaFromVersion, type MediaEditDraft } from "./media-clip-templates";

const ASSET_ID = "1f0b13a2-6c63-4d3d-9a52-a70f6a3b2001";

function asset(): MediaAsset {
  return {
    assetId: ASSET_ID,
    createdAt: "2026-10-19T00:00:00.000Z",
    origin: { kind: "local-upload", fileName: "clip.mp4" },
    original: {
      sha256: "a".repeat(64), bytes: 100, durationMs: 5000,
      width: 1920, height: 1080, fps: 24, codec: "h264",
      hasAudio: false, storeKey: "aaaaaaaaaaaaaaaa.mp4",
    },
  };
}

function draft(overrides: Partial<MediaEditDraft> = {}): MediaEditDraft {
  return { assetId: ASSET_ID, inMsText: "500", outMsText: "2500", fit: "cover", focalPercentText: "50", audio: "mute", ...overrides };
}

const MEDIA_WORKING = {
  sceneSource: { type: "media-clip" as const, mediaAssetId: ASSET_ID, inMs: 500, outMs: 2500, fit: "cover" as const, focalX: 0.33, audio: "keep" as const },
  durationMs: 2000,
};

test("M2：media 工作版本 → 草稿回填（focal 取整为百分数）", () => {
  const { draft: d, error } = draftMediaFromVersion(MEDIA_WORKING, [asset()]);
  assert.equal(error, null);
  assert.deepEqual(d, { assetId: ASSET_ID, inMsText: "500", outMsText: "2500", fit: "cover", focalPercentText: "33", audio: "keep" });
});

test("M2：非 media 版本 + 有账本 → 默认草稿（outMs=min(2000, 时长)）；无账本 → 指路错误", () => {
  const specWorking = { sceneSource: { type: "spec" as const, spec: {} }, durationMs: 2000 };
  const { draft: d } = draftMediaFromVersion(specWorking, [asset()]);
  assert.deepEqual(d, { assetId: ASSET_ID, inMsText: "0", outMsText: "2000", fit: "cover", focalPercentText: "50", audio: "mute" });
  const short = asset();
  short.original.durationMs = 1200;
  assert.equal(draftMediaFromVersion(specWorking, [short]).draft?.outMsText, "1200");
  const empty = draftMediaFromVersion(undefined, []);
  assert.equal(empty.draft, null);
  assert.match(empty.error!, /尚无媒体素材/);
});

test("M3：正路径——focal 33 → focalX 0.33，patch 无 durationMs（op 算），narration 带上", () => {
  const { patch, error, warnings } = buildMediaRevisePatch(draft({ focalPercentText: "33" }), [asset()], "旁白文本");
  assert.equal(error, null);
  assert.deepEqual(patch, {
    narrationText: "旁白文本",
    mediaClip: { mediaAssetId: ASSET_ID, inMs: 500, outMs: 2500, fit: "cover", focalX: 0.33, audio: "mute" },
  });
  assert.deepEqual(warnings, []);
});

test("M3：素材不在账本 → 拒，不静默换首条（Review Focus #2）", () => {
  const { patch, error } = buildMediaRevisePatch(draft({ assetId: "gone" }), [asset()], "");
  assert.equal(patch, null);
  assert.match(error!, /素材不存在或已移除：gone/);
});

test("M3：入出点文本非法（全角/小数/负号/空）→ regex 拒", () => {
  for (const bad of ["１００", "1.5", "-100", "", "1e3"]) {
    assert.match(buildMediaRevisePatch(draft({ inMsText: bad }), [asset()], "").error!, /整数毫秒/, bad);
    assert.match(buildMediaRevisePatch(draft({ outMsText: bad }), [asset()], "").error!, /整数毫秒/, bad);
  }
});

test("M3：focal 全角拒、前导零合法=50、越界 101 拒（Review Focus #3）", () => {
  assert.match(buildMediaRevisePatch(draft({ focalPercentText: "５０" }), [asset()], "").error!, /0\.\.100 整数/);
  const legal = buildMediaRevisePatch(draft({ focalPercentText: "0050" }), [asset()], "");
  assert.equal(legal.patch!.mediaClip.focalX, 0.5);
  assert.match(buildMediaRevisePatch(draft({ focalPercentText: "101" }), [asset()], "").error!, /0\.\.100 整数/);
});

test("M3：出点 < 入点+200 / 出点 > 素材时长 → 中文指路拒", () => {
  assert.match(buildMediaRevisePatch(draft({ outMsText: "600" }), [asset()], "").error!, /出点越界/);
  assert.match(buildMediaRevisePatch(draft({ outMsText: "5001" }), [asset()], "").error!, /出点越界.*素材时长 5000ms.*入=500 出=5001/);
});

test("M4：非整帧 → 软预警不阻塞；整帧 → 无预警", () => {
  const off = buildMediaRevisePatch(draft({ inMsText: "10" }), [asset()], ""); // 10*24=240 非 1000 倍数
  assert.ok(off.patch, "非整帧是预警不是错误");
  assert.equal(off.warnings.length, 1);
  assert.match(off.warnings[0]!, /非整帧/);
  const on = buildMediaRevisePatch(draft({ inMsText: "1000", outMsText: "3000" }), [asset()], ""); // 24/72 帧整
  assert.deepEqual(on.warnings, []);
});

test("M5：旁白语速超片段 → 软预警；短旁白无预警", () => {
  const long = buildMediaRevisePatch(draft(), [asset()], "一".repeat(20)); // 400+300×20 ≫ 2000ms
  assert.ok(long.warnings.some((w) => /超出片段/.test(w)));
  const short = buildMediaRevisePatch(draft(), [asset()], "短句");
  assert.ok(!short.warnings.some((w) => /超出片段/.test(w)));
});

test("M3：fit/audio 非法枚举兜底拒", () => {
  assert.match(buildMediaRevisePatch(draft({ fit: "fill" as never }), [asset()], "").error!, /cover 或 contain/);
  assert.match(buildMediaRevisePatch(draft({ audio: "loud" as never }), [asset()], "").error!, /mute 或 keep/);
});
```

（M4 首行断言写正式版：`assert.ok(off.patch, "非整帧是预警不是错误");`——上面草稿行删掉。）

- [ ] **Step 2: 跑测试验证失败**

Run: `node --import tsx --test src/app/video-studio/media-clip-templates.test.ts`
Expected: FAIL——Cannot find module。

- [ ] **Step 3: 实现（media-clip-templates.ts 全新）**

```ts
// P2.5-T3 第七族（媒体镜头）编辑纯逻辑（spec §2.3 M 表）：草稿/行内校验/软预警。
// 产物是 ContentVersion 级 mediaClip patch（非 spec params），与六族不同类；
// 非法 {patch:null,error} 不清文档（沿转场 C1 语义）。
import type { MediaAsset, SceneSource } from "@acs/video-document";
import { speechAwareDurationMs } from "./planner";

export const MEDIA_TEMPLATE_ID = "media-clip";
export const MEDIA_TEMPLATE_LABEL = "媒体镜头（选素材设入出点）";

const INTEGER_TEXT = /^[0-9]+$/;

export type MediaEditDraft = {
  assetId: string;
  inMsText: string;
  outMsText: string;
  fit: "cover" | "contain";
  focalPercentText: string;
  audio: "mute" | "keep";
};

export function draftMediaFromVersion(
  working: { sceneSource: SceneSource; durationMs: number } | undefined,
  assets: MediaAsset[],
): { draft: MediaEditDraft | null; error: string | null } {
  if (working && working.sceneSource.type === "media-clip") {
    const media = working.sceneSource;
    return {
      draft: {
        assetId: media.mediaAssetId,
        inMsText: String(media.inMs),
        outMsText: String(media.outMs),
        fit: media.fit,
        focalPercentText: String(Math.round(media.focalX * 100)),
        audio: media.audio,
      },
      error: null,
    };
  }
  const first = assets[0];
  if (!first) {
    return { draft: null, error: "项目尚无媒体素材，请先在素材面板上传" };
  }
  return {
    draft: {
      assetId: first.assetId,
      inMsText: "0",
      outMsText: String(Math.min(2000, first.original.durationMs)),
      fit: "cover",
      focalPercentText: "50",
      audio: "mute",
    },
    error: null,
  };
}

export function buildMediaRevisePatch(
  draft: MediaEditDraft,
  assets: MediaAsset[],
  narrationText: string,
): {
  patch: { narrationText: string; mediaClip: { mediaAssetId: string; inMs: number; outMs: number; fit: "cover" | "contain"; focalX: number; audio: "mute" | "keep" } } | null;
  error: string | null;
  warnings: string[];
} {
  const asset = assets.find((a) => a.assetId === draft.assetId);
  if (!asset) {
    return { patch: null, error: `素材不存在或已移除：${draft.assetId}`, warnings: [] };
  }
  if (!INTEGER_TEXT.test(draft.inMsText)) {
    return { patch: null, error: "入点须为 ≥0 的整数毫秒", warnings: [] };
  }
  if (!INTEGER_TEXT.test(draft.outMsText)) {
    return { patch: null, error: "出点须为 ≥0 的整数毫秒", warnings: [] };
  }
  const inMs = Number(draft.inMsText);
  const outMs = Number(draft.outMsText);
  if (inMs < 0) {
    return { patch: null, error: "入点须为 ≥0 的整数毫秒", warnings: [] };
  }
  if (outMs < inMs + 200 || outMs > asset.original.durationMs) {
    return {
      patch: null,
      error: `出点越界：须满足 入点+200 ≤ 出点 ≤ 素材时长 ${asset.original.durationMs}ms（当前 入=${inMs} 出=${outMs}）`,
      warnings: [],
    };
  }
  if (!INTEGER_TEXT.test(draft.focalPercentText)) {
    return { patch: null, error: "focal 百分比须为 0..100 整数", warnings: [] };
  }
  const focalPercent = Number(draft.focalPercentText);
  if (focalPercent < 0 || focalPercent > 100) {
    return { patch: null, error: "focal 百分比须为 0..100 整数", warnings: [] };
  }
  if (draft.fit !== "cover" && draft.fit !== "contain") {
    return { patch: null, error: "fit 须为 cover 或 contain", warnings: [] };
  }
  if (draft.audio !== "mute" && draft.audio !== "keep") {
    return { patch: null, error: "audio 须为 mute 或 keep", warnings: [] };
  }
  const warnings: string[] = [];
  // M4 非整帧（fps=29.97 时为浮点近似，预警非阻塞，T4 兑现取整）
  const fps = asset.original.fps;
  if ((inMs * fps) % 1000 !== 0 || (outMs * fps) % 1000 !== 0) {
    warnings.push(`入/出点非整帧（素材 ${fps}fps），出片将按帧取整`);
  }
  // M5 语速溢出（与 shot-edit 同一速度模型；对齐语义归 T4，不自动改时长）
  const spanMs = outMs - inMs;
  const neededMs = speechAwareDurationMs(spanMs, narrationText);
  if (neededMs > spanMs) {
    warnings.push(
      `旁白按语速需 ${(neededMs / 1000).toFixed(1)}s，超出片段 ${(spanMs / 1000).toFixed(1)}s`,
    );
  }
  return {
    patch: {
      narrationText,
      mediaClip: {
        mediaAssetId: draft.assetId,
        inMs,
        outMs,
        fit: draft.fit,
        focalX: focalPercent / 100,
        audio: draft.audio,
      },
    },
    error: null,
    warnings,
  };
}
```

（先确认 `speechAwareDurationMs` 的导出名与签名——shot-edit.ts:6/46-49；若参数序不同以实现为准调整调用。）

- [ ] **Step 4: 跑测试验证通过**

Run: `node --import tsx --test src/app/video-studio/media-clip-templates.test.ts`
Expected: 10 pass。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/video-studio/media-clip-templates.ts apps/web/src/app/video-studio/media-clip-templates.test.ts
git commit -m "feat(video-studio): 第七族媒体镜头编辑纯逻辑（T3 M1-M5：草稿/行内校验/整帧与语速软预警）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: 预览数学 `media-preview.ts`（P2/P3 纯函数）

**Files:**
- Create: `apps/web/src/app/video-studio/media-preview.ts`
- Create: `apps/web/src/app/video-studio/media-preview.test.ts`

**Interfaces:**
- Consumes: 无（纯数学）。
- Produces（Task 7 MediaStage 用）:
  ```ts
  mediaClipCss(assetWidth: number, assetHeight: number, canvasWidth: number, canvasHeight: number, fit: "cover" | "contain", focalX: number): { objectFit: "cover" | "contain"; objectPosition: string }
  mediaSeekTargetSec(inMs: number, localFrame: number, fps?: number): number
  shouldSeekVideo(currentSec: number, targetSec: number, thresholdSec?: number): boolean
  ```

- [ ] **Step 1: 写失败测试（media-preview.test.ts 全新）**

```ts
// P2.5-T3 P2/P3：cover 裁切 objectFit/objectPosition 双画幅数学 + 帧驱动 seek。
import assert from "node:assert/strict";
import test from "node:test";
import { mediaClipCss, mediaSeekTargetSec, shouldSeekVideo } from "./media-preview";

test("P2：contain → 50% 50%，focalX 不参与", () => {
  assert.deepEqual(mediaClipCss(1920, 1080, 360, 640, "contain", 0.9), { objectFit: "contain", objectPosition: "50% 50%" });
});

test("P2：cover 横溢出（16:9 素材进 9:16 画布）→ focalX 生效", () => {
  assert.deepEqual(mediaClipCss(1920, 1080, 360, 640, "cover", 0), { objectFit: "cover", objectPosition: "0.0% 50%" });
  assert.deepEqual(mediaClipCss(1920, 1080, 360, 640, "cover", 1), { objectFit: "cover", objectPosition: "100.0% 50%" });
  assert.deepEqual(mediaClipCss(1920, 1080, 360, 640, "cover", 1 / 3), { objectFit: "cover", objectPosition: "33.3% 50%" });
});

test("P2：双画幅同一素材——16:9 画布无溢出归一 50%，9:16 画布吃 focalX（数值钉死）", () => {
  assert.deepEqual(mediaClipCss(1920, 1080, 640, 360, "cover", 1 / 3).objectPosition, "50% 50%");
  assert.deepEqual(mediaClipCss(1920, 1080, 360, 640, "cover", 1 / 3).objectPosition, "33.3% 50%");
});

test("P2：cover 竖溢出（9:16 素材进 16:9 画布）→ X 归一 50%（契约无 focalY）", () => {
  assert.deepEqual(mediaClipCss(1080, 1920, 640, 360, "cover", 0.7), { objectFit: "cover", objectPosition: "50% 50%" });
});

test("P2：同尺寸（无溢出）→ 50% 50%（Review Focus #4）", () => {
  assert.deepEqual(mediaClipCss(640, 360, 640, 360, "cover", 0.2), { objectFit: "cover", objectPosition: "50% 50%" });
});

test("P3：seek 目标 = (inMs + 本地帧/24×1000)/1000", () => {
  assert.equal(mediaSeekTargetSec(500, 24), 1.5);
  assert.equal(mediaSeekTargetSec(0, 12), 0.5);
});

test("P3：seek 节流——差 <80ms 不重设，≥80ms 重设（边界含等号）", () => {
  assert.equal(shouldSeekVideo(0.5, 0.55), false);
  assert.equal(shouldSeekVideo(0.5, 0.58), true); // 恰 0.08
  assert.equal(shouldSeekVideo(0.5, 0.6), true);
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `node --import tsx --test src/app/video-studio/media-preview.test.ts`
Expected: FAIL——Cannot find module。

- [ ] **Step 3: 实现（media-preview.ts 全新）**

```ts
// P2.5-T3 媒体预览数学（spec §2.4 P2/P3）：objectFit/objectPosition 派生 +
// 帧驱动 seek 目标与节流。cover 语义：仅横溢出轴吃 focalX（注视点），竖溢出/
// 无溢出恒 50%（契约无 focalY）；contain 恒 letterbox 居中。
export function mediaClipCss(
  assetWidth: number,
  assetHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  fit: "cover" | "contain",
  focalX: number,
): { objectFit: "cover" | "contain"; objectPosition: string } {
  if (fit === "contain") {
    return { objectFit: "contain", objectPosition: "50% 50%" };
  }
  const scale = Math.max(canvasWidth / assetWidth, canvasHeight / assetHeight);
  const overflowX = assetWidth * scale > canvasWidth + 0.5;
  const x = overflowX ? `${(focalX * 100).toFixed(1)}%` : "50%";
  return { objectFit: "cover", objectPosition: `${x} 50%` };
}

export function mediaSeekTargetSec(
  inMs: number,
  localFrame: number,
  fps = 24,
): number {
  return (inMs + (localFrame / fps) * 1000) / 1000;
}

export function shouldSeekVideo(
  currentSec: number,
  targetSec: number,
  thresholdSec = 0.08,
): boolean {
  return Math.abs(targetSec - currentSec) >= thresholdSec;
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `node --import tsx --test src/app/video-studio/media-preview.test.ts`
Expected: 7 pass。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/video-studio/media-preview.ts apps/web/src/app/video-studio/media-preview.test.ts
git commit -m "feat(video-studio): 媒体预览数学 mediaClipCss 双画幅裁切 + 帧驱动 seek（T3 P2/P3）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: `shotWorkingMediaClip` + `scene-preview.tsx` 媒体渲染与缺失降级（P1/P2/P3/P4）

**Files:**
- Modify: `apps/web/src/app/video-studio/shot-specs.ts`（追加函数）
- Modify: `apps/web/src/app/video-studio/shot-specs.test.ts`（追加测试）
- Modify: `apps/web/src/app/video-studio/scene-preview.tsx`（TimelinePreviewItem 联合 + 渲染分支）
- Modify: `apps/web/src/app/video-studio/video-studio.css`（.media-stage/.media-missing/.preview-media-note）

**Interfaces:**
- Consumes: Task 6 `mediaClipCss`/`mediaSeekTargetSec`/`shouldSeekVideo`；Task 3 `mediaSrcUrl`；`MediaAsset` 类型。
- Produces（Task 8 用）:
  ```ts
  shotWorkingMediaClip(shot: Shot): Extract<SceneSource, { type: "media-clip" }> | null
  // TimelinePreviewItem 扩联合（spec 项形状不变，判别用 "spec" in item）：
  export type TimelinePreviewItem =
    | { spec: SceneSpec; startFrame: number; frames: number; narrationText?: string }
    | { kind: "media"; assetId: string; inMs: number; outMs: number; fit: "cover" | "contain"; focalX: number; startFrame: number; frames: number; narrationText?: string }
    | { kind: "missing"; reason: string; startFrame: number; frames: number };
  // TimelinePreview 新可选 prop：assets?: MediaAsset[]
  ```

- [ ] **Step 1: 写失败测试（shot-specs.test.ts 追加）**

```ts
// —— P2.5-T3：media-clip 工作版本解析（P1 装配基础）——
test("media-clip 工作版本 → 提取三成员；spec 版本 / 无工作版本 → null", () => {
  const clip = { type: "media-clip" as const, mediaAssetId: "a1", inMs: 0, outMs: 2000, fit: "cover" as const, focalX: 0.5, audio: "mute" as const };
  const shot = {
    shotId: "s1", order: 0, locked: false, workingVersionId: "v1",
    contentVersions: [{ versionId: "v1", createdAt: at, durationMs: 2000, description: "d", narrationText: "", sceneSource: clip, provenance: { engineId: "x", engineVersion: "1" } }],
    events: [],
  };
  assert.deepEqual(shotWorkingMediaClip(shot as never), clip);
  assert.equal(shotWorkingSpec(shot as never), null);
  const specShot = { ...shot, contentVersions: [{ ...shot.contentVersions[0]!, sceneSource: { type: "spec", spec: { specVersion: 1, componentId: "text-animation", componentVersion: 1, durationMs: 2000, seed: 1, background: "#ffffff", params: { title: "t" } } } }] };
  assert.equal(shotWorkingMediaClip(specShot as never), null);
  assert.equal(shotWorkingMediaClip({ ...shot, workingVersionId: "gone" } as never), null);
});
```

（`at`/既有夹具沿该文件现案；若无 `at` 常量则用内联 ISO 串。）

- [ ] **Step 2: 跑测试验证失败**

Run: `node --import tsx --test src/app/video-studio/shot-specs.test.ts`
Expected: FAIL——`shotWorkingMediaClip` 未导出。

- [ ] **Step 3: 实现 shot-specs.ts（追加）**

```ts
import type { SceneSource, Shot } from "@acs/video-document";

// P2.5-T3（spec §2.4 P1）：media-clip 工作版本解析。与 shotWorkingSpec 对称：
// 非 media-clip 或工作版本缺失 → null（调用方据此走 spec 项/降级，不炸页）。
export function shotWorkingMediaClip(
  shot: Shot,
): Extract<SceneSource, { type: "media-clip" }> | null {
  const working = shot.contentVersions.find(
    (version) => version.versionId === shot.workingVersionId,
  );
  if (!working || working.sceneSource.type !== "media-clip") return null;
  return working.sceneSource;
}
```

（文件头 import 行合并为 `import type { SceneSource, Shot } ...`。）

- [ ] **Step 4: 跑测试验证通过**

Run: `node --import tsx --test src/app/video-studio/shot-specs.test.ts`
Expected: 既有 + 1 全绿。

- [ ] **Step 5: 改 scene-preview.tsx（类型联合 + 渲染分支，组件不单测）**

1. `TimelinePreviewItem` 换为 Interfaces 里的三成员联合（**spec 项形状逐字节不变**）。
2. import 增加：`import type { MediaAsset } from "@acs/video-document";`、`import { mediaClipCss, mediaSeekTargetSec, shouldSeekVideo } from "./media-preview";`、`import { mediaSrcUrl } from "./media-assets";`。
3. `TimelinePreview` props 增 `assets?: MediaAsset[]`；函数体开头 `const assetsById = new Map((assets ?? []).map((a) => [a.assetId, a]));`
4. `activeContext` 收窄为 spec 项专用：
   ```ts
   const activeContext =
     active && "spec" in active
       ? shotCanvasContext({ durationMs: active.spec.durationMs, frames: active.frames })
       : null;
   ```
5. `activeCue` 的 spanMs 分支：
   ```ts
   const activeSpanMs =
     active === undefined
       ? 0
       : "spec" in active
         ? active.spec.durationMs
         : active.kind === "media"
           ? active.outMs - active.inMs
           : 0;
   // buildSubtitleCues 的 spanMs 实参从 active.spec.durationMs 换成 activeSpanMs（media 镜头也有字幕近似层）
   ```
6. 舞台渲染分支（替换现有 `active && activeContext ? <SpecCanvas/> : null`）：
   ```tsx
   {active ? (
     "spec" in active ? (
       activeContext ? (
         <SpecCanvas
           key={mapping.shotIndex}
           spec={active.spec}
           frame={mapping.localFrame}
           fps={activeContext.fps}
           durationFrames={activeContext.durationFrames}
         />
       ) : null
     ) : active.kind === "media" ? (
       <MediaStage
         key={mapping.shotIndex}
         asset={assetsById.get(active.assetId)}
         item={active}
         localFrame={mapping.localFrame}
       />
     ) : (
       <div className="media-missing" role="img" aria-label={active.reason}>
         {active.reason}
       </div>
     )
   ) : null}
   ```
7. 新增 `MediaStage`（文件内、`TimelinePreview` 之前）：
   ```tsx
   // P2/P3/P4：媒体镜头预览——muted <video> + cover/contain 裁切 + 帧驱动 seek
   //（80ms 节流防抖）；文件 404/解码错降级占位，不炸页。音频恒静音：
   // 预览本无声，audio:"keep" 是 T4 出片混音语义。
   function MediaStage({
     asset,
     item,
     localFrame,
   }: {
     asset: MediaAsset | undefined;
     item: Extract<TimelinePreviewItem, { kind: "media" }>;
     localFrame: number;
   }) {
     const videoRef = useRef<HTMLVideoElement | null>(null);
     const [failed, setFailed] = useState(false);
     useEffect(() => {
       const video = videoRef.current;
       if (!video || !asset || failed) return;
       const targetSec = mediaSeekTargetSec(item.inMs, localFrame, PIECE_FPS);
       if (shouldSeekVideo(video.currentTime, targetSec)) {
         video.currentTime = targetSec;
       }
     }, [localFrame, item.inMs, asset, failed]);
     if (!asset) {
       return (
         <div className="media-missing" role="img" aria-label="素材缺失">
           素材缺失：资产不在账本
         </div>
       );
     }
     if (failed) {
       return (
         <div className="media-missing" role="img" aria-label="素材文件不可用">
           素材缺失：文件无法加载或解码（其余镜头不受影响）
         </div>
       );
     }
     const css = mediaClipCss(
       asset.original.width,
       asset.original.height,
       PREVIEW_WIDTH,
       PREVIEW_HEIGHT,
       item.fit,
       item.focalX,
     );
     return (
       <video
         ref={videoRef}
         className="media-stage"
         src={mediaSrcUrl(asset)}
         style={css}
         muted
         playsInline
         preload="metadata"
         onError={() => setFailed(true)}
       />
     );
   }
   ```
8. 近似标注：controls 里既有字幕近似 span 旁，`items.some((item) => item.kind === "media")` 为真时追加：
   ```tsx
   <span className="preview-subtitle-note">媒体镜头为帧驱动预览近似</span>
   ```
9. video-studio.css 追加：
   ```css
   .media-stage {
     width: 100%;
     height: 100%;
     display: block;
     background: #000;
   }
   .media-missing {
     width: 100%;
     height: 100%;
     display: flex;
     align-items: center;
     justify-content: center;
     background: #2a2a2e;
     color: #d8d8dc;
     font-size: 14px;
     padding: 16px;
     box-sizing: border-box;
     text-align: center;
   }
   ```

- [ ] **Step 6: 全量验证（组件改动的等价门）**

Run: `pnpm --filter @acs/web test 2>&1 | tail -5 && pnpm --filter @acs/web typecheck`
Expected: 全绿零错（既有测试含 piece-preview/scene-preview 相关零回归；TS 联合类型收窄无错）。

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/video-studio/shot-specs.ts apps/web/src/app/video-studio/shot-specs.test.ts apps/web/src/app/video-studio/scene-preview.tsx apps/web/src/app/video-studio/video-studio.css
git commit -m "feat(video-studio): 整片预览识媒体镜头——<video> 裁切渲染 + 素材缺失占位（T3 P1-P4）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: page.tsx 装配 + 素材面板 MediaPanel + 上传（P1 装配 / U4 / X1 / X2）

**Files:**
- Create: `apps/web/src/app/video-studio/media-panel.tsx`（组件，不单测）
- Modify: `apps/web/src/app/video-studio/page.tsx`（装配 + editable + 上传回调 + 面板挂载）

**Interfaces:**
- Consumes: Task 3 `appendMediaAsset`/`assetLabel`；Task 7 `shotWorkingMediaClip`、`TimelinePreview assets` prop；Task 1 patch 类型（`reviseWorkingVersion` 透传）；既有 `saveVideoProject`（乐观并发）。
- Produces: `<MediaPanel assets busy onUpload(file)/>`；`ShotEditorCard` 新 prop `mediaAssets: MediaAsset[]`（Task 9 消费）；`uploadMedia` 页面回调。

- [ ] **Step 1: 写 media-panel.tsx（全新组件）**

```tsx
"use client";

// P2.5-T3 素材面板（spec §2.2 U4/X1）：file input → POST /api/media/ingest →
// 账本追加 + 保存由页面回调完成；失败行内中文错误，文档零改动。
import { useRef, useState } from "react";
import type { MediaAsset } from "@acs/video-document";
import { assetLabel } from "./media-assets";

export function MediaPanel({
  assets,
  busy,
  onUpload,
}: {
  assets: MediaAsset[];
  busy: boolean;
  onUpload: (file: File) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  return (
    <section className="media-panel">
      <h4>素材</h4>
      {assets.length === 0 ? (
        <p className="media-empty">
          尚无素材——上传 mp4/webm/mov（≤500MB，仅本地开发环境）
        </p>
      ) : (
        <ul className="media-list">
          {assets.map((asset) => (
            <li key={asset.assetId} className="media-item">
              {assetLabel(asset, assets)}
            </li>
          ))}
        </ul>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".mp4,.webm,.mov,video/mp4,video/webm,video/quicktime"
      />
      <button
        type="button"
        className="media-upload"
        disabled={busy || uploading}
        onClick={async () => {
          const file = inputRef.current?.files?.[0];
          if (!file) {
            setUploadError("请先选择文件");
            return;
          }
          setUploading(true);
          setUploadError(null);
          try {
            await onUpload(file);
            if (inputRef.current) inputRef.current.value = "";
          } catch (error) {
            setUploadError(
              error instanceof Error ? error.message : String(error),
            );
          } finally {
            setUploading(false);
          }
        }}
      >
        上传素材
      </button>
      {uploadError ? (
        <p className="media-upload-error" role="alert">
          {uploadError}
        </p>
      ) : null}
    </section>
  );
}
```

video-studio.css 追加：

```css
.media-panel {
  border: 1px solid #3a3a40;
  border-radius: 8px;
  padding: 12px;
  margin: 12px 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.media-list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.media-item,
.media-empty {
  font-size: 13px;
  color: #c8c8cc;
}
.media-upload-error {
  color: #e08080;
  font-size: 13px;
  margin: 0;
}
```

- [ ] **Step 2: 改 page.tsx**

1. import 增加：`import type { MediaAsset } from "@acs/video-document";`（并入既有 video-document import）、`import { appendMediaAsset } from "./media-assets";`、`import { MediaPanel } from "./media-panel";`、`shotWorkingMediaClip` 并入 `./shot-specs` import。
2. `shotSpecs` 行后追加：
   ```ts
   const shotMediaClips = document.shots.map((shot) => shotWorkingMediaClip(shot));
   const mediaAssets = document.mediaAssets ?? [];
   const assetsById = new Map(mediaAssets.map((a) => [a.assetId, a]));
   ```
3. pieceItems 装配（P1，替换 143-155 的 `if (...)` 块）：
   ```ts
   const perShot: (TimelinePreviewItem | null)[] = document.shots.map(
     (shot, index) => {
       const spec = shotSpecs[index] as SceneSpec | null;
       const meta = workingMeta[index]!;
       const media = shotMediaClips[index];
       if (spec) {
         return {
           spec,
           startFrame: 0,
           frames: 0,
           narrationText: meta.narrationText,
         };
       }
       if (media) {
         return assetsById.has(media.mediaAssetId)
           ? {
               kind: "media",
               assetId: media.mediaAssetId,
               inMs: media.inMs,
               outMs: media.outMs,
               fit: media.fit,
               focalX: media.focalX,
               startFrame: 0,
               frames: 0,
               narrationText: meta.narrationText,
             }
           : {
               kind: "missing",
               reason: `素材缺失：${media.mediaAssetId.slice(0, 8)} 不在账本`,
               startFrame: 0,
               frames: 0,
             };
       }
       return null; // editor-binding 等未来成员：整片仍降级（X2）
     },
   );
   if (
     document.shots.length > 0 &&
     durations.every((duration) => duration > 0) &&
     perShot.every((item) => item !== null)
   ) {
     pieceTimeline = quantizeTimeline(durations, 24);
     pieceItems = perShot.map((item, index) => ({
       ...item!,
       startFrame: pieceTimeline!.shots[index]!.startFrame,
       frames: pieceTimeline!.shots[index]!.frames,
     }));
   }
   ```
4. X2 降级文案（591-594 处）改为：
   ```tsx
   <p className="editor-hint">
     镜头含不可预览的场景源（非 spec/媒体）或时长缺失，整片预览不可用。
   </p>
   ```
5. `TimelinePreview` 挂载处加 `assets={mediaAssets}`。
6. `ShotEditorCard` 挂载处：`editable={shotSpecs[index] !== null || shotMediaClips[index] !== null}` + 新 prop `mediaAssets={mediaAssets}`。
7. 上传回调（`applyTransitionRows` 之后定义）：
   ```ts
   const uploadMedia = async (file: File) => {
     const form = new FormData();
     form.append("file", file);
     setEditor({ ...editor, busy: true, message: null });
     let asset: MediaAsset | undefined;
     try {
       const response = await fetch("/api/media/ingest", {
         method: "POST",
         body: form,
       });
       const payload = (await response.json().catch(() => ({}))) as {
         asset?: MediaAsset;
         error?: string;
       };
       if (!response.ok || !payload.asset) {
         throw new Error(
           payload.error ?? `上传失败（HTTP ${response.status}）`,
         );
       }
       asset = payload.asset;
     } catch (error) {
       setEditor({
         ...editor,
         busy: false,
         message: `上传失败：${error instanceof Error ? error.message : String(error)}`,
       });
       throw error instanceof Error ? error : new Error(String(error));
     }
     try {
       const saved = await saveVideoProject({
         ...document,
         mediaAssets: appendMediaAsset(document.mediaAssets, asset),
       });
       setEditor({
         document: saved,
         message: "素材已上传并保存",
         busy: false,
         sentence,
         plan,
         storyboard,
       });
     } catch (error) {
       setEditor({
         ...editor,
         busy: false,
         message: error instanceof Error ? error.message : "保存失败",
       });
       throw error instanceof Error ? error : new Error(String(error));
     }
   };
   ```
8. 面板挂载：`项目标题` label 之后插 `<MediaPanel assets={mediaAssets} busy={busy} onUpload={uploadMedia} />`。

- [ ] **Step 3: 全量验证**

Run: `pnpm --filter @acs/web test 2>&1 | tail -5 && pnpm --filter @acs/web typecheck`
Expected: 全绿零错（page 装配是组件代码，零单测；既有 local-video-projects/project-io 等不受影响）。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/video-studio/media-panel.tsx apps/web/src/app/video-studio/page.tsx apps/web/src/app/video-studio/video-studio.css
git commit -m "feat(video-studio): 素材面板上传入账本 + 整片预览装配 spec|media|missing（T3 P1/U4/X1/X2）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

（注：本任务给 `ShotEditorCard` 传了新 prop `mediaAssets`，但卡片的 props 类型在 Task 9 才扩——同提交内 TS 会报错。**执行顺序调整：Task 8 与 Task 9 的 Step 3 均要求 typecheck 过，因此 Task 8 提交时 ShotEditorCard props 已在 Task 9 Step 1 先行扩展**；实操时先做 Task 9 的 props 类型扩展（不含媒体臂逻辑），或把 Task 8 的 `mediaAssets` prop 传参与 Task 9 合并提交——取后者：Task 8 Step 2 第 6 点的 prop 传参挪到 Task 9 提交。以 typecheck 全绿为门。）

---

### Task 9: shot-editor-card 媒体臂 + 模板下拉第七 optgroup（M6 + §1 应用链两臂）

**Files:**
- Modify: `apps/web/src/app/video-studio/shot-editor-card.tsx`

**Interfaces:**
- Consumes: Task 5 `MEDIA_TEMPLATE_ID`/`MEDIA_TEMPLATE_LABEL`/`MediaEditDraft`/`draftMediaFromVersion`/`buildMediaRevisePatch`；Task 3 `assetLabel`；Task 8 页面传入 `mediaAssets`。
- Produces: `ShotEditorCardProps` 增 `mediaAssets: MediaAsset[]`；`onRevise` patch 类型扩为 `{ narrationText?: string; spec?: unknown; mediaClip?: MediaClipPatch }`（与 Task 1 op 对齐）。

- [ ] **Step 1: props 与状态扩展**

1. props 类型：
   ```ts
   export type ShotEditorCardProps = {
     shot: Shot;
     index: number;
     frames: number;
     editable: boolean;
     // P2.5-T3：媒体镜头编辑臂所需账本（素材下拉/默认入出点）。
     mediaAssets: MediaAsset[];
     onRevise: (patch: { narrationText?: string; spec?: unknown; mediaClip?: MediaClipPatch }) => void;
     onRedo: (directive: string) => void;
     onRollback: (versionId: string) => void;
     onToggleLock: (locked: boolean) => void;
     redoError: string | null;
   };
   ```
   （`MediaClipPatch` 从 `@acs/video-document` import；`MediaAsset` 同。）
2. import 增：`import { assetLabel } from "./media-assets";` 与 `import { buildMediaRevisePatch, draftMediaFromVersion, MEDIA_TEMPLATE_ID, MEDIA_TEMPLATE_LABEL, type MediaEditDraft } from "./media-clip-templates";`
3. `EMPTY_MEDIA_DRAFT`（文件顶常量区）：
   ```ts
   const EMPTY_MEDIA_DRAFT: MediaEditDraft = {
     assetId: "", inMsText: "0", outMsText: "2000",
     fit: "cover", focalPercentText: "50", audio: "mute",
   };
   ```
4. 合成基底（媒体→spec 换装时六族链的 substrate；`resolveAnyTemplate` 会覆写 componentId/params，基底只贡献 seed/background/durationMs）：
   ```ts
   function mediaSubstrateSpec(durationMs: number): SceneSpec {
     return {
       specVersion: 1, componentId: "bar-chart", componentVersion: 1,
       durationMs: Math.max(durationMs, 200), seed: 1,
       background: "#ffffff", params: {},
     };
   }
   ```
   （字段名以 video-scene `SceneSpec` 实际类型为准——对齐 chart-templates.test.ts 夹具。）
5. 组件体内、`const spec = shotWorkingSpec(shot);` 之后：
   ```ts
   const mediaSource =
     working?.sceneSource.type === "media-clip" ? working.sceneSource : null;
   // spec 缺席但工作版本是媒体 → 用合成基底撑起通用草稿（旁白/时长）与模板链
   const editSpec =
     spec ?? (working && mediaSource ? mediaSubstrateSpec(working.durationMs) : null);
   const canEdit = editable && working !== undefined && editSpec !== null;
   // 媒体臂启用条件：已选媒体条目，或工作版本就是媒体且未选 spec 模板
   const editingMedia =
     pendingTemplateId === MEDIA_TEMPLATE_ID ||
     (mediaSource !== null && pendingTemplateId === "");
   ```
   （原 `const canEdit = editable && working !== undefined && spec !== null;` 删除；draft 初始化与 reset effect 里的 `spec` 全换 `editSpec`——`draftFromWorking({...}, editSpec)`。）
6. 媒体草稿状态（家族草稿区末尾）：
   ```ts
   const [mediaDraft, setMediaDraft] = useState<MediaEditDraft | null>(() =>
     draftMediaFromVersion(working, mediaAssets).draft,
   );
   const [mediaError, setMediaError] = useState<string | null>(null);
   const [mediaWarnings, setMediaWarnings] = useState<string[]>([]);
   ```
   working 变更 reset effect 内追加：
   ```ts
   setMediaDraft(draftMediaFromVersion(nextWorking, mediaAssets).draft);
   setMediaError(null);
   setMediaWarnings([]);
   ```
   （effect 现签名从 `shot` 取 `nextWorking`——沿用现状写法。）

- [ ] **Step 2: 模板下拉第七 optgroup + onChange 媒体分支（M6）**

下拉 label 文案改「组件模板（图表 / 地图 / 流程 / 火柴人 / 手绘 / 加载 / 媒体）」；options 末尾追加：

```tsx
<optgroup label="媒体">
  <option value={MEDIA_TEMPLATE_ID}>{MEDIA_TEMPLATE_LABEL}</option>
</optgroup>
```

onChange 头部插媒体分支（在 `if (!templateId) return;` 之后、`resolveAnyTemplate` 之前）：

```ts
if (templateId === MEDIA_TEMPLATE_ID) {
  const seeded = draftMediaFromVersion(working, mediaAssets);
  setMediaDraft(seeded.draft);
  setMediaError(seeded.error);
  setMediaWarnings([]);
  return;
}
const applied = resolveAnyTemplate(editSpec ?? spec, templateId);
```

（`resolveAnyTemplate` 原实参 `spec` 换 `editSpec ?? spec`——媒体镜头选 spec 模板即换装预填。）

- [ ] **Step 3: 应用按钮两臂（应用链改造）**

onClick 头部插媒体臂（在 `let baseSpec = spec;` 之前）：

```ts
if (editingMedia) {
  if (!mediaDraft) {
    setMediaError("项目尚无媒体素材，请先在素材面板上传");
    return;
  }
  const built = buildMediaRevisePatch(mediaDraft, mediaAssets, draft.narrationText);
  if (built.error || !built.patch) {
    setMediaError(built.error ?? "媒体字段无效");
    return;
  }
  setMediaError(null);
  setMediaWarnings(built.warnings);
  setEditError(null);
  onRevise(built.patch);
  return;
}
```

spec 臂基底行改 `let baseSpec = editSpec;`（原 `= spec`）——媒体镜头选了 spec 模板时 `pendingTemplateId` 非空且非 MEDIA_TEMPLATE_ID → editingMedia 为 false → 走既有六族链完成换装（narration 合并语义共用）。既有链体零改动。

- [ ] **Step 4: 编辑字段分支（媒体字段替换 spec 专属字段）**

展开编辑区改结构：旁白 textarea（330-340）**保留在外层共享**（媒体臂也用它改 narration）；背景色/时长/标题副标题/换模板按钮/各族数据字段（341-764 的 spec 专属块）包进 `{!editingMedia ? (<>…</>) : (<媒体字段/>)}`。媒体字段：

```tsx
) : (
  <>
    <label className="shot-edit-field">
      素材
      <select
        className="media-asset-select"
        value={mediaDraft?.assetId ?? ""}
        onChange={(event) =>
          setMediaDraft({
            ...(mediaDraft ?? EMPTY_MEDIA_DRAFT),
            assetId: event.target.value,
          })
        }
      >
        {mediaAssets.length === 0 ? (
          <option value="">（项目尚无素材）</option>
        ) : (
          mediaAssets.map((asset) => (
            <option key={asset.assetId} value={asset.assetId}>
              {assetLabel(asset, mediaAssets)}
            </option>
          ))
        )}
      </select>
    </label>
    <label className="shot-edit-field">
      入点（ms）
      <input
        className="media-in-input"
        value={mediaDraft?.inMsText ?? ""}
        onChange={(event) =>
          setMediaDraft({
            ...(mediaDraft ?? EMPTY_MEDIA_DRAFT),
            inMsText: event.target.value,
          })
        }
      />
    </label>
    <label className="shot-edit-field">
      出点（ms）
      <input
        className="media-out-input"
        value={mediaDraft?.outMsText ?? ""}
        onChange={(event) =>
          setMediaDraft({
            ...(mediaDraft ?? EMPTY_MEDIA_DRAFT),
            outMsText: event.target.value,
          })
        }
      />
    </label>
    <span className="media-span-note">
      片段时长{" "}
      {Math.max(
        (Number(mediaDraft?.outMsText) || 0) -
          (Number(mediaDraft?.inMsText) || 0),
        0,
      )}
      ms（出点−入点，出片同长）
    </span>
    <label className="shot-edit-field">
      画面适配
      <select
        className="media-fit-select"
        value={mediaDraft?.fit ?? "cover"}
        onChange={(event) =>
          setMediaDraft({
            ...(mediaDraft ?? EMPTY_MEDIA_DRAFT),
            fit: event.target.value === "contain" ? "contain" : "cover",
          })
        }
      >
        <option value="cover">cover（裁切铺满）</option>
        <option value="contain">contain（完整留边）</option>
      </select>
    </label>
    <label className="shot-edit-field">
      注视点（%，cover 横向裁切时生效）
      <input
        className="media-focal-input"
        value={mediaDraft?.focalPercentText ?? ""}
        onChange={(event) =>
          setMediaDraft({
            ...(mediaDraft ?? EMPTY_MEDIA_DRAFT),
            focalPercentText: event.target.value,
          })
        }
      />
    </label>
    <label className="shot-edit-field">
      原声
      <select
        className="media-audio-select"
        value={mediaDraft?.audio ?? "mute"}
        onChange={(event) =>
          setMediaDraft({
            ...(mediaDraft ?? EMPTY_MEDIA_DRAFT),
            audio: event.target.value === "keep" ? "keep" : "mute",
          })
        }
      >
        <option value="mute">静音（预览/出片均不带原声）</option>
        <option value="keep">保留（出片与旁白混音，T4 兑现）</option>
      </select>
    </label>
    {mediaWarnings.map((warning) => (
      <p key={warning} className="media-warning" role="status">
        {warning}
      </p>
    ))}
    {mediaError ? (
      <p className="shot-edit-error">{mediaError}</p>
    ) : null}
  </>
)}
```

（spec 臂的语速溢出提示 765-788 留在 spec 分支内；`editError` 显示与应用/取消按钮保留在共享层。CSS 补 `.media-warning { color: #d8b04a; font-size: 13px; margin: 0; } .media-span-note { font-size: 12px; color: #9a9aa0; }`。）

- [ ] **Step 5: 全量验证**

Run: `pnpm run build && pnpm -r test 2>&1 | tail -15 && pnpm -r typecheck && npx biome check .`
Expected: 全绿零错零问题（web/video-document/video-scene/media-store/scripts；`pnpm run build` 先行——web 依赖 video-document 新导出的 dist）。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/video-studio/shot-editor-card.tsx apps/web/src/app/video-studio/page.tsx apps/web/src/app/video-studio/video-studio.css
git commit -m "feat(video-studio): 镜头卡媒体编辑臂 + 模板下拉第七族「媒体」（T3 M6/§1 两臂）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

（page.tsx 的 `mediaAssets` prop 传参若 Task 8 未随提交——按 Task 8 注记并入本提交。）

---

## 收口（executing-plans 终段，非独立任务）

1. 全电池复跑：`pnpm run build && pnpm -r test && node --test scripts/video/*.test.mjs && pnpm -r typecheck && npx biome check .`；`wc -l artifacts/tts-usage.jsonl` 须 34。
2. 手动冒烟（dev server，不进自动化，spec §6.2）：上传 2s mp4 → 素材列表 → 换媒体镜头 → 设入出点/fit/focal → 保存重开回填 → 预览出画面（cover 随 focalX 移动）→ 删仓文件预览变占位。
3. 终评（opus 全分支）→ 按效应重定级 → Critical/Important 一次修复通 → 台账 Final 行 → 删工作区 → CURRENT_STATE 条目 → Codex 交接单 `artifacts/codex-review-video-studio-p2-media-t3.md`。
