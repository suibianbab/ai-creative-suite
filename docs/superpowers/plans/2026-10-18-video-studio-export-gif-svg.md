# Video Studio 导出扩充（整片 GIF + 单场景 SVG）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从既有整片 MP4 渲染派生 GIF（ffmpeg palette，D4），并把单镜头声明式场景导出为可独立打开的动画/静态 SVG；两者都作为 DeliveryRecord 首次落档进项目文档。

**Architecture:** 场景组件本就输出纯数据 `SvgNode` 树（kebab-case attrs，「字符串序列化路径依赖」注释即为此预留）——SVG 导出是第三个树消费者，零新渲染逻辑；GIF 是 MP4 的确定性派生转码。两条路径都是 scripts/ 层 CLI（浏览器不承载 ffmpeg），共享一个 `appendDelivery` 纯模块把导出写回 `deliveries`（ADR 0003 字段，校验已备，至今无人写入）。

**Tech Stack:** Node 22 · node:test · ffmpeg/ffprobe（PATH，沿 frame-compare 既有用法）· `@acs/video-document` dist（pathToFileURL 动态导入，沿 render-scene 模式）· `@acs/video-scene` dist 同前。

**Spec:** `docs/superpowers/specs/2026-10-18-video-studio-export-gif-svg-design.md`

## Global Constraints

- 媒体不入库：`.gitignore` 已忽略 `artifacts/**`（仅放行 `*.md`/`*.json`），GIF/SVG 产物只留 SHA-256 证据（spec A5）。
- 零 TTS 计费：本刀无任何合成调用，e2e 断言 `artifacts/tts-usage.jsonl` 行数不变（spec A4）。
- scripts/ 不进 workspace 包图：加载 `@acs/video-document`/`@acs/video-scene` 一律 `await import(pathToFileURL(<repo>/packages/*/dist/index.js).href)`（render-scene.mjs:38 既有预检裁决）。单测需要先 `pnpm --filter @acs/video-document run build && pnpm --filter @acs/video-scene run build`。
- 单测零外部进程：ffmpeg/ffprobe 只在 CLI 主路径与 e2e 出现；纯逻辑测试注入数据（沿 tts-sse.test.mjs 模式）。
- 提交信息 ends with `Co-Authored-By: Claude Code <noreply@anthropic.com>`；提交前对触碰文件跑 `npx biome check --write`（pnpm lint 会卡格式）。
- 渲染常量与出片一致：`RENDER_FPS = 24`，`DIMENSIONS = { landscape: [1280, 720], portrait: [720, 1280] }`（render-scene.mjs:34-35 同值复制，注释指回）。
- DeliveryRecord 语义：`versionIds` = 本次交付的逐镜头版本；`renderIds` = 派生自的渲染记录（SVG 直出时为空数组，校验允许）；`frameMap` = 交付物内逐镜头帧数（正整数）。

## Review Focus

1. GIF 源 MP4 缺失（`outputAssetRef` 指向的文件被移走）——报错指路重渲染，不静默产出空文件 → Task 1 e2e 外的 CLI `existsSync` 门 + 测试断言错误信息。
2. `renderIds` 引用项目里不存在的 renderId（手改项目 JSON 后导出）——`validateVideoProject` 必须拒绝 → Task 1 测试 `appendDelivery rejects unknown render id`。
3. SVG 导出时 `spec.durationMs ≠ ContentVersion.durationMs` 或 0 帧镜头——拒绝导出，指路先修订对齐 → Task 3 测试 `duration mismatch rejected`。
4. `--shot` 1 基序号越界/非整数——报错给出合法范围 `1..N` → Task 3 测试 `shot out of range`。
5. 采样 fps 不整除 24（如 `--fps 10`）——frameMap 必须保持精确整数，拒绝并列合法值 → Task 1/3 测试 `non-divisor fps rejected`。

---

### Task 1: GIF 导出——delivery 纯模块 + export-gif CLI

**Files:**
- Create: `scripts/video/delivery.mjs`（共享：appendDelivery）
- Create: `scripts/video/export-gif.mjs`（纯逻辑导出 + CLI 主路径）
- Test: `scripts/video/export-gif.test.mjs`

**Interfaces:**
- Consumes: `validateVideoProject` from video-document dist；`RenderRecord`/`VideoProject` 形状（types.ts:55-95）。
- Produces（供 Task 3 与测试 import）:
  - `appendDelivery(project, {versionIds: string[], renderIds: string[], frameMap: number[]}) → {project, delivery}`（追加 + savedVersion+1 + 重校验，非法即 throw）
  - `findRenderBlock(project, aspect: "landscape"|"portrait") → {records: RenderRecord[], outputAssetRef: string}`
  - `gifFrameMap(records, fps) → number[]`
  - `buildGifFilter({fps, width, colors}) → string`
  - `RENDER_FPS = 24`、`GIF_FPS_CHOICES = [1,2,3,4,6,8,12,24]`

- [ ] **Step 1: 写失败测试**

`scripts/video/export-gif.test.mjs`：

```js
// D4 导出扩充：GIF 派生交付纯逻辑单测（ffmpeg/ffprobe 只在 CLI 主路径，不进单测）。
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  appendDelivery,
  buildGifFilter,
  findRenderBlock,
  GIF_FPS_CHOICES,
  gifFrameMap,
  RENDER_FPS,
} from "./export-gif.mjs";

const T = "2026-10-18T00:00:00.000Z";

function version(versionId, durationMs) {
  return {
    versionId,
    createdAt: T,
    durationMs,
    description: "占位",
    narrationText: "占位。",
    sceneSource: { type: "spec", spec: { componentId: "text-animation", componentVersion: 1, seed: 1, durationMs, background: "#ffffff", params: {} } },
    provenance: { engineId: "planner-rules", engineVersion: "1" },
  };
}

function project(renderRecords) {
  const v1 = randomUUID();
  const v2 = randomUUID();
  return {
    schemaVersion: 1,
    id: randomUUID(),
    title: "GIF 单测项目",
    brief: { sentence: "占位", aspectTargets: ["landscape", "portrait"] },
    shots: [
      { shotId: randomUUID(), order: 0, locked: false, workingVersionId: v1, contentVersions: [version(v1, 2000)], events: [{ at: T, kind: "submitted", actor: "human" }] },
      { shotId: randomUUID(), order: 1, locked: false, workingVersionId: v2, contentVersions: [version(v2, 3000)], events: [{ at: T, kind: "submitted", actor: "human" }] },
    ],
    renderRecords,
    deliveries: [],
    savedVersion: 3,
  };
}

function record(aspect, ref, versionId, frames) {
  const [width, height] = aspect === "landscape" ? [1280, 720] : [720, 1280];
  return {
    renderId: randomUUID(), versionId, contentDigest: "0".repeat(64),
    engineId: "remotion", engineVersion: "1", rendererVersion: "4.0.534",
    browser: "Chrome 155", fps: RENDER_FPS, width, height, codec: "h264",
    frames, fontDigests: {}, outputAssetRef: ref,
  };
}

test("findRenderBlock 取同画幅尾块（跨画幅穿插后）", () => {
  const p = project([
    record("landscape", "out/landscape.mp4", p1v1, 48), // 用闭包外变量见下方修正
  ]);
});
```

（fixture 里跨 test 的版本 id 引用改为在 test 内先建 project 再补 renderRecords——写成：先 `const p = project([])`，`p.shots[i].contentVersions[0].versionId` 取版本 id 再造 record。最终测试体如下：）

```js
test("findRenderBlock 取同画幅尾块（跨画幅穿插后）", () => {
  const p = project([]);
  const [a, b] = p.shots.map((s) => s.contentVersions[0].versionId);
  p.renderRecords = [
    record("landscape", "r1/landscape.mp4", a, 48),
    record("landscape", "r1/landscape.mp4", b, 72),
    record("portrait", "r1/portrait.mp4", a, 48),
    record("portrait", "r1/portrait.mp4", b, 72),
    record("landscape", "r2/landscape.mp4", a, 48),
    record("landscape", "r2/landscape.mp4", b, 72),
  ];
  const block = findRenderBlock(p, "landscape");
  assert.equal(block.records.length, 2);
  assert.ok(block.outputAssetRef.startsWith("r2/"));
  assert.deepEqual(block.records.map((r) => r.frames), [48, 72]);
});

test("findRenderBlock 无该画幅记录报错指路 render-scene", () => {
  const p = project([]);
  assert.throws(() => findRenderBlock(p, "portrait"), /先跑 render-scene/);
});

test("findRenderBlock 块长度与镜头数不符报错", () => {
  const p = project([]);
  const a = p.shots[0].contentVersions[0].versionId;
  p.renderRecords = [record("landscape", "r1/landscape.mp4", a, 48)];
  assert.throws(() => findRenderBlock(p, "landscape"), /重渲染/);
});

test("gifFrameMap 整除时精确整数，非整除拒绝并列合法值", () => {
  const records = [{ frames: 48 }, { frames: 74 }];
  assert.deepEqual(gifFrameMap(records, 12), [24, 37]);
  assert.throws(() => gifFrameMap(records, 10), new RegExp(GIF_FPS_CHOICES.join("/")));
});

test("buildGifFilter 含 fps/scale/palettegen/paletteuse", () => {
  const filter = buildGifFilter({ fps: 12, width: 480, colors: 128 });
  assert.ok(filter.includes("fps=12"));
  assert.ok(filter.includes("scale=480:-1:flags=lanczos"));
  assert.ok(filter.includes("palettegen=max_colors=128"));
  assert.ok(filter.includes("paletteuse=dither=bayer"));
  assert.ok(filter.endsWith("[out]"));
});

test("appendDelivery 追加交付并 savedVersion+1", () => {
  const p = project([]);
  const [a, b] = p.shots.map((s) => s.contentVersions[0].versionId);
  const r = [record("landscape", "r/landscape.mp4", a, 48), record("landscape", "r/landscape.mp4", b, 72)];
  p.renderRecords = r;
  const { project: next, delivery } = appendDelivery(p, {
    versionIds: [a, b],
    renderIds: r.map((x) => x.renderId),
    frameMap: [24, 36],
  });
  assert.equal(next.deliveries.length, 1);
  assert.equal(next.savedVersion, 4);
  assert.equal(delivery.versionIds.length, 2);
  assert.ok(delivery.deliveryId && delivery.at);
});

test("appendDelivery 拒绝未知 renderId（防手改项目后脏引用）", () => {
  const p = project([]);
  assert.throws(
    () => appendDelivery(p, { versionIds: [p.shots[0].contentVersions[0].versionId], renderIds: [randomUUID()], frameMap: [24] }),
    /renderIds|render record/i,
  );
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd scripts/video && node --test export-gif.test.mjs`（或仓库根 `node --test scripts/video/export-gif.test.mjs`）
Expected: FAIL——`Cannot find module './export-gif.mjs'`（模块尚不存在）。

- [ ] **Step 3: 实现 delivery.mjs + export-gif.mjs 纯逻辑**

`scripts/video/delivery.mjs`：

```js
// 交付记录（ADR 0003 deliveries 字段）首次落档的共享追加器：GIF/SVG 导出共用。
// 追加后立即重校验（沿 render-scene 回写口径），versionIds/renderIds 脏引用在此拦截。
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { validateVideoProject } = await import(
  pathToFileURL(path.join(ROOT, "packages/video-document/dist/index.js")).href
);

export function appendDelivery(project, { versionIds, renderIds, frameMap }) {
  const delivery = {
    deliveryId: randomUUID(),
    at: new Date().toISOString(),
    versionIds,
    renderIds,
    frameMap,
  };
  const next = {
    ...project,
    deliveries: [...project.deliveries, delivery],
    savedVersion: project.savedVersion + 1,
  };
  validateVideoProject(next);
  return { project: next, delivery };
}
```

`scripts/video/export-gif.mjs`（纯逻辑部分；CLI 主路径 Step 5）：

```js
#!/usr/bin/env node
// D4（spec R1）：整片 GIF 派生导出——从项目最近一次该画幅整片渲染的 MP4 经
// ffmpeg palettegen/paletteuse 转码，DeliveryRecord 落档（deliveries 首次写入）。
// 用法: node scripts/video/export-gif.mjs --project <path.json> [--aspect landscape|portrait] [--out <dir>] [--fps 12] [--colors 128] [--width 480]
import { appendDelivery } from "./delivery.mjs";

// 与出片一致（render-scene.mjs:34-35 同值；scripts/ 不引 web 侧常量）。
export const RENDER_FPS = 24;
export const DIMENSIONS = { landscape: [1280, 720], portrait: [720, 1280] };
export const GIF_FPS_CHOICES = [1, 2, 3, 4, 6, 8, 12, 24];

export function findRenderBlock(project, aspect) {
  const isAspect = (record) =>
    aspect === "landscape" ? record.width > record.height : record.width < record.height;
  const last = project.renderRecords.findLastIndex(isAspect);
  if (last < 0)
    throw new Error(`项目没有 ${aspect} 渲染记录，先跑 render-scene 出片再导出 GIF`);
  const ref = project.renderRecords[last].outputAssetRef;
  const block = [];
  for (let i = last; i >= 0 && project.renderRecords[i].outputAssetRef === ref; i--)
    block.unshift(project.renderRecords[i]);
  if (block.length !== project.shots.length)
    throw new Error(
      `${aspect} 最近渲染块长度 ${block.length} ≠ 当前镜头数 ${project.shots.length}（渲染后镜头已变更，需重渲染）`,
    );
  return { records: block, outputAssetRef: ref };
}

export function gifFrameMap(records, fps) {
  if (!GIF_FPS_CHOICES.includes(fps))
    throw new Error(`--fps ${fps} 不整除渲染帧率 ${RENDER_FPS}，合法值: ${GIF_FPS_CHOICES.join("/")}`);
  return records.map((record) => (record.frames * fps) / RENDER_FPS);
}

export function buildGifFilter({ fps, width, colors }) {
  return (
    `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];` +
    `[a]palettegen=max_colors=${colors}[p];` +
    `[b][p]paletteuse=dither=bayer:bayer_scale=4[out]`
  );
}
```

（CLI 主路径见 Step 5；`#!/usr/bin/env node` 头与 main 放同文件。）

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test scripts/video/export-gif.test.mjs`
Expected: PASS 7/7。

- [ ] **Step 5: CLI 主路径（ffmpeg + ffprobe + 回写）**

在 `export-gif.mjs` 追加（`import { spawnSync } from "node:child_process"; import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"; import path from "node:path"; import { parseArgs } from "node:util";` 等按需补齐）：

```js
function fail(message) {
  console.error(`[export-gif] ${message}`);
  process.exit(1);
}

function probeJson(file) {
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width", "-show_entries", "format=duration", "-of", "json", file],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (probe.status !== 0) fail(`ffprobe 失败: ${probe.stderr}`);
  return JSON.parse(probe.stdout);
}

const { values } = parseArgs({
  options: {
    project: { type: "string" },
    aspect: { type: "string", default: "landscape" },
    out: { type: "string" },
    fps: { type: "string", default: "12" },
    colors: { type: "string", default: "128" },
    width: { type: "string", default: "480" },
  },
});
if (!values.project)
  fail("用法: node scripts/video/export-gif.mjs --project <path.json> [--aspect landscape|portrait] [--out <dir>] [--fps 12] [--colors 128] [--width 480]");
const aspect = values.aspect;
if (!(aspect in DIMENSIONS)) fail(`--aspect 只认 landscape/portrait，收到 ${aspect}`);
const fps = Number(values.fps);
const colors = Number(values.colors);
const width = Number(values.width);

const projectPath = path.resolve(values.project);
const { validateVideoProject } = await import(
  pathToFileURL(path.join(path.dirname(projectPath), "../../..")).href // 占位——按 ROOT 模式重写
);
// 实际实现：与 delivery.mjs 相同的 ROOT 推导（fileURLToPath(import.meta.url)），
// 此处不要复制粘贴占位符。

let project;
try {
  project = validateVideoProject(JSON.parse(readFileSync(projectPath, "utf8")));
} catch (error) {
  fail(`项目校验失败: ${error.message}`);
}

let block;
try {
  block = findRenderBlock(project, aspect);
} catch (error) {
  fail(error.message);
}
const videoPath = path.resolve(path.dirname(projectPath), block.outputAssetRef);
if (!existsSync(videoPath))
  fail(`渲染产物不存在: ${videoPath}（outputAssetRef 失效，重跑 render-scene 后再导出）`);

let frameMap;
try {
  frameMap = gifFrameMap(block.records, fps);
} catch (error) {
  fail(error.message);
}

const outDir = path.resolve(values.out ?? path.dirname(projectPath));
mkdirSync(outDir, { recursive: true });
const gifPath = path.join(outDir, `${aspect}.gif`);
const transcode = spawnSync(
  "ffmpeg",
  ["-y", "-v", "error", "-i", videoPath, "-filter_complex", buildGifFilter({ fps, width, colors }), "-map", "[out]", "-loop", "0", gifPath],
  { encoding: "utf8", timeout: 600_000 },
);
if (transcode.status !== 0)
  fail(`ffmpeg 转码失败:\n${transcode.stderr ?? ""}`);

// ffprobe 门禁：codec/宽度/时长（GIF 帧计时取整允许 0.2s 容差）
const metadata = probeJson(gifPath);
const stream = metadata.streams?.[0];
const totalFrames = block.records.reduce((sum, record) => sum + record.frames, 0);
const expectedSeconds = totalFrames / RENDER_FPS;
const durationSeconds = Number(metadata.format?.duration ?? 0);
if (stream?.codec_name !== "gif" || stream?.width !== width)
  fail(`GIF 元数据不符: ${JSON.stringify(metadata)}（期望 gif/${width} 宽）`);
if (Math.abs(durationSeconds - expectedSeconds) > 0.2)
  fail(`GIF 时长 ${durationSeconds}s 与源 ${expectedSeconds}s 偏差超 0.2s`);

const { project: next, delivery } = appendDelivery(project, {
  versionIds: block.records.map((record) => record.versionId),
  renderIds: block.records.map((record) => record.renderId),
  frameMap,
});
writeFileSync(projectPath, `${JSON.stringify(next, null, 2)}\n`);
console.log(
  `[export-gif] 完成: ${gifPath}（${expectedSeconds.toFixed(1)}s @${fps}fps, ${width}px 宽）; DeliveryRecord ${delivery.deliveryId.slice(0, 8)} 已回写 ${path.basename(projectPath)} (savedVersion=${next.savedVersion})`,
);
```

（实现时把 `import.meta.url` 的 ROOT 推导写实，删除占位注释块；`validateVideoProject` 也可直接从 `./delivery.mjs` re-export 复用其动态导入，避免两份 ROOT 推导——推荐后者。）

- [ ] **Step 6: 手工冒烟（可选但推荐）**

Run: `node scripts/video/export-gif.mjs --project artifacts/video-studio-shot-editor/e2e.video-project.json --aspect landscape --out /tmp/gif-smoke`（该文件已有渲染记录；若本机 mp4 已被清理则跳过本步，交给 Task 4 e2e 验证）
Expected: 退出 0，打印完成行；`savedVersion` +1。

- [ ] **Step 7: Commit**

```bash
git add scripts/video/delivery.mjs scripts/video/export-gif.mjs scripts/video/export-gif.test.mjs
git commit -m "feat(video-studio): 整片 GIF 导出——ffmpeg palette 转码 + DeliveryRecord 首次落档"
```

---

### Task 2: SVG 序列化纯模块（翻页册动画 + 静态单帧）

**Files:**
- Create: `scripts/video/svg-serialize.mjs`
- Test: `scripts/video/svg-serialize.test.mjs`

**Interfaces:**
- Consumes: `SvgNode`（packages/video-scene/src/svg.ts:4-9；attrs 是 SVG 原生 kebab-case，字符串路径直接透传——react-svg-attrs.ts:1 注释明示）。
- Produces（供 Task 3 CLI 与测试 import；renderFrame 注入式，模块零外部依赖）:
  - `MAX_SVG_EXPORT_NODES = 50000`
  - `serializeNode(node: SvgNode) → string`
  - `countNodes(node: SvgNode) → number`
  - `buildAnimatedSvg({renderFrame: (i: number) => SvgNode, frameCount: number, fps: number, width, height, background, maxNodes?}) → {svg: string, totalNodes: number}`
  - `buildStaticSvg({renderFrame: (i: number) => SvgNode, frame: number, width, height, background, maxNodes?}) → {svg: string, totalNodes: number}`

- [ ] **Step 1: 写失败测试**

`scripts/video/svg-serialize.test.mjs`：

```js
// D4 导出扩充：SvgNode → 独立 SVG 文件字符串序列化单测（纯数据进出，零外部进程）。
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAnimatedSvg,
  buildStaticSvg,
  countNodes,
  MAX_SVG_EXPORT_NODES,
  serializeNode,
} from "./svg-serialize.mjs";

const g = (attrs, ...children) => ({ tag: "g", attrs, children });
const text = (attrs, str) => ({ tag: "text", attrs, text: str });

test("serializeNode 转义 text 与 attr 的 XML 特殊字符", () => {
  const node = text({ "font-size": 48, fill: '#"<&>' }, 'a<b>&"c\'');
  const out = serializeNode(node);
  assert.ok(out.includes('fill="#&quot;&lt;&amp;&gt;'));
  assert.ok(out.includes(">a&lt;b&gt;&amp;&quot;c&#39;</text>"));
});

test("serializeNode 无 children 无 text 自闭合", () => {
  assert.equal(serializeNode({ tag: "rect", attrs: { width: 10 } }), '<rect width="10"/>');
});

test("serializeNode 嵌套 children 递归", () => {
  const out = serializeNode(g({ id: "root" }, text({}, "内"), { tag: "circle", attrs: { r: 2 } }));
  assert.equal(out, '<g id="root"><text>内</text><circle r="2"/></g>');
});

test("countNodes 递归计数含根", () => {
  assert.equal(countNodes(g({}, text({}, "a"), g({}, text({}, "b")))), 4);
});

test("buildAnimatedSvg 生成每帧 keyframes 切片与画布", () => {
  const frames = [text({}, "一"), text({}, "二"), text({}, "三")];
  const { svg, totalNodes } = buildAnimatedSvg({
    renderFrame: (i) => frames[i],
    frameCount: 3,
    fps: 12,
    width: 1280,
    height: 720,
    background: "#102030",
  });
  assert.equal(totalNodes, 3);
  assert.ok(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(svg.includes('viewBox="0 0 1280 720"'));
  assert.ok(svg.includes('font-family="NotoSansSC, sans-serif"'));
  assert.ok(svg.includes('<rect width="1280" height="720" fill="#102030"/>'));
  assert.ok(svg.includes('class="kf kf-0"'));
  assert.ok(svg.includes("@keyframes kf-0 {0% {opacity: 1;} 33.3333% {opacity: 0;}}"));
  assert.ok(svg.includes("@keyframes kf-2 {66.6667% {opacity: 1;} 100% {opacity: 0;}}"));
  assert.ok(svg.includes("steps(1, end) infinite"));
  assert.ok(svg.includes("0.25s")); // 3 帧 / 12fps
});

test("buildAnimatedSvg 确定性：同输入两次逐字节一致", () => {
  const args = { renderFrame: (i) => text({ x: i * 10 }, `帧${i}`), frameCount: 5, fps: 12, width: 720, height: 1280, background: "#ffffff" };
  const a = buildAnimatedSvg(args).svg;
  const b = buildAnimatedSvg(args).svg;
  assert.equal(createHash("sha256").update(a).digest("hex"), createHash("sha256").update(b).digest("hex"));
});

test("buildAnimatedSvg 节点预算超限拒绝并建议降 fps", () => {
  assert.throws(
    () => buildAnimatedSvg({ renderFrame: () => g({}, ...Array.from({ length: 30 }, () => text({}, "x"))), frameCount: 4, fps: 12, width: 1280, height: 720, background: "#fff", maxNodes: 100 }),
    /预算|fps/,
  );
});

test("buildAnimatedSvg 单帧拒绝（指路 --frame 静态）", () => {
  assert.throws(
    () => buildAnimatedSvg({ renderFrame: () => text({}, "x"), frameCount: 1, fps: 12, width: 1280, height: 720, background: "#fff" }),
    /--frame/,
  );
});

test("buildStaticSvg 无动画样式、单组、含指定帧内容", () => {
  const { svg, totalNodes } = buildStaticSvg({ renderFrame: (i) => text({}, `第${i}帧`), frame: 7, width: 1280, height: 720, background: "#abc" });
  assert.equal(totalNodes, 1);
  assert.ok(!svg.includes("@keyframes"));
  assert.ok(svg.includes("第7帧"));
  assert.ok(svg.includes('fill="#abc"'));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test scripts/video/svg-serialize.test.mjs`
Expected: FAIL——`Cannot find module './svg-serialize.mjs'`。

- [ ] **Step 3: 实现 svg-serialize.mjs**

```js
// D4 导出扩充（spec R2）：SvgNode 纯数据树 → 可独立打开的 SVG 文件字符串。
// 动画 = 翻页册：全部采样帧叠进一个 <svg>，CSS keyframes 各自在时间切片内可见
// （steps(1,end) 消除插值）。零 React/DOM/网络依赖；确定性：同输入同串。
export const MAX_SVG_EXPORT_NODES = 50000;

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function serializeNode(node) {
  const attrs = Object.entries(node.attrs ?? {})
    .map(([key, value]) => ` ${key}="${esc(value)}"`)
    .join("");
  if (node.text !== undefined)
    return `<${node.tag}${attrs}>${esc(node.text)}</${node.tag}>`;
  if (node.children?.length)
    return `<${node.tag}${attrs}>${node.children.map(serializeNode).join("")}</${node.tag}>`;
  return `<${node.tag}${attrs}/>`;
}

export function countNodes(node) {
  return 1 + (node.children ?? []).reduce((sum, child) => sum + countNodes(child), 0);
}

// 切片百分比：足够分辨率且末帧终点恰为 100%。
function pct(index, frameCount) {
  return String(Number(((index * 100) / frameCount).toFixed(4)));
}

function canvas(svgBody, { width, height, background }) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="NotoSansSC, sans-serif">` +
    `<rect width="${width}" height="${height}" fill="${esc(background)}"/>` +
    svgBody +
    `</svg>\n`
  );
}

export function buildAnimatedSvg({
  renderFrame, frameCount, fps, width, height, background,
  maxNodes = MAX_SVG_EXPORT_NODES,
}) {
  if (frameCount < 2)
    throw new Error(`采样帧数 ${frameCount} 不足 2，动画无从谈起；单帧用 --frame 出静态 SVG`);
  const groups = [];
  const rules = [];
  let totalNodes = 0;
  for (let index = 0; index < frameCount; index++) {
    const node = renderFrame(index);
    totalNodes += countNodes(node);
    if (totalNodes > maxNodes)
      throw new Error(`SVG 导出节点预算超限（${totalNodes} > ${maxNodes}），建议 --fps 降采样`);
    groups.push(`<g class="kf kf-${index}">${serializeNode(node)}</g>`);
    rules.push(
      `@keyframes kf-${index} {${pct(index, frameCount)}% {opacity: 1;} ${pct(index + 1, frameCount)}% {opacity: 0;}}`,
      `.kf-${index} {opacity: 0; animation: kf-${index} ${(frameCount / fps).toFixed(3)}s steps(1, end) infinite;}`,
    );
  }
  const svg = canvas(`<style>${rules.join("")}</style>${groups.join("")}`, { width, height, background });
  return { svg, totalNodes };
}

export function buildStaticSvg({
  renderFrame, frame, width, height, background,
  maxNodes = MAX_SVG_EXPORT_NODES,
}) {
  const node = renderFrame(frame);
  const totalNodes = countNodes(node);
  if (totalNodes > maxNodes)
    throw new Error(`SVG 导出节点预算超限（${totalNodes} > ${maxNodes}）`);
  return { svg: canvas(serializeNode(node), { width, height, background }), totalNodes };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test scripts/video/svg-serialize.test.mjs`
Expected: PASS 9/9。

- [ ] **Step 5: Commit**

```bash
git add scripts/video/svg-serialize.mjs scripts/video/svg-serialize.test.mjs
git commit -m "feat(video-studio): SvgNode 序列化纯模块——CSS 翻页册动画 SVG 与静态单帧"
```

---

### Task 3: 单镜头 SVG 导出 CLI

**Files:**
- Create: `scripts/video/export-shot-svg.mjs`
- Test: `scripts/video/export-shot-svg.test.mjs`

**Interfaces:**
- Consumes: Task 2 `buildAnimatedSvg/buildStaticSvg/MAX_SVG_EXPORT_NODES`；`delivery.mjs appendDelivery`；video-scene dist（`validateSceneSpec/defaultRegistry/seededRandom/assertNodeBudget`）；video-document dist（`validateVideoProject/quantizeTimeline`）。
- Produces:
  - `resolveShot(project, shotNumber) → {shot, version}`（1 基；越界/无 working/非 spec 场景源均 throw 带指引）
  - `shotFrames(durationMs, fps = 24) → number`（quantizeTimeline 单镜头口径）
  - `sampledFrameCount(durationFrames, fps, renderFps = 24) → number`（= ceil(durationFrames / (renderFps / fps))；非整除 throw）
  - CLI：`node scripts/video/export-shot-svg.mjs --project <p.json> --shot <1 基> [--fps 12 | --frame <0 基帧号>] [--aspect landscape|portrait] [--out <dir>]`

- [ ] **Step 1: 写失败测试**

`scripts/video/export-shot-svg.test.mjs`：

```js
// D4 导出扩充：单镜头 SVG 导出 CLI 的纯辅助单测（ffmpeg 无关；渲染注入在 e2e 验证）。
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { resolveShot, sampledFrameCount, shotFrames } from "./export-shot-svg.mjs";

const T = "2026-10-18T00:00:00.000Z";
function project() {
  const v1 = randomUUID();
  const v2 = randomUUID();
  return {
    schemaVersion: 1,
    id: randomUUID(),
    title: "SVG 单测",
    brief: { sentence: "占位", aspectTargets: ["landscape"] },
    shots: [
      { shotId: randomUUID(), order: 0, locked: false, workingVersionId: v1, contentVersions: [{ versionId: v1, createdAt: T, durationMs: 2000, description: "", narrationText: "一。", sceneSource: { type: "spec", spec: { componentId: "text-animation", componentVersion: 1, seed: 1, durationMs: 2000, background: "#fff", params: {} } }, provenance: { engineId: "x", engineVersion: "1" } }], events: [{ at: T, kind: "submitted", actor: "human" }] },
      { shotId: randomUUID(), order: 1, locked: false, workingVersionId: v2, contentVersions: [{ versionId: v2, createdAt: T, durationMs: 3100, description: "", narrationText: "二。", sceneSource: { type: "text", text: "外部文本" }, provenance: { engineId: "x", engineVersion: "1" } }], events: [{ at: T, kind: "submitted", actor: "human" }] },
    ],
    renderRecords: [],
    deliveries: [],
    savedVersion: 1,
  };
}

test("resolveShot 1 基序号解析 working 版本", () => {
  const p = project();
  const { version } = resolveShot(p, 2);
  assert.equal(version.sceneSource.type, "text");
});

test("resolveShot 越界报错给出合法范围", () => {
  assert.throws(() => resolveShot(project(), 3), /1\.\.2/);
  assert.throws(() => resolveShot(project(), 0), /1\.\.2/);
});

test("resolveShot 非 spec 场景源拒绝并指路", () => {
  assert.throws(() => resolveShot(project(), 2).version, /spec/); // 占位——实际断言放在 resolveShot 内对 sceneSource 的 throw，见 Step 3
});

test("shotFrames 与出片量化口径一致", () => {
  assert.equal(shotFrames(2000), 48);
  assert.equal(shotFrames(3100), 74);
});

test("sampledFrameCount 整除精确、非整除拒绝", () => {
  assert.equal(sampledFrameCount(48, 12), 24);
  assert.equal(sampledFrameCount(74, 12), 37);
  assert.throws(() => sampledFrameCount(48, 10), /合法值/);
});
```

（第三个测试的占位断言在实现后修正为：`resolveShot` 校验场景源发生在 CLI 组装 spec 时——若把校验放进 `resolveShot` 则断言 `assert.throws(() => resolveShot(p, 2), /仅 spec/)`。**采用后者**：`resolveShot` 一并校验 `sceneSource.type === "spec"` 并 throw「仅 spec 场景源镜头可导出 SVG」。）

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test scripts/video/export-shot-svg.test.mjs`
Expected: FAIL——`Cannot find module './export-shot-svg.mjs'`。

- [ ] **Step 3: 实现 export-shot-svg.mjs**

```js
#!/usr/bin/env node
// D4 导出扩充（spec R2）：单镜头声明式场景 → 独立 SVG 文件。动画模式（--fps，
// 默认 12）出 CSS 翻页册；--frame <0 基> 出静态单帧。DeliveryRecord 落档
// （renderIds 为空数组——SVG 直出，不派生自任何 MP4 渲染）。
// 用法: node scripts/video/export-shot-svg.mjs --project <path.json> --shot <1 基序号> [--fps 12 | --frame 24] [--aspect landscape|portrait] [--out <dir>]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { appendDelivery } from "./delivery.mjs";
import { buildAnimatedSvg, buildStaticSvg } from "./svg-serialize.mjs";

const RENDER_FPS = 24;
const FPS_CHOICES = [1, 2, 3, 4, 6, 8, 12, 24];
const DIMENSIONS = { landscape: [1280, 720], portrait: [720, 1280] };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { quantizeTimeline, validateVideoProject } = await import(
  pathToFileURL(path.join(ROOT, "packages/video-document/dist/index.js")).href
);
const { assertNodeBudget, defaultRegistry, seededRandom, validateSceneSpec } = await import(
  pathToFileURL(path.join(ROOT, "packages/video-scene/dist/index.js")).href
);

export function resolveShot(project, shotNumber) {
  const shot = project.shots[shotNumber - 1];
  if (!shot)
    throw new Error(`--shot ${shotNumber} 越界（合法 1..${project.shots.length}）`);
  const version = shot.contentVersions.find(
    (candidate) => candidate.versionId === shot.workingVersionId,
  );
  if (!version) throw new Error(`镜头 ${shotNumber} 缺少 working version`);
  if (version.sceneSource.type !== "spec")
    throw new Error(`镜头 ${shotNumber} 的场景源不是 spec（仅 spec 场景源镜头可导出 SVG）`);
  return { shot, version };
}

export function shotFrames(durationMs, fps = RENDER_FPS) {
  return quantizeTimeline([durationMs], fps).shots[0].frames;
}

export function sampledFrameCount(durationFrames, fps, renderFps = RENDER_FPS) {
  if (!FPS_CHOICES.includes(fps))
    throw new Error(`--fps ${fps} 不整除渲染帧率 ${renderFps}，合法值: ${FPS_CHOICES.join("/")}`);
  return Math.ceil(durationFrames / (renderFps / fps));
}

function fail(message) {
  console.error(`[export-shot-svg] ${message}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    project: { type: "string" },
    shot: { type: "string" },
    fps: { type: "string" },
    frame: { type: "string" },
    aspect: { type: "string", default: "landscape" },
    out: { type: "string" },
  },
});
if (!values.project || !values.shot)
  fail("用法: node scripts/video/export-shot-svg.mjs --project <path.json> --shot <1 基序号> [--fps 12 | --frame 24] [--aspect landscape|portrait] [--out <dir>]");
const shotNumber = Number(values.shot);
if (!Number.isInteger(shotNumber)) fail(`--shot 必须是整数，收到 ${values.shot}`);
const aspect = values.aspect;
if (!(aspect in DIMENSIONS)) fail(`--aspect 只认 landscape/portrait，收到 ${aspect}`);
const [width, height] = DIMENSIONS[aspect];

const projectPath = path.resolve(values.project);
let project;
try {
  project = validateVideoProject(JSON.parse(readFileSync(projectPath, "utf8")));
} catch (error) {
  fail(`项目校验失败: ${error.message}`);
}

let version;
try {
  ({ version } = resolveShot(project, shotNumber));
} catch (error) {
  fail(error.message);
}

let spec;
try {
  spec = validateSceneSpec(version.sceneSource.spec, defaultRegistry);
} catch (error) {
  fail(`镜头 ${shotNumber} scene_spec 校验失败: ${error.message}`);
}
if (spec.durationMs !== version.durationMs)
  fail(`镜头 ${shotNumber} spec.durationMs(${spec.durationMs}) 与版本时长(${version.durationMs})不一致，先在工作台修订对齐`);

const durationFrames = shotFrames(version.durationMs);
const renderFrame = (index) => {
  const step = values.frame !== undefined ? 1 : RENDER_FPS / Number(values.fps ?? "12");
  const node = defaultRegistry.get(spec.componentId, spec.componentVersion).render(spec, {
    frame: Math.round(index * step),
    fps: RENDER_FPS,
    durationFrames,
    width,
    height,
    random: seededRandom(spec.seed),
  });
  assertNodeBudget(node);
  return node;
};

const outDir = path.resolve(values.out ?? path.dirname(projectPath));
mkdirSync(outDir, { recursive: true });
let svgPath;
let result;
try {
  if (values.frame !== undefined) {
    const frame = Number(values.frame);
    if (!Number.isInteger(frame) || frame < 0 || frame >= durationFrames)
      fail(`--frame ${values.frame} 越界（合法 0..${durationFrames - 1}）`);
    result = buildStaticSvg({ renderFrame: () => renderFrame(frame), frame, width, height, background: spec.background });
    svgPath = path.join(outDir, `shot-${shotNumber}-frame-${frame}.svg`);
  } else {
    const fps = Number(values.fps ?? "12");
    const frameCount = sampledFrameCount(durationFrames, fps);
    result = buildAnimatedSvg({ renderFrame, frameCount, fps, width, height, background: spec.background });
    svgPath = path.join(outDir, `shot-${shotNumber}-animated-${fps}fps.svg`);
  }
} catch (error) {
  fail(error.message);
}
writeFileSync(svgPath, result.svg);

const { project: next, delivery } = appendDelivery(project, {
  versionIds: [version.versionId],
  renderIds: [],
  frameMap: [values.frame !== undefined ? 1 : sampledFrameCount(durationFrames, Number(values.fps ?? "12"))],
});
writeFileSync(projectPath, `${JSON.stringify(next, null, 2)}\n`);
console.log(
  `[export-shot-svg] 完成: ${svgPath}（${result.totalNodes} 节点）; DeliveryRecord ${delivery.deliveryId.slice(0, 8)} 已回写 (savedVersion=${next.savedVersion})`,
);
```

注意 `renderFrame` 闭包里静态模式 `step=1` 仅是为了复用同一函数形状——静态路径实际传 `() => renderFrame(frame)`，`index` 不参与；实现时可把 step 计算移出闭包避免每帧重算（等价语义，择一）。

- [ ] **Step 4: 跑测试确认通过 + 修正第三个测试断言**

Run: `node --test scripts/video/export-shot-svg.test.mjs`
Expected: PASS 5/5（第三个测试按 Step 1 括注改为 `assert.throws(() => resolveShot(project(), 2), /仅 spec/)`）。

- [ ] **Step 5: Commit**

```bash
git add scripts/video/export-shot-svg.mjs scripts/video/export-shot-svg.test.mjs
git commit -m "feat(video-studio): 单镜头 SVG 导出 CLI——动画翻页册/静态帧 + DeliveryRecord 空渲染引用"
```

---

### Task 4: e2e 全链 + VID-015 + 证据文档

**Files:**
- Create: `scripts/video/e2e-export.mjs`
- Create: `artifacts/video-studio-export/E2E_EXPORT.md`
- Modify: `qa/registry.json`（追加 VID-015，沿 VID-014 体例）

**Interfaces:**
- Consumes: `render-scene.mjs`（spawnSync 子进程，沿 e2e-shot-editor 的 CLI 渲染冒烟模式）；Task 1/3 两个 CLI；入库基线 `artifacts/video-studio-shot-editor/baseline.video-project.json`（4 镜头、renderRecords 空、无 TTS）。
- Produces: e2e 退出码 0 = R1/R2/A1–A5 成立；证据文档 + VID-015。

- [ ] **Step 1: 写 e2e 脚本**

`scripts/video/e2e-export.mjs`（要点，全长按 e2e-shot-editor.mjs 体例组织）：

```js
#!/usr/bin/env node
// D4 导出扩充端到端验收（零 TTS 计费）：
//   入库基线项目（4 镜头）→ render-scene 出片（MP4×2 画幅 + RenderRecord×8）
//   → export-gif landscape（ffprobe 元数据 + DeliveryRecord renderIds 非空/frameMap [24,37,24,24]）
//   → 双跑转码逐字节一致（同 MP4 + 同 ffmpeg）
//   → export-shot-svg --shot 3 动画（keyframes 段数 = 74/2=37 + renderIds 空数组落档）
//   → export-shot-svg --shot 3 --frame 24 静态（无 @keyframes）
//   → SVG 双跑逐字节一致 → 计费台账行数不变。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "artifacts/video-studio-export");
const LEDGER = path.join(ROOT, "artifacts/tts-usage.jsonl");
const BASELINE = path.join(ROOT, "artifacts/video-studio-shot-editor/baseline.video-project.json");

function fail(step, detail) { console.error(`[e2e-export] FAIL at ${step}: ${detail ?? ""}`); process.exit(1); }
function sha256(file) { return createHash("sha256").update(readFileSync(file)).digest("hex"); }
function lines(file) { try { return readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).length; } catch { return 0; } }
function run(step, args) {
  const result = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", timeout: 600_000 });
  if (result.status !== 0) fail(step, `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  return result.stdout ?? "";
}

mkdirSync(OUT_DIR, { recursive: true });
const usageBefore = lines(LEDGER);

// 1. 基线拷贝 + 出片（走完整干跑门禁，不 --skip-dryrun）
const project = path.join(OUT_DIR, "e2e.video-project.json");
copyFileSync(BASELINE, project);
run("render-scene", [path.join(ROOT, "scripts/video/render-scene.mjs"), "--project", project, "--out", path.join(OUT_DIR, "render")]);
const rendered = JSON.parse(readFileSync(project, "utf8"));
if (rendered.renderRecords.length !== 8) fail("render-scene", `RenderRecord ${rendered.renderRecords.length} ≠ 8`);

// 2. export-gif（landscape，帧图 [48,74,48,48]@24fps → GIF@12fps [24,37,24,24]）
run("export-gif", [path.join(ROOT, "scripts/video/export-gif.mjs"), "--project", project, "--aspect", "landscape", "--out", OUT_DIR]);
const afterGif = JSON.parse(readFileSync(project, "utf8"));
if (afterGif.deliveries.length !== 1) fail("export-gif", "DeliveryRecord 未落档");
const d0 = afterGif.deliveries[0];
if (d0.renderIds.length !== 4) fail("export-gif", `renderIds ${d0.renderIds.length} ≠ 4`);
if (JSON.stringify(d0.frameMap) !== JSON.stringify([24, 37, 24, 24])) fail("export-gif", `frameMap ${JSON.stringify(d0.frameMap)}`);
const gif = path.join(OUT_DIR, "landscape.gif");
if (!existsSync(gif)) fail("export-gif", "GIF 未落盘");
// ffprobe 元数据门禁在 CLI 内部已做；此处再独立复核一次 codec/宽度
const probe = JSON.parse(spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width", "-of", "json", gif], { encoding: "utf8" }).stdout);
if (probe.streams?.[0]?.codec_name !== "gif" || probe.streams?.[0]?.width !== 480) fail("ffprobe", JSON.stringify(probe));

// 3. GIF 双跑逐字节一致（同 MP4 + 同 ffmpeg 版本）
const projectCopy = path.join(OUT_DIR, "rerun.video-project.json");
copyFileSync(project, projectCopy);
run("export-gif 双跑", [path.join(ROOT, "scripts/video/export-gif.mjs"), "--project", projectCopy, "--aspect", "landscape", "--out", path.join(OUT_DIR, "rerun")]);
if (sha256(gif) !== sha256(path.join(OUT_DIR, "rerun/landscape.gif")))
  fail("GIF 确定性", `两次哈希不一致: ${sha256(gif)} vs ${sha256(path.join(OUT_DIR, "rerun/landscape.gif"))}`);

// 4. export-shot-svg 动画（镜头 3 basic-shapes 3100ms → 74 帧 → @12fps 37 段）+ 静态
run("export-shot-svg 动画", [path.join(ROOT, "scripts/video/export-shot-svg.mjs"), "--project", project, "--shot", "3", "--fps", "12", "--out", OUT_DIR]);
const animated = readFileSync(path.join(OUT_DIR, "shot-3-animated-12fps.svg"), "utf8");
const keyframeCount = (animated.match(/@keyframes kf-/g) ?? []).length;
if (keyframeCount !== 37) fail("SVG 动画", `keyframes 段数 ${keyframeCount} ≠ 37`);
run("export-shot-svg 静态", [path.join(ROOT, "scripts/video/export-shot-svg.mjs"), "--project", project, "--shot", "3", "--frame", "24", "--out", OUT_DIR]);
const staticSvg = readFileSync(path.join(OUT_DIR, "shot-3-frame-24.svg"), "utf8");
if (staticSvg.includes("@keyframes")) fail("SVG 静态", "静态帧不应含动画样式");
const afterSvg = JSON.parse(readFileSync(project, "utf8"));
if (afterSvg.deliveries.length !== 3) fail("export-shot-svg", `交付数 ${afterSvg.deliveries.length} ≠ 3（gif1 + svg2）`);
if (afterSvg.deliveries[1].renderIds.length !== 0 || JSON.stringify(afterSvg.deliveries[1].frameMap) !== "[37]")
  fail("SVG 动画交付", JSON.stringify(afterSvg.deliveries[1]));

// 5. SVG 双跑逐字节一致
copyFileSync(project, projectCopy);
run("export-shot-svg 双跑", [path.join(ROOT, "scripts/video/export-shot-svg.mjs"), "--project", projectCopy, "--shot", "3", "--fps", "12", "--out", path.join(OUT_DIR, "rerun")]);
if (sha256(path.join(OUT_DIR, "shot-3-animated-12fps.svg")) !== sha256(path.join(OUT_DIR, "rerun/shot-3-animated-12fps.svg")))
  fail("SVG 确定性", "两次哈希不一致");

// 6. 计费不变 + 终版回读校验（deliveries 追加后文档仍合法）
if (lines(LEDGER) !== usageBefore) fail("计费", "tts-usage.jsonl 行数变化");
const finalProject = JSON.parse(readFileSync(project, "utf8"));
run("回读校验", [path.join(ROOT, "scripts/video/export-shot-svg.mjs"), "--project", project, "--shot", "3", "--frame", "25", "--out", path.join(OUT_DIR, "verify")]);
if (JSON.parse(readFileSync(project, "utf8")).deliveries.length !== finalProject.deliveries.length + 1)
  fail("回读校验", "追加交付后文档未按预期演进");

console.log(`[e2e-export] OK: GIF + SVG 全链（交付 ${finalProject.deliveries.length + 1} 条），计费零新增`);
for (const name of ["landscape.gif", "shot-3-animated-12fps.svg", "shot-3-frame-24.svg", "e2e.video-project.json"]) {
  console.log(`  ${name}: ${sha256(path.join(OUT_DIR, name))}`);
}
```

- [ ] **Step 2: 跑 e2e 确认失败→通过（首个完整跑通）**

Run: `node scripts/video/e2e-export.mjs`
Expected: 首跑可能暴露实现缝隙（文件名/口径不一致），修到退出 0，打印 OK 与 4 个 SHA-256。任何一步失败打印步骤名。

- [ ] **Step 3: 证据文档 E2E_EXPORT.md**

按 `artifacts/video-studio-shot-editor/E2E_SHOT_EDITOR.md` 体例：链路（基线→出片→GIF→SVG→双跑→计费）、结果（退出码 0、交付条数、keyframes 段数、双跑哈希一致）、入库件 vs 本地媒体表（`landscape.gif`/`shot-3-*.svg`/render mp4 均 gitignore，列 SHA-256）、复跑方式（无需 dev server，纯 CLI）、零计费声明。

- [ ] **Step 4: VID-015 登记**

`qa/registry.json` manual 段在 VID-014 后追加（沿同体例：id/title/owner/date/source=manual、steps、passCriteria=「e2e 退出 0：GIF ffprobe 元数据与 DeliveryRecord frameMap 精确、SVG keyframes 段数与静态无动画、双跑逐字节一致、计费行数不变」）。

- [ ] **Step 5: Commit**

```bash
git add scripts/video/e2e-export.mjs artifacts/video-studio-export qa/registry.json
git commit -m "feat(video-studio): 导出扩充 e2e——GIF/SVG 双跑确定性证据与 VID-015"
```

（`git add artifacts/video-studio-export` 只会带上 md/json，gif/svg/mp4 被 gitignore 自然排除。）

---

### Task 5: 工作台提示 + CURRENT_STATE + 全回归

**Files:**
- Modify: `apps/web/src/app/video-studio/page.tsx:535`（editor-export onClick 的 message）
- Modify: `AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md`（顶部新条目）

**Interfaces:**
- Consumes: Task 1/3 CLI 的实际用法行。
- Produces: 用户可发现的两条导出命令（纯文案）。

- [ ] **Step 1: page.tsx 提示文案**

把导出 message 改为（保持既有第一行不动，追加派生导出行）：

```ts
message: `已导出 ${anchor.download}。CLI 出片：node scripts/video/render-scene.mjs --project <导出件> --out <目录>；整片 GIF：node scripts/video/export-gif.mjs --project <导出件> --aspect landscape；单镜头 SVG：node scripts/video/export-shot-svg.mjs --project <导出件> --shot 1，完成后回列表页「导入项目 JSON」`,
```

（确认 `scripts/video/e2e-shot-editor.mjs` 未对旧文案做整串断言——它只等 download 事件与 `.editor-message` 的其他文案，此改动安全。）

- [ ] **Step 2: web 测试回归**

Run: `pnpm --filter @acs/web test`
Expected: PASS 59/59（文案无测试依赖）。

- [ ] **Step 3: CURRENT_STATE.md 顶部条目**

沿既有体例：`## 2026-10-18 Video Studio 导出扩充（P1 Feature ③）`——spec cb083ac、五任务提交号、GIF/SVG 能力一句话、e2e 结果（交付条数/双跑一致/零计费）、回归计数。

- [ ] **Step 4: 全回归**

Run: `pnpm --filter @acs/video-document run build && node --test "packages/video-document/dist/**/*.test.js" && pnpm --filter @acs/video-scene run build && node --test "packages/video-scene/dist/**/*.test.js" && pnpm --filter @acs/web test && node --test "scripts/video/*.test.mjs" && pnpm lint`
Expected: 全绿（video-document 61、video-scene 33、web 59、scripts 33+新增、lint clean）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/video-studio/page.tsx AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md
git commit -m "feat(video-studio): 导出扩充收口——工作台派生导出提示与状态文档"
```

---

## Self-Review 记录

1. **Spec coverage**：R1→Task 1；R2→Task 2+3；R3→Task 5 Step 1；R4→Task 4；错误表逐行映射到 CLI fail 路径与测试；验收 A1（GIF 双跑）A2（SVG 双模式+一致）A3（ffprobe/文件头）A4（计费）A5（SHA-256 表）全覆盖。
2. **占位扫描**：Task 1 Step 5 的 ROOT 推导占位已标注「实现时写实」并给出推荐做法（delivery.mjs re-export）；Task 3 Step 1 第三个测试的占位断言已注明修正方向。无 TBD/TODO。
3. **类型一致性**：`appendDelivery`/`findRenderBlock`/`buildGifFilter`/`buildAnimatedSvg`/`buildStaticSvg`/`resolveShot`/`shotFrames`/`sampledFrameCount` 在 Produces 与消费者处签名一致；`renderFrame` 注入式回调两边一致。
4. **Review Focus**：五条各有归属测试（Task 1 x2、Task 3 x3）。
