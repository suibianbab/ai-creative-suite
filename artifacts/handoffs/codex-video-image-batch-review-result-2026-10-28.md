# Codex 复核结果：Video Studio 图片素材批次

范围：`main@1432d75..claude/video-image-batch@ed1113d`。结论：**暂不合入 main**。图片入账、版本保存与双画幅导出已有实现和自动化证据；以下成片缺陷与任务 4 的真实链验收需要先修复。

## P1-1｜导出片的叠加标题几乎透明

`packages/remotion-engine/src/scene-spec-composition.tsx:205-209` 以 `localFrame / FPS` 得到**秒**，再除以 `overlay.enterMs`（**毫秒**）。400ms 淡入实际变成 400 秒。3.1 秒的商品镜头结束时不透明度不足 0.008。`artifacts/video-image-samples/frames/product-landscape-s0.png` 可见字幕，却看不到预期的「轻便保温 · 全天温暖」叠加标题；预览端 `apps/web/src/app/video-studio/scene-preview.tsx:479-483` 使用毫秒，因而两端不一致。

修复：统一毫秒口径，补非零帧的渲染层断言或真实抽帧对账。标题应在设定淡入时间后清楚可见。

## P1-2｜第二个及后续媒体镜头的运动从错误进度开始

`packages/remotion-engine/src/scene-spec-composition.tsx:158-165` 在 `<Sequence from={shot.startFrame}>` **外**调用 `useCurrentFrame()`，读到整片全局帧，却按镜头本地帧除以 `shot.frames-1`。`mediaMotionTransform` 会把超出 1 的进度截为 1，因此后续镜头（样片第二镜 `pan-left`）通常一上屏就停在终点，不按镜头时长平移。预览端按本地帧运动，两端再次不一致。

修复：把取帧逻辑置于 Sequence 子组件内，或明确减去 `shot.startFrame`；使用非首镜头检查首、中、末帧位置，并对照页面预览。

## P1-3｜平移露出黑边

`packages/video-scene/src/media-motion.ts:41-44` 的 `scale(1.06) translateX(±6%)` 只提供约 3% 的单侧超采，却移动约 6%；同时 `scene-spec-composition.tsx:182-189` 变换的是整块容器。实际 `artifacts/video-image-samples/frames/product-landscape-s1.png` 右侧已有明显黑条，与报告「不露边」相反。叠加标题也在这个被变换的容器内（`:201-214`），并非报告所说的独立固定层。即使修复 P1-2，本问题仍会在运动首尾出现。

修复：固定裁切视口、只变换内部图片，并使缩放余量覆盖平移幅度；抽取横竖两画幅 pan 首尾帧，检查四边无空白/黑边。

## P1-4｜“规划点名已上传图片”在真实样片中未成立

交接单称样片 A 的 `slotKind` 点名 `hero-bottle/detail-cap`，但 `artifacts/video-image-samples/review.json` 的 `productAd.namedImages` 为 `[]`，`product-planned.json` 里的两处素材位仅写「产品整体照片」「产品局部特写」。`scripts/video/e2e-image-samples.mjs:205-207` 计算点名数量后未断言非空，随后 `:225-229` 按「hero/全景」关键词**人工兜底选图**，所以测试仍报成功。当前只能证明通用素材位 + 人工绑定可用，不能证明任务 4 的真实链达标。

修复：在真实浏览器链中要求确认卡和项目 JSON 至少正确点名两张已上传图；不满足时测试失败。模型不遵守提示时需明确降级为「待用户选择」，不能把人工兜底计作自动点名成功。另请处理 `semantic-plan/route.ts:62-63` 文件名最多 40 字与 `semantic-storyboard.ts:916-920` 的 `slotKind` 最多 20 字之间的冲突，并在服务端校验模型给出的文件名确属本次清单（若仍宣称“只可用清单内真实文件名”）。

## P2-1｜视频镜头允许设置运动，但页面预览不播放该运动

`shot-editor-card.tsx` 对媒体镜头统一显示运动选择器；文档和 Remotion 渲染也接受视频 `motion`，但 `scene-preview.tsx:513-531` 的视频分支只返回普通 `<video>`，不应用 `mediaMotionTransform`。用户编辑视频镜头时所见与导出不同。请将运动限制为图片镜头，或补视频预览同口径支持，并加一条回归。

## 验证范围与边界

本轮检查了提交差异、关键代码、交付 JSON 和本机样片抽帧；未重新运行完整测试套件。报告的 398/398、125 自动/56 手工等通过数量暂按交付方记录，不等于上述视觉和语义验收通过。样片商品图是自制几何色块，可证明链路，不能证明真实商品的 Logo、包装文字、裁切与商业观感；这些质量项另用许可明确的真实商品图验证。19 秒知识片低于目标 20–30 秒已在报告如实披露，可作为非阻断限制。

整改后请提交最小增量，并附：修复前后相同时间点的横竖抽帧、非首镜头运动首/中/末帧、平移四边检查、实际确认卡点名截图及项目 JSON、针对上述反例的测试结果。
