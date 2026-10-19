# Video Studio P2.5-T2 设计：媒体导入与内容寻址媒体仓（spec）

- 日期：2026-10-19；作者：Claude（依用户总纲 `docs/VIDEO_STUDIO_OPENMONTAGE_ADOPTION_2026-10-19.md` 与修订案 `docs/VIDEO_STUDIO_MEDIA_MIX_REVISION_2026-10-19.md` §4 T2/§3 步骤 1/§7 裁定 3）
- 前置：T1 已落（`mediaAssets` 账本 / `media-clip` 场景源 / `assetDigests` 类型与校验，`855170c..335de8f`）。本刀消费 T1 的 `MediaAsset` 类型，不新增文档契约字段。
- 本刀性质：**导入服务层**——纯函数 + 包 + 脚本 + 两个 Next 路由。零 UI（T3 接线）、零 Wikimedia（T5）、零渲染（T4）。

## 0. 现状锚点（按代码核对，2026-10-19）

1. **项目文档在浏览器 IndexedDB**（`apps/web/src/app/video-studio/local-video-projects.ts:11-99`，`acs-video-studio-local` 库 projects/versions 双 store）——媒体二进制**不可能**进文档存储；`MediaAsset` 账本（元数据）随文档走，二进制必须落**服务端磁盘仓**，浏览器经 HTTP 路由读。这决定了本刀必须交付服务端路由，而非只交付脚本。
2. **浏览器不能 ffprobe/ffmpeg**——上传核验（ffprobe 元数据 + 解码验证 + sha256）必须发生在 Node 侧：脚本（CLI/e2e 用）与 Next 路由（工作台上传用）共用同一核验核心。核心放独立包 `packages/media-store`（`@acs/media-store`），**不得**塞进 `@acs/video-document`（该包被浏览器代码 import，`local-video-projects.ts:1-7` 即为消费者；引入 `node:child_process`/`node:crypto` 会污染浏览器束）。
3. **Next 路由先例**（`apps/web/src/app/api/image-local-edit/route.ts:10-60`）：`export async function POST(request: Request)` 原生 Web Request/Response；`NODE_ENV !== "development"` → 503 中文错误；origin 跨站检查 403；content-length 上限 413；`await request.formData()` 取 `File`；错误消息中文。GET 先例无——本刀新增文件流式 GET。⚠️ `apps/web/AGENTS.md`：本项目 Next 版本有破坏性变更，写路由代码前须读 `node_modules/next/dist/docs/` 相应指南（计划期任务，非本 spec 内容）。
4. **web 测试跑法**：`apps/web/package.json:10` `"test": "node --import tsx --test \"src/app/video-studio/*.test.ts\""`——api 目录不在 glob；本刀把 glob 扩为 `src/app/video-studio/*.test.ts` 与 `src/app/api/**/*.test.ts` 两段。
5. **ffprobe/spawn 先例**：`scripts/video/export-gif.mjs:173-191` `spawnSync("ffprobe", [...])` + `probe.status !== 0` 大声失败；脚本级测试可直接调本地 ffmpeg/ffprobe 生成/核验真实媒体（`scripts/video/export-gif.test.mjs` 先例，零网络）。
6. **T1 契约边界**（本刀的落账目标）：`original.durationMs` 200..600000；`storeKey = sha256 前 16 位 + ".mp4"|".webm"|".mov"`；`fps` 正有限（29.97 合法）；`proxy?` 可再生成。`validateMediaAssets` 只查形状——**真实文件的实测核验是本刀的职责**（修订案 §1「素材服务：无 → 全部待建」）。
7. **修订案 §3 步骤 1 失败语义**：解码失败/超时 → 行内错误、临时文件清理、**项目文档零改动**；§7 裁定 3：仓位置 env `ACS_MEDIA_STORE` 可覆盖，默认 `<数据目录>/acs-media-store/`，e2e 用仓库 `artifacts/media-store/`（gitignore）。
8. **实测教训**（修订案 §3 步骤 3/6 注）：超时可留可解码残片、退出码 0 ≠ 成功——凡「核验通过」必须有产物级证据（ffprobe + 解码 + 摘要），不能只看命令退出码。

## 1. 架构与模块

```
packages/media-store/                  # 新包 @acs/media-store（Node-only，浏览器零依赖）
  src/store.ts        仓布局 + 原子落盘 + 读取（纯决策 + fs）
  src/probe.ts        ffprobe 包装 + JSON 解析为 ProbeResult（拒绝规则）
  src/ingest.ts       导入管线：字节 → sha256 → storeKey → 探测 → 解码门 → 落仓 → MediaAsset
  src/proxy.ts        代理转码（分辨率上限 + 浏览器可播 codec）+ ffmpeg 版本记入 note
  src/index.ts        导出公共面
scripts/video/media-ingest.mjs         # CLI 薄壳（e2e/T6 与本地调试用）
apps/web/src/app/api/media/ingest/route.ts    # POST：formData 上传 → ingest → {asset}
apps/web/src/app/api/media/file/[storeKey]/route.ts  # GET：按 storeKey 流式取文件（预览用）
```

### 1.1 类型与签名（精确）

```ts
// probe.ts
export type ProbeResult = {
  durationMs: number; width: number; height: number;
  fps: number; codec: string; hasAudio: boolean; formatName: string;
};
// runProbe(filePath): { ok: true; probe: ProbeResult } | { ok: false; error: string }
//   ffprobe -v error -print_format json -show_format -show_streams
//   解析：fps = r_frame_rate 分子/分母（"30000/1001" → 29.97…）；拒绝见 §2 P 表

// store.ts
export function storeKeyFor(sha256: string, ext: "mp4" | "webm" | "mov"): string;
//   `${sha256.slice(0,16)}.${ext}`（与 T1 契约一致；sha256 形状由调用方保证）
export function resolveStoreRoot(): string;
//   process.env.ACS_MEDIA_STORE（须绝对路径，相对拒绝）否则
//   path.join(os.homedir(), ".acs", "media-store")
export function originalPath(root: string, storeKey: string): string;  // root/original/<storeKey>
export function proxyPath(root: string, storeKey: string): string;     // root/proxy/<stem>.proxy.mp4
// writeAtomically(dest, bytes): 已存在同大小 → 复用跳过（内容寻址幂等）；否则 tmp 写 + rename
// openOriginal/openProxy(root, storeKey): 校验 storeKey 形状后给绝对路径（防目录穿越）

// ingest.ts
export type IngestOrigin = { kind: "local-upload"; fileName: string };
export type IngestResult =
  | { ok: true; asset: MediaAsset }             // @acs/video-document 的类型
  | { ok: false; error: string; cleanupDone: true };
export function ingestMediaFile(input: {
  bytes: Buffer | Uint8Array; fileName: string; root: string;
  generateProxy?: boolean;      // 默认 true；e2e 可关
  now?: () => string;           // createdAt 注入（测试确定性）
  runProbe?: typeof runProbe;   // 注入点：越界时长的单元测试用假探针
  runDecode?: typeof runDecode; // 同上
}): Promise<IngestResult>;
// 管线：① 扩展名白名单（从 fileName 取，mp4|webm|mov）② sha256 → storeKey
//   ③ 临时文件落 os.tmpdir ④ runProbe ⑤ runDecode（全片解码门）⑥ 契约边界对账
//   ⑦ writeAtomically(original) ⑧ proxy 判定与转码 ⑨ 组 MediaAsset（crypto.randomUUID）
// 任何一步失败：删临时文件与半成品，返回 { ok:false }——仓内不留残片，账本不写（账本写入是调用方/T3 的事）

// proxy.ts
export const PROXY_MAX_EDGE = 1280;
export function needsProxy(p: ProbeResult): boolean;
//   长边 > 1280 或 codec ∉ {h264, vp8, vp9, av1}（hevc-in-mp4 浏览器不可播是主例）
export function transcodeProxy(inputPath: string, outputPath: string, p: ProbeResult):
  | { ok: true; sha256: string; bytes: number; width: number; height: number; note: string }
  | { ok: false; error: string };
//   scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))' 保 AR、
//   长边 ≤1280、偶数对齐；libx264 crf 23 yuv420p；hasAudio → aac；note 记 ffmpeg 版本首行 + 参数摘要
```

### 1.2 路由（薄壳，逻辑全在包内）

- `POST /api/media/ingest`：NODE_ENV 门（503）→ origin 检查（403）→ content-length ≤ 500_000_000（413）→ `formData()` 取 `file` → `ingestMediaFile` → `{ asset }` / `{ error }`（4xx/500）。**不写项目文档**——返回 MediaAsset，由前端（T3）追加账本。
- `GET /api/media/file/[storeKey]`：storeKey 形状正则 `^[0-9a-f]{16}\.(mp4|webm|mov)$`（拒穿越）→ original 存在则流式返回（Content-Type video/mp4|video/webm|video/quicktime + Accept-Ranges: bytes 基本支持，预览 seek 需要）；不存在查 proxy（`<stem>.proxy.mp4`）；都没有 → 404。Range 支持按 Next 版本文档的最小实现（206 分片；计划期核对 Next 动态路由参数 API）。

### 1.3 仓生命周期（§7 裁定 3 落地）

| 环境 | ACS_MEDIA_STORE | 说明 |
| --- | --- | --- |
| 开发默认 | 未设 → `~/.acs/media-store/` | 单机本地优先产品（项目在 IndexedDB，仓在磁盘） |
| e2e/T6 | `artifacts/media-store/`（gitignore） | 沿媒体不入库约定，复跑可清空重建 |
| 单元测试 | `os.tmpdir()` 临时目录 | 零网络、零仓库污染、并行安全（每测试唯一子目录） |
| 部署 | 显式 env | 不在本刀验收内（本地优先阶段） |

## 2. 规则表（错误消息中文；路由 HTTP 码见 §1.2）

**P 表（probe 解析与拒绝）**

| # | 规则 | 消息 |
| --- | --- | --- |
| P1 | 无视频流（全 streams 无 video codec_type） | `文件不含视频流` |
| P2 | duration 缺失/非有限正数 | `无法读取视频时长（文件可能不完整）` |
| P3 | width/height 非正整数 | `无法读取视频画幅（文件可能不完整）` |
| P4 | fps 解析为 0/非有限（r_frame_rate "0/0"、"0/1"） | `无法读取视频帧率（文件可能不完整）` |
| P5 | ffprobe 退出非 0 / 输出不可解析 | `文件无法探测：ffprobe 失败（<stderr 摘要 200 字内>）` |
| P6 | durationMs 取整后越 200..600000（T1 契约） | `视频时长 <X>ms 越界：仅支持 200ms..10 分钟` |

**S 表（store 落盘）**

| # | 规则 | 消息 |
| --- | --- | --- |
| S1 | 扩展名 ∉ mp4/webm/mov | `不支持的媒体格式 <ext>：仅支持 mp4 / webm / mov` |
| S2 | ACS_MEDIA_STORE 设了相对路径 | `ACS_MEDIA_STORE 须为绝对路径（当前：<值>）` |
| S3 | 目标已存在且大小一致 → 复用（幂等，不重写）；大小不一致 → 大声失败（内容寻址被破坏） | `仓内同 storeKey 文件大小不符（内容寻址冲突）：<路径>` |
| S4 | 任何失败路径删尽临时文件与半成品（tmp 探测文件、半写目标）——`cleanupDone: true` 是结果类型的硬字段 | （内部不变量，测试断言） |

**D 表（解码门）**

| # | 规则 | 消息 |
| --- | --- | --- |
| D1 | `ffmpeg -v error -i <tmp> -f null -` 退出非 0 或 stderr 非空 → 拒（全片解码，退出码 0 且零 error 才算过——教训 8「退出码 0 ≠ 成功」需 stderr 也干净） | `文件无法完整解码：<stderr 摘要>（文件可能损坏或不完整）` |

**W 表（代理转码）**

| # | 规则 | 消息 |
| --- | --- | --- |
| W1 | needsProxy = 长边 >1280 或 codec ∉ {h264,vp8,vp9,av1}；否则 asset.proxy 缺省（original 直接可预览） | （判定函数，非错误） |
| W2 | 转码失败 → **整个导入失败**（不留「有 original 无 proxy」的半成品资产——proxy 是资产完整性的一部分；可再生成指重转，不是可有可无）。回滚分寸：**本次导入新写的 original 删除**；**仓内预存的同 storeKey 文件不动**（它背后是既有账本资产，S3 复用场景的瞬时转码失败无权销毁别人家的原件） | `代理转码失败：<stderr 摘要>` |
| W3 | 转码产物须过自身 ffprobe（长边 ≤1280、可解码、时长与 original 相差 <500ms）——不过则同 W2 整体失败 | 同 W2 文案前缀 `代理转码核验失败：` |

**幂等语义**：同内容重导入 = 同 storeKey 文件复用（S3），但返回**新 assetId 的新 MediaAsset**（账本条目唯一键是 assetId；项目内去重按 `original.sha256` 查账本是 T3 的 UI 职责）。核心服务对项目无状态。

## 3. 失败语义（修订案 §3 步骤 1 逐条落地）

| 输入 | 用户/调用方看到 | 系统状态 |
| --- | --- | --- |
| 扩展名不支持 | S1 错误（路由 415） | 零写入 |
| ffprobe 失败/无视频流/画幅帧率不可读 | P1-P5（路由 422） | 临时文件清理，仓零改动 |
| 时长越界 | P6（路由 422） | 同上 |
| 损坏/残片（头好尾坏） | D1 全片解码门拦（路由 422） | 同上 |
| 代理转码失败/核验失败 | W2/W3（路由 500） | original 与 proxy 皆不留（W2 整体失败语义） |
| 仓路径配置错误 | S2/S3（路由 500） | 零半成品 |
| 成功 | `{ asset }`（asset.proxy 按需存在） | original 落仓（+proxy），**项目文档零改动**（T3 才写账本） |

## 4. 测试清单（全零网络；真实 ffmpeg/ffprobe 允许——脚本测试先例）

1. `runProbe` 真文件：ffmpeg testsrc 生成 2s mp4 → durationMs/宽高/fps/codec/hasAudio 全对。
2. `runProbe` 拒绝：纯文本改名 .mp4（P5/P1）；1 帧图序列（P2 或 D1）。
3. fps 分数解析：录制 ffprobe JSON 夹具（r_frame_rate "30000/1001"）→ 29.97（单测注入，不起进程）。
4. `storeKeyFor`/路径推导/穿越拒绝：`../evil`、`aaaaaaaaaaaaaaaa.mp4` 形状门。
5. `writeAtomically`：首写成功；同 storeKey 同大小复用；同 storeKey 异大小 S3。
6. `ingestMediaFile` 真文件全绿：asset 字段逐项断言（uuid/createdAt 注入/storeKey/sha256=实测/origin.local-upload.fileName）；仓内文件存在且 sha256 复核一致；二次导入文件复用（mtime 不变或等价断言）+ 新 assetId。
7. `ingestMediaFile` 拒绝（注入假 runProbe 越界时长 → P6；真文件坏内容 → D1）；失败后 tmp 与仓内零残留（目录清单断言）。
8. `needsProxy`：1920×1080 → true；640×360 h264 → false；1080×1920 竖版 → true；hevc → true。
9. `transcodeProxy` 真转码：1080p testsrc → 产物 ffprobe 长边 ≤1280、h264、时长差 <500ms；note 含 ffmpeg 版本串。
10. CLI：好文件 → stdout JSON 可 `JSON.parse` 且过 `validateVideoProject` 级联的单资产校验（直接调 `validateMediaAssets` 不导出则经临时项目文档走 `validateVideoProject`）；坏文件 → exit ≠0、stderr 中文、仓零残留。
11. 路由 POST：formData 好文件 → 200 `{asset}`；坏扩展 → 415；越界（注入不可行，用真坏文件）→ 422；NODE_ENV 门 → 503；origin 异 → 403；超大 content-length → 413。
12. 路由 GET：original 命中 → 200 Content-Type 正确 + 首字节与仓文件一致；仅 proxy 存在场景 → 命中 proxy；穿越/形状非法 storeKey → 400；合法形状但仓内无此文件 → 404；Range 请求 → 206 分片（按 Next 版本实际 API 能力，最低 206 单段）。
13. web 测试 glob 扩展后：既有 126 测试不回归。

## 5. 非目标（YAGNI）

- UI（素材列表/上传对话框/入出点编辑）= T3；`mediaAssets` 账本写入操作 = T3。
- Wikimedia 检索/下载/两态 = T5（本刀的 `ingestMediaFile` 是 T5 下载核验的复用基底——下载完整性对账是 T5 在其上叠的层）。
- 渲染消费/OffthreadVideo/assetDigests 写入 = T4。
- 多租户/鉴权/配额（Credit Ledger 不涉媒体仓——本地优先阶段；路由 NODE_ENV 门沿先例）。
- proxy 删除/重生成 API（evolve 执法已豁免 proxy 增改删；需要时 T3+ 再加）。
- 断点续传/分片上传（500MB 内单请求够用；T5 的分片下载是下载侧）。

## 6. 验收

1. §4 全清单红绿落账；`packages/media-store` 测试 + 既有四套（video-document 104 / video-scene 131 / web（含新路由测试）/ scripts 57）全绿；typecheck（root `-r` 含新包）；biome 过。
2. `scripts/video/media-ingest.mjs` 对真实文件一键导入成功/失败两态演示（测试固化）。
3. 仓生命周期表（§1.3）三环境各有测试或 e2e 钩子（e2e 环境的 VID-023 在 T6，本刀只留 env 约定与 gitignore 行）。
4. 失败注入三例（坏扩展/残片/转码失败）仓内零残留——目录清单断言，非日志断言。
5. 计费台账行数不变（零 TTS 路径）。

## 7. 沿用裁定（不重开）

- T1 全部裁定与 ADR 0003 第四次修订口径；媒体不入库（仓在 gitignore 目录，storeKey 内容寻址使仓可重建性=「重导入同一文件」）。
- 修订案 §7：拒绝原因不进项目文档（本刀 `IngestResult.error` 只回调用方）；Wikimedia 首源 = T5；仓位置裁定 3 落地如 §1.3。
- 新包进 root build 链与 workspace（`pnpm-workspace.yaml` 核对 packages/* 通配）；`apps/web` 依赖 `@acs/media-store` 用 workspace 协议。
