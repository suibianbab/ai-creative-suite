# 交给 Codex：图片素材批次（6 项）复核

分支 `claude/video-image-batch`（基线 main@1432d75）。交付报告（含逐项四态、
边界、复跑命令）：`artifacts/video-image-batch/REPORT.md`。

## 范围与提交

| 任务 | 提交 | 要点 |
| --- | --- | --- |
| 1 图片正式素材 | `c4d70b1` + `ab05136` | MediaAsset.original 判别联合（kind?: video 兼容旧 / kind: image 无时长/帧率/编码/音轨）；probe/ingest/仓键/文件路由/面板/绑定臂全链；真实 PNG/JPEG 夹具单测 + 浏览器全链 |
| 2 图片镜头+基础运动 | `c5bac55` + `3deeabc` | media-clip.motion 五档（mediaMotionTransform 纯函数单源，预览/出片同变换）；<Img> 渲染通道；双画幅 MP4 首尾帧对账（zoom 变化/still SSIM≥0.995/视频回归） |
| 3 图片与文字编排 | `5b7c?`（git log 见 detail） | media-clip.overlay（title 1..24/位置三档/enterMs）；渲染层药丸叠加不随运动抖动；UI 标题+位置；Logo 保留源图不重绘 |
| 4 NL 规划引用已传图 | 见 log | 请求带图片账本摘要（fileName/尺寸）；提示词 v10 slotKind「图片：<文件名>」点名；确认卡逐镜显示建议图；绑定仍用户动作 |
| 5 双画幅导出稳定性 | 见 log | 工作台渲染帧并发 1；连续两次一键有声导出（时长零漂移/记录 6→12 追加/每条带输出引用） |
| 6 两条样片 | 见 log | 商品广告 16.2s（绑定图+zoom-in+overlay+pan-left+保存重开+改镜）+ 知识片 19s（数值对账柱状/流程/计数）；review.json 逐镜 |

## 复跑

```bash
pnpm --filter @acs/web test        # 398/398
node --test packages/video-scene/dist/media-motion.test.js  # 已含于包测试
node scripts/video/e2e-image-media.mjs            # 无需密钥
node scripts/video/e2e-image-motion.mjs           # 无需密钥（CLI 渲染）
node scripts/video/e2e-dual-export-stability.mjs  # 需 DASHSCOPE_API_KEY dev server
node scripts/video/e2e-image-samples.mjs          # 需 DASHSCOPE_API_KEY dev server
pnpm qa:validate                                   # 125 自动 / 56 手工
```

## 已知限制（先读）

- 样片 B 19s 略低于 20-30s 目标带（生成概率性时长；确认卡如实显示，
  review.json 记录偏离）。
- 运动幅度固定（≤1.12 缩放/≤6% 平移），无自定义参数——「少量清晰可控」口径。
- overlay enterMs 固定 400ms（UI 不暴露）；位置仅三档。
- 图片绑定仍走「媒体臂」路径（与视频同一 UI），无独立图片编辑器。
- 图片 stock 源（Wikimedia）未扩：图片仅本地上传入账。
