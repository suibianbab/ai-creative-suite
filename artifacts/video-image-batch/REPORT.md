# 图片素材批次交付报告（任务 1–6）

分支 `claude/video-image-batch`（基线 main@1432d75），2026-10-28。
交接单：用户粘贴清单（6 项）。Codex 复核单：`artifacts/handoffs/codex-video-image-batch-review-2026-10-28.md`。

## 任务 1｜图片成为正式素材

四态：实现=完成；自动回归=video-document 5 用例 + media-store 5 用例（真实 ffmpeg PNG/JPEG 夹具）；真实浏览器=e2e-image-media 全链；出片=（无独立出片，服务任务 2/6）。

- `MediaAsset.original` 判别联合：`kind?: "video"`（缺省——旧资产零迁移）｜`kind: "image"`（sha256/bytes/width/height/format/storeKey，**无** durationMs/fps/codec/hasAudio）。storeKey 扩 `.png/.jpg/.webp`（jpeg→jpg 归一）。
- 校验：图片 media-clip 入点恒 0、audio 恒 mute、出点上限=账本统一上限（展示时长由镜头给定）；kind 非法值拒绝。
- media-store：probe 图片分支（png/mjpeg/webp codec 且无时长）；ingest 扩展名门 + 内容-扩展名一致性 + 解码门照走 + 无转码/代理；仓键模式扩图片。
- web：上传 accept/面板文案/图片元信息标签（`图片 800×600 · png`）；预览 `<img>`（同 cover/contain 单源裁切）；绑定臂图片口径（入点 0/mute/200..600s）；shot-recipes 图片不受 200ms 时长门。
- 浏览器验收：真实 PNG 上传→账本→绑定→media-clip 落库→img 预览→保存重开仍在→缺失资产双错误面（文档级：损坏件导入被严格校验拒绝点名；文件级：onError 降级占位）。

## 任务 2｜图片镜头与基础运动

四态：实现=完成；回归=video-scene media-motion 2 用例 + document motion 枚举用例；浏览器/出片=e2e-image-motion 双画幅 MP4 首尾帧对账。

- `media-clip.motion`：still/zoom-in/zoom-out/pan-left/pan-right（缺省不写键）。`mediaMotionTransform(motion, progress)` 纯函数（video-scene 单源；预览与 Remotion 同一份）：缩放 1↔1.12、平移 ±6% 配 1.06 超采（不露边）。
- 渲染：`<Img>`（图片）/OffthreadVideo（视频，口径不变）共处 motion 容器（transform 由 Sequence 本地帧→进度）；装配透传 motion/isImage（图片跳过音轨/时长检查）。
- 验收：同图双画幅 1280×720/720×1280——zoom 首尾帧哈希不同（运动生效）、still SSIM≥0.995（h264 有损下按结构相似度判静止）、同项目视频镜正常（回归）。

## 任务 3｜图片与文字的镜头编排

四态：实现=完成；回归=overlay 校验 4 断言；浏览器/出片=任务 6 样片 A（overlay 上屏+保存重开）。

- `media-clip.overlay {title 1..24, position top/center/bottom, enterMs 0..5000}`。渲染层药丸底衬（任意图片上可读）、字号随画幅、**叠加不随运动抖动**（在 motion 容器之上）。预览同口径。UI：标题输入（留空=无叠加；placeholder 明示 Logo 请保留源图）+ 位置三档；enterMs 固定 400。
- 边界：不做自由排版/关键帧文字动画；商品图上的 Logo/包装文字**保留源图**，叠加只新增文字。

## 任务 4｜自然语言规划使用已上传图片

四态：实现=完成；回归=路由测试（payload 含文件名+尺寸、确认卡 hints 逐镜点名）；浏览器=任务 6 样片 A（slotKind 点名 hero-bottle/detail-cap）。

- 规划请求带图片账本摘要（fileName/尺寸，≤20 张、40 字裁剪、无字节/ID）；服务端净化后拼进两轮 payload。提示词 v10：图片素材纪律——真实画面镜头用素材位且 slotKind 写「图片：<文件名>」点名建议；**只可用清单内真实文件名**；不虚构图片细节/包装文字。
- 确认卡素材位 renderHint 逐镜点名建议图；**绑定/改绑/回滚仍是用户动作**（沿用既有版本链）。

## 任务 5｜双画幅一键导出的资源稳定性

四态：实现=完成；回归=既有 cleanup/500 路径测试；浏览器=e2e-dual-export-stability 连续两次真实导出。

- 工作台渲染帧并发压 1（`RENDER_CONCURRENCY` 尊重外部调试值；两画幅本就顺序）。实测并发 2 在内存紧张时 x264 malloc 失败/Chrome OOM（N456 批次死因复盘），1 换吞吐保稳定。
- 验收：连续两次一键有声导出——每轮双链接、两画幅时长一致（8.43s）、零漂移、AAC；渲染记录 6→12 追加不覆盖；每条 RenderRecord 带输出引用（失败路径 cleanupFailedJob 既有）。

## 任务 6｜两条可体验样片

e2e-image-samples（真实千问+TTS；图=ffmpeg 自制，许可干净）：

- **样片 A 商品广告 16.2s**（4 镜，`product-*.mp4`）：上传 hero-bottle/detail-cap 两图 → AI 规划点名 → 用户绑定（镜1 zoom-in + overlay「轻便保温 · 全天温暖」；镜2 pan-left）→ 卖点 sketch → 品牌收尾；保存重开后修改收尾镜头旁白；有声横竖导出+抽帧。versions=2 链贯穿。
- **样片 B 知识数据片 19.0s**（5 镜，`knowledge-*.mp4`）：柱状 120万→350万次（cnUnits 万记法）→ 三步流程 → 计数 80万吨 → 确认卡数值逐项对账；有声横竖导出+抽帧。**已知偏离：19s 低于 20-30s 目标带下限 1s**（时长概率性；确认卡如实显示，如实记录）。
- 逐镜记录 `review.json`（source/motion/overlay/narration/versions）；抽帧 `frames/`（横竖×逐镜）。

## 汇总门禁

`pnpm --filter @acs/web test` 398/398；typecheck 通过；biome 全绿；`qa:validate` 125 自动/56 手工（VID-070..073 新登记）。

## 已知限制

- 样片 B 时长概率性偏低（19s vs 20-30s 带）；重试可落带内，未固化重试到带内的强制（时长是透明标注不是硬失败——沿用 N4 裁定）。
- 运动幅度/叠加 enterMs 为固定常量（受控口径，无自定义）。
- 图片仅本地上传；Wikimedia stock 未扩图片。
- 图片绑定与视频共用媒体臂 UI（无独立图片编辑器）；「文字位置与时段」= 三档位置+固定淡入，非自由编排。
