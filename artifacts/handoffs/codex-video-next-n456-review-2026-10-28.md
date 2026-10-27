# 交给 Codex：N4/N5/N6 复核

分支 `claude/video-next-n456`（基线 main@63fca68）。交付自述与四态：
`artifacts/video-studio-next-n456/REPORT.md`（含 rulings、已知限制与复核重点预答）。

## 范围

1. **N4 图表 intent**：`semantic-shot-n4.test.ts` + `audit-semantic-n4-live` 三链证据
   （`artifacts/video-studio-semantic-n4/`）。重点：数值闸对图表 value 的字符串化
   覆盖、dataHint 非阻断语义、时长下限公式。
2. **N5 素材位**：slot IR/路由闸（`semantic-shot-n5.test.ts` + plan/revise 路由测试）
   + `e2e-semantic-slots` 绑定链。重点：素材位占位诚实性（不冒充完成）、绑定/
   回滚走既有版本机制、needs-assets 新语义（两轮无素材位才 422）。
3. **N6 共性修复 + 混合片**：媒体绑定旁白 fail-fast（`media-clip-templates` M5→N6）
   与数值闸量级词（`absoluteNumeralsOf`）；`e2e-semantic-mixed-film` 21.6s 有声
   混合片（`artifacts/video-studio-semantic-mixed/`）。

## 复跑

见 REPORT「复跑」节（389/389；真实链需 DASHSCOPE_API_KEY dev server）。

## 已知限制（先读）

- 图片素材非一等公民（账本纯视频契约；Ruling 见 REPORT N5 节）。
- 账本无删除入口：「绑定后删素材」UI 面未验证；错引用/缺素材走行内校验。
- 混合片媒体镜头为自产测试色块（工具链验证；真实素材审美待后续）。
