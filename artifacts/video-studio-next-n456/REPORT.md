# N4/N5/N6 交付报告：数据图表、素材位与混合样片

分支 `claude/video-next-n456`（基线 main@63fca68），2026-10-27/28。
交接单：`artifacts/handoffs/claude-video-studio-next-n456-2026-10-27.md`。

## N4｜bar/line/counter 入受限语义 IR

四态：实现=完成；自动回归=semantic-shot-n4 7 用例 + dataHint 路由用例（389 全绿）；真实浏览器=三图表各一条全链（`audit-semantic-n4-live`）；视觉=check-layout 156 文本零碰撞 + 双画幅抽帧。

- IR：`bar-explainer`（bars 1..8）、`line-explainer`（points 2..12）、`counter-explainer`（value/prefix/suffix/decimals），形状校验对齐组件契约；编译到既有 bar-chart@1/line-chart@1/number-counter@1，配色/时序/布局全为编译器常量；时长下限按组件时序（1600+90×(n-1) / 2800 / 2400）。
- 数据纪律：图表 value 字符串化进数值闸（编造值与文字数字同拒）；「三城市」类结构性计数豁免（序数表补 城市|项）；独立汉字「一」豁免。renderHint 逐项列 label+value 供确认卡对账。
- dataHint：图表诉求但句中无数字 → 非阻断提示「补充具体数值后可用图表」（plan 路由 + 确认卡显示）。
- 实测三链：rain-bar（北京530/上海1170/广州1720）、temp-line（一月2/四月15/七月28/十月17）、water-counter（1500毫升）——确认卡逐项对账 + 数值闸审计 + 双画幅 MP4 + 抽帧全过。

## N5｜素材位：先规划位、再绑定入库素材

四态：实现=完成；自动回归=slot IR 3 用例 + plan/revise 路由闸改造用例；真实浏览器=`e2e-semantic-slots` 全链；视觉=绑定前后卡片截图 + 混合成片（见 N6）。

- IR：`media-slot-explainer`（slotKind 1..20 + purpose 1..60；URL/资产 ID 字段按资产口径拒绝给绑定指引）→ 编译为诚实占位（标题「素材位·种类」/副标题「待绑定素材——用途」/description【素材位】前缀）。
- 路由（plan/revise）：素材诉求句放行——模型须产素材位；两轮都无素材位才 422 needs-assets（重试带因）；明示图解替代仍留 substitutedForAssets。提示词 v8/r5 十种 intent + 素材纪律（真实素材需求→素材位；Logo/包装文字保留原图不重绘）。
- 绑定走**既有**媒体臂（模板选媒体→素材下拉→入出点→应用=reviseWorkingVersion mediaClip）；绑定完成剥【素材位】前缀；占位版本留链可回滚（e2e 断言）。
- e2e：产品短片句→素材位确认卡（明示待绑定）→上传自产测试视频（MediaPanel 真实入口）→绑定→media-clip 落库→保存重开绑定仍在→双画幅 MP4。
- **Ruling**：素材账本为纯视频契约（MediaAsset 强制 durationMs/fps/codec，storeKey mp4|webm|mov）——图片素材非一等公民；扩展=media-store schema 手术，交接单「不重做素材仓」边界内不做。测试素材=ffmpeg 自产色块视频（许可干净）。
- 已知限制：账本无删除入口，「绑定后删素材」的 UI 面未验证（错资产引用/缺素材由既有 buildMediaRevisePatch 行内校验覆盖：素材不存在或已移除→可操作错误）。

## N6｜混合样片 + 共性问题修复

**共性问题（样片实测暴露，已修）**：媒体片段旁白溢出——种子出点固定 2000ms，长旁白镜头绑定后「出片期才 500」，绑定动作离反馈太远。修复：种子按旁白预算扩（卡片/stock-apply 双路）+ 语速溢出从软预警升级为应用时可操作错误（扩出点/精简旁白/换素材，含素材剩余时长判断）。旧 M5 预警用例按新契约更新。

**共性问题 2（数值闸记数法）**：用户「120万次」→模型图表 value 1200000 被字面匹配误拒（混合片首轮生成连续 422 的根因）。修复：闸两侧解析为绝对值集（万=×10⁴/亿=×10⁸ 复合 token），同一数量不同记数法互通；量级不同仍拒（130万 冒充 120万 拒）。

四态：实现=完成；自动回归=389 全绿（量级词 1 用例 + 媒体绑定 2 用例）；真实浏览器=`e2e-semantic-mixed-film` 全链；视听=有声双画幅 + manifest 逐镜对账 + check-layout 64 文本零碰撞 + 抽帧（人工审片意见：模板化图解风格稳定，媒体镜头为测试色块非真实街拍——工具链已证，素材审美待真实素材验证）。

混合样片（21.6s，`artifacts/video-studio-semantic-mixed/`）：标题→柱状图（120万/350万次）→**绑定媒体镜头**（2 版本：素材位→media-clip）→**AI 修改流程镜**（2 版本：单镜自然语言修改入口）→数字计数（80万吨）→收尾；旁白字幕双画幅 MP4，manifest 逐镜 versionId=工作版本（含被修改镜头）。

## 复跑

```bash
pnpm --filter @acs/web test        # 389/389
node scripts/video/audit-semantic-n4-live.mjs      # 三图表链（真实千问）
node scripts/video/e2e-semantic-slots.mjs          # 素材位绑定链
node scripts/video/e2e-semantic-mixed-film.mjs     # N6 混合有声片
node artifacts/video-studio-semantic-n4/check-layout.mjs
node artifacts/video-studio-semantic-mixed/check-layout.mjs
```

## 给 Codex 的复核重点

1. 数值闸绝对值集（`absoluteNumeralsOf`）：复合 token 占位符防二次扫描的实现；小数×万（1.5万→15000）；两侧同口径比对是否有漏（负数？千分位逗号？——现按无逗号处理）。
2. 媒体绑定 fail-fast 的三类出口文案与 headroom 判断（素材剩余 ≥ 预算 → 扩出点提示；否则精简旁白）。
3. 素材位路由闸：plan/revise 的 missingSlots 判定与重试原因拼接；substitutedForAssets 与素材位并存时的语义。
4. N5 Ruling（图片素材不做）与已知限制（账本删除）是否接受为 v1 边界。
5. 混合片 AI 修改镜（versions=2）与绑定镜（versions=2）的版本链/回滚语义。

## 计费台账

N4 审计 3 链 + N5 e2e 2 轮 + N6 e2e 3 轮（含失败轮）+ 探针：qwen-plus 约 2.5 万 tokens；TTS 2 轮（N6 有声 + 失败重试）。远低于 ¥50 预算。
