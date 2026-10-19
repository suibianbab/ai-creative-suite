# P2.5-T1 媒体镜头数据契约 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `@acs/video-document` 落地 media-clip 场景源、mediaAssets 账本、assetDigests 渲染摘要的类型与校验（P2.5 六任务的第一刀，纯契约层）。

**Architecture:** 三处增量——`types.ts` 加联合成员与两个可选字段（全部加法，schemaVersion 不动）；`validate.ts` 新增 `validateMediaAssets` 并把资产 Map 沿 `validateVideoProject → validateShot → validateContentVersion → validateSceneSource` 下传做交叉校验；ADR 0003 追加第四次修订条目。消费方零改动（全仓 `sceneSource` 消费均为 `!== "spec"` 守卫，media-clip 自动落入既有拒绝/降级路径）。

**Tech Stack:** TypeScript + node:test（既有 `packages/video-document`），biome，pnpm workspace。

**Spec:** `docs/superpowers/specs/2026-10-19-video-studio-media-clip-contract-design.md`（规则编号 A1-A8/C1-C6/R1-R2 与测试清单 1-17 均出自该 spec）。

## Global Constraints

- 单元测试零网络（纯 Node）；本刀无浏览器链路、无 qa registry 新条目（VID-023 在 T6 登记）。
- 错误消息：数组/UUID/ISO 沿英文既有句式；media 专属规则用中文（沿 transitions 先例）。
- `MAX_ARRAY=1000`、`VIDEO_PROJECT_MAX_BYTES=2MiB`、`MAX_DURATION_MS=600000` 不变；schemaVersion 保持 1；旧文档零改动必须通过。
- 代码风格沿 `validate.ts` 现状：双引号、分号、`fail()` 抛 `VideoProjectValidationError`。
- 每个 commit 结尾 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 构建/测试命令：`pnpm --filter @acs/video-document run build && node --test "packages/video-document/dist/**/*.test.js"`（当前 71 pass）。

## Review Focus

Spec 测试清单未覆盖、最可能咬到使用者的五类输入（每条已钉进所属任务的测试）：

1. **非整数 fps（29.97）**：数字字段误收紧成整数会让合法素材落不了账 → Task 1 测试「fps=29.97 → 通过」。
2. **NaN/Infinity focalX**：`typeof === "number"` 放过 NaN → Task 2 用 `Number.isFinite` 并测 `NaN` 拒绝。
3. **storeKey 正则合法但前缀与 sha256 不对应**（内容寻址被偷换）→ Task 1 测「storeKey 前缀错位 → 拒绝」。
4. **两镜头引用同一 assetId**（素材复用）被误判重复 → Task 2 测「复用 → 通过」。
5. **assetDigests 键指向账本外资产**（渲染钉住幽灵素材）→ Task 3 测「键不在账本 → 拒绝」。

**TDD 排序预警（执行者必读）**：`mediaAssets`/`assetDigests` 是新增可选键，旧校验**忽略未知键**——正路径测试会先绿，这是兼容性见证，不是无效测试；每个任务的 RED 由**负路径测试**承担（断言 throw 的用例在实现前必然失败，因为旧校验根本不抛）。`media-clip` 正路径在旧校验下是未知类型，天然 RED。

---

### Task 1: MediaAsset 类型与账本校验

**Files:**
- Modify: `packages/video-document/src/types.ts`（加 `MediaAsset` 及 VideoProject.mediaAssets?）
- Modify: `packages/video-document/src/validate.ts`（加 `validateMediaAssets`，在 shots 循环前调用）
- Test: `packages/video-document/src/validate.test.ts`（追加）

**Interfaces:**
- Produces: `type MediaAsset`（导出）；`validateMediaAssets(value: unknown): Map<string, number>`（模块内私有，返回 assetId → durationMs）；该 Map 是 Task 2/3 交叉校验的输入。

- [ ] **Step 1: 写夹具与负/正路径测试（RED）**

在 `validate.test.ts` 的 `baseProject` 之后追加（先夹具后测试；正路径标兼容见证）：

```ts
// —— P2.5-T1 媒体资产账本（spec A1-A8）——
import type { MediaAsset } from "./types.js";

const ASSET_ID = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b2002";
const ASSET_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // 64 个 a

function mediaAsset(overrides: Record<string, unknown> = {}): MediaAsset {
  return {
    assetId: ASSET_ID,
    createdAt: "2026-10-19T00:00:00.000Z",
    origin: { kind: "local-upload", fileName: "demo.mp4" },
    original: {
      sha256: ASSET_SHA,
      bytes: 123456,
      durationMs: 30000,
      width: 1920,
      height: 1080,
      fps: 30,
      codec: "h264",
      hasAudio: true,
      storeKey: "aaaaaaaaaaaaaaaa.mp4", // sha256 前 16 位 + 扩展名
    },
    ...overrides,
  } as MediaAsset;
}

test("mediaAssets 非数组（对象）→ 拒绝（A1）", () => {
  const p = baseProject();
  (p as Record<string, unknown>).mediaAssets = { a: mediaAsset() };
  assert.throws(() => validateVideoProject(p), /mediaAssets/);
});

test("mediaAssets assetId 重复 → 拒绝（A2）", () => {
  const p = baseProject();
  (p as Record<string, unknown>).mediaAssets = [mediaAsset(), mediaAsset()];
  assert.throws(() => validateVideoProject(p), /duplicated/);
});

test("mediaAssets assetId 非 UUID → 拒绝（A2）", () => {
  const p = baseProject();
  (p as Record<string, unknown>).mediaAssets = [
    mediaAsset({ assetId: "not-a-uuid" }),
  ];
  assert.throws(() => validateVideoProject(p), /assetId must be a UUID/);
});

test("stock-source 缺 license.name → 拒绝（A4）", () => {
  const p = baseProject();
  (p as Record<string, unknown>).mediaAssets = [
    mediaAsset({
      origin: {
        kind: "stock-source",
        sourceId: "wikimedia",
        sourcePageUrl: "https://commons.wikimedia.org/wiki/File:X",
        license: { name: "" },
        retrievedAt: "2026-10-19T00:00:00.000Z",
      },
    }),
  ];
  assert.throws(() => validateVideoProject(p), /license\.name/);
});

test("stock-source sourceId 非 wikimedia → 拒绝（A4）", () => {
  const p = baseProject();
  (p as Record<string, unknown>).mediaAssets = [
    mediaAsset({
      origin: {
        kind: "stock-source",
        sourceId: "pexels",
        sourcePageUrl: "https://example.com/x",
        license: { name: "CC0" },
        retrievedAt: "2026-10-19T00:00:00.000Z",
      },
    }),
  ];
  assert.throws(() => validateVideoProject(p), /sourceId/);
});

test("stock-source sourcePageUrl 非 http(s) → 拒绝（A4）", () => {
  const p = baseProject();
  (p as Record<string, unknown>).mediaAssets = [
    mediaAsset({
      origin: {
        kind: "stock-source",
        sourceId: "wikimedia",
        sourcePageUrl: "ftp://example.com/x",
        license: { name: "CC0" },
        retrievedAt: "2026-10-19T00:00:00.000Z",
      },
    }),
  ];
  assert.throws(() => validateVideoProject(p), /sourcePageUrl/);
});

test("original.sha256 63 位 → 拒绝（A5）", () => {
  const p = baseProject();
  (p as Record<string, unknown>).mediaAssets = [
    mediaAsset({
      original: { ...mediaAsset().original, sha256: "a".repeat(63) },
    }),
  ];
  assert.throws(() => validateVideoProject(p), /sha256/);
});

test("storeKey 前缀与 sha256 不对应 → 拒绝（A7）", () => {
  const p = baseProject();
  (p as Record<string, unknown>).mediaAssets = [
    mediaAsset({
      original: { ...mediaAsset().original, storeKey: "bbbbbbbbbbbbbbbb.mp4" },
    }),
  ];
  assert.throws(() => validateVideoProject(p), /storeKey/);
});

test("storeKey 非法扩展名 .avi → 拒绝（A7）", () => {
  const p = baseProject();
  (p as Record<string, unknown>).mediaAssets = [
    mediaAsset({
      original: { ...mediaAsset().original, storeKey: "aaaaaaaaaaaaaaaa.avi" },
    }),
  ];
  assert.throws(() => validateVideoProject(p), /storeKey/);
});

test("durationMs=199 的源 → 拒绝（A6 下界）", () => {
  const p = baseProject();
  (p as Record<string, unknown>).mediaAssets = [
    mediaAsset({
      original: { ...mediaAsset().original, durationMs: 199 },
    }),
  ];
  assert.throws(() => validateVideoProject(p), /durationMs/);
});

test("proxy 负 width → 拒绝（A8）", () => {
  const p = baseProject();
  (p as Record<string, unknown>).mediaAssets = [
    mediaAsset({ proxy: { sha256: ASSET_SHA, bytes: 1, width: -1, height: 720, note: "h264 720p" } }),
  ];
  assert.throws(() => validateVideoProject(p), /proxy/);
});

test("合法账本（两种 origin、fps=29.97、含 proxy）→ 通过（兼容见证：先绿）", () => {
  const p = baseProject();
  const local = mediaAsset();
  const stock = mediaAsset({
    assetId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b2004",
    origin: {
      kind: "stock-source",
      sourceId: "wikimedia",
      sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Clouds",
      license: { name: "CC BY-SA 4.0", author: "Nesnad", usageNote: "署名即可" },
      retrievedAt: "2026-10-19T00:00:00.000Z",
    },
    original: {
      ...mediaAsset().original,
      sha256: "b".repeat(64),
      fps: 29.97,
      storeKey: "bbbbbbbbbbbbbbbb.webm",
      codec: "vp9",
    },
    proxy: { sha256: "c".repeat(64), bytes: 999, width: 1280, height: 720, note: "h264 720p cap" },
  });
  (p as Record<string, unknown>).mediaAssets = [local, stock];
  const out = validateVideoProject(p);
  assert.equal((out as Record<string, unknown>).mediaAssets?.length ?? 0, 2);
});
```

注意 `import type { MediaAsset }` 合并进文件顶部既有 import（不重复起行）。

- [ ] **Step 2: 构建并跑测试，确认负路径全 RED**

Run: `pnpm --filter @acs/video-document run build && node --test packages/video-document/dist/validate.test.js`
Expected: FAIL —— 11 个负路径用例全部以「Missing expected exception」失败（旧校验忽略 mediaAssets 键）；「合法账本」用例 PASS（兼容见证，计划已预告）。

- [ ] **Step 3: 类型与校验实现（GREEN）**

`types.ts` 追加（放在 `ShotTransition` 之后）：

```ts
// —— P2.5 媒体混编（T1 契约）：项目级追加账本，与 renderRecords 同纪律（只追加）——
export type MediaAsset = {
  assetId: string; // UUID，账本内唯一
  createdAt: string; // ISO 8601
  origin:
    | { kind: "local-upload"; fileName: string }
    | {
        kind: "stock-source";
        sourceId: "wikimedia"; // 首个公开来源；扩源时升格联合
        sourcePageUrl: string;
        license: { name: string; author?: string; usageNote?: string };
        retrievedAt: string;
      };
  original: {
    // ffprobe 实测，导入核验通过才落账；不可变（ADR 0001）
    sha256: string; // 64 位小写 hex
    bytes: number;
    durationMs: number; // 200..600000
    width: number;
    height: number;
    fps: number; // 正有限数（29.97 合法）
    codec: string;
    hasAudio: boolean;
    storeKey: string; // `${sha256 前 16 位}.${mp4|webm|mov}` 内容寻址
  };
  proxy?: {
    // 浏览器预览用转码代理，可再生成
    sha256: string;
    bytes: number;
    width: number;
    height: number;
    note: string; // 转码参数摘要
  };
};
```

`VideoProject` 加可选字段（放 `transitions?` 旁）：

```ts
  // —— P2.5 媒体混编：素材元数据账本（二进制不入文档，只追加）——
  mediaAssets?: MediaAsset[];
```

`validate.ts`：顶部常量区加 `const SHA256_HEX = /^[0-9a-f]{64}$/;`；新增函数（放 `validateSceneSource` 前）：

```ts
// 返回 assetId → durationMs 映射，供 media-clip 出入点与 assetDigests 交叉校验。
function validateMediaAssets(value: unknown): Map<string, number> {
  if (value === undefined) return new Map();
  if (!Array.isArray(value) || value.length > MAX_ARRAY) {
    fail(`mediaAssets must be an array of at most ${MAX_ARRAY} entries`);
  }
  const durations = new Map<string, number>();
  for (const [index, asset] of value.entries()) {
    const field = `mediaAssets[${index}]`;
    if (!isRecord(asset)) fail(`${field} must be an object`);
    if (!isUuid(asset.assetId)) fail(`${field}.assetId must be a UUID`);
    if (durations.has(asset.assetId)) fail(`${field}.assetId is duplicated`);
    if (!isIsoTime(asset.createdAt))
      fail(`${field}.createdAt must be an ISO 8601 string`);
    const origin = asset.origin;
    if (!isRecord(origin)) fail(`${field}.origin must be an object`);
    if (origin.kind === "local-upload") {
      if (
        typeof origin.fileName !== "string" ||
        origin.fileName.length < 1 ||
        origin.fileName.length > 200
      ) {
        fail(`${field}.origin.fileName 须为 1..200 字符`);
      }
    } else if (origin.kind === "stock-source") {
      if (origin.sourceId !== "wikimedia")
        fail(`${field}.origin.sourceId 须为 "wikimedia"`);
      if (
        typeof origin.sourcePageUrl !== "string" ||
        !/^https?:\/\//.test(origin.sourcePageUrl) ||
        origin.sourcePageUrl.length > 2000
      ) {
        fail(`${field}.origin.sourcePageUrl 须为 http(s):// 开头且 ≤2000 字符`);
      }
      const license = origin.license;
      if (!isRecord(license)) fail(`${field}.origin.license must be an object`);
      if (
        typeof license.name !== "string" ||
        license.name.length < 1 ||
        license.name.length > 100
      ) {
        fail(`${field}.origin.license.name 须为 1..100 字符`);
      }
      for (const key of ["author", "usageNote"] as const) {
        const v = license[key];
        if (
          v !== undefined &&
          (typeof v !== "string" || v.length < 1 || v.length > 200)
        ) {
          fail(`${field}.origin.license.${key} 须为 1..200 字符`);
        }
      }
      if (!isIsoTime(origin.retrievedAt))
        fail(`${field}.origin.retrievedAt must be an ISO 8601 string`);
    } else {
      fail(`${field}.origin.kind must be "local-upload" or "stock-source"`);
    }
    const o = asset.original;
    if (!isRecord(o)) fail(`${field}.original must be an object`);
    if (typeof o.sha256 !== "string" || !SHA256_HEX.test(o.sha256)) {
      fail(`${field}.original.sha256 须为 64 位小写十六进制`);
    }
    if (!Number.isInteger(o.bytes) || (o.bytes as number) < 1) {
      fail(`${field}.original.bytes 须为正整数`);
    }
    if (
      !Number.isInteger(o.durationMs) ||
      (o.durationMs as number) < 200 ||
      (o.durationMs as number) > MAX_DURATION_MS
    ) {
      fail(
        `${field}.original.durationMs 须为 200..${MAX_DURATION_MS} 的整数毫秒`,
      );
    }
    if (
      !Number.isInteger(o.width) ||
      (o.width as number) < 1 ||
      !Number.isInteger(o.height) ||
      (o.height as number) < 1
    ) {
      fail(`${field}.original.width/height 须为正整数`);
    }
    if (
      typeof o.fps !== "number" ||
      !Number.isFinite(o.fps) ||
      (o.fps as number) <= 0
    ) {
      fail(`${field}.original.fps 须为正数`);
    }
    if (typeof o.codec !== "string" || o.codec.length === 0) {
      fail(`${field}.original.codec must be a non-empty string`);
    }
    if (typeof o.hasAudio !== "boolean") {
      fail(`${field}.original.hasAudio must be boolean`);
    }
    if (
      typeof o.storeKey !== "string" ||
      !/^[0-9a-f]{16}\.(mp4|webm|mov)$/.test(o.storeKey) ||
      (o.storeKey as string).slice(0, 16) !== (o.sha256 as string).slice(0, 16)
    ) {
      fail(`${field}.original.storeKey 须为 sha256 前 16 位 + .mp4/.webm/.mov`);
    }
    if (asset.proxy !== undefined) {
      const p = asset.proxy;
      if (!isRecord(p)) fail(`${field}.proxy must be an object`);
      if (typeof p.sha256 !== "string" || !SHA256_HEX.test(p.sha256)) {
        fail(`${field}.proxy.sha256 须为 64 位小写十六进制`);
      }
      if (!Number.isInteger(p.bytes) || (p.bytes as number) < 1) {
        fail(`${field}.proxy.bytes 须为正整数`);
      }
      if (
        !Number.isInteger(p.width) ||
        (p.width as number) < 1 ||
        !Number.isInteger(p.height) ||
        (p.height as number) < 1
      ) {
        fail(`${field}.proxy.width/height 须为正整数`);
      }
      if (typeof p.note !== "string" || p.note.length < 1 || p.note.length > 200) {
        fail(`${field}.proxy.note 须为 1..200 字符`);
      }
    }
    durations.set(asset.assetId as string, o.durationMs as number);
  }
  return durations;
}
```

`validateVideoProject` 里在 `if (!Array.isArray(parsed.shots) ...)` **之前**插入：

```ts
  // —— P2.5-T1：媒体资产账本先于镜头校验（media-clip 交叉校验需要资产时长）——
  const mediaAssetDurations = validateMediaAssets(parsed.mediaAssets);
```

- [ ] **Step 4: 构建并跑包内全部测试**

Run: `pnpm --filter @acs/video-document run build && node --test "packages/video-document/dist/**/*.test.js"`
Expected: PASS —— 既有 71 + 新增 12，全绿。

- [ ] **Step 5: Commit**

```bash
git add packages/video-document/src/types.ts packages/video-document/src/validate.ts packages/video-document/src/validate.test.ts
git commit -m "feat(video-document): P2.5-T1 mediaAssets 素材账本类型与校验（A1-A8）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: media-clip 场景源与出入点对账

**Files:**
- Modify: `packages/video-document/src/types.ts`（SceneSource 第三成员）
- Modify: `packages/video-document/src/validate.ts`（validateSceneSource/ContentVersion/Shot 签名下传 + C1-C6）
- Test: `packages/video-document/src/validate.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 的 `mediaAssetDurations: Map<string, number>`。
- Produces: `SceneSource` 含 `media-clip` 成员（T3 编辑卡/T4 出片的类型输入）；`validateContentVersion(value, field, mediaAssets)` 内部签名。

- [ ] **Step 1: 写负/正路径测试（media-clip 正路径天然 RED）**

```ts
// —— P2.5-T1 media-clip 场景源（spec C1-C6）——
const CLIP_VERSION_ID = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b2003";

function withMediaClipShot(
  p: VideoProject,
  sceneOverrides: Record<string, unknown> = {},
  versionOverrides: Record<string, unknown> = {},
): VideoProject {
  (p as Record<string, unknown>).mediaAssets = [mediaAsset()];
  p.shots.push({
    shotId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b2005",
    order: 1,
    locked: false,
    workingVersionId: CLIP_VERSION_ID,
    contentVersions: [
      {
        versionId: CLIP_VERSION_ID,
        createdAt: "2026-10-19T00:00:00.000Z",
        durationMs: 3000,
        description: "实拍镜头",
        narrationText: "",
        sceneSource: {
          type: "media-clip",
          mediaAssetId: ASSET_ID,
          inMs: 1000,
          outMs: 4000,
          fit: "cover",
          focalX: 0.5,
          audio: "mute",
          ...sceneOverrides,
        },
        provenance: { engineId: "media-import", engineVersion: "0" },
        ...versionOverrides,
      },
    ],
    events: [],
  });
  return p;
}

test("合法 media-clip 镜头 → 通过（C1-C6 正路径）", () => {
  const out = validateVideoProject(withMediaClipShot(baseProject()));
  assert.equal(out.shots[1]!.sceneSource.type, "media-clip");
});

test("mediaAssetId 指向不存在资产 → 拒绝（C1）", () => {
  assert.throws(
    () => validateVideoProject(withMediaClipShot(baseProject(), { mediaAssetId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b2999" })),
    /mediaAssetId/,
  );
});

test("outMs 超素材时长 → 拒绝（C3）", () => {
  assert.throws(
    () => validateVideoProject(withMediaClipShot(baseProject(), { outMs: 30001 })),
    /出入点越界/,
  );
});

test("outMs−inMs=199 → 拒绝（C3 最短 200ms）", () => {
  assert.throws(
    () =>
      validateVideoProject(
        withMediaClipShot(baseProject(), { inMs: 1000, outMs: 1199 }, { durationMs: 199 }),
      ),
    /出入点越界/,
  );
});

test("inMs 非整数 → 拒绝（C2）", () => {
  assert.throws(
    () => validateVideoProject(withMediaClipShot(baseProject(), { inMs: 1000.5 })),
    /inMs/,
  );
});

test("版本 durationMs ≠ outMs−inMs → 拒绝（C4 对账）", () => {
  assert.throws(
    () => validateVideoProject(withMediaClipShot(baseProject(), {}, { durationMs: 2500 })),
    /durationMs 须等于 outMs−inMs/,
  );
});

test("fit 非法 → 拒绝（C5）", () => {
  assert.throws(
    () => validateVideoProject(withMediaClipShot(baseProject(), { fit: "fill" })),
    /fit/,
  );
});

test("focalX 为 NaN → 拒绝（C6）", () => {
  assert.throws(
    () => validateVideoProject(withMediaClipShot(baseProject(), { focalX: Number.NaN })),
    /focalX/,
  );
});

test("focalX=1.5 → 拒绝（C6 上界）", () => {
  assert.throws(
    () => validateVideoProject(withMediaClipShot(baseProject(), { focalX: 1.5 })),
    /focalX/,
  );
});

test("audio 非法 → 拒绝（C5）", () => {
  assert.throws(
    () => validateVideoProject(withMediaClipShot(baseProject(), { audio: "auto" })),
    /audio/,
  );
});

test("两镜头引用同一 assetId → 通过（素材复用合法）", () => {
  const p = withMediaClipShot(baseProject());
  const first = p.shots[1]!;
  p.shots.push({
    ...first,
    shotId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b2006",
    order: 2,
    workingVersionId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b2007",
    contentVersions: [
      {
        ...first.contentVersions[0]!,
        versionId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b2007",
        sceneSource: {
          ...(first.contentVersions[0]!.sceneSource as Record<string, unknown>),
          inMs: 5000,
          outMs: 8000,
        },
        durationMs: 3000,
      },
    ],
  });
  assert.equal(validateVideoProject(p).shots.length, 3);
});
```

（注：sceneOverrides 只进 `sceneSource`、versionOverrides 只进版本顶层——覆盖 in/out 后须同步传一致的 `durationMs`，C4 对账才会聚焦被测规则。）

- [ ] **Step 2: 构建并跑测试，确认 RED**

Run: `pnpm --filter @acs/video-document run build && node --test packages/video-document/dist/validate.test.js`
Expected: FAIL —— 「合法 media-clip 镜头」以 `sceneSource.type must be "spec" or "editor-binding"` 失败（天然 RED）；其余负路径同样因未知类型先炸（失败消息不同属预期，RED 成立即可）。

- [ ] **Step 3: 类型与校验实现（GREEN）**

`types.ts` SceneSource 追加：

```ts
  | {
      // —— P2.5 媒体混编：实拍片段作受控镜头源。字段平台可校验/可预览，
      // 与 editor-binding 的「平台永不解析」语义相反（ADR 0003 §3.3 + 变更日志）——
      type: "media-clip";
      mediaAssetId: string; // 指向 project.mediaAssets[]
      inMs: number; // 整数，≥0
      outMs: number; // 整数，≥ inMs+200 且 ≤ asset.durationMs
      fit: "cover" | "contain";
      focalX: number; // 0..1，cover 裁切注视点（contain 时忽略）
      audio: "mute" | "keep"; // keep = 原声与 TTS 旁白混音
    };
```

`validate.ts`：`validateSceneSource` 加第三参并在 editor-binding 分支后加 media-clip 分支；`validateContentVersion`/`validateShot` 加 `mediaAssets: Map<string, number>` 参数并下传；调用点 `validateShot(shot, \`shots[${index}]\`, mediaAssetDurations)`；`validateContentVersion` 在 `validateSceneSource(...)` 调用后加 C4：

```ts
function validateSceneSource(
  value: unknown,
  field: string,
  mediaAssets: Map<string, number>,
): void {
  if (!isRecord(value)) fail(`${field}.sceneSource must be an object`);
  if (value.type === "spec") {
    // …既有不变…
  }
  if (value.type === "editor-binding") {
    // …既有不变…
  }
  if (value.type === "media-clip") {
    if (
      typeof value.mediaAssetId !== "string" ||
      !mediaAssets.has(value.mediaAssetId)
    ) {
      fail(`${field}.sceneSource.mediaAssetId 未指向 mediaAssets 账本中的资产`);
    }
    for (const key of ["inMs", "outMs"] as const) {
      if (!Number.isInteger(value[key]))
        fail(`${field}.sceneSource.${key} 须为整数毫秒`);
    }
    const assetDurationMs = mediaAssets.get(value.mediaAssetId as string);
    if (
      (value.inMs as number) < 0 ||
      (value.outMs as number) < (value.inMs as number) + 200 ||
      (value.outMs as number) > (assetDurationMs as number)
    ) {
      fail(
        `${field}.sceneSource 出入点越界（合法 inMs ≥ 0、inMs+200 ≤ outMs ≤ 素材 durationMs=${assetDurationMs}）`,
      );
    }
    if (value.fit !== "cover" && value.fit !== "contain") {
      fail(`${field}.sceneSource.fit 须为 "cover" 或 "contain"`);
    }
    if (
      typeof value.focalX !== "number" ||
      !Number.isFinite(value.focalX) ||
      (value.focalX as number) < 0 ||
      (value.focalX as number) > 1
    ) {
      fail(`${field}.sceneSource.focalX 须为 0..1 的数`);
    }
    if (value.audio !== "mute" && value.audio !== "keep") {
      fail(`${field}.sceneSource.audio 须为 "mute" 或 "keep"`);
    }
    return;
  }
  fail(`${field}.sceneSource.type must be "spec" | "editor-binding" | "media-clip"`);
}
```

`validateContentVersion` 签名 `(value: unknown, field: string, mediaAssets: Map<string, number>)`，末段校验：

```ts
  validateSceneSource(value.sceneSource, field, mediaAssets);
  // C4 对账：媒体镜头时长恒等于片段长度（渲染量化与交付 frameMap 依赖此恒等）
  if (isRecord(value.sceneSource) && value.sceneSource.type === "media-clip") {
    if (
      value.durationMs !==
      (value.sceneSource.outMs as number) - (value.sceneSource.inMs as number)
    ) {
      fail(`${field}.durationMs 须等于 outMs−inMs（媒体镜头时长=片段长度）`);
    }
  }
```

`validateShot` 同样加参下传；`validateVideoProject` 循环里调用改 `validateShot(shot, \`shots[${index}]\`, mediaAssetDurations)`。

- [ ] **Step 4: 构建并跑包内全部测试**

Run: `pnpm --filter @acs/video-document run build && node --test "packages/video-document/dist/**/*.test.js"`
Expected: PASS（71 + Task1 的 12 + 本任务 11）。

- [ ] **Step 5: Commit**

```bash
git add packages/video-document/src/types.ts packages/video-document/src/validate.ts packages/video-document/src/validate.test.ts
git commit -m "feat(video-document): P2.5-T1 media-clip 场景源——出入点/画幅/原声校验与时长对账（C1-C6）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: RenderRecord.assetDigests

**Files:**
- Modify: `packages/video-document/src/types.ts`（RenderRecord 可选字段）
- Modify: `packages/video-document/src/validate.ts`（renderRecords 循环内 R1-R2）
- Test: `packages/video-document/src/validate.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 的 `mediaAssetDurations`（`.has()` 查键）。
- Produces: `assetDigests?: Record<string, string>`（T4 出片写入实际素材摘要）。

- [ ] **Step 1: 先加类型字段（类型层无行为，不影响 RED）**

`types.ts` RenderRecord 追加（`browser?` 后）：

```ts
  // —— P2.5 媒体混编（T1 契约，T4 写入）：渲染钉住实际素材摘要。
  // key=mediaAssetId（须存在于 mediaAssets 账本），value=sha256（64 位小写 hex）。
  assetDigests?: Record<string, string>;
```

（先加类型是刻意的顺序：`build` 即 `tsc`，测试代码引用新字段若类型未加会以编译错失败——那不是断言 RED。类型字段本身零行为，负路径测试在实现前仍必然失败。）

- [ ] **Step 2: 写测试（负路径 RED / 正路径兼容见证）**

```ts
// —— P2.5-T1 RenderRecord.assetDigests（spec R1-R2）——
function withMediaRenderRecord(p: VideoProject, digests: unknown): VideoProject {
  (p as Record<string, unknown>).mediaAssets = [mediaAsset()];
  p.renderRecords.push({
    renderId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b2008",
    versionId: UUID, // 指向 baseProject 首镜头工作版本
    contentDigest: "d".repeat(64),
    engineId: "html-gsap",
    engineVersion: "0",
    rendererVersion: "remotion-4",
    fps: 24,
    width: 1920,
    height: 1080,
    codec: "h264",
    frames: 72,
    fontDigests: {},
    outputAssetRef: "out.mp4",
    assetDigests: digests as Record<string, string>,
  });
  return p;
}

test("assetDigests value 非 64hex → 拒绝（R1）", () => {
  assert.throws(
    () => validateVideoProject(withMediaRenderRecord(baseProject(), { [ASSET_ID]: "XYZ" })),
    /assetDigests/,
  );
});

test("assetDigests 键指向账本外资产 → 拒绝（R2）", () => {
  assert.throws(
    () =>
      validateVideoProject(
        withMediaRenderRecord(baseProject(), { "0b0b13a2-6c63-4d3d-9a52-a70f6a3b2999": "e".repeat(64) }),
      ),
    /assetDigests/,
  );
});

test("合法 assetDigests → 通过（正路径，兼容见证：先绿）", () => {
  const out = validateVideoProject(
    withMediaRenderRecord(baseProject(), { [ASSET_ID]: ASSET_SHA }),
  );
  assert.equal(out.renderRecords[0]!.assetDigests?.[ASSET_ID], ASSET_SHA);
});
```

（`assetDigests?` 类型已在 Step 1 加入，测试代码可直接引用。）

- [ ] **Step 3: 跑 RED**

Run: `pnpm --filter @acs/video-document run build && node --test packages/video-document/dist/validate.test.js`
Expected: FAIL —— 两个负路径用例「Missing expected exception」（旧校验忽略 assetDigests）；正路径 PASS（兼容见证）。

- [ ] **Step 4: 实现（GREEN）**

`validate.ts` renderRecords 循环内（`browser` 检查之后）：

```ts
    if (record.assetDigests !== undefined) {
      if (!isRecord(record.assetDigests))
        fail(`${field}.assetDigests must be an object`);
      for (const [assetId, digest] of Object.entries(record.assetDigests)) {
        if (!mediaAssetDurations.has(assetId)) {
          fail(
            `${field}.assetDigests 的键 ${assetId} 未指向 mediaAssets 账本中的资产`,
          );
        }
        if (typeof digest !== "string" || !SHA256_HEX.test(digest)) {
          fail(
            `${field}.assetDigests[${assetId}] 须为 64 位小写十六进制`,
          );
        }
      }
    }
```

- [ ] **Step 5: 构建并跑包内全部测试**

Run: `pnpm --filter @acs/video-document run build && node --test "packages/video-document/dist/**/*.test.js"`
Expected: PASS（累计 71 + 12 + 11 + 3）。

- [ ] **Step 6: Commit**

```bash
git add packages/video-document/src/types.ts packages/video-document/src/validate.ts packages/video-document/src/validate.test.ts
git commit -m "feat(video-document): P2.5-T1 RenderRecord.assetDigests 渲染钉住素材摘要（R1-R2）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: 未知类型消息、迁移回归固化与 ADR 变更日志

**Files:**
- Modify: `docs/adr/0003-video-studio-shot-schema.md`（Change log 追加第四次修订条目）
- Test: `packages/video-document/src/validate.test.ts`（追加 2 条固化测试）

**Interfaces:**
- Consumes: Task 2 已更新的三类型兜底消息。
- Produces: ADR 0003 变更日志条目（P2.5 后续任务与 Codex 复核的引用锚点）。

- [ ] **Step 1: 写测试**

```ts
// —— P2.5-T1 迁移与兜底固化 ——
test("旧项目（无 mediaAssets 键）原样通过（迁移回归）", () => {
  const p = baseProject();
  const out = validateVideoProject(p);
  assert.equal((out as Record<string, unknown>).mediaAssets, undefined);
});

test("未知 sceneSource.type 错误消息包含三类型", () => {
  const p = baseProject();
  p.shots[0]!.contentVersions[0]!.sceneSource = {
    type: "future-thing" as never,
  };
  assert.throws(
    () => validateVideoProject(p),
    /must be "spec" \| "editor-binding" \| "media-clip"/,
  );
});
```

- [ ] **Step 2: 跑测试**

Run: `pnpm --filter @acs/video-document run build && node --test packages/video-document/dist/validate.test.js`
Expected: PASS 两条（未知类型消息在 Task 2 已更新——本任务是**固化**既有行为，两条都应直接绿；若第一条因夹具演化不绿，属夹具问题，修夹具不修校验）。

- [ ] **Step 3: ADR 0003 追加变更日志条目**

在 `## Change log` 列表末尾追加：

```markdown
- 2026-10-19 fourth revision (P2.5 media mixing, T1): promoted `SceneSource` union member `media-clip` (mediaAssetId / inMs / outMs / fit / focalX / audio — platform-parsed and platform-verified, unlike the opaque `editor-binding`), project-level append-only `mediaAssets` ledger (origin + license + ffprobe-verified original with content-addressed storeKey + optional regenerable proxy), and `RenderRecord.assetDigests` (renders pin actual asset digests). Determinism input set extended to media file sha256 (original; proxy when used) and ffmpeg version; cross-machine bit-equality is explicitly not promised for lossy transcode chains — same-machine decoded-frame equality remains the fitness function. Additive optional fields only; schemaVersion stays 1; historical pure-spec projects open, validate, and export unchanged.
```

- [ ] **Step 4: 全量回归（本刀收口）**

Run（四套 + 静态，工作树根目录）：

```bash
pnpm --filter @acs/video-document run build && node --test "packages/video-document/dist/**/*.test.js"   # 99 pass（71+28）
pnpm --filter @acs/video-scene run build && node --test "packages/video-scene/dist/**/*.test.js"          # 131 pass
pnpm --filter @acs/web test                                                                               # 126 pass
node --test scripts/video/*.test.mjs                                                                      # 57 pass
pnpm --filter @acs/web run typecheck                                                                      # 零错（消费方零改动实证）
npx biome check packages/video-document/src/types.ts packages/video-document/src/validate.ts packages/video-document/src/validate.test.ts  # 零问题
pnpm run qa:validate                                                                                      # 82 automated / 51 manual 不变
```

Expected: 全绿；typecheck 零错证明「消费方零改动」论断成立。

- [ ] **Step 5: Commit**

```bash
git add docs/adr/0003-video-studio-shot-schema.md packages/video-document/src/validate.test.ts
git commit -m "docs(video-studio): ADR 0003 第四次修订——media-clip 提升字段入变更日志；迁移回归固化

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## 执行后（不属本计划任务）

- `AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md` 顶部追加 T1 条目（提交链、测试计数、消费方零改动证据）。
- 写 Codex 复核交接单 `artifacts/codex-review-video-studio-p2-media-t1.md`（沿 p2-themes-3-6 版式）。
- 后续接口提醒：T2 spec 必补 web 上传 ffprobe 的 Next 服务端路由与媒体仓三环境生命周期；T3 升格「提取 apply 基底」并接第七族；T4 定义旁白时长适配对 media-clip 的语义（改 outMs 或拒绝对齐）。
