# Video Studio 方案修订：实拍媒体导入与混编（2026-10-19）

依据 `docs/VIDEO_STUDIO_OPENMONTAGE_ADOPTION_2026-10-19.md`（下称《采纳交接》）与实测报告 `D:\codex\openmontage-eval\projects\validation-2026-10-19\REPORT.md` 修订。架构基线（ADR 0003、对齐评审、六题材目标）不变；本文只调整任务排序并给出媒体混编的最小契约、数据流与样片拆分。

## 0. 排序调整

- 新阶段 **P2.5 媒体混编**（外部实拍镜头作为受控镜头源进入现有 Remotion 时间线）插在 P2 与 P3 之间。P3 交互与 3D、P4 产品化整体顺延，内容不变。
- Blender 商品 Golden Spike 仍走并行支线，与 P2.5 无依赖（`blender_world` 不采用，见 §6）。
- Piper 本地 TTS 不在本阶段（C 项随需求再做）；当前 TTS/字幕/转场/导出一律沿用。

## 1. 现状与缺口清单（已实现 vs 待接线，按代码核对）

| 面 | 现状（证据） | 缺口 |
| --- | --- | --- |
| 数据模型 | `SceneSource = spec \| editor-binding{engineId,engineVersion,assetId}`（`packages/video-document/src/types.ts:3-10`）；`editor-binding` 是不透明引擎引用，校验只查三字段非空（`validate.ts:51-62`），平台不解析 | 无媒体镜头类型：装不下入出点/画幅策略/原声策略；无素材资产记录（许可、来源、摘要、代理转码关系） |
| 素材服务 | **无**。无上传、无来源检索、无下载校验 | 全部待建（候选 ≠ 已用素材两态、下载核验、许可可追溯） |
| Web 预览 | `shotWorkingSpec`（`apps/web/src/app/video-studio/shot-specs.ts:14-24`）对 `editor-binding`/非法 spec 返回 null → 单镜头「不可预览」降级不炸页 | 无 `<video>` 预览、无入出点/裁切预览、无逐镜头素材缺失告警 |
| 出片 | `render-scene.mjs:130-131` 对非 spec 镜头**大声拒绝**；Remotion 合成器只消费 SceneSpec | 媒体镜头进不了时间线；RenderRecord 只有 `fontDigests`，无媒体资产摘要（`types.ts:54`）；「产物存在 + ffprobe + 摘要核验」的成功判定未覆盖媒体 |
| 存储 | 项目 = 文档 JSON（保存/导出），媒体二进制无任何通道 | 内容寻址媒体仓 + 项目内 `mediaAssets` 追加账本 |
| 已有能力直接复用 | ContentVersion 只追加、镜头版本/审批/锁定、累计边界帧量化、转场、TTS 旁白混音、字幕轨、双画幅导出、GIF/SVG 交付、qa registry | —（P2.5 不新造这些） |

## 2. 最小媒体源契约（§4.2）

### 2.1 选择：新增 `media-clip` 场景源类型（不用 `editor-binding` 扩展）

两条路都评估过：

- **扩展 `editor-binding`**（engineId="media-clip"，其余塞 assetId/opaque 载荷）：零联合类型改动，但把平台要解析的字段（入出点、画幅、原声）藏进不透明载荷，违背该类型「平台永不解析」的既有语义（ADR 0003 §3.3）；生命周期也不同——binding 指向外部编辑器会话产物，媒体镜头指向**本平台自有的不可变素材 + 剪裁策略**。
- **新增联合成员 `media-clip`**（选定）：字段平台可校验、可预览、可进确定性输入集；`editor-binding` 留给 D3（FilmCraft 类）原用途。

```ts
// SceneSource 新增第三成员
| {
    type: "media-clip";
    mediaAssetId: string;   // 指向 project.mediaAssets[]（存在性 + 摘要一致由 validate 核）
    inMs: number;           // 0..asset.durationMs-1
    outMs: number;          // inMs+200..asset.durationMs（最短 200ms，防零帧镜头）
    fit: "cover" | "contain";
    focalX: number;         // 0..1，cover 裁切注视点（contain 时忽略）
    audio: "mute" | "keep"; // keep = 保留原声与 TTS 旁白混音
  }

// VideoProject 新增可选追加账本（与 renderRecords 同纪律：只追加）
mediaAssets?: MediaAsset[];

type MediaAsset = {
  assetId: string; createdAt: string;
  origin:
    | { kind: "local-upload"; fileName: string }
    | { kind: "stock-source"; sourceId: "wikimedia"; sourcePageUrl: string;
        license: { name: string; author?: string; usageNote?: string }; retrievedAt: string };
  original: {              // ffprobe 实测，导入核验通过才落账
    sha256: string; bytes: number; durationMs: number;
    width: number; height: number; fps: number; codec: string; hasAudio: boolean;
    storeKey: string;      // 内容寻址仓内文件名 = sha256 前 16 位 + 原扩展名
  };
  proxy?: { sha256: string; bytes: number; width: number; height: number; note: string };
  // proxy 是浏览器预览用转码代理（可再生成）；original 不可变（ADR 0001）
};
```

### 2.2 ADR 0003 变更与旧项目规则

- 按 ADR「每个新内容类型集成须在变更日志写明提升了哪些字段」，本阶段追加 **ADR 0003 第四次修订**（变更日志条目，不新开 ADR 号）：SceneSource 联合 +`media-clip`、VideoProject +`mediaAssets?`、RenderRecord +`assetDigests?: Record<string,string>`、确定性输入集扩展（见 2.3）。
- 旧项目：两处均为**可选字段/联合新成员**，旧文档按原样打开、校验、出片（migration-on-read 无需改写）；含 `media-clip` 的文档在旧代码上是「未知类型」→ 沿既有降级路径（预览不可预览/出片拒绝），不静默。
- 审批/锁定/版本语义零改动：换素材/改入出点 = 追加新 ContentVersion（human 路径，锁定镜头加 audit 事件），与现有编辑器一致。

### 2.3 确定性口径（诚实边界）

- 确定性输入集追加：媒体文件 sha256（original；若出片用 proxy 则含 proxy）、ffmpeg 版本（proxy 转码与最终混流）、既有 browser/renderer/fps/画幅。RenderRecord 落 `assetDigests`。
- CI/复跑门槛：同一锁定环境（同机同文件同版本）双跑**解码帧一致** + ffprobe 参数一致，沿 VID-016..022 口径。跨机器位级一致**不承诺**（有损编码转码链不保证），验收写明。

## 3. 端到端数据流与失败语义（§4.3）

| 步骤 | 成功 | 失败 → 用户看到 / 系统状态 |
| --- | --- | --- |
| 1 本地导入（上传 → ffprobe → 抽帧核验 → sha256 → 落仓 → 写 MediaAsset + 生成 proxy） | 素材列表出现新资产（缩略图 + 时长 + 许可「本地上传」） | 解码失败/超时：行内错误「文件无法解码或超时」，临时文件清理，**项目文档零改动** |
| 2 来源检索（Wikimedia API，仅缩略图/元数据，见 §5） | 候选列表（缩略图、来源页、许可、时长、尺寸）；**候选不进项目文档** | 网络失败：提示可重试/转本地上传，项目可继续纯 SceneSpec 工作 |
| 3 下载 + 核验（限选分辨率 → 流式下载到临时文件（分片/超时/重试）→ ffprobe + 解码抽帧 + sha256 → 与候选元数据对账 → 落仓 + 发布 MediaAsset） | 候选变为项目素材资产 | 超时/不完整/与元数据不符：候选标记失败与原因，部分文件删除，**不发布、无半成品资产**（实测教训：超时留下可解码残片） |
| 4 接入分镜（镜头卡换「媒体镜头」→ 选资产 + 入出点/fit/focal/原声 → 应用） | 追加 media-clip ContentVersion；卡片显示素材镜头 | 入出点非法（越界/最短 200ms/零帧预警）：行内错误不落版本（C1 语义沿六族先例） |
| 5 浏览器预览（`<video>` 按入出点 + object-fit/object-position 演算；两画幅各自显示裁切） | 时间线可播，横竖版裁切可见 | 素材文件缺失：该镜头「素材缺失」占位，其余镜头照常，不炸页（沿 shotWorkingSpec 降级先例） |
| 6 出片（render-scene 组装媒体 props → Remotion OffthreadVideo 进同一时间线 → 双画幅 → 成功判定 = 产物存在 + ffprobe + 摘要/时长/音轨核对） | RenderRecord 追加（含 assetDigests），无尾部意外空白（显式尾帧核算） | 缺文件/摘要不符/渲染失败：**大声失败，不写 RenderRecord，不产半成品交付**（实测教训：退出码 0 ≠ 成功） |
| 7 保存重开/导出 | mediaAssets 随文档持久；重开后素材镜头完整；旧纯 SceneSpec 项目照常 | 素材仓缺文件：重开后逐镜头「素材缺失」告警，可改其他镜头，不阻断导出纯 spec 项目 |

## 4. 受控样片与任务拆分（§4.4）

样片 = 《采纳交接》§5：「20–30 秒解说短片，≥4 镜头 = 2 现有 SceneSpec + 2 段不同实拍，含旁白/字幕/至少一处转场」。任务拆分（每任务走 spec→plan→TDD→复核流水线，先本地导入后公开来源）：

1. **T1 数据契约与校验**：media-clip 联合成员、MediaAsset 账本、validate 扩展（存在性/摘要/in-out 边界/最短时长）、ADR 0003 变更日志、旧文档回归（迁移测试）。
2. **T2 导入与媒体仓**：内容寻址仓（env 可配目录）、ffprobe/解码核验、sha256、proxy 转码（分辨率上限）、失败清理；纯函数 + 脚本级（`scripts/video/media-ingest.mjs`）。
3. **T3 预览与镜头卡接线**：`<video>` 预览（入出点/fit/focal/两画幅裁切显示）、素材缺失降级、镜头卡媒体编辑字段、入出点行内校验。
4. **T4 出片链路**：render-scene 媒体 props 组装、Remotion 媒体镜头（OffthreadVideo + 裁切/原声混音）、成功判定（产物+ffprobe+摘要+无尾部空白）、RenderRecord assetDigests、双画幅。
5. **T5 Wikimedia 候选源**：检索（缩略图/许可/元数据）、分辨率选择、分片下载/超时/重试/清理、候选-资产两态、拒绝原因记录（会话级，见 §7 裁定 1）。
6. **T6 样片 e2e + 登记**：VID-023 全链路（含 §5 逐条断言）、qa registry、证据文档、双层门槛记录、Codex 交接单。

## 5. 质量门槛两层（§4.5）

- **链路正确（自动）**：VID-023 = 导入→混编→保存→重开→双画幅出片→ffprobe（时长/音轨/画幅/无尾部空白帧/旁白不句中截断）→同机双跑解码帧一致→失败注入（超时/残片/缺文件）不产 RenderRecord/半成品。测试零网络（Wikimedia 用录制夹具）；真实网络仅手动冒烟。
- **审片效果（人工，单独结论）**：镜头与旁白一致、横竖版裁切得当、文字可读、节奏与音画同步；结论三值「通过 / 待人工 / 失败」，与自动门槛分别标记交付（§6 口径），不以 ffprobe 成功替代。

## 6. OpenMontage 借鉴边界与许可（§4.6）

- 只借**设计与已验证的局部做法**：候选元数据接口概念、两态（候选≠已用）、下载前分辨率选择、成功判定含产物核验。零源码复制——OpenMontage 为 **AGPL-3.0**，若未来任何提议需复制其文件，先单列文件清单 + 许可评估并取得明确结论，未经此步不执行。
- 不采用：第二套时间线/项目账本、Piper 替换 CosyVoice、`blender_world` 商品路线、自动全网抓取、CLIP 全库索引、138 工具注册体系。实拍样片的「幻灯片化」不作为质量目标。

## 7. 待确认裁定（默认按写明执行，可推翻）

1. **拒绝原因记录粒度**：默认会话级（导入对话框内可见，不进项目文档）——项目文档只记**已发布资产**的来源/许可。理由：防文档膨胀（YAGNI）；若审计需要全留痕再升格为 project 级追加账本。
2. **首个公开来源 = Wikimedia Commons**：免密钥、逐文件许可/作者元数据明确、实测可检索；风险（大文件超时）由分辨率选择 + 分片下载缓解。第二来源（如 Pexels，需免费密钥）待首个稳定后再接。
3. **媒体仓位置**：默认 `<数据目录>/acs-media-store/`（env `ACS_MEDIA_STORE` 可覆盖；e2e 用仓库 `artifacts/media-store/`，gitignore 不入库，沿媒体不入库约定）。
