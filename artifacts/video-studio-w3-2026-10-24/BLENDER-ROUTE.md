# W3 Blender 路线：协议就绪、执行待环境

## 状态：**待环境**（本机无 Blender 执行器）

`Get-Command blender` 与常见安装路径（Program Files / LOCALAPPDATA / D:\Blender*）均未发现。2026-10-09 的三份 spike 产物在库（`artifacts/blender-*-2026-10-09/`），但可执行器已不在本机。按交接单「完成能独立完成的部分」，本路线交付协议与命令就绪、标注待环境复跑。

## 复跑协议（环境就绪后执行）

1. **建模**：获取有明确许可的公开模型（首选 CC0/CC-BY，来源与许可证入账）；无合适模型时用非品牌程序化对象（` bpy.ops.mesh.primitive_cube_add` 级别即可）并如实限定结论。
2. **源文件**：`.blend` 保存可编辑（模型/材质/相机/灯光逐版本入 `.blend` 文件内），参数与命令同录。
3. **渲染命令**（Windows）：
   ```text
   blender --background <scene>.blend --python render_dual.py -- <out> landscape
   blender --background <scene>.blend --python render_dual.py -- <out> portrait
   ```
   `render_dual.py` 固定 Cycles、固定采样数与种子（确定性对照前提），输出 PNG 序列 → 既有 ffmpeg 管线编码。
4. **对照**：与 `three-route/` 同机位关键帧并排比较（评分表见 w3-result 附录）。
5. **计时**：建模准备分钟数、渲染每帧耗时、显存/内存峰值（`--debug-memory` 或任务管理器采样）。

## 授权与来源纪律

- 模型/纹理来源与许可证必须入账（blender-product-spike 的 `model-inspection.json` 是既有格式先例）。
- 不使用来源不明的扫描件；单图转 3D 的结果一律标注「风格化概念」，不得称商品复刻。

## 结论边界（先行声明）

Blender 路线解决「准确模型 + 写实灯光」；Three 路线解决「工作台内可编辑 + 程序化参数化」。两路线按「身份准确性 × 总制作成本」择优分配题材——该结论须等本路线真实渲染后才能给出，本轮不预填。
