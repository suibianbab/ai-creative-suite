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

## 复核修复轮（2026-10-28，CODEX_REVIEW_ROUND 结果四项全闭合）

- **P1-1 条目键白名单**：bars/points 条目未知键（含 assetUrl）校验层拒绝并给资产口径指引；编译只投影 label/value（4 个反例用例 + 投影断言）。
- **P1-2 导出闸**：`slot-gate.ts` 纯函数逐镜点名未绑定素材位，接入工作台双画幅+有声导出（与代表帧确认闸同位）。浏览器双路径实证：`export-blocked.png`（阻断+点名）→ 全绑定后 5 镜双画幅 MP4（各 15.0s，ffprobe 核验）+ 逐镜抽帧。
- **P2-1 范围命名**：N5 定名「视频素材位 v1」——素材账本为纯视频契约（MediaAsset 强制 durationMs/fps），图片绑定列为待办（需 media-store schema 演进，超出「不重做素材仓」边界）。
- **P2-2 读数与字幕**：①`formatCnCount` 万/亿记法（整除性不满足回落原数字；组件参数 `cnUnits` opt-in，语义编译器开启、手工模板口径不变；bar 值 1200000 显示 120万，单测+组件级渲染断言）；②字幕带 8%→2.5%（横版字号 5%→4.5%，Remotion 出片层与预览近似层同口径）——图表轴标签最深至画面 90.1%，新字幕带顶缘 91.4%，几何分离（旧带 82.5% 起即重叠，Codex 所指 s1 帧病灶）；③bar-chart 可选 `valueSuffix`（≤6 字，校验+默认空）。
- **P2-3 门禁**：biome 全绿（含本轮全部新文件）；VID-066/067/068 入 QA registry（120 自动用例）。
- **本轮环境硬仗（如实记录）**：系统 Chrome 155→156 staged 更新 + 常驻内存压力，暴露两个真实缺陷并修复——①media-server 客户端中断即击杀（未接 error 的读流，Chrome 新 compositor 会中途放弃下载；回归测试）；②渲染 GL 默认路径在新 Chrome 上卡死（--gl=angle 固化，RENDER_CONCURRENCY/RENDER_BROWSER_EXECUTABLE 可覆写）。残余现象：高内存压力下 8 分钟级渲染偶发 x264 malloc 失败（重试可过，本轮样片均为重试后完整产物）；.tools 渲染作业目录在失败后会话内偶发消失（不影响成功产物）。
- **数值闸两处收紧**：独立汉字「二」豁免（二维码等习语）；提示词 v9/r6 明令禁止原话没有的量化类比（模型「相当于1100万棵树」两轮固执实测触发）。
- 混合样片重制：project-final（v9 编译，柱值带 cnUnits）双画幅重渲染（20.0s/6 镜）+ 逐镜抽帧 + LAYOUT OK 64 文本。

## 给 Codex 的复核重点

1. 数值闸绝对值集（`absoluteNumeralsOf`）：复合 token 占位符防二次扫描的实现；小数×万（1.5万→15000）；两侧同口径比对是否有漏（负数？千分位逗号？——现按无逗号处理）。
2. 媒体绑定 fail-fast 的三类出口文案与 headroom 判断（素材剩余 ≥ 预算 → 扩出点提示；否则精简旁白）。
3. 素材位路由闸：plan/revise 的 missingSlots 判定与重试原因拼接；substitutedForAssets 与素材位并存时的语义。
4. N5 Ruling（图片素材不做）与已知限制（账本删除）是否接受为 v1 边界。
5. 混合片 AI 修改镜（versions=2）与绑定镜（versions=2）的版本链/回滚语义。

## 计费台账

N4 审计 3 链 + N5 e2e 2 轮 + N6 e2e 3 轮（含失败轮）+ 探针：qwen-plus 约 2.5 万 tokens；TTS 2 轮（N6 有声 + 失败重试）。远低于 ¥50 预算。

## Codex 二轮整改与重新验收（2026-10-28）

**覆盖前述修复轮中“有声双画幅已按新版重渲染”的说法：当时新版 20s 文件是无声重渲染，目录里的 21.589s 有声文件仍是旧图表版本。两者不能拼成一次验收。** 此节记录修正后的证据。

- 素材位状态现写入 `ContentVersion.assetSlot.kind`，旧项目由占位 SceneSpec 识别；可编辑的说明文字不再是出片判据。`@acs/video-document` 提供同一判断，工作台、`/api/video/render` 与 `render-scene.mjs` 均在正式 MP4 前拦截。删除说明前缀、直连 API、CLI 三条反例通过；绑定媒体或明确改用普通图解后，新工作版本可放行。项目 JSON 导出仍允许，以便继续编辑。
- 使用修复后 `project-final.json` 与六段已有计费缓存旁白重合成：`mixed-landscape.mp4` 和 `mixed-portrait.mp4` 各为 20.011s、H.264 + AAC（画面 480 帧 @24fps），均从同一内容版本生成。摘要与逐镜版本见 `report.json`。
- 横版有声片 3.5s 抽帧显示字幕位于图表轴标签下方且未碰撞；5.5s 抽帧显示“120万/350万”。本机文件在 `frames/landscape-s1-subtitle.png` 与 `frames/landscape-s1-values.png`，遵循 `.gitignore`：MP4/PNG 仅留本机，入库的 JSON/报告记录校验摘要。
- 重新抽帧抓到新增遗漏：`bar-chart` 的竖版分支仍输出原数字。代码与测试已补齐，最终竖版有声片 `frames/portrait-s1-subtitle.png` 实测显示“120万/350万”且字幕与轴标签分离；旧片保存在 `mixed-portrait-before-unit-fix.mp4`，不作为新版证据。
- 环境诊断：Image Studio 本地蒙版服务占用约 19 GB，导致可用虚拟内存不足，竖版曾报 Chromium/FFmpeg 内存错误。暂时停用该服务后，竖版单画幅全片渲染成功，已按原命令重启服务。**两画幅各自完整通过；本轮仍未证明单次请求连续双画幅事务在这台机器上成功**，应在资源隔离环境重跑 VID-068。
- 验证：`video-document` 163/163、素材位/API/应用目标测试 30/30、CLI 未绑定反例通过、Biome 510 文件零问题。完整 Web 套件将在指定 Node/pnpm 环境复跑；本机默认 Node 22.0.0/pnpm 9 的并行测试曾有媒体子进程失败，不能当作本轮代码结论。
