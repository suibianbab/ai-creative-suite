# C2 交付报告：W5 交换清单的真实时间线与可用媒体（2026-10-25）

分支 `claude/video-studio-closure`（基于 C1 提交）。任务源：交接单 §C2。证据：`artifacts/video-studio-c2-2026-10-25/`（工作目录 `.tools/video-studio-c2-transition/`，不入库）。

## 先回答交接单的第一个问题：转场与无缝区间的关系

读渲染器真实实现（`packages/video-document/src/transitions.ts` + `render-scene.mjs` L496-510）：**转场是叠加、不是缩短**。dip-to-black 在相邻镜头尾部/头部"借帧"（halfOut=ceil(T/2)、halfIn=floor(T/2)），叠加黑场发生在既有帧内；镜头帧区间与总时长不变。因此 v1 的"无缝衔接权威时间线"在有转场的项目里依然正确——v1 缺的是**表示合成后的转场窗口**。据此 v2 的设计：区间语义不变，新增合成窗口表示 + 编辑器可编辑性限制说明。

## 改动（`scripts/video/export-edit-list.mjs` → v2）

- `transitions[]`：每条 `{boundary, kind, durationMs, startFrame, frames, halfOut, halfIn, baked:true}`——窗口帧数学用 `resolveTransitionWindows`（video-document dist；与渲染器装配**同式**——渲染器内联了自己的同式实现，见终审修复节），借帧越界在导出时大声拒绝。
- `compositionNotes[]`：①转场已合成进帧（区间/总长不变）；②逐镜切片首尾相接即还原权威终片（切片内含变暗帧）；③要改/去转场，切片无法恢复未变暗原始帧，须回项目重出片——编辑器侧可编辑性限制如实写明。
- `renderSources` + 逐镜 `sourceSpans` + `slicePlan`（`--render <dir>` 给定才有）：真实渲染源逐画幅 SHA-256/字节入账；每镜两个画幅的精确帧区间；可复跑的 ffmpeg 命令模板。
- 素材核验（`--media-store <dir>` 给定才有）：逐资产打开 `original/<storeKey>` 实测 SHA-256 与账本比对，`verified{file,bytes,sha256}` 入清单；不可读/摘要不符即拒绝导出。
- 校验器双版本：v1 清单（含 W5 留存工件）仍可读；v2 增查转场窗（位置等式、借帧上下限、相邻窗口重叠）与 sourceSpans/renderSources 一致性；formatVersion 3+ 拒绝。
- CLI：输出 `edit-list.v2.json`（原子写不变）；**out 目录与任何源目录（narration/render/media-store）任一方向重叠即拒绝**（源资产不覆盖）。

## 四态

1. **代码实现**：完成（上述 + 7 条新回归）。
2. **自动回归**：`node --test scripts/video/export-edit-list.test.mjs` 10/10（RED→GREEN：实现前 8 失败实证）。覆盖：v1 工件可读、v3 拒绝、旧项目（无转场）v2 时间线与留存 v1 工件逐字段一致、转场窗帧数学（500ms@24fps=12 帧，66..78）、区间不变+无缝保持、损坏转场窗三型（错位/越界/重叠）拒绝、render 源摘要与切片方案、素材核验正/反例、CLI v2 原子写、out 落源目录拒绝且源文件逐字节未动。
3. **真实导出与切片**（真实 STEM 项目，全程先拷贝）：
   - 拷贝 STEM → 注入 `fade 500ms @boundary 0` → **真实双画幅渲染**（`render-scene.mjs`，624 帧 ×2，旁白 7/7，RenderRecord 只回写拷贝 savedVersion 5→6；留存原件指纹前后复核**分毫未动**——W2 事故教训落实）。
   - 导出 v2 清单：转场窗 `{startFrame:66, frames:12}` 与渲染器自己的 `render-manifest.json` **逐字段一致**；7/7 audioTrack、7/7 wordTimings 引用真实可读文件并带 SHA-256。
   - **真实切片**（系统 ffmpeg 8.0.1 按清单 slicePlan）：镜 1（72 帧/3.000s）、镜 7 竖版（72 帧/3.000s）、镜 2（96 帧/4.000s）——ffprobe 实测帧数与区间吻合。**真实发现并修复**：`-t 时长`切片会把恰在端点整秒处的下一镜首帧多包进来（实测 97≠96 帧），slicePlan 已改为 `-frames:v 帧数` 并把该坑写进 notes。
   - **转场确实合成在帧里**（数值实证，signalstats YAVG）：窗内帧 60→68→72→76→84 = 46.4→30.8→**16.0（纯黑，与渲染器标定值一致）**→34.1→45.9。
   - 反例：真实导出清单拷贝篡改 `timeline[3].startFrame+=10` → 校验器拒绝（`须无缝衔接`）。
4. **视觉质量**：转场关键帧 3 张已归档（`keyframes/frame{68,72,76}.png`）+ YAVG 数值核验；主观审片不适用（无 UI 变化）。

## 复跑

```text
node --test scripts/video/export-edit-list.test.mjs
# 真实链路（约 3-5 分钟，渲染为主）：
node scripts/video/render-scene.mjs --project .tools/video-studio-c2-transition/work/stem-with-transition.video-project.json \
  --style-bible .tools/video-studio-c2-transition/work/stem.style-bible.json \
  --out .tools/video-studio-c2-transition/work/render --narration artifacts/video-studio-stem-sample-final-2026-10-23/narration
node scripts/video/export-edit-list.mjs --project .tools/video-studio-c2-transition/work/stem-with-transition.video-project.json \
  --out .tools/video-studio-c2-transition/work/editlist --render .tools/video-studio-c2-transition/work/render \
  --narration artifacts/video-studio-stem-sample-final-2026-10-23/narration
```

## 限制（如实）

1. **编辑器往返仍未验证**（本机无许可编辑器，同 W5）：v2 清单 + 真实切片 + 逐镜 WAV 已把"可导入的素材"备齐，`MANUAL-ROUNDTRIP.md` 的核对步骤仍待人工在许可编辑器执行。
2. 转场 kind 目前仅 `fade`（schema 限定）；清单结构已为多 kind 留位。
3. 素材核验只在显式 `--media-store` 时进行；不传则清单只带账本（与 v1 行为一致，未冒称核验）。
4. 切片是"明确受支持方案 + 已实测命令"而非编辑器内建导出；逐镜切片文件本轮作为证据产物归档（3 个），全量 14 个切片可由 slicePlan 一键复算。

## 终审修复（全分支新上下文复核后，同一提交序列内补齐）

- **帧量化改为渲染器同一口径**：v2 初版沿用了 v1 的逐镜头 `round(durationMs×fps/1000)`，与渲染器的累计边界取整（ADR 0003 §3.5）在特定时长组合下从第二镜起错一帧（如 [3010×4]@24fps：72/144/216/288 vs 正确 72/144/217/289）——切片方案会把错帧写进可执行命令。已改用 `quantizeTimeline`（video-document 导出，零帧镜头大声拒绝），回归测试锁定 `[72,144,217,289]`。已交付的 STEM 转场工件两种取整恰好同值，帧数据不受影响。
- **--fps 非正整数大声拒绝**：初版单镜头项目 + `--fps abc` 会把 `endFrame: null` 写进清单（NaN 比较全部为假）。已在 CLI 入口校验。
- 文本更正：转场帧数学与渲染器是**同式**实现（渲染器 render-scene 内联了自己的窗口计算，非调用同一函数），两处等价但存在漂移风险——已在代码注释与本报告中改为准确表述。
