# P3-B 3D 镜头（three.js 预烘焙）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让分镜里出现真正的 3D 画面：声明式 `three` 镜头在独立无头 Chromium（强制 SwiftShader）里逐帧烘焙成 PNG，编码为临时 mp4 后作为普通媒体镜头喂给现有 Remotion 出片链路，并把渲染器/浏览器/帧摘要写进渲染记录。

**Architecture:** 新 `sceneSource.type: "three"` 存声明式场景（组件 + 参数 + 时长 + 种子），平台解析、不 eval。烘焙发生在 `render-scene.mjs` 的干跑之后、Remotion 之前，产物落在 `mkdtemp` 临时目录，由第二个 `media-server.mjs` 实例托管，渲染结束（含失败路径）清理。`video-scene` 与 `remotion-engine` 一行不改。

**Tech Stack:** Node 22 ESM、`playwright-core`（根 devDependency，既有）、`three@0.186.1`（新增根 devDependency）、Remotion 自带 `ffmpeg`（n7.1，经 `pnpm --filter @acs/remotion-engine exec remotion ffmpeg`）、`node:test`。

**Spec:** `docs/superpowers/specs/2026-10-21-video-studio-three-3d-design.md`（本计划从它论证；执行者两篇都要读）

## Global Constraints

- 只在工作树 `D:\codex\animate\.claude\worktrees\video-studio-p0`（分支 `worktree-video-studio-p2`）工作；**主检出 `D:\codex\animate` 一个字都不能碰**。
- 永远不 stage `artifacts/`、`.superpowers/`、`qa/reports/`。
- 每条 commit 结尾固定加：`Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 不 push、不 merge（集成交给用户）。
- 零新依赖，唯一例外 `three@0.186.1`（精确版本，根 `devDependencies`）；不引 `@remotion/three`、`react-three-fiber`、`@types/three`。
- 所有用户可见字符串为中文。
- TDD：先写失败测试，再写实现；零 TTS 计费，`artifacts/tts-usage.jsonl` 必须保持 34 行。
- 确定性门禁：同一项目两次烘焙 `framesDigest` 相同；无 `three` 镜头的项目 `props-<aspect>.json` 与改动前逐字节一致。

## Review Focus

1. **无 3D 项目回归**：项目不含 `three` 镜头时，出片产物（`props-<aspect>.json`、`RenderRecord`、manifest）必须与改动前逐字节一致——装配代码被按画幅重构后，任何多余字段/顺序变化都是静默回归。
2. **失败路径不留痕**：烘焙、编码、渲染任一步失败，不得写 `RenderRecord`、不得留下子进程或 `acs-three-*` 临时目录。
3. **渲染器断言**：机器上 WebGL 落到硬件 GPU 时（renderer 不含 `SwiftShader`）必须中文报错拒绝，而不是产出一部不可复现的片子。
4. **组件/参数封闭性**：未注册组件、未知版本、越界参数、超 256 KiB 的 spec 必须在烘焙前失败并指名镜头号。
5. **同内容多镜头**：两个镜头烘焙出相同字节时共用同一个 `storeKey`，不得互相覆盖或导致 media-server 白名单漏放。

---

### Task 1: 文档契约（`three` sceneSource 与 `RenderRecord.three`）

**Files:**
- Modify: `packages/video-document/src/types.ts`
- Modify: `packages/video-document/src/validate.ts`
- Test: `packages/video-document/src/validate.test.ts`

**Interfaces:**
- Produces:
  - `export type ThreeSceneSpec = { specVersion: 1; componentId: string; componentVersion: number; durationMs: number; seed: number; background: string; params: Record<string, unknown> }`
  - `SceneSource` 新增分支 `{ type: "three"; spec: ThreeSceneSpec }`
  - `export type ThreeRenderEvidence = { componentId: string; componentVersion: number; threeVersion: string; chromiumVersion: string; glRenderer: string; framesDigest: string; clipSha256: string }`
  - `RenderRecord.three?: ThreeRenderEvidence`
- 后续任务依赖：`validateThreeSpec`（Task 2）与 `render-scene`（Task 4）按这些字段名读写。

- [ ] **Step 1: 写失败测试**（`packages/video-document/src/validate.test.ts`，沿用文件内既有 `validProject()` 夹具）

新增用例（名称即断言意图）：

```ts
test("three 镜头：合法 spec 通过", ...)                    // durationMs 与版本一致
test("three 镜头：spec 非对象被拒", ...)                    // /sceneSource\.spec must be an object/
test("three 镜头：specVersion 非 1 被拒", ...)              // /specVersion/
test("three 镜头：componentId 形状非法被拒", ...)           // "Orbit3D" 与 "orbit-3d" 都拒
test("three 镜头：componentVersion 非正整数被拒", ...)      // 0 与 1.5
test("three 镜头：durationMs 与版本时长不等被拒", ...)       // 报错含 "durationMs"
test("three 镜头：seed 越界被拒", ...)                      // -1 与 4294967296
test("three 镜头：background 非 #RRGGBB 被拒", ...)          // "#12345" 与 "red"
test("three 镜头：params 非对象被拒", ...)                   // 数组与 null
test("three 镜头：spec 序列化字节超 256 KiB 被拒", ...)      // params.large 拼长串
test("sceneSource.type 未知时错误信息列出 three", ...)       // /"spec" \| "editor-binding" \| "media-clip" \| "three"/
test("RenderRecord.three 合法通过", ...)
test("RenderRecord.three 的 framesDigest 非 64 位小写 hex 被拒", ...)
```

- [ ] **Step 2: 跑测试确认全红**

Run: `pnpm --filter @acs/video-document run build && pnpm --filter @acs/video-document test`
Expected: 新增 13 条失败（多为「three 分支未实现」，错误信息不含新规则）。

- [ ] **Step 3: 实现**

`types.ts`：按 Interfaces 加类型与分支，注释写明「平台解析、不 eval；深度校验交给烘焙期注册表」。

`validate.ts` 的 `validateSceneSource` 新增分支（放在 `media-clip` 之后；常量与既有 `VIDEO_PROJECT_MAX_BYTES` 并列定义 `const MAX_THREE_SPEC_BYTES = 256 * 1024;`）：

```ts
if (value.type === "three") {
  const spec = value.spec;
  if (!isRecord(spec)) fail(`${field}.sceneSource.spec must be an object (validated in depth by three registry)`);
  // 用文件顶部已有的 encoder（TextEncoder）：本包同时被浏览器工作台与 Node CLI 引用。
  if (encoder.encode(JSON.stringify(spec)).length > MAX_THREE_SPEC_BYTES)
    fail(`${field}.sceneSource.spec 超过 256 KiB 上限`);
  if (spec.specVersion !== 1) fail(`${field}.sceneSource.spec.specVersion 必须为 1`);
  if (typeof spec.componentId !== "string" || !/^[a-z][a-zA-Z0-9]{0,63}$/.test(spec.componentId))
    fail(`${field}.sceneSource.spec.componentId 须匹配 ^[a-z][a-zA-Z0-9]{0,63}$`);
  if (!Number.isInteger(spec.componentVersion) || spec.componentVersion < 1)
    fail(`${field}.sceneSource.spec.componentVersion 须为正整数`);
  if (!Number.isInteger(spec.durationMs) || spec.durationMs < 1)
    fail(`${field}.sceneSource.spec.durationMs 须为正整数`);
  if (!Number.isInteger(spec.seed) || spec.seed < 0 || spec.seed > 4294967295)
    fail(`${field}.sceneSource.spec.seed 须为 0..4294967295 的整数`);
  if (typeof spec.background !== "string" || !/^#[0-9a-fA-F]{6}$/.test(spec.background))
    fail(`${field}.sceneSource.spec.background 须为 #RRGGBB`);
  if (!isRecord(spec.params)) fail(`${field}.sceneSource.spec.params 须为对象`);
  return;
}
```

时长等式放在 `validateContentVersion` 里与 `media-clip` 相邻的位置（validate.ts 现有 `isRecord(value.sceneSource) && value.sceneSource.type === "media-clip"` 那一段）：

```ts
if (isRecord(value.sceneSource) && value.sceneSource.type === "three") {
  const spec = value.sceneSource.spec;
  if (isRecord(spec) && spec.durationMs !== value.durationMs)
    fail(`${field}.sceneSource.spec.durationMs(${spec.durationMs}) 与 ContentVersion.durationMs(${value.durationMs}) 不一致`);
}
```

`RenderRecord.three` 校验（放在 `assetDigests` 之后）：

```ts
if (record.three !== undefined) {
  const three = record.three;
  if (!isRecord(three)) fail(`${field}.three must be an object`);
  if (typeof three.componentId !== "string" || three.componentId.length === 0 || three.componentId.length > 64)
    fail(`${field}.three.componentId must be a non-empty string of at most 64 characters`);
  if (!Number.isInteger(three.componentVersion) || three.componentVersion < 1)
    fail(`${field}.three.componentVersion must be a positive integer`);
  for (const key of ["threeVersion", "chromiumVersion"] as const) {
    if (typeof three[key] !== "string" || three[key].length === 0 || three[key].length > 64)
      fail(`${field}.three.${key} must be a non-empty string of at most 64 characters`);
  }
  if (typeof three.glRenderer !== "string" || three.glRenderer.length === 0 || three.glRenderer.length > 256)
    fail(`${field}.three.glRenderer must be a non-empty string of at most 256 characters`);
  for (const key of ["framesDigest", "clipSha256"] as const) {
    if (typeof three[key] !== "string" || !SHA256_HEX.test(three[key]))
      fail(`${field}.three.${key} 须为 64 位小写十六进制`);
  }
}
```

未知枚举的错误信息改为四值。

- [ ] **Step 4: 跑测试确认全绿**

Run: `pnpm --filter @acs/video-document run build && pnpm --filter @acs/video-document test`
Expected: 全绿，计数 = 原 122 + 13 = 135。

- [ ] **Step 5: 提交**

```bash
git add packages/video-document/src/types.ts packages/video-document/src/validate.ts packages/video-document/src/validate.test.ts
git commit -m "feat(video-document): 新增 three 场景源与 3D 渲染证据字段"
```

---

### Task 2: 3D 注册表、`orbit3d` 组件与深度校验

**Files:**
- Create: `scripts/video/three/registry.mjs`
- Create: `scripts/video/three/components/orbit3d.mjs`
- Create: `scripts/video/three/spec.mjs`
- Test: `scripts/video/three-registry.test.mjs`
- Modify: `package.json`、`pnpm-lock.yaml`（根 devDependencies 加 `"three": "0.186.1"`，精确版本）

**Interfaces:**
- Produces:
  - `createThreeRegistry()` → `{ register(component), get(componentId, version), version, list() }`；`threeRegistry` 单例（已注册 `orbit3d@1`，`version: 1`）
  - `UnknownThreeComponentError`（带 `componentId`/`componentVersion` 字段）
  - 组件模块契约（同时可在 Node 与浏览器导入，**顶层不 import three**）：
    `componentId: string`、`version: number`、`validateParams(value) → normalizedParams`、
    `createRig({ THREE, params, width, height, background }) → { scene, camera }`、
    `pose(rig, frameIndex, { fps, durationFrames }) → void`
  - `validateThreeSpec(value, registry) → ThreeSceneSpec`（**只做**注册表查询 + `component.validateParams` + 返回规范化 spec；结构规则唯一实现点是 Task 1 的 `validateVideoProject`，这里只保留 `componentId`/`componentVersion` 存在性检查以便给出可读错误）

**`orbit3d` 参数表（默认值与范围，逐项校验并拒绝未知键）：**

| 键 | 范围 | 默认 |
| --- | --- | --- |
| `shape` | `"box" \| "sphere" \| "torus" \| "icosahedron"` | `"box"` |
| `color` | `#RRGGBB` | `#4f9dff` |
| `accent` | `#RRGGBB` | `#e8b04b` |
| `spinPerFrame` | 0..0.5 | `0.02` |
| `tilt` | 0..1.5 | `0.35` |
| `zoom` | 0.5..2 | `1` |

场景固定项（对齐快验）：`WebGLRenderer({ antialias:false, alpha:false, preserveDrawingBuffer:true, stencil:false })`、`OrthographicCamera(-4*zoom, 4*zoom, 2.25*zoom, -2.25*zoom, 0.1, 100)`、环境光 0.35 + 方向光 2.0（位置 `(2.5,4,3)`）、参照轴 `BoxGeometry(0.08, 2.2, 0.08)` 在 `(2.6,-0.2,0)`、主体 `rotation.x = tilt`、`rotation.y = frameIndex * spinPerFrame`。

- [ ] **Step 1: 写失败测试**（`scripts/video/three-registry.test.mjs`）

```ts
test("注册表：重复注册同 componentId@version 抛错", ...)
test("注册表：未知组件抛 UnknownThreeComponentError 且带 id/version", ...)
test("orbit3d：validateParams 填默认值且拒绝未知键", ...)         // { bounce: 1 } → /未知参数/
test("orbit3d：shape/颜色/spinPerFrame/tilt/zoom 越界逐个拒绝", ...)
test("orbit3d：createRig + pose 的旋转角只由帧号决定", ...)        // frame 0 → 0；frame 100 → 2.0（100*0.02）
test("orbit3d：createRig 的几何随 shape 变化", ...)                // 断言 mesh.geometry.type
test("validateThreeSpec：未注册组件被拒且信息含 id@version", ...)
test("validateThreeSpec：params 越界由组件拒绝", ...)
test("validateThreeSpec：返回规范化 params（补齐默认值）", ...)
```

- [ ] **Step 2: 跑测试确认全红**

Run: `node --test scripts/video/three-registry.test.mjs`
Expected: `ERR_MODULE_NOT_FOUND`（模块尚不存在）。

- [ ] **Step 3: 实现**

先装依赖（根目录）：`pnpm add -D -E three@0.186.1`，装完确认 `node -e "console.log(require('three/package.json').version)"` 输出 `0.186.1`。

- `registry.mjs`：`Map` 键 `${componentId}@${version}`，重复注册抛 `Error`（中文），`get` 查不到抛 `UnknownThreeComponentError`；单例末尾 `register(orbit3d)`。
- `components/orbit3d.mjs`：常量 + 参数规范化 + 场景构建 + `pose`。所有 three 对象都由传入的 `THREE` 构造，文件顶层零 import。
- `spec.mjs`：只做 `componentId`/`componentVersion` 存在性检查（给出可读错误）+ `registry.get` + `component.validateParams`；结构规则与 256 KiB 字节上限的唯一实现点是 `validateVideoProject`（Ruling 1），此处不重复。

- [ ] **Step 4: 跑测试确认全绿**

Run: `node --test scripts/video/three-registry.test.mjs`
Expected: 9 pass。

- [ ] **Step 5: 提交**

```bash
git add package.json pnpm-lock.yaml scripts/video/three scripts/video/three-registry.test.mjs
git commit -m "feat(video): 新增 3D 场景注册表与 orbit3d 组件"
```

---

### Task 3: 烘焙内核（harness + 逐帧 PNG + 编码）

**Files:**
- Create: `scripts/video/three/harness.html`
- Create: `scripts/video/three/harness.js`
- Create: `scripts/video/sha256-file.mjs`（从 `render-scene.mjs:75` 抽出）
- Modify: `scripts/video/render-scene.mjs`（改为 import 抽出的 `sha256File`）
- Create: `scripts/video/bake-three.mjs`
- Test: `scripts/video/three-bake.test.mjs`

**Interfaces:**
- Produces:
  - `BAKE_FPS = 24`
  - `buildBakeJobs({ project, aspects })` → `[{ aspect, shotIndex, label, spec, width, height, frames }]`（纯函数，用 `quantizeTimeline` 算 span）
  - `bakeThreeShots({ jobs, outDir, deps })` → `[{ shotIndex, aspect, storeKey, clipPath, framesDigest, frameHashes, clipSha256, threeVersion, chromiumVersion, glRenderer }]`
  - `createThreeServer({ root })` → `{ server, url }`（静态服务：`/`、`/harness.js`、`/scene/*.mjs`、`/vendor/three/*.js`，只读、127.0.0.1、无目录遍历）
  - `runEncoder(framesDir, fps, outFile)`（默认实现走 `pnpm --filter @acs/remotion-engine exec remotion ffmpeg`）
  - CLI：`node scripts/video/bake-three.mjs --project <path> [--out <dir>]`，按 `brief.aspectTargets` 逐画幅烘焙全部 `three` 镜头（无 `three` 镜头时打印「无 3D 镜头」并 exit 0）；`--out` 缺省为 `mkdtemp`，退出时清理
- `deps` 默认值：`{ launchBrowser, hashFile, encode: runEncoder }`；测试注入假实现。

**harness 契约（页面全局）：**

```js
window.bakeInfo = { ready: true, threeVersion, width, height, dpr: 1, antialias: false,
                    preserveDrawingBuffer: true, glRenderer, glVersion, colorSpace }
window.bakeFrame = (frameIndex) => string  // "data:image/png;base64,…"
```

配置通过 `page.addInitScript` 注入 `window.__THREE_SCENE_CONFIG__`（`{ componentId, componentVersion, width, height, background, seed, params, fps, durationMs }`），页面读它动态 `import("/scene/<componentId>.mjs")`。

启动参数：`chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--disable-gpu-sandbox"] })`；拿到 `bakeInfo` 后断言 `glRenderer.includes("SwiftShader")`。

- [ ] **Step 1: 写失败测试**（`scripts/video/three-bake.test.mjs`，全部用假 deps，不启浏览器）

```ts
test("buildBakeJobs：帧数取累计量化的 span", ...)                  // 与 quantizeTimeline 对拍
test("buildBakeJobs：无 three 镜头返回空数组", ...)
test("bakeThreeShots：逐帧落盘、命名 %04d.png、framesDigest = sha256(逐帧 hex 用 \\n 串联)", ...)
test("bakeThreeShots：frameHashes 逐帧顺序与文件一致（供 manifest 消费）", ...)
test("bakeThreeShots：storeKey = clipSha256 前 16 位 + .mp4，落在 <out>/original/", ...)
test("bakeThreeShots：渲染器不含 SwiftShader 时中文报错并含镜头号", ...)
test("bakeThreeShots：页面 console error 时失败且带首条错误", ...)
test("bakeThreeShots：帧数与 jobs 不符时失败", ...)                 // 假 page 少给 1 帧
test("bakeThreeShots：编码失败时保留 ffmpeg 末 20 行 stderr", ...)
test("bakeThreeShots：两个镜头字节相同 → 同 storeKey 不互相覆盖", ...)
test("bakeThreeShots：任何失败都不留下克隆页面/浏览器进程", ...)     // 假 deps 记录 close 调用
```

- [ ] **Step 2: 跑测试确认全红**

Run: `node --test scripts/video/three-bake.test.mjs`
Expected: `ERR_MODULE_NOT_FOUND`（`bake-three.mjs` 不存在）。

- [ ] **Step 3: 实现**

顺序：先 `sha256-file.mjs` 抽取（跑 `node --test scripts/video/render-scene.media.test.mjs` 确认既有套件不红）→ `harness.html`/`harness.js`（照 `artifacts/p3b-three-spike/index.html` 的结构，改为读注入配置 + 注册表组件）→ `createThreeServer` → `buildBakeJobs` → `bakeThreeShots` → `runEncoder`。

编码参数（写死）：

```js
const args = [
  "-y", "-hide_banner", "-loglevel", "error",
  "-framerate", String(fps), "-i", path.join(framesDir, "%04d.png"),
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
  "-pix_fmt", "yuv420p", "-threads", "1", "-movflags", "+faststart",
  outFile,
];
spawnSync("pnpm", ["--filter", "@acs/remotion-engine", "exec", "remotion", "ffmpeg", ...args],
          { cwd: ROOT, shell: true, encoding: "utf8" });
```

`three` 版本来源：`createRequire(import.meta.url)("three/package.json").version`（Node 侧），页面里的 `THREE.REVISION` 用于交叉核对（不一致即失败）。

- [ ] **Step 4: 跑测试确认绿灯 + 一次真实烘焙冒烟**

Run:
```bash
node --test scripts/video/three-bake.test.mjs
node scripts/video/bake-three.mjs --project scripts/video/fixtures/three-sample.video-project.json --out "$(mktemp -d)/bake"
```
（`three-sample.video-project.json` 在本步创建：1 个 `three` 镜头 + 1 个 spec 镜头，夹具只进 `scripts/video/fixtures/`。）
Expected: 单测全绿；真实烘焙 exit 0，打印每画幅的 `framesDigest` 与 `SwiftShader` 证据。

- [ ] **Step 5: 提交**

```bash
git add scripts/video/three scripts/video/bake-three.mjs scripts/video/three-bake.test.mjs scripts/video/sha256-file.mjs scripts/video/render-scene.mjs scripts/video/fixtures/three-sample.video-project.json
git commit -m "feat(video): three.js 逐帧烘焙内核与确定性证据"
```

---

### Task 4: 出片装配（三镜头进主链路）

**Files:**
- Create: `scripts/video/render-scene.props.mjs`（把 `timelineProps` 组装从 `render-scene.mjs` 抽出为纯函数）
- Modify: `scripts/video/render-scene.mjs`
- Modify: `scripts/video/frame-dryrun.mjs`
- Test: `scripts/video/render-scene.props.test.mjs`（新建；装配回归）、`scripts/video/frame-dryrun.test.mjs`

**Interfaces:**
- Consumes: Task 1 字段、Task 2 `validateThreeSpec`、Task 3 `buildBakeJobs`/`bakeThreeShots`/`BAKE_FPS`
- Produces:
  - `render-scene.mjs` 的 `three` 分支；`shotEntries` 新增 `{ shot, version, three: spec }`
  - `buildTimelineProps(input) → object`（`input`: `{ timeline, shotEntries, mediaByShot, threeByShot, mediaUrlBase, threeUrlBase, narrationByShot, subtitlesByShot, transitions }`；无 `three` 时输出与改动前逐字节一致）
  - `buildTimelineShotThree(entry, src, fps) → { media: {...} }`（与 `buildTimelineShotMedia` 同形，`inMs: 0`、`fit: "contain"`、`focalX: 0.5`、`audio: "mute"`、`trimBefore: 0`、`outMs: Math.round(frames / fps * 1000)`）
  - `render-manifest.json` 新增 `aspects[aspect].three.shots[]`，每条含 `{ shotIndex, componentId, componentVersion, threeVersion, chromiumVersion, glRenderer, frameHashes: string[], framesDigest }`

- [ ] **Step 1: 写失败测试**

`render-scene.props.test.mjs` 新增：

```ts
test("按画幅组装的 props：无 three 项目与旧输出逐字节一致", ...)   // 固定夹具 JSON.stringify 对拍
test("按画幅组装的 props：three 镜头生成 media 块（inMs=0、fit=contain、trimBefore=0）", ...)
test("按画幅组装的 props：three 镜头 outMs = round(frames/24*1000)", ...)
```

`frame-dryrun.test.mjs` 新增：

```ts
test("干跑：three 镜头不产生作业且不抛错", ...)
test("干跑：three 与 media-clip 混排时作业数只计 spec 镜头", ...)
```

- [ ] **Step 2: 跑测试确认红**

Run: `node --test scripts/video/render-scene.props.test.mjs scripts/video/frame-dryrun.test.mjs`
Expected: 5 条新增失败（`three` 分支缺失）。

- [ ] **Step 3: 实现**

装配阶段：`sceneSource.type === "three"` → `validateThreeSpec` → 返回 `{ shot, version, three: spec }`。

烘焙阶段（干跑之后）：

```js
const threeJobs = buildBakeJobs({ project, aspects });
let threeResult = new Map(); // `${aspect}:${shotIndex}` → 烘焙结果
let threeTempDir = null;
if (threeJobs.length > 0) {
  threeTempDir = mkdtempSync(path.join(tmpdir(), "acs-three-"));
  const baked = await bakeThreeShots({ jobs: threeJobs, outDir: threeTempDir });
  threeResult = new Map(baked.map((item) => [`${item.aspect}:${item.shotIndex}`, item]));
  // 第二个 media-server：--root <threeTempDir>（布局 <root>/original/<storeKey>.mp4）
}
```

props：把原 `timelineProps` 的构造抽成 `buildTimelineProps(aspect)`，`three` 镜头在 map 内追加 `{ media: {...}, startFrame, frames, ...narration/subtitles }`；无 `three` 时分支不执行，输出不变。

RenderRecord：`three` 镜头追加 `three: { componentId, componentVersion, threeVersion, chromiumVersion, glRenderer, framesDigest, clipSha256 }`；manifest 追加逐帧哈希。

清理：`finally` 中 `rmSync(threeTempDir, { recursive: true, force: true })`，`process.on("exit")` 兜杀第二个 media-server（与既有服务同写法）。

- [ ] **Step 4: 跑测试确认绿 + 出片冒烟**

Run:
```bash
node --test scripts/video/*.test.mjs
node scripts/video/render-scene.mjs --project <临时目录>/three-sample.video-project.json --out <临时目录>/out
```
Expected: 全套绿；出片 exit 0，`landscape.mp4` 存在，项目 JSON 追加了带 `three` 字段的 `RenderRecord`；系统临时目录下不残留 `acs-three-*`（`finally` 清理生效）。

- [ ] **Step 5: 提交**

```bash
git add scripts/video/render-scene.mjs scripts/video/render-scene.props.mjs scripts/video/render-scene.props.test.mjs scripts/video/frame-dryrun.mjs scripts/video/frame-dryrun.test.mjs scripts/video/bake-three.mjs
git commit -m "feat(video): three 镜头接入出片主链路并写入 3D 证据"
```

---

### Task 5: 工作台最小创建路径

**Files:**
- Create: `apps/web/src/app/video-studio/three-templates.ts`
- Test: `apps/web/src/app/video-studio/three-templates.test.ts`
- Modify: `apps/web/src/app/video-studio/shot-editor-card.tsx`
- Modify: `apps/web/src/app/video-studio/page.tsx`
- Modify: `packages/video-document/src/operations.ts`
- Test: `packages/video-document/src/operations.test.ts`

**Interfaces:**
- Produces:
  - `THREE_TEMPLATE_ID = "three-3d"`、`THREE_TEMPLATE_LABEL = "3D 镜头（出片时烘焙）"`
  - `buildThreeSceneVersion({ durationMs, seed, params? }) → SceneSource`（`sceneSource.type === "three"`，`spec.durationMs === durationMs`；模板常量：`specVersion: 1`、`componentId: "orbit3d"`、`componentVersion: 1`、`background: "#101820"`、`params` 默认 `{ shape: "box", color: "#4f9dff", accent: "#e8b04b", spinPerFrame: 0.02, tilt: 0.35, zoom: 1 }`，传入 `params` 时整体替换默认值）
  - `threeSceneFromVersion(working) → ThreeSceneSpec | null`
  - `threeTemplateSelectValue(pendingTemplateId, isThree)`（照 `mediaTemplateSelectValue` 同构）
- Consumes（Task 1）：`ThreeSceneSpec`、`SceneSource` 的 `three` 成员来自 `@acs/video-document`；web 直接消费其 `dist`，**先跑 `pnpm --filter @acs/video-document run build`**。
- Extends（Ruling 11）：`reviseWorkingVersion` 的 patch 增加 `threeScene?: ThreeSceneSpec`，与 `spec`/`mediaClip` **三者互斥**；`durationMs = threeScene.durationMs`；`sceneSource = { type: "three", spec: threeScene }`。

- [ ] **Step 1: 写失败测试（文档操作层）**

在 `packages/video-document/src/operations.test.ts` 追加：

```ts
test("reviseWorkingVersion：threeScene 落 three 场景源并同步 durationMs", ...)
test("reviseWorkingVersion：threeScene 与 spec / mediaClip 互斥（三种组合都抛）", ...)
test("reviseWorkingVersion：threeScene 修订后 workingVersionId 前移到新版本", ...)
```

- [ ] **Step 2: 写失败测试（web 纯逻辑）**

在 `apps/web/src/app/video-studio/three-templates.test.ts`：

```ts
test("模板：buildThreeSceneVersion 的 durationMs 与入参一致", ...)
test("模板：默认参数为 orbit3d 且通过 validateParams 规范化", ...)
test("模板：threeSceneFromVersion 对 spec/media-clip 返回 null", ...)
test("模板：threeTemplateSelectValue 在已是 three 且未选模板时停在 THREE_TEMPLATE_ID", ...)
```

- [ ] **Step 3: 跑测试确认红**

Run: `pnpm --filter @acs/video-document run build && pnpm --filter @acs/video-document run test`
Expected: 3 条新用例失败（`threeScene` 未支持）。
Run: `pnpm --filter @acs/web test`
Expected: 4 条失败（模块不存在）。

- [ ] **Step 4: 实现文档操作层**

`operations.ts` 的 `reviseWorkingVersion`：互斥检查扩为「spec、mediaClip、threeScene 任意两者同时出现都抛」；`durationMs` 分支新增 `threeScene !== undefined ? threeScene.durationMs`；`sceneSource` 分支新增 `{ type: "three", spec: patch.threeScene }`。保持既有 spec/mediaClip 行为逐字节不变。

- [ ] **Step 5: 实现 web**

`three-templates.ts` 纯逻辑（不 import React；默认参数常量自带，见 Ruling 10，不跨目录 import `scripts/video/three/*`）。`shot-editor-card.tsx`：
- 导入模板常量，模板下拉新增 `<optgroup label="3D">` 一项；
- 选中只置 `pendingTemplateId = THREE_TEMPLATE_ID`（Ruling 11/4）；点「应用」时与其他族一致调用 `onRevise({ narrationText, threeScene })`，`threeScene = buildThreeSceneVersion({ durationMs: 当前工作版本 durationMs, seed, params }).spec`；
- `editingThree` 标志（`working?.sceneSource.type === "three"`）：为真时隐藏 spec 编辑字段，改为只读信息块「3D 镜头 · 出片时烘焙；工作台不预览 3D 画面」+ 组件名与参数摘要；
- 模板下拉的受控 value 走 `threeTemplateSelectValue`，保证 3D 镜头不再显示为「保持当前组件」。

`page.tsx`：
- `shotThree = document.shots.map((shot) => threeSceneFromVersion(工作版本))`（与 `shotSpecs`/`shotMediaClips` 并列）；
- `editable` 三选一：`shotSpecs[index] !== null || shotMediaClips[index] !== null || shotThree[index] !== null`（Ruling 11/2）；
- `perShot` 的 three 分支复用占位：`{ kind: "missing", reason: "3D 镜头：出片时烘焙，工作台不预览", startFrame: 0, frames: 0 }`（Ruling 11/3，不新增 kind、不改 `scene-preview.tsx`）。

> apps/web/AGENTS.md 要求：改 Next 相关代码前先读 `apps/web/node_modules/next/dist/docs/` 的相关指南。本任务只改 React 组件与页面数据流，不新增路由/API；如触及 Next API 先读文档。

- [ ] **Step 6: 跑测试确认绿 + 类型检查**

Run: `pnpm --filter @acs/video-document run build && pnpm --filter @acs/video-document run test`
Run: `pnpm --filter @acs/web test && pnpm --filter @acs/web typecheck`
Expected: 全绿，typecheck exit 0。

- [ ] **Step 7: 提交**

```bash
git add packages/video-document/src/operations.ts packages/video-document/src/operations.test.ts
git commit -m "feat(video-document): reviseWorkingVersion 支持 three 场景源"
git add apps/web/src/app/video-studio/three-templates.ts apps/web/src/app/video-studio/three-templates.test.ts apps/web/src/app/video-studio/shot-editor-card.tsx apps/web/src/app/video-studio/page.tsx
git commit -m "feat(web): 工作台新增 3D 镜头模板与只读提示"
```

---

### Task 6: 交互交付拒绝 + e2e + QA 登记 + 文档

**Files:**
- Modify: `scripts/video/export-interactive.mjs`
- Test: `scripts/video/export-interactive.test.mjs`
- Create: `scripts/video/e2e-three.mjs`
- Modify: `qa/registry.json`
- Modify: `AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md`

**Interfaces:**
- Consumes: Task 4 的出片链路、Task 3 的烘焙 CLI

- [ ] **Step 1: 写失败测试**

`export-interactive.test.mjs`：

```ts
test("three 镜头整次拒绝：指名镜头号并说明 3D 不支持交互交付", ...)  // /镜头 2/ + /three/ + /不支持交互交付/
```

- [ ] **Step 2: 跑测试确认红**

Run: `node --test scripts/video/export-interactive.test.mjs`
Expected: 1 条失败（现有话术为通用「不是 spec」，不含「不支持交互交付」）。

- [ ] **Step 3: 实现**

`buildInteractiveExport` 的 sceneSource 分支（**放在现有 `!== "spec"` 通用拒绝之前**，否则 three 会先命中通用话术）：

```js
if (version.sceneSource.type === "three")
  throw new Error(
    `镜头 ${shotNumber} 是 3D 镜头（three），P3-A 交互交付不支持：帧图会超出页面体积上限`,
  );
```

- [ ] **Step 4: 写 e2e（`scripts/video/e2e-three.mjs`）**

骨架照 `e2e-transitions.mjs` 的「fail(step)/sha256/usageLines」结构，但**不需要 dev server、浏览器或端口**（`requiresPorts: []`）：直接用 `scripts/video/fixtures/three-sample.video-project.json` 作为输入。

1. `mkdtempSync(path.join(os.tmpdir(), "e2e-three-"))`，把 fixture 复制成 `<tmp>/project.json` 与 `<tmp>/project-rerun.json`；
2. 烘焙 A/B：`node scripts/video/bake-three.mjs --project <tmp>/project.json --out <tmp>/bake-a`，再对同一 project 跑一次（两个独立进程、两次新浏览器）`--out <tmp>/bake-b`；从 stdout 解析 `framesDigest`/`clipSha256`，断言两次相同；
3. 出片 A/B：分别用 `node scripts/video/render-scene.mjs --project <tmp>/project.json --out <tmp>/render-a` 与 `--project <tmp>/project-rerun.json --out <tmp>/render-b`（独立项目副本，避免第一次回写的 RenderRecord 影响第二次），断言两次 exit 0 且 `landscape.mp4` SHA-256 相同（Ruling 7 已实测字节一致，无需降级）；
4. 断言（spec §6）：
   - 出片 exit 0，`landscape.mp4` 存在且非空；
   - manifest 的 3D 证据：`glRenderer` 含 `SwiftShader`、`frameHashes` 条数 = 该镜头 span 帧数（fixture 1000ms @24fps = 24）；
   - 完整出片的 `landscape.mp4` 两次 SHA-256 相同；
   - 非黑：用 **`spawnSync("pnpm", ["--filter","@acs/remotion-engine","exec","remotion","ffmpeg", ...])`** 跑 signalstats（与 `bake-three.mjs` 同一 ffmpeg 来源，不依赖 PATH），取 3D 镜头首帧，`YAVG > 16`；
   - `RenderRecord` 有 `three` 字段且 `validateVideoProject` 重校验通过、`mediaAssets` 长度不变；
   - `artifacts/tts-usage.jsonl` 行数仍为 34；
   - 运行结束后 `os.tmpdir()` 下无 `acs-three-*` 残留（成功与失败路径都清理）。
5. 默认 `finally` 删除 `<tmp>`；设 `E2E_KEEP=1` 时保留并打印路径。

- [ ] **Step 5: 跑 e2e**

Run: `node scripts/video/e2e-three.mjs`
Expected: 全部断言通过，打印 `framesDigest` 与两次 mp4 摘要。

- [ ] **Step 6: 登记 QA 与文档**

`qa/registry.json` 在 VID-024 之后新增 VID-025：

```json
{
  "id": "VID-025",
  "title": "3D 镜头（three 预烘焙）出片与确定性",
  "tier": "integration",
  "command": "node scripts/video/e2e-three.mjs",
  "requiresPorts": []
}
```

`CURRENT_STATE.md` 追加 P3-B 条目（测试计数、`framesDigest` 实测值、Chromium/three 版本、QA 用例号）。

- [ ] **Step 7: 全套验证**

```bash
node --test scripts/video/*.test.mjs
pnpm --filter @acs/video-document test
pnpm --filter @acs/web test
pnpm qa:validate
npx biome check .
node -e "console.log(require('fs').readFileSync('artifacts/tts-usage.jsonl','utf8').trim().split('\n').length)"
```
Expected: 视频套件 144/144（143 + 新增 1）、文档 139/139（136 + Task 5 新增 3）、web 207/207（203 + Task 5 新增 4）、QA 注册表校验通过、biome 0 错、TTS 台账 34。

- [ ] **Step 8: 提交**

```bash
git add scripts/video/export-interactive.mjs scripts/video/export-interactive.test.mjs scripts/video/e2e-three.mjs qa/registry.json AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md
git commit -m "test(video): P3-B 3D 镜头 QA 用例与交互交付拒绝话术"
```
