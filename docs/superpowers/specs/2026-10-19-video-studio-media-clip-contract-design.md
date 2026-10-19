# Video Studio P2.5-T1：媒体镜头数据契约与校验（spec）

依据《采纳交接》`docs/VIDEO_STUDIO_OPENMONTAGE_ADOPTION_2026-10-19.md` 与《方案修订》`docs/VIDEO_STUDIO_MEDIA_MIX_REVISION_2026-10-19.md` §2/§4-T1。本 spec 只覆盖 **T1 数据契约与校验**：类型、validate 扩展、ADR 0003 变更日志、旧项目回归。导入（T2）、预览/编辑卡（T3）、出片（T4）、Wikimedia（T5）不在本刀。

## 0. 现状锚点（已按代码核对）

- `SceneSource = spec | editor-binding`（`packages/video-document/src/types.ts:3-10`）；`editor-binding` 三字段只查非空（`validate.ts:51-62`），平台不解析（ADR 0003 §3.3 不透明载荷语义）。
- **消费方扫描结论（全仓 grep `sceneSource`）**：所有非 spec 消费方均为 `!== "spec"` / `=== "spec"` 守卫——`render-scene.mjs:130`（出片大声拒绝）、`verify-determinism.mjs:79`、`frame-dryrun.mjs:105`、`export-shot-svg.mjs:39`、`shot-specs.ts:18`（预览 null 降级）。新增联合成员**零穷尽检查破坏**，T1 无需改任何消费方；media-clip 自动落入既有拒绝/降级路径（这正是 T4 之前的期望行为：不静默）。
- 唯一需要留意的消费方：`tts-sse.mjs:357`（旁白时长适配只 patch `spec` 镜头的 `spec.durationMs`）——media-clip 镜头的旁白对齐语义归 T3/T4，T1 不动它。
- 错误消息惯例：全库混合中英；最新一族（transitions，`validate.ts:463-498`）用**中文**。本刀新校验规则沿用中文。
- 文档体积上限 `VIDEO_PROJECT_MAX_BYTES = 2 MiB`、`MAX_ARRAY = 1000`、`MAX_DURATION_MS = 600000` 均不变。媒体**二进制不入文档**，`mediaAssets` 只存元数据（每条 ~300B）。

## 1. 类型契约（`packages/video-document/src/types.ts`）

```ts
// SceneSource 追加第三成员（字段即《方案修订》§2.1，零改动搬运）
| {
    type: "media-clip";
    mediaAssetId: string;   // 指向 project.mediaAssets[]，存在性由 validate 核
    inMs: number;           // 整数，≥0
    outMs: number;          // 整数，≥ inMs+200 且 ≤ asset.durationMs
    fit: "cover" | "contain";
    focalX: number;         // 有限数 0..1；contain 时忽略但仍须合法
    audio: "mute" | "keep";
  }

// 项目级追加账本（与 renderRecords 同纪律：只追加、不改写、不删除）
export type VideoProject = {
  // …既有字段不变…
  mediaAssets?: MediaAsset[];   // 可选：旧文档无此键，原样通过
};

export type MediaAsset = {
  assetId: string;        // UUID，平台生成，账本内唯一
  createdAt: string;      // ISO 8601
  origin:
    | { kind: "local-upload"; fileName: string }              // fileName 1..200
    | {
        kind: "stock-source";
        sourceId: "wikimedia";                                 // 首个且唯一公开来源
        sourcePageUrl: string;                                 // http(s):// 非空
        license: { name: string; author?: string; usageNote?: string }; // name 1..100
        retrievedAt: string;                                   // ISO 8601
      };
  original: {
    sha256: string;       // 64 位小写 hex（导入核验通过才落账）
    bytes: number;        // 正整数
    durationMs: number;   // 整数 200..600000（短于 200ms 的源不可能产出合法镜头）
    width: number;        // 正整数
    height: number;       // 正整数
    fps: number;          // 正有限数（29.97 合法，不强制整数）
    codec: string;        // 非空（ffprobe 实测值，如 "h264"/"vp9"）
    hasAudio: boolean;
    storeKey: string;     // 内容寻址：`${sha256.slice(0,16)}.${ext}`，ext ∈ mp4|webm|mov
  };
  proxy?: {               // 预览用转码代理，可再生成；original 不可变（ADR 0001）
    sha256: string;       // 64 位小写 hex
    bytes: number;        // 正整数
    width: number;        // 正整数
    height: number;       // 正整数
    note: string;         // 1..200（转码参数摘要，如 "h264 720p cap"）
  };
};

// RenderRecord 追加可选字段（T4 出片时写入；T1 只定形状与校验）
export type RenderRecord = {
  // …既有字段不变…
  assetDigests?: Record<string, string>; // key=mediaAssetId（须存在于账本），value=64hex
};
```

设计依据（为什么不用 `editor-binding` 扩展）见《方案修订》§2.1：media 字段是**平台要解析、校验、预览**的字段，塞进「平台永不解析」的不透明载荷违背其既有语义；`editor-binding` 留给 D3 原用途。

## 2. 校验规则（`packages/video-document/src/validate.ts`）

签名调整：`validateSceneSource(value, field)` → `validateSceneSource(value, field, mediaAssets: Map<string, { durationMs: number }>)`；`validateVideoProject` 在 shots 循环**之前**校验 `mediaAssets` 并建 Map 向下传（对账需要 `durationMs`）。

### 2.1 mediaAssets 账本（项目级，可选）

| # | 规则 | 错误消息（中文，含字段路径） |
| --- | --- | --- |
| A1 | 存在时必须是数组，长度 ≤ 1000 | `mediaAssets must be an array of at most 1000 entries`（沿英文既有句式） |
| A2 | assetId 为 UUID 且账本内唯一 | `mediaAssets[i].assetId must be a UUID` / `mediaAssets[i].assetId is duplicated` |
| A3 | createdAt 为 ISO 8601 | `mediaAssets[i].createdAt must be an ISO 8601 string` |
| A4 | origin 二选一；local-upload.fileName 1..200；stock-source 的 sourceId 必须是 `"wikimedia"`、sourcePageUrl 须 `http(s)://` 开头非空 ≤2000、license.name 1..100、author?/usageNote? 非空 ≤200、retrievedAt ISO | `mediaAssets[i].origin.kind must be "local-upload" or "stock-source"` 及逐字段中文消息 |
| A5 | original.sha256 为 64 位小写 hex | `mediaAssets[i].original.sha256 须为 64 位小写十六进制` |
| A6 | bytes/width/height 正整数；durationMs 整数 200..600000；fps 正有限数；codec 非空；hasAudio 布尔 | 逐字段中文 |
| A7 | storeKey 必须 === `${sha256.slice(0,16)}.${ext}`，ext ∈ `mp4|webm|mov` | `mediaAssets[i].original.storeKey 须为 sha256 前 16 位 + .mp4/.webm/.mov` |
| A8 | proxy 可选；存在时 sha256/bytes/width/height 同上、note 1..200 | 逐字段中文 |

### 2.2 media-clip 场景源（镜头级）

| # | 规则 | 错误消息 |
| --- | --- | --- |
| C1 | mediaAssetId 非空字符串且存在于账本 | `…sceneSource.mediaAssetId 未指向 mediaAssets 账本中的资产` |
| C2 | inMs/outMs 均为整数 | `…sceneSource.inMs/outMs 须为整数毫秒` |
| C3 | inMs ≥ 0；outMs ≥ inMs+200；outMs ≤ asset.durationMs | `…sceneSource 出入点越界（合法 inMs ≥ 0、inMs+200 ≤ outMs ≤ 素材 durationMs=…）` |
| C4 | **版本 durationMs === outMs − inMs**（镜头时长=片段时长对账；spec 镜头同款对账由 operations 同步，media 镜头由 validate 强制——渲染量化与交付 frameMap 依赖此恒等） | `…durationMs 须等于 outMs−inMs（媒体镜头时长=片段长度）` |
| C5 | fit ∈ `cover|contain`；audio ∈ `mute|keep` | `…sceneSource.fit 须为 "cover" 或 "contain"`（audio 同式） |
| C6 | focalX 有限数 0..1（含端点；NaN/Infinity 拒绝；contain 时忽略但仍校验——恒定不变量比条件分支便宜） | `…sceneSource.focalX 须为 0..1 的数` |

未知 `sceneSource.type` 的兜底消息更新为三类型：`must be "spec" | "editor-binding" | "media-clip"`。

### 2.3 RenderRecord.assetDigests（可选）

| # | 规则 | 错误消息 |
| --- | --- | --- |
| R1 | 存在时必须是对象；每个 value 64 位小写 hex | `renderRecords[i].assetDigests[k] 须为 64 位小写十六进制` |
| R2 | 每个 key 必须存在于 mediaAssets 账本 | `renderRecords[i].assetDigests 的键 k 未指向 mediaAssets 账本中的资产` |

不校验「assetDigests 与镜头实际引用一致」（那是渲染时的对账，非文档形状）；只追加纪律同 renderRecords——写入方自律，validate 查当前形状。

## 3. ADR 0003 变更日志（第四次修订，条目草案）

> - 2026-10-19 fourth revision (P2.5 media mixing, T1): promoted `SceneSource` union member `media-clip` (mediaAssetId / inMs / outMs / fit / focalX / audio — platform-parsed and platform-verified, unlike the opaque `editor-binding`), project-level append-only `mediaAssets` ledger (origin + license + ffprobe-verified original with content-addressed storeKey + optional regenerable proxy), and `RenderRecord.assetDigests` (renders pin actual asset digests). Determinism input set extended to media file sha256 (original; proxy when used) and ffmpeg version; cross-machine bit-equality is explicitly not promised for lossy transcode chains — same-machine decoded-frame equality remains the fitness function. Additive optional fields only; schemaVersion stays 1; historical pure-spec projects open, validate, and export unchanged.

## 4. 兼容与迁移

- **旧文档（无 mediaAssets、无 media-clip）**：校验路径零变化——`mediaAssets === undefined` 时整段跳过，schemaVersion 仍为 1。回归由既有 71 测试 + 新增「旧夹具原样通过」断言保证。
- **新文档在旧代码上**：旧 validate 把 media-clip 判为未知类型 → 整文档拒绝（比逐镜头降级更响，不静默）。这是期望行为：media-clip 是新契约，旧代码不该假装能处理。
- **migration-on-read**：无需改写——两处均为可选字段/联合新成员。
- **审批/锁定/版本语义零改动**：换素材/改入出点 = 追加新 ContentVersion（human 路径，锁定镜头加 audit 事件），T3 接线时沿用。

## 5. 测试清单（RED 用例；夹具沿 `baseProject()` + 新增 `mediaAsset()` / media-clip version helper）

1. mediaAssets 非数组 → 拒绝（A1）
2. assetId 重复 → 拒绝（A2）；非 UUID → 拒绝
3. local-upload 与 stock-source 两种合法 origin → 通过（含完整 original/proxy）
4. stock-source 缺 license.name / sourceId 非 wikimedia / sourcePageUrl 非 http(s) → 拒绝（A4）
5. original.sha256 63 位 / 大写 → 拒绝（A5）
6. storeKey 与 sha256 不对应 / 非法扩展名 `.avi` → 拒绝（A7）
7. proxy 非法形状（负 width）→ 拒绝（A8）；proxy 缺省 → 通过
8. durationMs=199 的源 → 拒绝（A6 下界）；fps=29.97 → 通过（非整数 fps 合法）
9. 合法 media-clip 版本 → 通过；含 assetDigests 的 RenderRecord → 通过（C1..C6、R1..R2 正路径）
10. mediaAssetId 指向不存在资产 → 拒绝（C1）
11. outMs 超素材时长 / outMs−inMs=199 / inMs=−1 / 非整数 → 拒绝（C2、C3）
12. 版本 durationMs ≠ outMs−inMs → 拒绝（C4 对账）
13. fit/focalX/audio 各一例非法（`"fill"` / `1.5` / `"auto"`）→ 拒绝（C5、C6）
14. assetDigests value 非 64hex / key 不在账本 → 拒绝（R1、R2）
15. 旧项目（baseProject 原样）→ 通过（迁移回归）
16. 未知 sceneSource.type 错误消息包含三类型
17. 两镜头引用同一 assetId → 通过（素材复用合法，账本唯一性≠引用唯一性）

## 6. 非目标（本刀不做）

- 导入/ffprobe/sha256 落仓（T2：`scripts/video/media-ingest.mjs` + 内容寻址仓；**web 上传侧需 Next 服务端路由跑 ffprobe——浏览器无 ffprobe，《方案修订》已漏，T2 spec 必补**）
- 浏览器预览/镜头卡第七族/apply 基底提取（T3：**延后 Minor「第七族时提取 apply 基底表达式」就此升格为 T3 任务**）
- 出片/Remotion OffthreadVideo/尾部空白核算（T4，含 assetDigests 写入与旁白对齐的 media 语义）
- Wikimedia 检索/下载（T5）；媒体仓生命周期三环境（dev/e2e/部署）对齐——T2 验收条款
- planner、六族编辑器、转场、TTS、字幕：零改动

## 7. 验收标准

- `packages/video-document`：新增类型编译零错、validate 新规则全数有 RED→GREEN 测试，包内全绿（71 + 新增）。
- 全仓 `typecheck` 零错（消费方零改动的实证）；biome 零问题；`qa:validate` 通过（registry 无需新增条目——T1 无浏览器链路，VID-023 在 T6 登记）。
- ADR 0003 变更日志出现第四次修订条目（§3 草案文字）。
- 既有 71 测试一个不改语义地全绿（只允许因错误消息更新而调整的断言——预计零处，未知类型消息既有测试不匹配旧文案才需同步）。
