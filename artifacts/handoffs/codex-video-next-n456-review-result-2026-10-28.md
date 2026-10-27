# Codex 复核结果：Video Studio N4/N5/N6

范围：`main@63fca68..claude/video-next-n456@da12931`。**结论：暂不合 main。** N4 三类图表与 N6 混合有声片的技术链已有证据，但 N5 仍是部分能力；以下问题需要收口。此轮只复核，未修改生产代码。

## 阻断项

### P1-1｜图表嵌套 IR 未实行严格字段白名单

`apps/web/src/app/video-studio/semantic-storyboard.ts:809-879` 仅校验 `bars[]` / `points[]` 条目的 `label` 与 `value`，不拒绝其他键；编译器在 `:495/:514` 又把原条目原样写入 SceneSpec。最小复现：

```ts
const shot = {intent:'bar-explainer',title:'数量对比',narrationText:'数量变化',durationMs:3000,
  bars:[{label:'A',value:5,assetUrl:'https://example.com/x'}]};
const checked = validateSemanticShot(shot); // ok: true
compileSemanticShot(checked.shot, 5000).plan.spec.params.bars[0].assetUrl; // URL 仍在
```

这违反“模型不能输出 URL/资产 ID/未授权字段”的 IR 边界，且把未授权数据持久化进项目。对 bar/line 条目逐键拒绝未知字段，并在编译时只投影 `label/value`；补 `assetUrl`、任意扩展键与数组条目错型测试。

### P1-2｜未绑定素材位可以作为成功 MP4 导出

`scripts/video/e2e-semantic-slots.mjs:98-110,126-180` 只要求至少一个素材位并绑定第一个，随后导出完整横竖 MP4。实际 `project-slots.json` 有 **4 个**素材位，`project-reopened.json` 仍有 **3 个**工作版本带 `【素材位】`，但 `render/landscape.mp4`、`render/portrait.mp4` 已成功生成；抽帧 `frames/landscape-s1.png` 是“待绑定素材”大字。占位画面自身说清状态，但正常成功出片路径无法区分“草稿预览”和“素材齐备成片”，与 N5 的完成态承诺不符。

建议：允许草稿预览，但最终导出前统计未绑定素材位并阻断，或显式产出带 `draft` 状态/水印的预览，不能冒充正式成片。E2E 应分别覆盖“未绑全部→不可最终交付”和“全部绑定→正式出片”，不能只绑定 1/4 就宣称产品短片链完成。

## 功能范围与质量

### P2-1｜图片素材要求尚未交付

交接任务要求从项目已有图片/视频绑定真实素材；本轮 `MediaAsset` 账本仍只接视频，E2E 将产品照片诉求改为自产色块 MP4。报告已坦诚写为 Ruling，但这是**N5 范围未完成**，未经用户确认不能标成 N5 全部完成。建议明确选择：扩展现有媒体账本支持静图（保持单账本），或将本批能力正式命名为“视频素材位 v1”，把图片绑定列为待办。

### P2-2｜数据图表单帧可读性尚未达到样片质量口径

混合片横版 `artifacts/video-studio-semantic-mixed/frames/landscape-s1.png` 的柱值显示 `1200000/3500000`，缺少用户输入的“次/万”单位；字幕“到350万”压在图表横轴“之前/之后”位置。竖版没有该处字幕碰撞。当前 `check-layout` 只报组件文本几何 64/64，并未覆盖合成字幕，所以不能以“零碰撞”证明最终画面无碰撞。应保留数值来源与单位、加入最终字幕安全区抽帧检查，至少修复本样片的横版重叠；避免按单一镜头坐标硬编码。

### P2-3｜合并门禁与回归登记

`biome check .` 当前报 **9 个格式错误**（包括 `page.tsx` 的多处顶格 `dataHint: null`），不能合并；格式化后复跑。新增三条 live/E2E 脚本没有登记到 `qa/registry.json`，未来回归入口发现不了这些能力。应按已有 tier 与端口/密钥条件登记，避免运行 `qa:validate` 只显示旧的 117 自动/56 手工用例。

## 核实通过与限制

- Web typecheck 通过；Web 测试连续两次为 **389/389**，首次并行执行时出现一次 388/389，未保留单项失败明细，应留意并发偶发性。
- `qa:validate` 注册表有效；N4 布局 156 文本、N6 布局 64 文本零组件内碰撞。
- N6 横竖 MP4 文件存在，`ffprobe` 确认为 H.264 视频 + AAC 音轨，尺寸分别 1280×720 / 720×1280。视觉抽帧证实技术链，但媒体镜头是自产色块，不足以验证真实街拍/商品广告的素材审美。
- N4 数值闸的“120万→1200000”记数法转换有单测与真实样片；这证明数值相等，不证明指标和单位语义匹配。报告应维持此边界。

请修复 P1 与格式门禁，给出增量提交范围。图片素材与最终画面质量需明确交付口径后再宣称 N5/N6 完成。
