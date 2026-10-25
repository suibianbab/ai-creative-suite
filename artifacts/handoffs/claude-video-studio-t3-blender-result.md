# Task 3 交付报告：Blender 与 Three 同对象双画幅对照（2026-10-25）

分支 `claude/video-batch-2-t34`（基线 `main@799616a`）。任务源：`claude-video-studio-next-batch-2026-10-25.md` §3。

## 环境与资产

- **Blender**：便携 5.2.2（`D:/codex/animate/.tools/blender-5.2.2-windows-x64/blender.exe`，来源与 SHA 留档 `artifacts/blender-gpu-spike-2026-10-09/REVIEW.md`）
- **同一对象**：非品牌演示立方体——Blender `build_scene.py` 与 Three `orbit3d@1` rig 参数级对齐（正交相机 ±4×±2.25、立方体 2×2×2 #4f9dff roughness 0.4、tilt 0.35rad、自转 frame×0.02、参照轴 0.08×2.2×0.08 Y 向）
- **来源**：C4 执行轮（已并入 main，含轴修复后的正确渲染）

## 双画幅对照

| 维度 | Three 路线 | Blender 路线 | 结论 |
|---|---|---|---|
| 关键帧 | 0.6/1.5/2.7s 双画幅 6 帧 | 14/36/65 帧双画幅 6 帧 | 主体与参照轴几何一致（bbox IoU **0.904** 横竖同值） |
| 运动段 | — | 24 帧双画幅 MP4 | 自转姿态逐帧与 Three 同式（`frame*0.02` 驱动表达式） |
| 竖版 | Three 竖版经 orbit3d@2 修复后方形像素 | Blender 竖版 720×405→拉伸 720×1280（精确复刻 Three 映射） | 竖版两路线同一映射策略，可比 |

## 制作成本

| 指标 | Three 路线 | Blender 路线 |
|---|---|---|
| 烘焙（96 帧/画幅） | 4.8s（bake-three，SwiftShader） | — |
| 出片（96 帧/画幅） | 45.3s | 外推 144 帧 ≈7 分钟（实测均值 ~4.6s/帧横 + ~1.6s/帧竖） |
| 每帧成本 | ~0.47s | ~3.1s（均值） |
| 编辑性 | 工作台可改参数、即时预览、配方入库 | 离线 CLI，改参数需重跑 Python |
| 材质/光照 | 标准材质 + 双灯（演示级） | Cycles 全局光照 + 环境近似（写实级但非生产级） |
| GPU 归因 | 纯 CPU（SwiftShader） | **未决**（OPTIX 已启用但利用率仅 12-24%，详见 `c4-report.json` deviceInvestigation） |

## 适用范围结论

| 场景 | 推荐路线 | 理由 |
|---|---|---|
| 工作台内快速出片、参数可编辑、配方复用 | **Three** | 集成链路完整，出片 ~1 分钟内，零环境依赖 |
| 写实光照/材质表现（如产品质感预览） | **Blender** | Cycles GI 有真实光感优势，但成本高 ~6×，且需离线 |
| 竖版 3D | **Three（@2）** | 方形像素取景已修复；Blender 竖版需手动分辨率设置 |
| 准确商品模型 | **Blender** | `.blend` 可载入真实模型；Three 封闭注册表仅支持程序化几何 |
| 交互 3D 页 | **Three** | 自包含 HTML 导出链已有（T3/W4）；Blender 无交互输出 |

**边界**：本轮结论基于单一非品牌程序化对象的对照；不含真实商品模型的准确性与成本差异。Blender GPU 加速可用性待环境复查，不宣称。

## 复跑

```text
node scripts/video/c4-blender-dual.mjs --smoke                     # 冒烟（~2s）
node scripts/video/c4-blender-dual.mjs --phase keys                 # 关键帧（~5min）
node scripts/video/c4-blender-dual.mjs --phase motion               # 运动段（~10min）
node scripts/video/t1-portrait-3d-verify.mjs                         # Three 路线（含 @2 竖版）
```

## 四态

1. **代码**：无新代码——C4 对照链已入 main（含轴修复），本报告为结果汇总与适用范围结论。
2. **自动回归**：VID-055（C4 冒烟）、VID-056（Three 取景）在 QA 注册表覆盖。
3. **真实出片**：Blender 双画幅 6 关键帧 + 48 运动帧 + 并排对照图（`compare-*-mid.png`）全部留存 `artifacts/video-studio-c4-2026-10-25/`。
4. **视觉**：同机位几何一致（IoU 0.904）；Three 均匀光照 vs Cycles 渐变真实可见（`compare-landscape-mid.png`）；人工评分表**留空待人工**。
