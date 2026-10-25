# T1 交付报告：竖版 Three 3D 方形像素取景（2026-10-25）

分支 `claude/video-next-batch`（基线 `origin/codex/video-closure-final-fix@0dcf2a1`）。任务源：`claude-video-studio-next-batch-2026-10-25.md` §T1。证据：`artifacts/video-studio-t1-portrait-3d-2026-10-25/`。

## 实现

- **`orbit3d@2`**（`scripts/video/three/components/orbit3d.mjs`）：水平视轴恒 8×zoom、垂直 = 8×zoom×(height/width)。横版 1280×720 公式值与 @1 逐值相同（**横版输出逐字节不变**）；竖版 720×1280 垂直视轴 8×(1280/720) ≈ 14.22（方形像素，主体比例与横版一致）。参数表与 @1 完全相同（可编辑 rig 不变）；宽高缺省回落 16:9 基线。
- **`orbit3d@1` 保留**：旧 spec 历史渲染逐字节不变（registry 双版本注册）。
- **harness/bake**（`three/harness.js`）：按 `componentVersion` 选择版本对象，宽高传入装配层；顶层 `pose` 导出兼容。
- **工作台**（`three-templates.ts`）：新建 3D 镜头默认 `componentVersion: 2`；旧项目里的 @1 spec 原样渲染。

## 四态

1. **代码**：完成（上述四文件；无 schema 改动——componentVersion 是既有正整数字段）。
2. **自动回归**：three-registry **10/10**（含新增 T1 视轴公式测试：@2 横=@1 逐值、竖版垂直 = 8×(h/w)、zoom 语义、@1 无宽高照常、缺省回落）；three-bake 16/16；web 全套（含 three-templates v2 断言）；typecheck/Biome/qa validate 108/56。
3. **真实出片**：`t1-portrait-3d-verify.mjs`（VID-056）——@2 与 @1 同 spec 双画幅真实渲染，原生像素 bbox：**v2 横 1.421 vs 竖 1.426（差 0.3% < 10% 判据）**；v1 竖 0.451 ≈ 1.421/3.16（拉伸证据）。早/中/晚帧 × 双画幅 × 双版本留档；`portrait-old-vs-new.png` 并排目检确认。
4. **视觉**：并排图左（v1）立方体纵向拉长变形，右（v2）比例正确、上下留白正常——竖版 3D 现在可作为可交付素材。

## 新旧产物对应

- @1 = 历史基线（所有现存项目与渲染记录的原语义，渲染不变）。
- @2 = 新默认（新建 3D 镜头）；新产物哈希在 `t1-summary.json` 与 artifacts。
- 新旧竖版并排：`portrait-old-vs-new.png`；不把新哈希冒充旧哈希。

## 已知限制

1. 竖版视锥更高 → 主体在竖版画面中占比更小（比例正确的自然结果；如需竖版特写可调 zoom 参数——rig 可编辑性保留）。
2. **Codex 后续修复已补代表帧预览**：工作台整片预览遇到 3D 镜头时，请求当前工作版本和画幅的中段代表帧；服务端调用出片使用的同一个 Three bake harness，横竖分别按 1280×720 / 720×1280 烘焙。浏览器 VID-061 验证了两画幅图片尺寸及显示。独立取竖版第 36 帧 PNG 与 MP4 在 1.5 秒的解码抽帧，蓝色主体的像素包围盒均为 `(233,512)-(486,767)`（720×1280），取景位置与比例一致。预览是静态代表帧，镜头动态仍应以 MP4 为准。原先“工作台不预览”的占位已移除。
3. T3 交互页为衍生演示（PerspectiveCamera，非出片 OrthographicCamera 的逐像素机位复刻——Codex P2-1 已在页面文案与 manifest `semantics` 字段如实标注）。
