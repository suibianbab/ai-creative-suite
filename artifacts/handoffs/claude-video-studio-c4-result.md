# C4 交付报告：Blender 路线环境与双路线同机位对照（2026-10-25）

分支 `claude/video-studio-closure`（基于 C3 提交）。任务源：交接单 §C4；协议：`artifacts/video-studio-w3-2026-10-24/BLENDER-ROUTE.md`。证据：`artifacts/video-studio-c4-2026-10-25/`（`c4-report.json`、`scene.blend`、`build_scene.py`、`render_dual.py`、双画幅 MP4、关键帧 6 张、并排对照 2 张）。

## 环境门禁：通过（W3 的「待环境」解除）

- **执行器**：`D:\codex\animate\.tools\blender-5.2.2-windows-x64\blender.exe`（便携版，主检出 .tools，2026-10-09 轮遗留仍在位；`--version` 实测 **Blender 5.2.2 LTS**）。不改系统安装；W3 当日只搜了 PATH/Program Files/D:\Blender*，未查 .tools 便携位。
- **环境实测坑（已修）**：工厂默认偏好不勾任何 Cycles compute device，`scene.cycles.device="GPU"` 会**静默回退 CPU**——首轮实测约 40-45s/帧、GPU 占用 8%（nvidia-smi）、进程 CPU 时间快速累积。修正：`build_scene.py` 显式 `prefs.compute_device_type="OPTIX"` 并逐设备 `use=True` 后重跑（首轮无产物入库，回退速率入档）。

## 执行内容（W3 协议逐项）

- **题材**：非品牌程序化演示立方体（无外部模型/纹理，零授权风险）；`.blend` 源文件入证据（模型/材质/相机/灯光全在文件内，可编辑）。
- **Rig 参数级移植**（与 W3 Three Golden Spike 的 orbit3d@1 同机位）：正交相机 ±4×±2.25（ortho_scale 8）@(0,0,10) 朝原点 +Y 上；立方体 2×2×2 #4f9dff roughness 0.4 metal 0、tilt X=0.35rad、自转 frame×0.02（确定性驱动表达式）；参照轴 **0.08×2.2×0.08（长边沿 Y，与 Three 的 BoxGeometry(0.08, 2.2, 0.08) 同轴）** #e8b04b @ (2.6,-0.2,0)——**Codex 复核 Important#2 修复**：原 build_scene 的 (0.08, 0.08, 2.2) 长边在 Z、正对相机只剩一个点，导致首轮对照无效；修复后已重渲全部关键帧/对照图/度量（冒烟断言同步升至金色参照轴 ≥1px 且为竖条）。主灯方位 (2.5,4,3)（Sun energy 3.0 近似 DirectionalLight 2.0）、环境强度 0.111 近似 AmbientLight 0.35。**颜色经 sRGB→线性转换**（Blender 节点色按线性存储；未转换时背景 #101820 会渲成 (71,86,99)——实测修掉，修后背景逐像素等于 (16,24,32)）。灯光为近似移植（渲染器单位制不同），对照维度是同机位下的材质/光线质感，**不是逐像素复刻**。
- **命令**（复跑入口）：
  ```text
  blender --background scene.blend --python render_dual.py -- landscape <out>
  blender --background scene.blend --python render_dual.py -- portrait <out>
  ```
  Cycles 固定 samples=48、seed=0、自适应采样关（确定性前提）；PNG 序列 → 系统 ffmpeg 8.0.1 编 H.264。
- **双画幅**：横版 1280×720；竖版 720×405 → 拉伸 720×1280——**精确复刻 Three 路线的竖版映射**（实测发现 Three 竖版 3D 是同一 16:9 视锥的 3.16× 纵向拉伸：内容宽高比 0.45 vs 横版 1.43，与视锥数学完全吻合；该行为按原样复刻以便同机位对照，作为独立发现上报 C5）。
- **帧数**：72 帧/画幅（Three spike 的立方体段 0..71；对照时刻 0.6/1.5/2.7s 均落段内；Three 基线另含尾随 1s spec 镜头共 96 帧，不属对照对象）。

## 实测数据（数字以 c4-report.json 为准）

| 项 | 实测 |
| --- | --- |
| 建模（build_scene.py，含 .blend 保存） | 0.76 s |
| 运动段渲染 横版 1280×720 ×24 帧 | **110.8 s（4.6 s/帧，轴修复后 2026-10-25 上午重渲）**；旧值 470.3s/19.6s 为首轮渲染，保留在 c4-report.json attempts 史 |
| 运动段渲染 竖版 720×405 ×24 帧 | 149.6 s（**6.2 s/帧**，像素数 0.56 → 速率一致由分辨率驱动） |
| CPU 设备单帧（i5-14400F，48spp，720p） | 36.3 s |
| GPU（nvidia-smi 整卡） | 基线 9%，峰值 12-13%，显存峰值 2186 MiB |
| 72×2 全长外推 | **≈7 分钟**（按轴修复后双画幅实测 motionMsPerFrame 均值 ~3.1s/帧；Codex r2 修复：SKIP 关键帧启动计时不再参与外推；首轮 19.6s/帧外推 47 分钟保留在 attempts 史——本轮速率显著回升且 GPU 峰值占用 24%/21%，与设备归因「未决」一致，不作单轮定论） |
| 编码 | motion-landscape.mp4（1280×720×24f）、motion-portrait.mp4（720×1280×24f，拉伸复刻） |

**设备归因（未解决，如实；Codex 复核 Minor 措辞收窄）**：偏好已显式勾选 OPTIX（探测输出留痕），但渲染期间 nvidia-smi 整卡峰值仅 12-13%——注意该读数是**整卡、0.5s 采样**，低利用率不能独立证明 GPU 未承载采样（已观察到相对 CPU 计时的差异）。**确定的事实只有**：本轮表现低于 2026-10-09 同执行器的真实 OPTIX 速率（5.5s/帧，见 `artifacts/blender-gpu-spike-2026-10-09/REVIEW.md`——便携版来源与官方 ZIP SHA 亦在该档），且设备归因未决。本会话单帧耗时 20-85s 大幅波动（详见 c4-report.json attempts/deviceInvestigation），嫌疑为驱动 595.95 差异或同期负载。**本轮成本按实测速率入账，不称其为「CPU 侧速率」**；环境复查前不宣称 Blender 路线 GPU 加速可用。

**结构对照（数值代理，人工栏仍留空；轴修复后重算）**：中段帧内容包围盒（64×36 网格，灰度>40 判非背景）Three 33×23 格 vs Blender 35×22 格，**IoU 0.904**（横竖同式——竖版两边同为 3.16× 拉伸映射所以网格一致）。旧值 IoU 0.625/0.615 产生于参照轴朝向错误的渲染，已作废。并排图 `compare-{landscape,portrait}-mid.png` 供人工评审：可见 Three 均匀标准材质光照 vs Cycles 全局光照渐变——即两路线「材质反应」维度的真实差异。

## 四态

1. **代码实现**：`scripts/video/c4-blender-dual.mjs`（建模→双画幅渲染→GPU/CPU 采样→编码→关键帧/并排对照→报告；`--smoke` 冒烟模式；`--phase keys|motion` 分相可续跑）。
2. **自动回归**：冒烟模式 = 建模 + 单帧渲 + **像素级断言**（背景逐像素 = #101820——能抓住 sRGB→线性转换缺失类回归（该 bug 实测渲成 rgb(71,87,99)）、蓝色主体 ≥100px、金色参照轴 ≥1px；此断言为终审复核后补入，此前版本只查文件存在，本报告早前文本夸大为"像素级断言"，已更正）；全流程断言 = 每画幅关键帧恰 3 张 + 运动段恰 24 帧（全长 72×2 为外推值而非渲染断言），MP4/关键帧/对照图由流程强制生成。
3. **真实渲染**：OPTIX 配置全程 + 整卡 nvidia-smi 采样（峰值占用/显存入档，设备归因未决见上）；CPU 单帧对照计时；首轮 CPU 回退事故如实入档。
4. **视觉质量**：程序化演示级对照（两路线都不是商品写实）；**人工评分表留空待人工**（下方），不宣称商业级产品广告。

## 同机位对照评分表（人工栏留空——待人工）

| 维度 | Three 帧 | Blender 帧 | 评（0-5） | 备注 |
| --- | --- | --- | --- | --- |
| 轮廓重合 | `three-route/landscape-mid.png` | `blender-landscape-mid.png` | — | 结构性代理：见 c4-report.json 的 bbox 对照 |
| 标识/文字 | 无（程序化） | 无（程序化） | — | 两路线本轮都无文字维度 |
| 材质反应 | 演示级（Standard 材质） | Cycles 48spp（Principled） | — | 待人工 |
| 运动中露馅 | （视频对照） | （视频对照） | — | 待人工 |
| 人工修正耗时 | 0（参数化） | （待记） | — | 待人工 |

## 结论边界

- 本轮给出的是**同机位对照的事实数据**（成本/帧时/占用/关键帧产物），两路线题材分配结论仍需人工评分后才有——不预填。
- 三发现的独立上报：①工厂默认 GPU 静默回退 CPU（环境坑）；②Blender 节点色线性 vs sRGB（移植坑）；③**Three 竖版 3D 拉伸映射**（产品层发现，建议 C5 后续工作包处理）。
