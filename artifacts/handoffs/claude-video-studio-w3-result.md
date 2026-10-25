# W3 交付报告：3D 两路线 Golden Spike 与质量门禁（2026-10-24）

分支 `claude/video-studio-w2-w5`（W3 段）。需求源：`artifacts/handoffs/claude-video-studio-continuation-2026-10-24.md` §W3。证据根目录：`artifacts/video-studio-w3-2026-10-24/`。

## 四态报告

1. **代码实现**：Three 路线 Golden Spike 脚本 `scripts/video/w3-three-golden-spike.mjs`（非品牌程序化演示立方体 → 计时烘焙 → 双画幅出片 → 早/中/晚关键帧 → 摘要落档）；身份清单与门禁设计 `three-route/IDENTITY-CHECKLIST.md`；Blender 路线协议 `BLENDER-ROUTE.md`。**无产品代码改动**（W3 是验证轮，按交接单「先做对比验证和门禁，不急于接入新架构」）。
2. **自动回归**：Three spike exit 0；烘焙 4.8s、出片 45.3s、双画幅各 96 帧（`three-route/spike-summary.json`）；既有 VID-025 确定性 e2e 不受影响（未动 three 链路任何代码）。
3. **真实浏览器与真实出片**：双画幅 H.264 MP4 落档（`three-route/render/`）；关键帧 6 张（早/中/晚 × 双画幅）。中段帧人工目检：立方体身份特征（等比、蓝主体、金强调棱）与清单一致，无破面/闪面。
4. **视觉质量**：程序化演示级（固定柔光 rig、无写实材质）——**不宣称商品级写实**；人工深度审片：待人工。

## 两路线状态

| 路线 | 状态 | 说明 |
| --- | --- | --- |
| 受控 Three（orbit3d@1） | **完成** | 全链路可复现（命令见 spike 脚本），成本已量化（秒级烘焙/分钟级出片），可编辑性=组件参数 |
| Blender 准确模型 | **待环境** | 本机无 Blender 执行器（检索过程见 BLENDER-ROUTE.md）；协议、命令、授权纪律、对照评分表就绪，环境到位即可复跑 |

**结论边界**：本轮不给出「两路线题材分配」结论——那需要 Blender 路线真实渲染后的同机位对照（交接单要求）；预填即是编造。

## 质量门禁设计要点（详见 IDENTITY-CHECKLIST.md）

身份声明四字段（subject/identityNotes/referenceViews/assetProvenance）在生成前校验，缺失即阻止；实现须走注册表版本演进（orbit3d@2 或 sceneSource 级可选字段），**最小集成建议**：若后续要把门禁落进代码，改 `validateThreeSpec` 之上的镜头级检查 + `bake-three.mjs` 入口前置，预计一个工作包；本轮按「先验证后集成」原则保持设计态。

## 同机位对照评分表（Blender 就绪后使用）

| 维度 | Three 帧 | Blender 帧 | 评（0-5） | 备注 |
| --- | --- | --- | --- | --- |
| 轮廓重合 | `three-route/landscape-mid.png` | （待补） | — | |
| 标识/文字 | 无（程序化） | （待补） | — | |
| 材质反应 | 演示级 | （待补） | — | |
| 运动中露馅 | （视频对照） | （待补） | — | |
| 人工修正耗时 | 0（参数化） | （待记） | — | |

## 已知限制

1. Blender 路线全部内容待环境（含 2026-10-09 旧 spike 的重验——旧产物在库但不可复跑）。
2. 身份门禁为设计态，未落代码（理由如上）。
3. 未申请/使用任何外部 3D 模型授权——程序化对象零授权风险，也意味着「准确商品」维度本轮无数据。
