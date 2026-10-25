# Task 3 交付报告：Blender 与 Three 路线对照（2026-10-25 修订）

分支 `claude/video-batch-2-t34`（基线 `main@799616a`）。任务源：§3。本轮修订按 Codex 复核意见修正口径。

## FORM 01 可行性核查（复核 Important#1）

**结论：Three 封闭注册表无法表达 FORM 01，不可比。**

- **资产位置**：`D:/codex/animate/artifacts/fictional-product-ad-2026-10-09/`——`render/form01_scene.blend`（可编辑主场景）、`portrait/draft/form01_scene.blend`（竖版独立取景）、72 帧横版 + 6s H.264/AAC、竖版独立导出、`REVIEW.md` 成本记录（Blender 5.2.2 Cycles OptiX，横版 381s 端到端）。
- **不可比原因**：Three 封闭注册表 `orbit3d@1/@2` 的 `validateParams` 仅接受 `shape ∈ {box, sphere, torus, icosahedron}` + 标准材质（`MeshStandardMaterial`、uniform color、roughness/metalness 标量）。FORM 01 香水瓶需要：
  1. **玻璃透明材质**（`Transmission`/`IOR`）——Three 路线不支持
  2. **多部件装配**（瓶身 + 瓶盖 + 标签）——orbit3d 单 mesh，无装配
  3. **曲线瓶身几何**——封闭 shape 集合无自由几何入口
  4. **弧形影棚背景幕**——orbit3d 无背景几何

按任务源约定"不为对照擅自扩充生产组件"，不做 Three 侧的 FORM 01 适配。

## 可行的同对象对照：C4 程序化立方体（口径收窄）

在两种路线**都能**表达的对象范围内，C4 演示立方体是唯一已完成的对照。数据来自已入 main 的 C4 产物（含轴修复后正确渲染）：

| 指标 | Three 路线 | Blender 路线 |
|---|---|---|
| 对象 | orbit3d@1 box 2×2×2（@1 口径） | 同参数 Blender 移植 |
| bbox IoU | — | 0.904（横竖，@1 基线） |
| 竖版映射 | @1 拉伸 3.16× | 720×405→拉伸 720×1280（复刻 @1） |
| 每帧成本 | ~0.47s（96 帧实测 45.3s） | ~3.1s 均值（外推，短段实测，非全长） |
| 材质 | 标准材质+双灯（演示级） | Cycles GI（写实感优势可从 `compare-*.png` 目检确认） |

**竖版口径修正**（复核 Important#2）：C4 的竖版对照是在 @1 拉伸语义下做的（两路线同为 3.16× 拉伸，IoU 0.904 有效）。**@2 方形像素取景（T1 修复）尚未与 Blender 做同机位对照**——若需 @2 口径的对照需单独执行，本轮不做。

**成本口径修正**（复核 #3）：Blender "约 7 分钟"为短段均值外推，非 144 帧实测；人工评分表空；结论限定为**单一程序化立方体的观察**，不能外推为 FORM 01 产品广告成本。

## FORM 01 Blender 单侧记录（无 Three 对照）

| 项 | 数据 | 来源 |
|---|---|---|
| 横版渲染 | 381s 端到端（含场景搭建 + 72 帧渲染 + 端卡） | REVIEW.md |
| 竖版 | 独立 .blend 重新取景，非裁切 | REMOTION_REVIEW.md |
| GPU | RTX 4060 OptiX，95% 峰值利用率（整卡采样） | REVIEW.md |
| 可编辑性 | .blend 可打开续改（模型/灯光/相机/材质） | .blend 在库 |
| 产出 | 6s 横竖双版 H.264/AAC + 文字排版 + 合成音效 | final/ + portrait/ |

## 适用范围结论（口径收窄）

| 场景 | 推荐 | 证据等级 |
|---|---|---|
| 工作台快速出片、参数可编辑 | Three | 立方体对照 + 集成链完整（已验证） |
| 竖版 3D | Three @2 | T1 修复验证（无 Blender @2 对照） |
| 写实产品（如香水瓶） | Blender | FORM 01 单侧完成；Three 无法表达（不可比） |
| 交互 3D 页 | Three | 自包含 HTML 导出链已有 |
| 成本量化对比 | — | 立方体对照有数据；FORM 01 无双侧对照，不做定量结论 |

## 四态

1. **代码**：无新代码（FORM 01 .blend 与渲染在库；Three 侧不扩组件）。
2. **自动回归**：VID-055（C4 冒烟）、VID-056（Three 取景）覆盖立方体链。
3. **真实出片**：C4 立方体对照双画幅产物在库；FORM 01 Blender 双版在库（无 Three 对照）。
4. **视觉**：C4 立方体几何一致（IoU 0.904）；FORM 01 写实质感仅 Blender 单侧；人工评分表**留空待人工**。
