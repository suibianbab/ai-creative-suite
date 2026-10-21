# P3-B 3D 镜头（three.js 预烘焙）设计

- 日期：2026-10-21
- 状态：待实施
- 前序：`docs/VIDEO_STUDIO_ALIGNMENT_REVIEW_2026-10-17.md`（P3 行：交互动画/动态网页 + Three.js 3D + 小游戏）；`docs/adr/0003-video-studio-shot-schema.md`（scene_spec 声明式、确定性适函数比对解码帧、渲染记录固定确定性输入全集）
- 相关：`docs/superpowers/specs/2026-10-21-video-studio-interactive-delivery-design.md`（P3-A，交互交付拒绝 3D）、`scripts/video/render-scene.mjs`（出片主链路）、`scripts/video/media-server.mjs`（媒体托管）、`artifacts/p3b-three-spike/`（本设计的可行性快验）

## 1. 意图

P3-A 让观众能自己点着看；P3-B 要的是**画面本身有三维感**：产品展示、概念解释类镜头里出现旋转的立方体/球体/环面，而不是平面图形做假 3D。

约束没有变：本仓库的一切成片都要过确定性门禁（ADR 0003），同一项目两次出片必须给出同一部片子。所以 P3-B 的第一性问题不是「怎么把 three.js 画出来」，而是「怎么让 WebGL 的画面在被编码进 MP4 之前就已经是确定的、可复算的、可留证的」。

### 1.1 三条路线与选择

| 路线 | 做法 | 结论 |
| --- | --- | --- |
| A 实时渲染 | `@remotion/three` + react-three-fiber，Remotion 渲染时逐帧跑 WebGL | 否 |
| **B 预烘焙** | 独立无头 Chromium 逐帧烘焙 PNG → 编码 mp4 → 当普通媒体镜头喂给现有 Remotion 合成 | **采用** |
| C 交互页内嵌 | 3D 放进 P3-A 的 `index.html`，用 WebGL 现场渲染 | 否（P3-A R1 的自包含 + 8 MiB 上限都容不下） |

路线 A 被否的三条理由：

1. **确定性不可控**：WebGL 上下文由 Remotion 的渲染浏览器创建，显卡/ANGLE/驱动任一变化都会改变字节；`@remotion/three` 把「渲染器的选择」藏进了渲染进程，我们无法在失败时给出可读诊断，也无法把 renderer 字符串写进渲染记录。
2. **依赖面**：react-three-fiber 会再引入 three + 一整套 React 渲染器生命周期，而我们的合成树是纯数据驱动（`spec`/`media` 两种 props），没有 React 组件编排需求。
3. **时间预算**：Remotion 渲染期内多一层 GPU 调用，帧耗时不确定；烘焙把这段成本挪到渲染之前，可单独计时、单独重试、单独比对哈希。

路线 B 的可行性已被快验证实（`artifacts/p3b-three-spike/hashes.json`，2026-10-21）：

- 两个**独立浏览器进程**各烘焙 48 帧 1280×720 PNG，逐帧 SHA-256 完全一致，`mismatches: []`，整册摘要 `dc763746…`；
- 渲染器字符串 `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`，Chromium `156.0.8078.4`，three r186；
- 性能：240 帧「渲染 + PNG 回传」共 2.69 s（均值 11.2 ms/帧，中位 11.07 ms/帧），单镜头烘焙成本可忽略；
- 对照实验：`antialias:true` 与 `preserveDrawingBuffer:false` 都会改变字节（详见 `variants.json`），因此这两个开关必须写死并进证据。

## 2. 核心裁定（每条都写明代价）

### R1 场景源 = 新增 `sceneSource.type: "three"`，声明式、平台解析

```ts
{
  type: "three";
  spec: {
    specVersion: 1;
    componentId: string;        // 必须是 three 注册表里的已注册组件
    componentVersion: number;   // 正整数
    durationMs: number;         // 正整数，必须等于 ContentVersion.durationMs
    seed: number;               // 0..4294967295 的整数
    background: string;         // "#RRGGBB"
    params: Record<string, unknown>; // 交给组件 validateParams 深度校验
  };
}
```

与 `spec`（SVG 组件）、`media-clip` 同一语义层级：平台**解析并校验**，绝不 `eval`，绝不接受任意 JS 代码或外部模型/纹理 URL。`spec.durationMs !== version.durationMs` 时校验失败（与 `media-clip` 的 `durationMs === outMs − inMs` 同位置、同纪律）。

- 理由：ADR 0003 要求平台可解析的声明式数据；只有把 3D 场景写进文档，项目才是自洽可重算的——烘焙产物是派生物，丢了能重来。
- 代价（若判断错）：文档新增一种 sceneSource，所有按 `type` 分支的调用点都要跟一处；漏改的表现是「明确拒绝 + 中文报错」，不是静默降级。
- 已探明需要跟进的调用点：`packages/video-document/src/validate.ts`（校验 + 错误枚举）、`scripts/video/render-scene.mjs:205`、`scripts/video/frame-dryrun.mjs:134`、`scripts/video/export-interactive.mjs:65`（P3-A 拒绝话术）。

### R2 场景组件 = 版本化封闭注册表，本刀只注册 `orbit3d@1`

组件与 `packages/video-scene` 的 SVG 组件同构，但**不进 video-scene**（那里的契约是 `render(): SvgNode`，混入非 SVG 会破坏契约）：

- `scripts/video/three/registry.mjs`：`threeRegistry.get(componentId, componentVersion)`，重复注册抛错，查不到抛 `UnknownThreeComponentError`；
- `scripts/video/three/components/orbit3d.mjs`：`{ componentId: "orbit3d", version: 1, validateParams(value), createRig(THREE, ctx), pose(rig, frameIndex, ctx) }`。

`orbit3d` 的 `params`（全部有默认值与范围，`validateParams` 逐项拒绝越界）：

| 键 | 类型/范围 | 默认 | 含义 |
| --- | --- | --- | --- |
| `shape` | `"box" \| "sphere" \| "torus" \| "icosahedron"` | `"box"` | 主体几何 |
| `color` | `#RRGGBB` | `#4f9dff` | 主体颜色 |
| `accent` | `#RRGGBB` | `#e8b04b` | 参照轴颜色（保证画面不是纯色块） |
| `spinPerFrame` | 0..0.5 弧度 | `0.02` | 每帧绕 Y 轴自转量 |
| `tilt` | 0..1.5 弧度 | `0.35` | 初始 X 轴倾角 |
| `zoom` | 0.5..2 | `1` | 正交相机视野缩放 |

- 理由：封闭集合让确定性可穷举——每个组件、每个版本的渲染路径都必须被 e2e 覆盖，才敢进注册表。
- 代价（若判断错）：只有一种 3D 观感；加组件是纯追加（注册表 + 一个组件文件 + 一条 QA 断言），不需改数据模型。

### R3 烘焙 = 独立无头 Chromium + 强制 SwiftShader，逐帧由帧号驱动

烘焙页（`scripts/video/three/harness.html` + `harness.js`）用 import map 从本地静态服务加载 three 与组件，页面只暴露两个入口：`window.bakeFrame(frameIndex) → PNG data URL` 与 `window.bakeInfo`。固定项：

| 项 | 值 | 说明 |
| --- | --- | --- |
| 启动 | `chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--disable-gpu-sandbox"] })` | 显式走软件光栅，避免同一份项目在不同机器上出两种字节 |
| 断言 | `UNMASKED_RENDERER_WEBGL` 必须含 `SwiftShader`，否则失败 | 断言而非假设：强制参数失效时要大声失败 |
| `antialias` | `false` | 快验证明 `true` 会改变字节 |
| `preserveDrawingBuffer` | `true` | 否则 `toDataURL` 读回不稳定 |
| `setPixelRatio` | `1` | DPR 不进渲染 |
| 尺寸 | 画幅常量 1280×720 / 720×1280，CSS 撑满、无滚动条 | 与出片尺寸同源 |
| 时间 | **只读帧号**，不读 `performance.now()` / `Date.now()` / `requestAnimationFrame` 时序 | 每帧由 Node 显式推进：`pose()` → `render()` → `toDataURL()` |
| 随机 | 只来自 `spec.seed`（复用既有 `seededRandom` 口径） | 组件当前不取随机，但契约先钉死 |

- 理由：快验的 48 帧逐字节一致是在这一组开关下取得的，任何一个变了都是另一套字节契约。
- 代价（若判断错）：SwiftShader 强制参数在未来 Chromium 版本失效 → 断言直接失败并给出中文原因，不会静默出一部不可复现的片子；修复点是启动参数，不动数据模型。

### R4 帧数 = 该镜头在整片时间轴上的量化 span

烘焙帧数**不**按单镜头 `round(durationMs/1000*24)` 自算，而是用 `quantizeTimeline(全镜头时长, 24)` 得到该镜头的 `span.frames`（累计边界量化，ADR 0003 禁止逐镜头独立取整）。烘焙出的 mp4 恰好 `span.frames` 帧 @24fps。

- 理由：与出片、交互交付、转场的帧图完全同源；否则 3D 镜头的时长会与相邻镜头对不齐，转场边界错位。
- 代价（若判断错）：累计取整可能让某镜头比名义时长多/少 1 帧，观众无感，但它是全仓库唯一正确的对齐口径。

### R5 编码 = Remotion 自带 ffmpeg，产物是临时文件，不进媒体仓

`pnpm --filter @acs/remotion-engine exec remotion ffmpeg`（已核实：n7.1，含 `libx264`、`image2` 解复用/复用，参数透传可用）。参数写死：

```
-y -hide_banner -loglevel error
-framerate 24 -i <framesDir>/%04d.png
-c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -threads 1 -movflags +faststart
<tmp>/shot-<n>.mp4
```

- 理由：不引入系统 ffmpeg 依赖（e2e 里的 `ffmpeg` 来自 PATH，不能当运行时依赖）；带宽与质量的取舍与 Remotion 主渲染一致（crf 18 / yuv420p）。`-threads 1` 去掉多线程调度的字节差异。
- 代价（若判断错）：多一次有损编码（3D 画面经 h264 后再被 Remotion 编一次，属二次编码）；若质量不可接受，可将中间产物换成无损但更大的编码，装配层不变。

### R6 烘焙产物 = 以「媒体镜头」同形喂给现有合成

烘焙出的 mp4 以 `storeKey` 形状命名（`<sha256 前 16 位>.mp4`），落在临时目录的 `original/` 下，由**独立的 `media-server.mjs` 实例**托管（`--root <临时目录>`，白名单只放本片烘焙键）。props 组装：

```js
{ media: { src: `http://127.0.0.1:<port>/original/<key>.mp4`,
           assetWidth: width, assetHeight: height,
           inMs: 0, outMs: Math.round(frames / 24 * 1000),
           fit: "contain", focalX: 0.5, audio: "mute", trimBefore: 0 } }
```

`TimelineScene` / `MediaClipLayer` 一行不改——3D 镜头在合成层就是一段普通视频。

- 理由：复用已被 P2.5 验证过的媒体链路（OffthreadVideo、trim、fit、Sequence 对齐），把新增面收敛到烘焙与装配两处。
- 代价（若判断错）：3D 镜头无法与旁白「原声混音」（烘焙无音轨，`audio: "mute"` 恒定）；若以后要 3D 自带音效，需要新的音轨来源。

### R7 证据 = `RenderRecord` 新增可选字段 `three`

```ts
three?: {
  componentId: string;
  componentVersion: number;
  threeVersion: string;     // "186"
  chromiumVersion: string;  // "156.0.8078.4"
  glRenderer: string;       // UNMASKED_RENDERER_WEBGL 原文
  framesDigest: string;     // 各帧 PNG 的 sha256 以 "\n" 串联后再 sha256
  clipSha256: string;       // 中间 mp4 的 sha256（辅助证据，非门禁）
};
```

`render-manifest.json` 里另记逐帧哈希列表（`aspects[].three.shots[]`），供人工复核；`RenderRecord` 只放摘要。**帧级门禁比对的是 `framesDigest`，不是 mp4 字节**——与 ADR 0003「比对解码帧」同义。

- 理由：确定性输入全集（组件版本、three 版本、Chromium 版本、渲染器字符串、输出参数）必须落到渲染记录里，否则半年后无从复算。
- 代价（若判断错）：`RenderRecord` 形状再扩一次；旧记录无此字段，校验保持兼容（可选字段，与 `browser`/`assetDigests` 同纪律）。

### R8 交互交付（P3-A）= 明确拒绝 `three` 镜头

`export-interactive.mjs` 遇到 `three` 镜头整次失败，报错指名镜头号与「3D 镜头不支持交互交付」。不做「烘成逐帧 SVG/PNG 内联」的降级：1280×720 的 240 帧内联必然撞破 8 MiB 上限，且 3D 的价值在动态。

- 理由：P3-A R1 的自包含约束与 3D 帧数天然冲突；静默降级（丢 3D 或丢交互）比失败更难排查。
- 代价（若判断错）：含 3D 镜头的项目拿不到交互页；要支持就得改 P3-A 的交付形态（外部资源目录），属独立一刀。

### R9 工作台 = 最小创建路径（模板 + 只读提示），不做实时 3D 预览

- `apps/web/.../three-templates.ts`：一个模板把镜头改写成 `three` 工作版本（默认 `orbit3d` 参数），并保证 `spec.durationMs === version.durationMs`；
- 镜头卡片对 `three` 工作版本显示「3D 镜头 · 出片时烘焙」徽标与参数摘要，并明示「工作台不预览 3D 画面」；
- 不做：工作台内 WebGL 预览、参数滑块、时间轴拖拽。

- 理由：工作台现有预览全部基于 `video-scene` 的 SVG 或 `<video>` 标签，实时 3D 预览要引入浏览器 WebGL 与另一套渲染器（且与烘焙结果不保证一致），成本与收益不成比例；先让不懂技术的使用者能「创建并出片」。
- 代价（若判断错）：用户改参数前看不到效果，只能出片后看；补救路径是「烘焙单帧缩略图」接口，属 P4。

### R10 依赖 = 仅新增 `three`（根 `devDependencies`，精确版本 `0.186.1`）

不引入 `@remotion/three`、`react-three-fiber`。`three` 只被两处消费：Node 侧烘焙编排（单测里 `import * as THREE` 建场景图）+ 静态服务给烘焙页的 `build/three.module.js`。**不进 `apps/web` 打包**。

- 理由：3D 是路线图 P3 点名的能力，three.js 无法手写；此前各刀的「零新依赖」针对的是能用既有 SVG/纯函数手搓的图表、手绘、动画库，与本刀性质不同。
- 代价（若判断错）：仓库第一次带浏览器侧图形库（约 1.2 MB 源码）；若以后要换渲染器，烘焙契约（R3 的开关表 + R7 的证据字段）是唯一需要重写的部分。

## 3. 校验规则（`packages/video-document/src/validate.ts`）

`sceneSource.type === "three"` 时逐项校验并在失败信息里带字段路径（中文口径与既有 `media-clip` 一致）：

1. `spec` 必须为对象，序列化字节 ≤ 256 KiB（与 `spec` 镜头同口径，防超大 params）；
2. `specVersion === 1`；
3. `componentId`：非空字符串，长度 1..64，形如 `^[a-z][a-zA-Z0-9]*$`；
4. `componentVersion`：正整数；
5. `durationMs`：正整数；且必须等于 `ContentVersion.durationMs`（校验位置与 `media-clip` 的时长等式相邻）；
6. `seed`：0..4294967295 的整数；
7. `background`：`^#[0-9a-fA-F]{6}$`；
8. `params` 必须为对象（深度校验交给烘焙期注册表，与 `spec` 镜头「深度校验交给 @acs/video-scene」同分工）。

`RenderRecord.three` 出现时：`componentId` 非空 ≤64、`componentVersion` 正整数、`threeVersion`/`chromiumVersion` 非空 ≤64、`glRenderer` 非空 ≤256、`framesDigest`/`clipSha256` 为 64 位小写十六进制。

错误枚举同步改为：`sceneSource.type must be "spec" | "editor-binding" | "media-clip" | "three"`。

## 4. 烘焙编排（`scripts/video/bake-three.mjs`）

对外两个入口：

```js
export function validateThreeSpec(value, registry)                  // 深度校验（§3 第 1-8 条 + 组件 validateParams）
export async function bakeThreeShots({ jobs, outDir, deps })        // 纯编排，deps 可注入
// jobs: [{ shotIndex, spec, width, height, frames, label }]
// 返回: [{ shotIndex, storeKey, clipPath, framesDigest, clipSha256,
//          threeVersion, chromiumVersion, glRenderer }]
```

`deps` 默认实现：`launchBrowser`（playwright-core `chromium.launch`）、`encode`（R5 的 ffmpeg 调用）、`hashFile`、`mkTempDir`。单测注入假实现即可覆盖编排逻辑（帧数、命名、摘要、失败话术）而不启动浏览器；真实确定性由 e2e 负责。

失败话术（全部带镜头号）：

- 注册表查不到组件 →「镜头 N 的 3D 组件 xxx@1 未注册」；
- 渲染器不是 SwiftShader →「镜头 N 烘焙渲染器不是 SwiftShader（实际: …），3D 输出不可复现，已拒绝」；
- 页面 console error / pageerror / `bakeInfo.ready !== true` → 指名镜头与首条错误；
- 编码失败 → 带 ffmpeg 的末 20 行 stderr；
- 帧数与 `jobs[].frames` 不一致 → 直接失败（不允许静默补帧/丢帧）。

## 5. 出片装配（`scripts/video/render-scene.mjs`）

1. 装配阶段：`three` 镜头走 `validateThreeSpec`，记入 `shotEntries`（新 `three` 分支），`durationMs` 不等即失败；
2. 干跑阶段：`frame-dryrun.mjs` 把 `three` 当媒体镜头处理（不产生 SVG 干跑作业，提示「3D 镜头由烘焙门禁覆盖」）；
3. 烘焙阶段（干跑之后、Remotion 之前）：按 `project.brief.aspectTargets` 逐画幅烘焙所有 `three` 镜头到同一个临时目录，失败即整片失败、不写任何 RenderRecord；
4. props：把 `timelineProps` 的组装改为按画幅生成（`three` 镜头的 `media.src` 端口/键按画幅不同）；**无 `three` 镜头的项目，`props-<aspect>.json` 必须与改动前逐字节一致**（回归测试钉住）；
5. 媒体服务：`three` 存在时再起一个 `media-server.mjs`（`--root <临时目录>`），与既有媒体仓服务同生命周期（exit 钩子兜杀）；
6. RenderRecord 追加 `three` 字段（R7）；`render-manifest.json` 追加逐帧哈希；
7. `finally` 清理临时目录（失败路径也清）。

## 6. 验收（QA 用例 VID-025，`tier: "integration"`）

`scripts/video/e2e-three.mjs`，不需要 dev server（`requiresPorts: []`），断言：

1. 含 1 个 `three` + 1 个 `spec` 镜头的项目出片 exit 0，产出 `landscape.mp4`；
2. `render-manifest.json` 含 3D 证据：`componentId`、`threeVersion`、`chromiumVersion`、`glRenderer` 含 `SwiftShader`、逐帧哈希条数 = 该镜头 span 帧数；
3. **独立烘焙两次**（各自新浏览器进程）`framesDigest` 相同；
4. 完整出片跑两次，`landscape.mp4` 的 SHA-256 相同；
5. `ffmpeg -vf signalstats` 抽帧非黑（沿用既有 e2e 口径）；
6. `RenderRecord` 新增 `three` 字段且项目重校验通过；`mediaAssets` 长度不变（烘焙不入账本）；
7. `artifacts/tts-usage.jsonl` 行数不变。

单测（进 `node --test scripts/video/*.test.mjs` 与 `packages/video-document` 套件，不启浏览器）：

- 校验：`three` spec 八条规则的通过与拒绝各若干例，含 `durationMs` 不等、`componentId` 形状、`background` 非法、`seed` 越界、spec 字节上限；
- 注册表：重复注册抛错、未知组件抛 `UnknownThreeComponentError`、`orbit3d.validateParams` 越界拒绝；
- 组件：`createRig` + `pose` 的纯数学生成（帧 0 与帧 100 的旋转角、几何类型、颜色）；
- 编排：假 deps 下帧数/命名/摘要正确，渲染器断言、帧数不符、编码失败三条失败路径话术带镜头号；
- P3-A 拒绝：`three` 镜头的交互导出失败且报镜头号；
- 装配回归：无 `three` 项目 `props-<aspect>.json` 逐字节不变。

## 7. 非目标

- 外部模型（glTF/OBJ）、纹理图片、环境贴图——都要引入外部资产与网络，超出「声明式封闭集合」；
- 阴影、后处理、抗锯齿（R3 已固定为关）；
- 3D 镜头的音轨；
- 工作台实时 3D 预览（R9）；
- 多 3D 组件库（本刀只 `orbit3d@1`）；
- 已有项目批量迁移。

## 8. 已知风险（不阻塞，记录在案）

| 风险 | 表现 | 处置 |
| --- | --- | --- |
| SwiftShader 随 Chromium 升级改变字节 | 同一项目在新版本上 `framesDigest` 变化 | 证据记录了版本；跨版本复算需同版本 Chromium，属预期行为 |
| PNG 编码依赖 zlib/Chromium 内部实现 | 同版本内稳定，跨大版本可能变 | 同上；`framesDigest` 是检测手段而非修复手段 |
| 临时盘占用 | 每帧 PNG（1280×720 约几十 KB），240 帧约 10–30 MB/镜头/画幅 | `finally` 清理；失败路径同样清理 |
| 编码是二次有损 | 3D 画面经 h264（crf18）后再被 Remotion 编码 | 与主链路同参数；若画质不合格换无损中间编码，装配层不变 |
| 首帧/末帧与转场边界 | 烘焙帧数严格等于 span，转场在合成层做 | e2e 用含转场的项目再跑一次（断言 4 的同跑覆盖） |

## 9. 落地任务（供实施计划拆分）

1. **文档契约**：`types.ts` / `validate.ts` 的 `three` sceneSource 与 `RenderRecord.three` + 全套单测；
2. **3D 注册表与组件**：`three/registry.mjs`、`three/components/orbit3d.mjs`、`validateThreeSpec` + 单测；
3. **烘焙内核**：`three/harness.html|js`、`bake-three.mjs`（启动参数、渲染器断言、逐帧 PNG、帧摘要、ffmpeg 编码）+ 假 deps 单测；
4. **出片装配**：`render-scene.mjs` 的 `three` 分支、按画幅 props、第二个媒体服务、RenderRecord/manifest 证据、干跑跳过 + 回归测试；
5. **工作台最小路径**：`three-templates.ts` + 镜头卡片徽标/提示；
6. **P3-A 拒绝 + QA**：`export-interactive` 拒绝话术与测试、`e2e-three.mjs`、`qa/registry.json` VID-025、`CURRENT_STATE.md`。
