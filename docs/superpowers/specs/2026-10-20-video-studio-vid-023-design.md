# P2.5-T6 样例 e2e VID-023 设计（Wikimedia 素材源全链路）

- 日期：2026-10-20
- 状态：已实施（Task 1 e2e 双跑通过、Task 2 登记与收口完成）
- 前序：`docs/superpowers/specs/2026-10-20-video-studio-stock-source-design.md`（T5 素材源，L5 把片内署名留到本刀）
- 计划：`docs/superpowers/plans/2026-10-20-video-studio-vid-023.md`

## 1. 意图

P2.5 五刀（契约 → 导入仓 → 预览编辑 → 出片链路 → Wikimedia 素材源）都已单独验收，但还没有一支**用真实 Wikimedia 素材**走完「编辑器全链路 + CLI 出片」的样片。本刀用一支可重复执行的 e2e 把这条链钉死，并结掉 T5 明确留给 T6 的**片内署名**裁定。

## 2. 裁定 L6：片内署名

**成片不叠任何画面内署名；署名信息只保存在项目元数据（素材账本的 `origin`）里，发布环节由使用者自行核验。**

- 记录面：T5 已入账并展示 `origin.license{name,author,usageNote}`、`origin.sourcePageUrl`、`origin.retrievedAt`；资产标签与候选卡已有作者/许可/来源。
- 不做的：片尾卡、角标、任何新渲染层、任何 UI 控件。出片字节不因署名改变。
- 已知义务：`usageNote` 含 `须署名` 的素材，发布前仍需按许可在发布环节处理；本刀在样片证据里记录该限制，不把它变成产品承诺。
- 影响：**无产品代码改动**；本刀只新增 e2e、QA 登记与文档。

## 3. 样片定义

- 规划句式（P1 分镜规划器固定句式，纯规则、不调模型）：
  `做一个9秒的STEM解说视频，主题是云，分3个镜头`
  → 3 镜头 × 3000ms（总 9000ms，@24fps = 216 帧）。
- 镜头 1：组件模板下拉选「媒体镜头（选素材设入出点）」（value `media-clip`）→ 应用；在卡内在线素材面板搜 `clouds`，选 `File:Clouds-seloncourt.ogv` 的 **480p** 档位，点「下载并应用」。
- 落库默认（T5 行为）：入点 0、出点 `min(2000, 素材时长)`、`fit:"cover"`、`focalX:0.5`（草稿显示 50%）、`audio:"mute"`；镜头 1 时长随之变为 2000ms（总片长 8000ms）。
- 镜头 2、3：保持规划器产出的 spec 镜头不动，作为混编对照。
- 不编辑旁白、不合成 TTS；渲染不传 `--narration`。

固定素材（网络漂移时以 `pageTitle` 为准，找不到就失败，不静默换片）：

| 字段 | 值 |
|---|---|
| pageTitle | `File:Clouds-seloncourt.ogv` |
| 480p 档位 | `https://upload.wikimedia.org/wikipedia/commons/transcoded/f/fb/Clouds-seloncourt.ogv/Clouds-seloncourt.ogv.480p.vp9.webm` |
| 作者 / 许可 | Thomas Bresson / CC BY 2.0（`须署名`） |
| 实测 | 854×480、28600ms、`hasAudio:false`、VP9/WebM、无 proxy |

## 4. 验收链与断言

1. **检索**：面板搜 `clouds` 返回候选，固定 `pageTitle` 在列；档位下拉**初始值**即 480p（`DERIVATIVE_URL`）。
2. **下载并应用**：观察到 `POST /api/media/stock/import` 返回 200；卡内出现 `素材已下载并应用（镜头 1）`。
3. **项目导出**（`.editor-export` 下载 JSON）：
   - `mediaAssets[0].origin`：`kind:"stock-source"`、`sourceId:"wikimedia"`、`sourcePageUrl` 为固定值、`license.name:"CC BY 2.0"`、`license.author:"Thomas Bresson"`、`retrievedAt` 为 ISO 8601。
   - `original`：854×480、28600ms、`hasAudio:false`、`sha256` 匹配 `/^[0-9a-f]{64}$/`、`storeKey` = sha256 前 16 位 + `.webm`、`proxy` 缺省。
   - 镜头 1 工作版本 `sceneSource`：`type:"media-clip"`、`mediaAssetId` 与账本一致、`inMs:0`、`outMs:2000`、`fit:"cover"`、`focalX:0.5`、`audio:"mute"`、`durationMs:2000`。
   - 镜头 2、3：仍为 `spec`，且 `componentId` 与导入前基线导出逐个一致。
4. **保存 / 重开**：`.editor-save` → `已保存`；`.project-action` 返回列表 → 打开同一项目 → 镜头 1 素材下拉回填同一 `mediaAssetId`，卡内入点/出点/fit/focal/audio 五项与导出值一致。
5. **预览**：重开后把整片预览拨到帧 12（500ms，仍在镜头 1 的 0..47 帧域内并暂停），`<video class="media-stage">` 的 `src` 含 `storeKey`，`readyState≥2`（已取到当前帧数据）、`videoWidth===854`、`error===null`。
6. **出片**：`node scripts/video/render-scene.mjs --project <exported> --out <dir>`（不传 `--narration`）双画幅各 exit 0；**双跑逐字节 SHA-256 一致**；镜头 1 帧（如第 24 帧，1000ms）YAVG ≥ 100（非黑帧；不构成素材身份校验）。
7. **零计费**：`artifacts/tts-usage.jsonl` 行数前后不变（本机为 34；文件不存在时按 0 计）。
8. **控制台**：浏览器 `console` 无 error。
9. **纪律**：导出 JSON、渲染产物、截图、临时媒体仓全部 untracked/仓外，不入库。

## 5. 环境前提（本机事实，非产品行为）

- dev server 绑定 `127.0.0.1`（见本节末条），`NODE_USE_ENV_PROXY=1` + `HTTPS_PROXY=http://127.0.0.1:7890` 才能访问 Wikimedia；`BASE_URL` 默认 `http://127.0.0.1:3211`（经 `scripts/dev/proxy-3211.mjs` 代理到 3210，或直接起在 3211）。
- `ACS_MEDIA_STORE` 指向仓外隔离目录（如 `D:/tmp/acs-stock-e2e-*/store`），不碰真实仓。
- `playwright-core` 自带 Chromium（本机已安装，沿既有 e2e 的 `chromium.launch({ headless: true })`）；`ffmpeg`/`ffprobe` 在 PATH。
- 统一用 `--hostname 127.0.0.1` 启动：`scripts/dev/proxy-3211.mjs` 的上游写死 `127.0.0.1:3210`；本机 `localhost` 可能先解析到 IPv6 `::1`，用 `localhost` 绑定时代理会连不上。

## 6. 非目标

- 片内署名（本刀裁定不做，见 §2）。
- proxy 分支真实网络覆盖（固定素材 VP9/WebM 无音轨，不触发；由单测覆盖）。
- 搜索分页/排序/多语言、候选持久化、断点续传、仓 GC。
- T5 两条缓存 Minor（超时文案与清理失败态、`content-encoding: Identity` 大小写）仍按交接单 §6 缓办；本刀不顺手改，避免无评审的 spec §3 文案变更。

## 7. 失败与证据

- 任一步失败：`exit 1`，打印步骤名与可读原因；固定素材缺失/网络不可达都算失败，不跳过。
- 证据文件 `artifacts/video-studio-vid-023/evidence.md`（untracked）：环境、实测时长/哈希、双跑 SHA-256、YAVG、台账行数、署名裁定复述。
- QA 登记 `qa/registry.json`：`VID-023`，`tier:"integration"`，`requiresPorts:[3211]`，`argv:["node","scripts/video/e2e-stock.mjs"]`。
