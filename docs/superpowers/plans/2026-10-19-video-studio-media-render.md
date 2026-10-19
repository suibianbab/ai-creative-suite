# Video Studio P2.5-T4 媒体镜头出片链路 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** render-scene 支持 media-clip 镜头出片：Remotion OffthreadVideo 渲染原始素材（裁切/原声混音/双画幅），渲染前仓核验（存在性+sha256），成功判定扩至末帧黑帧检测，manifest/RenderRecord 写媒体证据（assetDigests）。

**Architecture:** 三层装配——纯逻辑层 `scripts/video/render-scene.media.mjs`（G1-G7 全部可注入依赖单测）、服务层 `scripts/video/media-server.mjs`（Remotion 资产下载器只认 http，仓内 original 流式托管）、编排层 `render-scene.mjs`（门禁放宽 spec→spec|media-clip、双服务 spawn、门禁族接线）。裁切数学从 web 南迁 `@acs/video-scene`（web 预览与 remotion-engine 共同可达的唯一层）；引擎侧 `TimelineShotProps` 增设互斥 `media` 通道，OffthreadVideo 在 Sequence 内取镜头本地帧。

**Tech Stack:** Remotion 4.0.534（OffthreadVideo/trimBefore 帧单位/Audio 自动混音）、node:test、ffmpeg/ffprobe（signalstats YAVG 末帧黑帧）、media-store 内容寻址仓（无新依赖）。

**Spec:** `docs/superpowers/specs/2026-10-19-video-studio-media-render-design.md`（裁定 B1-B6、规则 G/S/E/A/D/X 全表、错误文案 §3、测试清单 §4、验收 §6）

## Global Constraints

- 工作树 `D:\codex\animate\.claude\worktrees\video-studio-p0`（分支 `worktree-video-studio-p2`）；git 一律从工作树根以普通命令执行；主检出 `D:\codex\animate` 勿动。
- **零计费**：本刀不调 DashScope；冒烟旁白用 ffmpeg 合成正弦 wav；`artifacts/tts-usage.jsonl` 保持 34 行。
- 单测零网络零 Remotion 渲染：fs/hash/探针文本全部注入（`render-scene.narration.test.mjs` 同款纪律）；媒体仓服务测试仅 127.0.0.1 本地回环。
- 媒体不入库；证据留在 `artifacts/video-studio-media-render/`（SHA-256 口径）；DASHSCOPE_API_KEY 只从 env 读，不落盘不进 props/manifest/日志。
- 错误文案全中文（spec §3 逐字）。
- 提交信息尾部 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 出片参数恒定：FPS=24、双画幅 1280×720 / 720×1280（`render-scene.mjs` DIMENSIONS，勿改成 1920×1080）。
- 组件（.tsx）不写单测（house style）：typecheck + 全量套件兜底；纯逻辑进 .ts/.mjs 配测试。
- pnpm 版本门绕行：root build 被拒时逐包 `pnpm --filter <pkg> run build`；`npx biome check .` 须 clean。
- spec-only 项目 props 逐字节恒等（X1/A1 金标准）：timelineProps 的 spec 路径键序 `spec,startFrame,frames,narration?,subtitles?` 不得改动。

## Review Focus

（spec 隐含但无任务测试覆盖、最可能咬人的五类输入；逐条钉进归属任务的测试）

1. **props 字节恒等（X1）**：Task 6/7 改造后 spec-only 项目 props 逐字节不变（含键序）。→ 钉在 Task 3（`buildTimelineShotMedia` 键序 JSON 精确串断言）+ Task 8（A1 金标准 e2e-dataviz 复跑 props 逐字节比对 + contentDigest `4ac94b11…`/`8f2b26ad…` 不变）。
2. **trimBefore 取整边界（B5）**：非整帧入点 half-up 两侧（×.488→下、×.512→上）。→ 钉在 Task 3 `mediaTrimBefore` 测试（1541ms@24fps→36.984→37 属正常；1562ms→37.488→37、1563ms→37.512→38 钉半进位方向）。
3. **仓漂移失败路径（G3）**：文件缺失/sha 不符 → 大声失败且不写 RenderRecord 不回写项目。→ 钉在 Task 3 `verifyMediaAssets` 两条负路径测试 + Task 8 手工反证（删仓文件重跑 → 退出码≠0、项目文件 mtime/内容不变）。
4. **aac 四象限（G4）**：旁白有/无 × 媒体 keep/mute 组合下 aac 存在性判定。→ 钉在 Task 3 `buildHasAudioTrack` 四象限测试 + Task 8（keep 出片有 aac；mute 无旁白重跑无音频流为反证见证）。
5. **末帧黑帧误报边界（B6/G5）**：YAVG 解析对多行 metadata/缺 YAVG 的健壮性，阈值 16 与 17 的两侧。→ 钉在 Task 3 `parseTailYavg`/`isBlackTail` 测试（多行取末行、无匹配→null、16 黑 17 非黑、null 不判黑）。

---

### Task 1: video-scene media-crop（裁切数学南迁，B2）

**Files:**
- Create: `packages/video-scene/src/media-crop.ts`
- Create: `packages/video-scene/src/media-crop.test.ts`
- Modify: `packages/video-scene/src/index.ts`
- Modify: `apps/web/src/app/video-studio/media-preview.ts`（删实现改再导出）
- Modify: `apps/web/src/app/video-studio/media-preview.test.ts`（迁出 5 条，留 2 条 seek）

**Interfaces:**
- Consumes: `apps/web/src/app/video-studio/media-preview.ts` 现有 `mediaClipCss`（迁移源，实现逐字节搬走）。
- Produces: `@acs/video-scene` 导出 `mediaClipCss(assetWidth: number, assetHeight: number, canvasWidth: number, canvasHeight: number, fit: "cover"|"contain", focalX: number): { objectFit: "cover"|"contain"; objectPosition: string }`——Task 6 引擎 MediaClipLayer 与 web scene-preview 共用（web 侧经 media-preview.ts 再导出保持 import 面不变，X4）。

- [ ] **Step 1: 写失败测试**（`packages/video-scene/src/media-crop.test.ts`）

```ts
// P2.5-T4 B2：裁切数学单源在 video-scene（web 预览 + remotion-engine 出片共用）。
// 前 5 例自 apps/web media-preview.test.ts 迁移（值不变），末例钉出片双画幅。
import assert from "node:assert/strict";
import test from "node:test";
import { mediaClipCss } from "./media-crop.js";

test("contain：同比居中，focal 无效恒 50% 50%", () => {
  assert.deepEqual(mediaClipCss(1920, 1080, 360, 640, "contain", 0.9), {
    objectFit: "contain",
    objectPosition: "50% 50%",
  });
});

test("cover 横溢出：focal 定水平位（1/3 → 33.3%）", () => {
  const css = mediaClipCss(1920, 1080, 360, 640, "cover", 1 / 3);
  assert.equal(css.objectFit, "cover");
  assert.equal(css.objectPosition, "33.3% 50%");
});

test("cover 出片双画幅钉死：1280×720 焦点钳缘（0/1 不出画）、720×1280 竖溢出裁横", () => {
  // 2400×1080 源进 1280×720：scale=720/1080=0.667，宽 2400×0.667=1600>1280.5 → 横溢出
  assert.equal(mediaClipCss(2400, 1080, 1280, 720, "cover", 0).objectPosition, "0.0% 50%");
  assert.equal(mediaClipCss(2400, 1080, 1280, 720, "cover", 1).objectPosition, "100.0% 50%");
  // 1920×1080 源进 720×1280：scale=1280/1080≈1.185，宽 2276>720.5 → 横溢出，focal 0.25
  assert.equal(mediaClipCss(1920, 1080, 720, 1280, "cover", 0.25).objectPosition, "25.0% 50%");
});

test("cover 无横溢出：同比与竖溢出都归 50%（focal 无效但恒定，C6 先例）", () => {
  // 1920×1080 进 1280×720 同比：无溢出
  assert.equal(mediaClipCss(1920, 1080, 1280, 720, "cover", 0.3).objectPosition, "50% 50%");
  // 1080×1920 竖源进 1280×720：竖溢出横不溢出
  assert.equal(mediaClipCss(1080, 1920, 1280, 720, "cover", 0.7).objectPosition, "50% 50%");
});

test("同尺寸：cover 归一无偏移", () => {
  assert.deepEqual(mediaClipCss(1280, 720, 1280, 720, "cover", 0.1), {
    objectFit: "cover",
    objectPosition: "50% 50%",
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @acs/video-scene run build && node --test "packages/video-scene/dist/**/*.test.js" 2>&1 | tail -5`
Expected: FAIL——dist 里没有 media-crop.test.js（构建可能因新文件进 src 而编译，但 import "./media-crop.js" 无实现则编译失败：`Cannot find module './media-crop.js'`）。失败即 RED。

- [ ] **Step 3: 最小实现**

`packages/video-scene/src/media-crop.ts`（实现从 `apps/web/src/app/video-studio/media-preview.ts` 逐字节搬走——只改头注释）：

```ts
// P2.5-T4（spec §1 B2）裁切数学南迁：video-scene 是 web 预览与 remotion-engine
// 出片共同可达的唯一层，mediaClipCss 在此单源。web media-preview.ts 转再导出。
export function mediaClipCss(
  assetWidth: number,
  assetHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  fit: "cover" | "contain",
  focalX: number,
): { objectFit: "cover" | "contain"; objectPosition: string } {
  if (fit === "contain") {
    return { objectFit: "contain", objectPosition: "50% 50%" };
  }
  const scale = Math.max(canvasWidth / assetWidth, canvasHeight / assetHeight);
  const overflowX = assetWidth * scale > canvasWidth + 0.5;
  const x = overflowX ? `${(focalX * 100).toFixed(1)}%` : "50%";
  return { objectFit: "cover", objectPosition: `${x} 50%` };
}
```

`packages/video-scene/src/index.ts` 追加一行（与其余 `export *` 同款、字母序）：

```ts
export * from "./media-crop.js";
```

> 执行注记：实现体必须先 diff web 原文件逐行核对（迁移不是重写）；web 侧删除前跑一次 web 测试确认 7 条仍绿（此时 web 旧实现还在）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @acs/video-scene run build && node --test "packages/video-scene/dist/**/*.test.js" 2>&1 | tail -3`
Expected: 137 pass（131 + 6）。

- [ ] **Step 5: web 侧切换再导出**

`apps/web/src/app/video-studio/media-preview.ts`：删除 mediaClipCss 实现块，原位加：

```ts
// P2.5-T4（B2）：mediaClipCss 已南迁 @acs/video-scene（出片与预览单源），
// 此处再导出保持既有 import 面不变（X4）。
export { mediaClipCss } from "@acs/video-scene";
```

`apps/web/src/app/video-studio/media-preview.test.ts`：删除 5 条 mediaClipCss 测试（contain/横溢出/双画幅/竖溢出/同尺寸），保留 2 条 seek 测试（`mediaSeekTargetSec`/`shouldSeekVideo`）；头注释改为「seek 节流纯逻辑（mediaClipCss 已南迁 video-scene）」。

Run: `node --import tsx --test "apps/web/src/app/video-studio/media-preview.test.ts" && pnpm --filter @acs/web run typecheck`
Expected: 2 pass；typecheck 零错（scene-preview.tsx 经再导出仍编译）。

- [ ] **Step 6: 全量回归 + 格式 + 提交**

Run: `pnpm --filter @acs/web test 2>&1 | tail -3` → Expected: 167 pass（172 − 5）。
Run: `npx biome check packages/video-scene/src apps/web/src/app/video-studio/media-preview.ts apps/web/src/app/video-studio/media-preview.test.ts` → clean（必要时 `npx biome check --write <files>`）。

```bash
git add packages/video-scene/src/media-crop.ts packages/video-scene/src/media-crop.test.ts packages/video-scene/src/index.ts apps/web/src/app/video-studio/media-preview.ts apps/web/src/app/video-studio/media-preview.test.ts
git commit -m "feat(video-studio): T4 媒体裁切数学南迁 video-scene（B2 单源，web 再导出）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 2: media-server.mjs（仓内 original 的 http 托管，B1）

**Files:**
- Create: `scripts/video/media-server.mjs`
- Create: `scripts/video/media-server.test.mjs`

**Interfaces:**
- Consumes: 媒体仓布局 `<root>/original/<storeKey>`（media-store store.ts；storeKey 形状 `/^[0-9a-f]{16}\.(mp4|webm|mov)$/`）。
- Produces: CLI `node scripts/video/media-server.mjs --root <媒体仓根> --files <storeKey,…>`；stdout 首行 `{"port":N}`；GET `/original/<storeKey>` → 200（Content-Type 按后缀 + Content-Length + 流式 body）。Task 7 以 `http://127.0.0.1:<port>/original/<storeKey>` 作 OffthreadVideo src。

- [ ] **Step 1: 写失败测试**（`scripts/video/media-server.test.mjs`）

```js
// P2.5-T4 B1：媒体仓 http 托管服务单测。真起子进程 + 127.0.0.1 fetch（本地
// 回环零外网）；白名单/形状门/穿越/畸形编码四路。Content-Type 必须按后缀——
// Remotion 下载器用 contentType 推导资产文件名后缀（B1 注记）。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // scripts/
const WORK = mkdirSync(path.join(tmpdir(), "acs-media-server-"), { recursive: true });
test.after(() => rmSync(WORK, { recursive: true, force: true }));

const KEY_A = "0123456789abcdef.mp4";
const KEY_B = "fedcba9876543210.webm";
const BODY = { [KEY_A]: Buffer.from("mp4-bytes-假"), [KEY_B]: Buffer.from("webm-bytes") };

async function startServer(files) {
  mkdirSync(path.join(WORK, "original"), { recursive: true });
  for (const [key, bytes] of Object.entries(BODY))
    writeFileSync(path.join(WORK, "original", key), bytes);
  const child = spawn(
    process.execPath,
    [path.join(ROOT, "video/media-server.mjs"), "--root", WORK, "--files", files],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const port = await new Promise((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
      const m = /"port":(\d+)/.exec(out);
      if (m) resolve(Number(m[1]));
    });
    child.on("exit", () => reject(new Error(`服务提前退出: ${out}`)));
    setTimeout(() => reject(new Error("端口上报超时")), 10_000).unref?.();
  });
  return { child, base: `http://127.0.0.1:${port}` };
}

test("白名单命中：200 + 后缀 Content-Type + 字节相等（mp4/webm 各一）", async () => {
  const { child, base } = await startServer(`${KEY_A},${KEY_B}`);
  try {
    const mp4 = await fetch(`${base}/original/${KEY_A}`);
    assert.equal(mp4.status, 200);
    assert.equal(mp4.headers.get("content-type"), "video/mp4");
    assert.equal(mp4.headers.get("content-length"), String(BODY[KEY_A].length));
    assert.deepEqual(Buffer.from(await mp4.arrayBuffer()), BODY[KEY_A]);
    const webm = await fetch(`${base}/original/${KEY_B}`);
    assert.equal(webm.headers.get("content-type"), "video/webm");
    assert.deepEqual(Buffer.from(await webm.arrayBuffer()), BODY[KEY_B]);
  } finally {
    child.kill();
  }
});

test("白名单外同仓文件：404（白名单是精确串，目录里有什么不重要）", async () => {
  const { child, base } = await startServer(KEY_A);
  try {
    const res = await fetch(`${base}/original/${KEY_B}`); // 在仓里、不在白名单
    assert.equal(res.status, 404);
    const miss = await fetch(`${base}/original/deadbeefdeadbeef.mov`); // 不在仓
    assert.equal(miss.status, 404);
  } finally {
    child.kill();
  }
});

test("编码穿越：..、%2e%2e、子路径变体全 404（永不触 fs）", async () => {
  const { child, base } = await startServer(KEY_A);
  try {
    for (const p of [
      `/original/%2e%2e/original/${KEY_A}`,
      `/original/..%2fproxy%2fx.mp4`,
      `/original/../original/${KEY_A}`,
      `/foo/original/${KEY_A}`,
      `/original/subdir/${KEY_A}`,
      `/original/${KEY_A}.exe`,
    ]) {
      assert.equal((await fetch(base + p)).status, 404, p);
    }
  } finally {
    child.kill();
  }
});

test("畸形百分号序列：400（decode 失败不落 fs）", async () => {
  const { child, base } = await startServer(KEY_A);
  try {
    const res = await fetch(`${base}/original/%zz`);
    assert.equal(res.status, 400);
  } finally {
    child.kill();
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test scripts/video/media-server.test.mjs 2>&1 | tail -5`
Expected: 全部 FAIL——`media-server.mjs` 不存在（子进程 spawn ENOENT → 「服务提前退出」）。

- [ ] **Step 3: 实现** `scripts/video/media-server.mjs`

```js
#!/usr/bin/env node
// P2.5-T4（spec §1 B1）媒体镜头出片的素材托管服务。Remotion OffthreadVideo
// 的资产下载链 readFile→getClient 只认 http(s)（file:// 抛 Can only download
// URLs starting with http://，与 D2 旁白探针同结论）——原始素材必须本地 HTTP
// 托管。与 narration-server.mjs 同骨架，三处媒体特化：
//   ① 形状门 + 白名单双闸（storeKey regex + original/<storeKey> 精确串）；
//   ② Content-Type 按后缀（Remotion 下载器按 contentType 推导资产文件名后缀）；
//   ③ statSync + createReadStream 流式（original 可达数百 MB，不整读内存）。
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { parseArgs } from "node:util";

const STORE_KEY_PATTERN = /^[0-9a-f]{16}\.(mp4|webm|mov)$/;
const CONTENT_TYPES = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    files: { type: "string" }, // 逗号分隔 storeKey 白名单
  },
});
if (!values.root || !values.files) {
  console.error("用法: node scripts/video/media-server.mjs --root <媒体仓根> --files <storeKey,storeKey,…>");
  process.exit(1);
}
const allowed = new Set(
  values.files.split(",").map((key) => key.trim()).filter(Boolean),
);

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
  } catch {
    res.writeHead(400).end("400 Bad Request"); // 畸形百分号序列，不落 fs
    return;
  }
  // 期望形状 /original/<storeKey>：先形状门再白名单再 fs，任何不匹配一律 404
  // （不区分「不存在/不合法/不在名单」，不给探测方泄露仓结构）。
  const member = pathname.replace(/^\/+/, "");
  const storeKey = member.startsWith("original/")
    ? member.slice("original/".length)
    : null;
  if (!storeKey || !STORE_KEY_PATTERN.test(storeKey) || !allowed.has(storeKey)) {
    res.writeHead(404).end("404 Not Found");
    return;
  }
  const file = path.join(values.root, "original", storeKey);
  if (!existsSync(file)) {
    res.writeHead(404).end("404 Not Found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": CONTENT_TYPES[path.extname(storeKey)] ?? "application/octet-stream",
    "Content-Length": statSync(file).size,
  });
  createReadStream(file).pipe(res);
});
server.listen(0, "127.0.0.1", () => {
  process.stdout.write(`${JSON.stringify({ port: server.address().port })}\n`);
});
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test scripts/video/media-server.test.mjs 2>&1 | tail -3`
Expected: 4 pass。

- [ ] **Step 5: 全量脚本套件 + 提交**

Run: `node --test scripts/video/*.test.mjs 2>&1 | tail -3` → Expected: 66 pass（62 + 4）。
Run: `npx biome check scripts/video/media-server.mjs scripts/video/media-server.test.mjs` → clean。

```bash
git add scripts/video/media-server.mjs scripts/video/media-server.test.mjs
git commit -m "feat(video-studio): T4 媒体仓 http 托管服务（B1 白名单双闸+流式+Content-Type 后缀）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 3: render-scene.media.mjs（装配纯逻辑 G1-G7）

**Files:**
- Create: `scripts/video/render-scene.media.mjs`
- Create: `scripts/video/render-scene.media.test.mjs`

**Interfaces:**
- Consumes: `project.mediaAssets: MediaAsset[]`（types.ts L126-158：`assetId`/`origin`/`original.{sha256,bytes,durationMs,width,height,fps,codec,hasAudio,storeKey}`）；sceneSource `type:"media-clip"`（types.ts L11-21：`mediaAssetId,inMs,outMs,fit,focalX,audio`）；`roundHalfUp`（`@acs/video-document` quantize.ts 导出，经 dist 动态 import，media-ingest.mjs 同款）。
- Produces（Task 7 消费，全部命名精确）：
  - `collectMediaShots(project, mediaAssets) → { entries: MediaShotEntry[], problems: string[] }`
  - `mediaTrimBefore(inMs, fps) → number`
  - `buildTimelineShotMedia(entry, src, fps) → { media: {…} }`（spread 在镜头 props 首键位）
  - `verifyMediaAssets(entries, deps) → Promise<string[]>`（`deps = { storeRoot, existsSync, hashFile }`，hashFile 可返回 Promise——CLI 传流式实现，测试传固定表）
  - `buildHasAudioTrack(narrationEntries, mediaEntries) → boolean`
  - `parseTailYavg(text) → number | null`；`isBlackTail(yavg, threshold=16) → boolean`
  - `buildManifestMedia(entries, timeline, fps) → object[]`；`buildShotAssetDigests(entry) → Record<string,string>`

- [ ] **Step 1: 写失败测试**（`scripts/video/render-scene.media.test.mjs`）

```js
// P2.5-T4 G1-G7 纯装配逻辑单测（不跑 Remotion、零网络）：fs/hash/探针全注入。
// fixture 沿 render-scene.narration.test.mjs 风格：内联最小 project + mediaAssets。
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHasAudioTrack,
  buildManifestMedia,
  buildShotAssetDigests,
  buildTimelineShotMedia,
  collectMediaShots,
  isBlackTail,
  mediaTrimBefore,
  parseTailYavg,
  verifyMediaAssets,
} from "./render-scene.media.mjs";

const FPS = 24;

function mediaAsset(assetId, over = {}) {
  return {
    assetId,
    createdAt: "2026-10-19T00:00:00.000Z",
    origin: { kind: "local-upload", fileName: "clip.mp4" },
    original: {
      sha256: "a".repeat(64),
      bytes: 1000,
      durationMs: 5000,
      width: 1920,
      height: 1080,
      fps: 30,
      codec: "h264",
      hasAudio: true,
      storeKey: `${assetId.slice(0, 16)}.mp4`,
      ...over,
    },
  };
}

function mediaShot(shotId, versionId, mediaAssetId, inMs, outMs, audio = "mute") {
  return {
    shotId,
    order: 0,
    locked: false,
    workingVersionId: versionId,
    contentVersions: [
      {
        versionId,
        createdAt: "2026-10-19T00:00:00.000Z",
        durationMs: outMs - inMs, // C4：durationMs = 出点−入点
        description: "",
        narrationText: "",
        sceneSource: { type: "media-clip", mediaAssetId, inMs, outMs, fit: "cover", focalX: 0.5, audio },
        provenance: { engineId: "planner-rules", engineVersion: "1" },
      },
    ],
    events: [],
  };
}

function specShot(shotId, versionId, durationMs) {
  return {
    shotId,
    order: 1,
    locked: false,
    workingVersionId: versionId,
    contentVersions: [
      {
        versionId,
        createdAt: "2026-10-19T00:00:00.000Z",
        durationMs,
        description: "",
        narrationText: "",
        sceneSource: { type: "spec", spec: { componentId: "x" } },
        provenance: { engineId: "planner-rules", engineVersion: "1" },
      },
    ],
    events: [],
  };
}

const project = (shots) => ({
  schemaVersion: 1,
  id: "p1",
  title: "t",
  brief: { sentence: "s", aspectTargets: ["landscape"] },
  shots,
  renderRecords: [],
  deliveries: [],
  savedVersion: 1,
});

// ── G1 collectMediaShots ─────────────────────────────────────────────

test("G1 装配：media 镜头成 entry（带资产快照），spec 镜头跳过，账本缺失大声报", () => {
  const proj = project([
    specShot("s1", "v1", 2000),
    mediaShot("s2", "v2", "asset-2", 1000, 3000, "keep"),
  ]);
  const { entries, problems } = collectMediaShots(proj, [mediaAsset("asset-2")]);
  assert.deepEqual(problems, []);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].shotIndex, 1);
  assert.equal(entries[0].shotId, "s2");
  assert.equal(entries[0].versionId, "v2");
  assert.equal(entries[0].media.mediaAssetId, "asset-2");
  assert.equal(entries[0].media.inMs, 1000);
  assert.equal(entries[0].asset.storeKey, "asset-2".slice(0, 16) + ".mp4");
  assert.equal(entries[0].asset.sha256, "a".repeat(64));

  const missing = collectMediaShots(project([mediaShot("s2", "v2", "ghost", 0, 2000)]), [mediaAsset("asset-2")]);
  assert.equal(missing.entries.length, 0);
  assert.equal(missing.problems.length, 1);
  assert.match(missing.problems[0], /素材不在账本：ghost/);
});

test("G1 装配：出点超素材时长拒（手改 JSON 的越界兜底）", () => {
  const { problems } = collectMediaShots(
    project([mediaShot("s2", "v2", "asset-2", 0, 6000)]),
    [mediaAsset("asset-2")], // durationMs 5000
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /片段出点 6000ms 超素材时长 5000ms/);
});

// ── B5 trimBefore ────────────────────────────────────────────────────

test("B5 trimBefore：半进位边界（×.488 下取、×.512 上取、整帧精确）", () => {
  assert.equal(mediaTrimBefore(1500, FPS), 36); // 整帧 36.0
  assert.equal(mediaTrimBefore(1562, FPS), 37); // 37.488 → 37
  assert.equal(mediaTrimBefore(1563, FPS), 38); // 37.512 → 38
  assert.equal(mediaTrimBefore(0, FPS), 0);
});

// ── G2 props 装配 ────────────────────────────────────────────────────

test("G2 props：media 键位首序 + 两画幅无差（无合成宽高入 props）+ trimBefore 内嵌", () => {
  const { entries } = collectMediaShots(
    project([mediaShot("s2", "v2", "asset-2", 1000, 3000, "keep")]),
    [mediaAsset("asset-2")],
  );
  const shot = {
    ...buildTimelineShotMedia(entries[0], "http://127.0.0.1:7/original/x.mp4", FPS),
    startFrame: 24,
    frames: 48,
  };
  assert.equal(
    JSON.stringify(shot),
    '{"media":{"src":"http://127.0.0.1:7/original/x.mp4","assetWidth":1920,"assetHeight":1080,"inMs":1000,"outMs":3000,"fit":"cover","focalX":0.5,"audio":"keep","trimBefore":24},"startFrame":24,"frames":48}',
  );
});

// ── G3 仓核验 ────────────────────────────────────────────────────────

test("G3 核验：存在性缺失与 sha 漂移都大声报（含 storeKey 与仓根指路），通过则零问题", async () => {
  const { entries } = collectMediaShots(
    project([mediaShot("s2", "v2", "asset-2", 0, 2000)]),
    [mediaAsset("asset-2")],
  );
  const ok = await verifyMediaAssets(entries, {
    storeRoot: "D:/store",
    existsSync: () => true,
    hashFile: async () => "a".repeat(64),
  });
  assert.deepEqual(ok, []);

  const gone = await verifyMediaAssets(entries, {
    storeRoot: "D:/store",
    existsSync: () => false,
    hashFile: async () => "a".repeat(64),
  });
  assert.match(gone[0], /媒体文件缺失：asset-2.*\.mp4/);
  assert.match(gone[0], /ACS_MEDIA_STORE=D:\\?\D?store|ACS_MEDIA_STORE=D:\/store/);

  const drifted = await verifyMediaAssets(entries, {
    storeRoot: "D:/store",
    existsSync: () => true,
    hashFile: async () => "b".repeat(64),
  });
  assert.match(drifted[0], /素材摘要不符/);
  assert.match(drifted[0], /账本 a{12}… 实测 b{12}…/);
});

test("G3 核验：storeKey 形状异常（账本被手改）也拒绝，不触 fs", async () => {
  const bad = { ...entries0(), asset: { ...entries0().asset, storeKey: "../escape.mp4" } };
  const problems = await verifyMediaAssets([bad], {
    storeRoot: "D:/store",
    existsSync: () => { throw new Error("不该触 fs"); },
    hashFile: async () => "a".repeat(64),
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /storeKey 形状非法/);
  function entries0() {
    return collectMediaShots(
      project([mediaShot("s2", "v2", "asset-2", 0, 2000)]),
      [mediaAsset("asset-2")],
    ).entries[0];
  }
});

// ── G4 aac 四象限 ────────────────────────────────────────────────────

test("G4 音轨判定四象限：仅旁白/仅 keep/keep+旁白/mute 无旁白", () => {
  const keep = collectMediaShots(project([mediaShot("s2", "v2", "a", 0, 2000, "keep")]), [mediaAsset("a")]).entries;
  const mute = collectMediaShots(project([mediaShot("s3", "v3", "a", 0, 2000, "mute")]), [mediaAsset("a")]).entries;
  assert.equal(buildHasAudioTrack([{}], mute), true); // 仅旁白
  assert.equal(buildHasAudioTrack([], keep), true); // 仅媒体 keep
  assert.equal(buildHasAudioTrack([{}], keep), true); // 双有
  assert.equal(buildHasAudioTrack([], mute), false); // 全无
});

// ── B6/G5 末帧黑帧 ───────────────────────────────────────────────────

test("G5 末帧 YAVG 解析：多行取末值、无匹配 null、16 黑 17 非黑", () => {
  const text = "[Parsed_metadata…] yuvavg inactive\nframe:0 pts:0\nYMIN=0 YMAX=255 YAVG=17.5\nYAVG=16.0\n";
  assert.equal(parseTailYavg(text), 16.0);
  assert.equal(parseTailYavg("ffmpeg 挂了没有任何统计行"), null);
  assert.equal(isBlackTail(16), true);
  assert.equal(isBlackTail(16.0), true);
  assert.equal(isBlackTail(17), false);
  assert.equal(isBlackTail(null), false); // 解析失败不误判黑，交调用方大声处理
});

// ── G6/G7 证据 ───────────────────────────────────────────────────────

test("G6 manifest.media：逐镜头证据（sha256+trimBefore+frames 取自帧图 span）", () => {
  const { entries } = collectMediaShots(
    project([mediaShot("s1", "v1", "asset-1", 1000, 3000, "keep")]),
    [mediaAsset("asset-1")],
  );
  const timeline = { shots: [{ shotIndex: 0, startFrame: 0, frames: 48 }], totalFrames: 48 };
  assert.deepEqual(buildManifestMedia(entries, timeline, FPS), [
    {
      shotIndex: 0,
      versionId: "v1",
      mediaAssetId: "asset-1",
      storeKey: "asset-1".slice(0, 16) + ".mp4",
      sha256: "a".repeat(64),
      inMs: 1000,
      outMs: 3000,
      trimBefore: 24,
      frames: 48,
      audio: "keep",
    },
  ]);
});

test("G7 RenderRecord assetDigests：key=mediaAssetId、value=素材 original sha256", () => {
  const { entries } = collectMediaShots(
    project([mediaShot("s1", "v1", "asset-1", 0, 2000)]),
    [mediaAsset("asset-1")],
  );
  assert.deepEqual(buildShotAssetDigests(entries[0]), { "asset-1": "a".repeat(64) });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test scripts/video/render-scene.media.test.mjs 2>&1 | tail -5`
Expected: 全部 FAIL——`Cannot find module '.../render-scene.media.mjs'`。

- [ ] **Step 3: 实现** `scripts/video/render-scene.media.mjs`

```js
// P2.5-T4（spec §2 G1-G7）媒体镜头出片装配纯逻辑：收集/核验/props/证据。
// 依赖全注入（fs/hash），单测零网络零 Remotion；编排由 render-scene.mjs 做。
// roundHalfUp 从 @acs/video-document dist 动态取（scripts 不进 TS 源，
// media-ingest.mjs 同款 pathToFileURL 模式）。
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const { roundHalfUp } = await import(
  pathToFileURL(path.join(ROOT, "packages/video-document/dist/index.js")).href
);

const STORE_KEY_PATTERN = /^[0-9a-f]{16}\.(mp4|webm|mov)$/;

// G1：media 镜头 → entry（含账本资产快照）。问题收集不抛——调用方统一大声拒。
export function collectMediaShots(project, mediaAssets) {
  const entries = [];
  const problems = [];
  for (const [shotIndex, shot] of project.shots.entries()) {
    const version = shot.contentVersions.find(
      (candidate) => candidate.versionId === shot.workingVersionId,
    );
    if (!version || version.sceneSource.type !== "media-clip") continue;
    const media = version.sceneSource;
    const asset = mediaAssets.find((a) => a.assetId === media.mediaAssetId);
    if (!asset) {
      problems.push(`镜头 ${shotIndex + 1} 素材不在账本：${media.mediaAssetId}（mediaAssets 无此 assetId，请先上传或恢复账本）`);
      continue;
    }
    if (media.outMs > asset.original.durationMs) {
      problems.push(`镜头 ${shotIndex + 1} 片段出点 ${media.outMs}ms 超素材时长 ${asset.original.durationMs}ms（媒体镜头时长=出点−入点，出点以素材时长为上限）`);
      continue;
    }
    entries.push({
      shotIndex,
      shotId: shot.shotId,
      versionId: version.versionId,
      durationMs: version.durationMs,
      media: {
        mediaAssetId: media.mediaAssetId,
        inMs: media.inMs,
        outMs: media.outMs,
        fit: media.fit,
        focalX: media.focalX,
        audio: media.audio,
      },
      asset: {
        assetId: asset.assetId,
        storeKey: asset.original.storeKey,
        sha256: asset.original.sha256,
        width: asset.original.width,
        height: asset.original.height,
        fps: asset.original.fps,
        durationMs: asset.original.durationMs,
      },
    });
  }
  return { entries, problems };
}

// B5：源内起始帧 = 半进位（与 quantizeTimeline 同口径），props/manifest 单点计算。
export function mediaTrimBefore(inMs, fps) {
  return roundHalfUp((inMs * fps) / 1000);
}

// G2：镜头 props 的 media 通道。不含合成宽高——裁切在组件内 useVideoConfig 现算，
// props 两画幅逐字节一致（X1 纪律在媒体路径的延续）。
export function buildTimelineShotMedia(entry, src, fps) {
  return {
    media: {
      src,
      assetWidth: entry.asset.width,
      assetHeight: entry.asset.height,
      inMs: entry.media.inMs,
      outMs: entry.media.outMs,
      fit: entry.media.fit,
      focalX: entry.media.focalX,
      audio: entry.media.audio,
      trimBefore: mediaTrimBefore(entry.media.inMs, fps),
    },
  };
}

// G3：渲染前仓核对（仓是事实源、账本 sha 是钉子）。存在性 + sha256 双查；
// hashFile 可异步（CLI 传流式实现）。形状门在 fs 之前（账本被手改也不触盘）。
export async function verifyMediaAssets(entries, deps) {
  const problems = [];
  for (const entry of entries) {
    if (!STORE_KEY_PATTERN.test(entry.asset.storeKey)) {
      problems.push(`storeKey 形状非法：${entry.asset.storeKey}（账本可能被手改，拒绝出片）`);
      continue;
    }
    const file = path.join(deps.storeRoot, "original", entry.asset.storeKey);
    if (!deps.existsSync(file)) {
      problems.push(`媒体文件缺失：${entry.asset.storeKey}（仓根 ACS_MEDIA_STORE=${deps.storeRoot}，请检查媒体仓与项目账本是否同机同步）`);
      continue;
    }
    const sha = await deps.hashFile(file);
    if (sha !== entry.asset.sha256) {
      problems.push(`素材摘要不符：${entry.asset.storeKey} 账本 ${entry.asset.sha256.slice(0, 12)}… 实测 ${sha.slice(0, 12)}…（仓文件被改动，内容寻址被破坏，拒绝出片）`);
    }
  }
  return problems;
}

// G4：aac 存在性判定四象限单点（旁白轨 ∨ 媒体 keep 原声）。
export function buildHasAudioTrack(narrationEntries, mediaEntries) {
  return (
    narrationEntries.length > 0 ||
    mediaEntries.some((entry) => entry.media.audio === "keep")
  );
}

// B6/G5：末帧黑帧检测。signalstats 的 metadata=print 走 stderr、逐帧多行统计，
// 取最后一个 YAVG；无匹配返回 null（调用方对 null 必须大声处理，不静默放行）。
const YAVG_RE = /YAVG=([0-9]+(?:\.[0-9]+)?)/g;
export function parseTailYavg(text) {
  const matches = [...`${text}`.matchAll(YAVG_RE)];
  if (matches.length === 0) return null;
  return Number(matches[matches.length - 1][1]);
}
export function isBlackTail(yavg, threshold = 16) {
  return yavg !== null && yavg <= threshold;
}

// G6：manifest.aspects[aspect].media 逐镜头证据（修订文档 §3 数据流行 5/6）。
export function buildManifestMedia(entries, timeline, fps) {
  return entries.map((entry) => ({
    shotIndex: entry.shotIndex,
    versionId: entry.versionId,
    mediaAssetId: entry.media.mediaAssetId,
    storeKey: entry.asset.storeKey,
    sha256: entry.asset.sha256,
    inMs: entry.media.inMs,
    outMs: entry.media.outMs,
    trimBefore: mediaTrimBefore(entry.media.inMs, fps),
    frames: timeline.shots[entry.shotIndex].frames,
    audio: entry.media.audio,
  }));
}

// G7：RenderRecord.assetDigests（T1 契约字段，T4 首个写入方）。
export function buildShotAssetDigests(entry) {
  return { [entry.media.mediaAssetId]: entry.asset.sha256 };
}
```

> 执行注记：G2 测试的 JSON 精确串就是键序契约（Review Focus #1 的单测锚）——若实现键序不同，测试失败而不是改断言。`verifyMediaAssets` 测试里 storeRoot 断言允许 `D:/store` 与 `D:\store`（path.join 在 win32 产出反斜杠，错误消息里保留原样——实现用 deps.storeRoot 原串拼消息，不 path.join 进文案）。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test scripts/video/render-scene.media.test.mjs 2>&1 | tail -3`
Expected: 12 pass。

- [ ] **Step 5: 全量 + 格式 + 提交**

Run: `node --test scripts/video/*.test.mjs 2>&1 | tail -3` → Expected: 78 pass（66 + 12）。
Run: `npx biome check scripts/video/render-scene.media.mjs scripts/video/render-scene.media.test.mjs` → clean。

```bash
git add scripts/video/render-scene.media.mjs scripts/video/render-scene.media.test.mjs
git commit -m "feat(video-studio): T4 媒体镜头出片装配纯逻辑（G1-G7 注入式单测 12 条）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 4: tts-sse 时长对齐排除媒体镜头（A1）

**Files:**
- Modify: `scripts/video/tts-sse.mjs:280-299`（planDurationAlignments 返回 `{plan, skipped}`，media-clip 溢出进 skipped）
- Modify: `scripts/video/tts-narration.mjs:202-210`（解构新形状 + skipped 提示）
- Test: `scripts/video/tts-sse.test.mjs`（改 331-370 现有断言 + 新增 2 条）

**Interfaces:**
- Consumes: 现有 `planDurationAlignments(project, wavMsByBase)` 语义（wav 实测超 `version.durationMs` 才入 plan；`newDurationMs = Math.ceil(wavMs+50)`）。
- Produces: `planDurationAlignments(project, wavMsByBase) → { plan: AlignmentPlanItem[], skipped: { shotIndex, shotId, versionId, wavMs, durationMs }[] }`——媒体镜头永不拉伸（C4：durationMs=outMs−inMs 对账不变量，拉伸即破坏账本）。

- [ ] **Step 1: 改现有测试 + 写失败测试**

`tts-sse.test.mjs` 331-370 那条改为解构（其余断言不动）：

```js
  const { plan, skipped } = planDurationAlignments(project, overflow);
  assert.equal(skipped.length, 0, "纯 spec 项目无跳过");
  assert.equal(plan.length, 1, "只报超出版本时长的镜头");
  // ……（356-361 行原断言保持）
  assert.equal(planDurationAlignments(project, edge).plan.length, 0);
  assert.equal(planDurationAlignments(project, new Map()).plan.length, 0);
```

紧随其后新增两条：

```js
// P2.5-T4（A1）：媒体镜头时长=出点−入点（C4 对账不变量），TTS 自动拉伸会写坏
// 账本——溢出改进 skipped，调用方提示走 --allow-truncate，不写新版本。
test("planDurationAlignments：媒体镜头溢出跳过对齐进 skipped，plan 不收", () => {
  const project = {
    shots: [
      {
        shotId: "m1",
        workingVersionId: "v1",
        contentVersions: [
          {
            versionId: "v1",
            durationMs: 2000,
            narrationText: "实拍。",
            sceneSource: {
              type: "media-clip",
              mediaAssetId: "a1",
              inMs: 0,
              outMs: 2000,
              fit: "cover",
              focalX: 0.5,
              audio: "mute",
            },
          },
        ],
      },
      {
        shotId: "s1",
        workingVersionId: "v2",
        contentVersions: [
          { versionId: "v2", durationMs: 2000, narrationText: "图表。" },
        ],
      },
    ],
  };
  const { plan, skipped } = planDurationAlignments(
    project,
    new Map([
      ["m1-v1", 2640],
      ["s1-v2", 2640],
    ]),
  );
  assert.equal(plan.length, 1, "spec 镜头照常对齐");
  assert.equal(plan[0].shotId, "s1");
  assert.equal(skipped.length, 1, "媒体镜头只提示不对齐");
  assert.deepEqual(skipped[0], {
    shotIndex: 0,
    shotId: "m1",
    versionId: "v1",
    wavMs: 2640,
    durationMs: 2000,
  });
});

test("planDurationAlignments：媒体镜头未溢出则 plan/skipped 两不进", () => {
  const project = {
    shots: [
      {
        shotId: "m1",
        workingVersionId: "v1",
        contentVersions: [
          {
            versionId: "v1",
            durationMs: 3000,
            narrationText: "实拍。",
            sceneSource: {
              type: "media-clip",
              mediaAssetId: "a1",
              inMs: 0,
              outMs: 3000,
              fit: "cover",
              focalX: 0.5,
              audio: "mute",
            },
          },
        ],
      },
    ],
  };
  const { plan, skipped } = planDurationAlignments(project, new Map([["m1-v1", 1500]]));
  assert.equal(plan.length, 0);
  assert.equal(skipped.length, 0);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test scripts/video/tts-sse.test.mjs 2>&1 | tail -6`
Expected: 新两条 FAIL（现实现把媒体镜头也塞进 plan：`plan.length` 1≠… 且返回数组解构 skipped undefined）；改写后的旧测试 FAIL（`planDurationAlignments(...)` 返回数组，`.plan` undefined）。若旧测试居然过了，说明改写未生效，回去改。

- [ ] **Step 3: 实现**——`tts-sse.mjs` planDurationAlignments 函数体替换为（保持既有 plan 项字段集 shotIndex/shotId/versionId/oldDurationMs/wavMs/newDurationMs 不变）：

```js
// P2.5-T4（A1）：媒体镜头（sceneSource=media-clip）时长=出点−入点（C4 对账
// 不变量），自动拉伸 durationMs 会写坏账本——溢出进 skipped 交调用方提示，
// 渲染期截断由 --allow-truncate 显式选择。
export function planDurationAlignments(project, wavMsByBase) {
  const plan = [];
  const skipped = [];
  for (const [shotIndex, shot] of project.shots.entries()) {
    const version = shot.contentVersions.find(
      (candidate) => candidate.versionId === shot.workingVersionId,
    );
    if (!version) continue;
    const wavMs = wavMsByBase.get(`${shot.shotId}-${version.versionId}`);
    if (wavMs === undefined || wavMs + 50 <= version.durationMs) continue;
    if (version.sceneSource.type === "media-clip") {
      skipped.push({
        shotIndex,
        shotId: shot.shotId,
        versionId: version.versionId,
        wavMs,
        durationMs: version.durationMs,
      });
      continue;
    }
    plan.push({
      shotIndex,
      shotId: shot.shotId,
      versionId: version.versionId,
      oldDurationMs: version.durationMs,
      wavMs,
      newDurationMs: Math.ceil(wavMs + 50),
    });
  }
  return { plan, skipped };
}
```

> 执行注记：先 diff 函数现状（280-299），保持循环骨架与既有字段序（上方即目标态；若现状 guard 写法不同，以目标语义最小改写）。

`tts-narration.mjs:202` 调用点改：

```js
const { plan: alignments, skipped: alignmentSkipped } = planDurationAlignments(
  project,
  wavMsByBase,
);
for (const item of alignmentSkipped) {
  console.warn(
    `[tts-narration] 镜头 ${item.shotIndex + 1} 是媒体镜头（时长=出点−入点，不可自动拉伸），旁白 ${item.wavMs}ms 超片段 ${item.durationMs}ms，保留截断（渲染期需 --allow-truncate）`,
  );
}
```

（后续 `if (alignments.length > 0)` 起全部不动——对齐写版本逻辑仅 spec 镜头可达。）

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test scripts/video/tts-sse.test.mjs 2>&1 | tail -3 && node --test scripts/video/tts-narration.test.mjs 2>&1 | tail -3`
Expected: tts-sse 全绿（含新 2 条）；tts-narration 现有全绿（调用点兼容）。

- [ ] **Step 5: 全量 + 格式 + 提交**

Run: `node --test scripts/video/*.test.mjs 2>&1 | tail -3` → Expected: 80 pass（78 + 2）。
Run: `npx biome check scripts/video/tts-sse.mjs scripts/video/tts-sse.test.mjs scripts/video/tts-narration.mjs` → clean。

```bash
git add scripts/video/tts-sse.mjs scripts/video/tts-sse.test.mjs scripts/video/tts-narration.mjs
git commit -m "feat(video-studio): T4 TTS 时长对齐排除媒体镜头（A1：C4 不可拉伸，溢出进 skipped 提示）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 5: frame-dryrun 混编语义（D1）

**Files:**
- Modify: `scripts/video/frame-dryrun.mjs:95-131`（buildProjectDryRunJobs）
- Test: `scripts/video/frame-dryrun.test.mjs`（追加 2 条；现有 4 条 dryRunJobs 测试不动）

**Interfaces:**
- Consumes: `buildProjectDryRunJobs(project) → { jobs, timeline }`（render-scene.mjs:258 已按 `const { jobs } = ...` 解构——返回形状保持）。
- Produces: 同名同形返回，语义变化——量化覆盖全部镜头（帧保真：媒体镜头占位帧数一致），jobs 只为 spec span 生成；全媒体项目返回 `{jobs: [], timeline}` 合法（render-scene 干跑 0 作业直接通过）；第三类 sceneSource（未来）仍大声抛错。

- [ ] **Step 1: 写失败测试**（追加到 frame-dryrun.test.mjs 末尾；头部补 import）

```js
// P2.5-T4（D1）：混编项目干跑语义——帧图量化覆盖全部镜头，spec 干跑作业只给
// spec span；全媒体项目空 jobs 合法（媒体渲染路径在 render-scene，无需干跑）。
import { buildProjectDryRunJobs } from "./frame-dryrun.mjs";

function workingShot(shotId, versionId, durationMs, sceneSource) {
  return {
    shotId,
    order: 0,
    locked: false,
    workingVersionId: versionId,
    contentVersions: [
      {
        versionId,
        createdAt: "2026-10-19T00:00:00.000Z",
        durationMs,
        description: "",
        narrationText: "",
        sceneSource,
        provenance: { engineId: "planner-rules", engineVersion: "1" },
      },
    ],
    events: [],
  };
}

const SPEC = { type: "spec", spec: { componentId: "poster-title" } };
const MEDIA = {
  type: "media-clip",
  mediaAssetId: "a1",
  inMs: 0,
  outMs: 2000,
  fit: "cover",
  focalX: 0.5,
  audio: "mute",
};

const dryProject = (shots) => ({
  schemaVersion: 1,
  id: "p1",
  title: "t",
  brief: { sentence: "s", aspectTargets: ["landscape"] },
  shots,
  renderRecords: [],
  deliveries: [],
  savedVersion: 1,
});

test("干跑装配：spec+media 混编——量化覆盖全部镜头（72 帧），作业只给 spec span", () => {
  const { jobs, timeline } = buildProjectDryRunJobs(
    dryProject([
      workingShot("s1", "v1", 1000, SPEC),
      workingShot("s2", "v2", 2000, MEDIA),
    ]),
  );
  assert.equal(timeline.totalFrames, 72, "1000ms+2000ms @24fps = 24+48");
  assert.equal(jobs.length, 1, "媒体镜头不出 spec 干跑作业");
  assert.equal(jobs[0].frames, 24);
  assert.match(jobs[0].label, /镜头 1/);
});

test("干跑装配：全媒体项目空 jobs 合法返回（不抛），未知 sceneSource 类型仍抛", () => {
  const all = buildProjectDryRunJobs(dryProject([workingShot("m1", "v1", 2000, MEDIA)]));
  assert.deepEqual(all.jobs, []);
  assert.equal(all.timeline.totalFrames, 48);
  assert.throws(
    () =>
      buildProjectDryRunJobs(
        dryProject([workingShot("x1", "v1", 1000, { type: "未来类型" })]),
      ),
    /既非 spec 也非 media-clip/,
  );
});
```

（import 语句合并进文件头现有 import 块。）

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test scripts/video/frame-dryrun.test.mjs 2>&1 | tail -5`
Expected: 新两条 FAIL——现实现对 MEDIA shot 抛「镜头 N 的 sceneSource 不是 spec」。

- [ ] **Step 3: 实现**——`frame-dryrun.mjs` `buildProjectDryRunJobs` 改为（保留 working-version 查找与 `entries.length === 0` 抛错；量化改全量；作业生成改 spec-only）：

```js
// P2.5-T4（D1）：帧图量化覆盖全部镜头（帧保真——媒体镜头占位帧数与出片一致），
// 干跑作业只给 spec span（媒体渲染在 render-scene 走 OffthreadVideo，无需 spec
// 干跑）；全媒体项目 → 空 jobs 合法。未知类型大声抛错（未来通道接入时显式改）。
export function buildProjectDryRunJobs(project) {
  const entries = project.shots.map((shot, index) => {
    const version = shot.contentVersions.find(
      (candidate) => candidate.versionId === shot.workingVersionId,
    );
    if (!version) throw new Error(`镜头 ${index + 1} 缺少 working version`);
    return version;
  });
  if (entries.length === 0) throw new Error("项目没有镜头，无法干跑");
  const timeline = quantizeTimeline(
    entries.map((version) => version.durationMs),
    FPS,
  );
  const jobs = [];
  for (const span of timeline.shots) {
    const version = entries[span.shotIndex];
    if (version.sceneSource.type === "spec") {
      jobs.push({
        label: `镜头 ${span.shotIndex + 1}`,
        frames: span.frames,
        moduleUrl: SPEC_FRAME_RENDERER_URL,
        fn: "renderSpecFrame",
        args: {
          spec: version.sceneSource.spec,
          fps: FPS,
          durationFrames: span.frames,
          width: 1280,
          height: 720,
        },
      });
    } else if (version.sceneSource.type !== "media-clip") {
      throw new Error(`镜头 ${span.shotIndex + 1} 的 sceneSource 既非 spec 也非 media-clip`);
    }
  }
  return { jobs, timeline };
}
```

> 执行注记：以现状 95-131 行为准最小改写（现状在量化前逐镜头验 spec 并抛错——那段挪成上面的类型分派）；CLI 尾部若有「jobs 为空」的独立报错路径，改为打印 `干跑 0 作业（全部为媒体镜头）` 后正常退出。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test scripts/video/frame-dryrun.test.mjs 2>&1 | tail -3`
Expected: 6 pass（4 旧 + 2 新）。

- [ ] **Step 5: 全量 + 提交**

Run: `node --test scripts/video/*.test.mjs 2>&1 | tail -3` → Expected: 82 pass（80 + 2）。
Run: `npx biome check scripts/video/frame-dryrun.mjs scripts/video/frame-dryrun.test.mjs` → clean。

```bash
git add scripts/video/frame-dryrun.mjs scripts/video/frame-dryrun.test.mjs
git commit -m "feat(video-studio): T4 干跑混编语义（D1：量化全镜头、作业限 spec、全媒空载合法）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 6: 引擎媒体通道（E1-E3）

**Files:**
- Modify: `packages/remotion-engine/src/scene-spec-composition.tsx:103-113`（类型）、`122-221`（TimelineScene 渲染分支 + MediaClipLayer）
- 验证：typecheck + `pnpm --filter @acs/remotion-engine run build` + 全量套件（组件不单测，house style）

**Interfaces:**
- Consumes: `mediaClipCss`（Task 1 的 `@acs/video-scene` 导出）；`Sequence`/`OffthreadVideo`（remotion 包，零新依赖）；Task 3 的 props 形状（`buildTimelineShotMedia` 的 media 对象）。
- Produces: `TimelineShotProps = { spec?: SceneSpec; media?: TimelineMediaProps; startFrame; frames; narration?; subtitles? }`（spec 与 media 互斥，C4）；`TimelineMediaProps` 新导出类型（Task 7 的 props 由装配层生成同形 JSON）。

- [ ] **Step 1: 类型扩展**（103-113 行替换）

```ts
// P2.5-T4（spec §2 E1）：媒体镜头通道。spec 与 media 互斥（C4：media-clip 版本
// 不带 spec params）——spec-only 项目 props 逐字节不变（X1），媒体镜头才出现
// media 键。trimBefore = B5 半进位取整后的源内起始帧（装配层算好）。
export type TimelineMediaProps = {
  src: string; // http://127.0.0.1:<port>/original/<storeKey>（媒体仓托管，B1）
  assetWidth: number; // 素材原始尺寸——裁切用 useVideoConfig 合成宽高现算，
  assetHeight: number; // props 不含画幅参数，两画幅逐字节一致（G2）
  inMs: number;
  outMs: number;
  fit: "cover" | "contain";
  focalX: number;
  audio: "mute" | "keep"; // keep = 原声与旁白轨由 Remotion 音频管线自动混音（B4）
  trimBefore: number;
};

export type TimelineShotProps = {
  spec?: SceneSpec;
  media?: TimelineMediaProps;
  startFrame: number;
  frames: number;
  // D2：镜头旁白音轨。audioSrc 由装配方给绝对路径（CLI 渲染）；
  // 无 narration 的镜头不出 Sequence，画面与既有渲染逐字节一致。
  narration?: { audioSrc: string };
  // P1 字幕轨（spec R3）：cues 为镜头本地时间（音频从镜头起点播，同口径）。
  // 缺省不渲染字幕分支——输出与 D2 现状逐字节一致（帧确定性纪律）。
  subtitles?: { cues: SubtitleCue[] };
};
```

- [ ] **Step 2: MediaClipLayer 组件 + 渲染分支**（122 行 TimelineScene 前插入组件；179-185 行 renderSpecLayer 调用改三分支）

```tsx
// P2.5-T4（E2/E3）：媒体镜头渲染层。Sequence 包裹让 OffthreadVideo 内部的
// useCurrentFrame 取到镜头本地帧（与旁白轨同款定位），trimBefore 定源内起始帧，
// span 的 durationInFrames 天然界定播出帧数（无 trimAfter——播满即止）。
// muted 吃 audio 通道（B4：keep 时原声与旁白 Sequence 由 Remotion 自动混音）。
// 裁切对象（objectFit/objectPosition）来自 video-scene 单源 mediaClipCss，
// 画幅宽高 useVideoConfig 现算——两画幅共用同一份 props。
const MediaClipLayer: FC<{ shot: TimelineShotProps }> = ({ shot }) => {
  const media = shot.media!;
  const { width, height } = useVideoConfig();
  const crop = mediaClipCss(
    media.assetWidth,
    media.assetHeight,
    width,
    height,
    media.fit,
    media.focalX,
  );
  return (
    <Sequence from={shot.startFrame} durationInFrames={shot.frames}>
      <OffthreadVideo
        src={media.src}
        muted={media.audio === "mute"}
        trimBefore={media.trimBefore}
        style={{
          width: "100%",
          height: "100%",
          objectFit: crop.objectFit,
          objectPosition: crop.objectPosition,
        }}
      />
    </Sequence>
  );
};
```

render 分支（原 179-185）：

```tsx
      {active.media ? (
        <MediaClipLayer shot={active} />
      ) : (
        renderSpecLayer(active.spec!, {
          frame: frame - active.startFrame,
          fps,
          durationFrames: active.frames,
          width,
          height,
        })
      )}
```

（`active.spec!` 的非空断言与 narration 同款合法：三分支互斥保证 media 缺席时 spec 必在——C4。）

import 行补：`OffthreadVideo` 进 remotion 具名导入；`mediaClipCss` 进 `@acs/video-scene` 具名导入（按 biome 排序）。

- [ ] **Step 3: 验证（无单测——组件层，typecheck + 构建兜底）**

Run: `pnpm --filter @acs/remotion-engine run typecheck && pnpm --filter @acs/remotion-engine run build`
Expected: 零错。（若 typecheck 脚本不存在则 build 即验证——build 含 tsc。）

Run: `node --test "packages/video-scene/dist/**/*.test.js" 2>&1 | tail -3`
Expected: 137 pass（Task 1 基线不受引擎改动影响）。

- [ ] **Step 4: 提交**

```bash
git add packages/remotion-engine/src/scene-spec-composition.tsx
git commit -m "feat(video-studio): T4 引擎媒体通道（E1-E3：OffthreadVideo+Sequence 本地帧+单源裁切）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 7: render-scene.mjs 编排接线

**Files:**
- Modify: `scripts/video/render-scene.mjs`（多处，下述精确锚点）
- 验证：`node --test scripts/video/*.test.mjs`（82 pass 不动——CLI 无新单测）+ Task 8 冒烟

**Interfaces:**
- Consumes: Task 2 media-server、Task 3 全部装配函数、Task 6 props 形状、Task 5 混编干跑、`resolveStoreRoot`（`@acs/media-store` dist，pathToFileURL 模式）。
- Produces: 出片成功判定扩展（末帧黑帧 + aac 四象限 + 媒体仓核验前置）；manifest.aspects[aspect].media 与 RenderRecord.assetDigests 证据写入；spec-only 项目输出逐字节恒等（Task 8 A1 复跑证明）。

> 本任务无 TDD 单测（编排层，spawn/子进程/ffmpeg 依赖），门禁正确性由 Task 3 纯逻辑单测 + Task 8 冒烟/反证承担——house style（render-scene.mjs 既有逻辑同例）。

- [ ] **Step 1: 门禁放宽与媒体装配（125-151 区域）**

shotEntries 分派改（125-143）：

```js
const shotEntries = project.shots.map((shot, index) => {
  const version = shot.contentVersions.find(
    (candidate) => candidate.versionId === shot.workingVersionId,
  );
  if (!version) fail(`镜头 ${index + 1} 缺少 working version`);
  if (version.sceneSource.type === "spec") {
    let spec;
    try {
      spec = validateSceneSpec(version.sceneSource.spec, defaultRegistry);
    } catch (error) {
      fail(`镜头 ${index + 1} scene_spec 校验失败: ${error.message}`);
    }
    if (spec.durationMs !== version.durationMs)
      fail(
        `镜头 ${index + 1} spec.durationMs(${spec.durationMs}) 与 ContentVersion.durationMs(${version.durationMs}) 不一致`,
      );
    return { shot, version, spec };
  }
  if (version.sceneSource.type === "media-clip") {
    // P2.5-T4：媒体镜头不验 spec（无 params），资产核验在下方 G3 块统一做
    return { shot, version, media: version.sceneSource };
  }
  fail(`镜头 ${index + 1} 的 sceneSource 既非 spec 也非 media-clip（出片仅支持这两种）`);
});
```

量化块（147-151）之后插入（G1/G3）：

```js
// P2.5-T4 G1/G3：媒体镜头装配 + 渲染前仓核验（账本→仓：存在性 + sha256 双查；
// 任何问题大声拒——不 spawn 服务、不渲染、不写 RenderRecord，修订文档 §3 行 6）。
const { entries: mediaShots, problems: mediaProblems } = collectMediaShots(
  project,
  project.mediaAssets ?? [],
);
if (mediaProblems.length > 0)
  fail(`媒体镜头装配失败，拒绝渲染：\n  ${mediaProblems.join("\n  ")}`);
const mediaStoreRoot = resolveStoreRoot();
const verifyProblems = await verifyMediaAssets(mediaShots, {
  storeRoot: mediaStoreRoot,
  existsSync,
  hashFile: sha256File,
});
if (verifyProblems.length > 0)
  fail(`媒体仓核验失败，拒绝渲染（不写 RenderRecord）：\n  ${verifyProblems.join("\n  ")}`);
const mediaByShot = new Map(mediaShots.map((entry) => [entry.shotIndex, entry]));
```

import 头补：`collectMediaShots, verifyMediaAssets, buildTimelineShotMedia, buildManifestMedia, buildShotAssetDigests, buildHasAudioTrack, parseTailYavg, isBlackTail`（from `"./render-scene.media.mjs"`）；`createReadStream`（node:fs）；`resolveStoreRoot` 经 dist 动态 import（media-ingest.mjs 同款——文件头部 import 区加）：

```js
const { resolveStoreRoot } = await import(
  pathToFileURL(path.join(ROOT, "packages/media-store/dist/index.js")).href
);
```

流式 sha256 帮助函数（放在文件既有 `sha256` 帮助函数旁）：

```js
// P2.5-T4 G3：大文件流式 sha256（original 可达数百 MB，不整读内存）。
async function sha256File(file) {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}
```

- [ ] **Step 2: 媒体服务 spawn（旁白服务块 243 行之后）**

端口等待逻辑提为共体（旁白块 211-238 的 Promise 逻辑原样搬入函数，两处调用；行为零变化——A1 复跑兜底）：

```js
// P2.5-T4：文件服务端口等待共体（旁白/媒体两用；10s 超时 + 提前退出竞速 +
// 定时器清理——自 D2 旁白块原样提取，行为零变化）。
async function awaitServerPort(serverProcess, label) {
  let output = "";
  serverProcess.stdout.on("data", (chunk) => {
    output += chunk;
  });
  const serverDead = new Promise((_, reject) => {
    serverProcess.on("exit", () => reject(new Error(`${label}提前退出: ${output}`)));
  });
  let portTimer;
  const portLine = new Promise((resolve, reject) => {
    serverProcess.stdout.on("data", function onChunk(chunk) {
      const match = /"port":(\d+)/.exec(`${chunk}`);
      if (match) {
        serverProcess.stdout.off("data", onChunk);
        resolve(Number(match[1]));
      }
    });
    portTimer = setTimeout(() => reject(new Error(`${label}端口上报超时`)), 10000);
  });
  return await Promise.race([portLine, serverDead]).finally(() =>
    clearTimeout(portTimer),
  );
}
```

旁白块改调用 `const port = await awaitServerPort(narrationServer, "narration-server");`（删原 211-238 内联版）。随后新增媒体块：

```js
// P2.5-T4（B1）：媒体仓托管服务——OffthreadVideo 资产下载链只认 http(s)。
// 与旁白服务同生命周期纪律：exit 钩子兜杀（幂等 kill），白名单只放行本片
// 涉及的 storeKey（去重）。
let mediaServer = null;
let mediaUrlBase = null;
if (mediaShots.length > 0) {
  mediaServer = spawn(
    process.execPath,
    [
      path.join(ROOT, "scripts/video/media-server.mjs"),
      "--root",
      mediaStoreRoot,
      "--files",
      [...new Set(mediaShots.map((entry) => entry.asset.storeKey))].join(","),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  process.on("exit", () => mediaServer?.kill());
  const mediaPort = await awaitServerPort(mediaServer, "media-server");
  mediaUrlBase = `http://127.0.0.1:${mediaPort}`;
  console.log(
    `[render-scene] 媒体镜头 ${mediaShots.length}/${timeline.shots.length}（仓 ${mediaStoreRoot}，端口 ${mediaPort}）`,
  );
}
```

- [ ] **Step 3: timelineProps 装配（317-329）**

return 对象首键改条件展开（spec 路径键序字节不变，X1）：

```js
    const entry = shotEntries[span.shotIndex];
    return {
      ...(mediaByShot.has(span.shotIndex)
        ? buildTimelineShotMedia(
            mediaByShot.get(span.shotIndex),
            `${mediaUrlBase}/original/${mediaByShot.get(span.shotIndex).asset.storeKey}`,
            FPS,
          )
        : { spec: entry.spec }),
      startFrame: span.startFrame,
      frames: span.frames,
      ...(narrationByShot.has(span.shotIndex)
        ? {
            narration: {
              audioSrc: narrationByShot.get(span.shotIndex).propsSrc,
            },
          }
        : {}),
      ...subtitlesBlock,
    };
```

- [ ] **Step 4: 渲染旗标与门禁（358-436 区域）**

`--disable-web-security` 条件（377 行附近）改：`narrationEntries.length > 0 || mediaShots.length > 0`（G8：有旁白或有媒体即加——媒体虽走服务端下载，放宽无代价，spec §2 G8 裁定）。

视频 ffprobe 门禁之后、aac 门禁（416 行）之前插入末帧黑帧检测（B6/G5，对**所有**渲染生效）：

```js
  // P2.5-T4（B6/G5）：末帧黑帧检测——所有渲染（纯 spec 亦然）。signalstats 的
  // YAVG ≤16 判黑（transitions e2e 实测纯黑=16，内容帧 220+）。黑帧 = 装配/时长
  // 事故，大声拒收（此时 mp4 已写但 RenderRecord 未写——失败语义见修订文档
  // §3 行 6「退出码 0 ≠ 成功」的反向：这里让失败真的以非 0 退出）。
  const tail = spawnSync(
    "ffmpeg",
    [
      "-sseof", "-0.2", "-i", videoPath, "-frames:v", "1",
      "-vf", "signalstats,metadata=print", "-f", "null", "-",
    ],
    { encoding: "utf8" },
  );
  const tailYavg = parseTailYavg(`${tail.stdout}${tail.stderr}`);
  if (tailYavg === null)
    fail(`${aspect}.mp4 末帧黑帧检测失败：无法解析 YAVG（ffmpeg status=${tail.status}）`);
  console.log(`[render-scene] ${aspect}.mp4 末帧 YAVG=${tailYavg}`);
  if (isBlackTail(tailYavg))
    fail(`${aspect}.mp4 末帧为黑帧（YAVG=${tailYavg}）：疑似镜头装配/时长事故，拒绝收片`);
```

aac 门禁条件（416 行）改：`if (buildHasAudioTrack(narrationEntries, mediaShots)) {`（G4 四象限；体内探针与报错不动）。

- [ ] **Step 5: manifest 与 RenderRecord（438-497 区域）**

frameMap 的 componentId（450 行）改：

```js
      componentId: shotEntries[span.shotIndex].media
        ? "media-clip"
        : shotEntries[span.shotIndex].spec.componentId,
```

narration 证据块之后（470 行 subtitleCues 前后同段）加 media 证据：

```js
    // P2.5-T4（G6）：媒体镜头逐条证据（素材指纹/入出点/源内起始帧/原声通道）
    ...(mediaShots.length > 0
      ? { media: buildManifestMedia(mediaShots, timeline, FPS) }
      : {}),
```

RenderRecord 循环内（481-496）加 assetDigests（G7，媒体镜头专属键）：

```js
    project.renderRecords.push({
      renderId: randomUUID(),
      versionId: entry.version.versionId,
      contentDigest: contentDigests[span.shotIndex],
      ...(entry.media
        ? { assetDigests: buildShotAssetDigests(mediaByShot.get(span.shotIndex)) }
        : {}),
      engineId: "remotion",
      // ……其余字段不动
```

（`entry` 已是循环内既有变量名——与现状 480 行一致。）

收尾 kill（501 行）补：`if (mediaServer) mediaServer.kill();`。

- [ ] **Step 6: 验证 + 提交**

Run: `node --test scripts/video/*.test.mjs 2>&1 | tail -3` → Expected: 82 pass（编排层无新单测，既有全绿）。
Run: `node --check scripts/video/render-scene.mjs && npx biome check scripts/video/render-scene.mjs` → 语法零错 + clean。

```bash
git add scripts/video/render-scene.mjs
git commit -m "feat(video-studio): T4 render-scene 媒体出片编排（G1-G8 接线：双服务/黑帧门禁/证据回写）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 8: 冒烟 + A1 金标准复跑（零计费）

**Files:**
- Create: `artifacts/video-studio-media-render/`（证据目录，git-ignored 或按仓现状不入库——媒体不入库约定）
- 验证：真实 render-scene 全链路（唯一一次真渲染，本刀无 e2e 脚本改动）

**Interfaces:**
- Consumes: Task 1-7 全部产物；`scripts/video/media-ingest.mjs`（`--file <path> --store <abs> --no-proxy`，stdout JSON 给 storeKey/probe 结果）；`artifacts/video-studio-map/e2e.video-project.json`（现存 spec 镜头样本，拷贝不改动原件）；`scripts/video/frame-compare.mjs` 的 `decodeFrameHash`（解码帧哈希）。
- Produces: 证据四件——成功出片 mp4×2 画幅 + render-manifest.json（含 media 证据）+ 双跑解码帧哈希相等表 + mute 反证（无音频流）+ A1 金标准 contentDigest 不变。

- [ ] **Step 1: 素材与项目准备（全部本地 ffmpeg，零计费）**

```bash
EVID=artifacts/video-studio-media-render
mkdir -p $EVID/store $EVID/narr $EVID/a1
# 3s 有声素材（audio=keep 出 aac 才有反证意义）
ffmpeg -y -f lavfi -i testsrc2=size=1280x720:rate=30 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 3 -c:v libx264 -pix_fmt yuv420p -c:a aac $EVID/clip.mp4
# 入仓（--store 独立临时仓，不动默认仓）
node scripts/video/media-ingest.mjs --file $EVID/clip.mp4 --store "$(pwd)/$EVID/store" --no-proxy   # 记下 stdout JSON 的 storeKey/sha256/width/height/fps/durationMs
# 假旁白（正弦 wav，1.6s，命名对齐 s1-v1.wav；零 DashScope）
ffmpeg -y -f lavfi -i sine=frequency=660:sample_rate=48000 -t 1.6 $EVID/narr/s1-v1.wav
```

项目 JSON（`$EVID/smoke.video-project.json`）：拷 `artifacts/video-studio-map/e2e.video-project.json` 为底——保留镜头 1 的 spec 作 s1（旁白挂它），追加镜头 2 为 media-clip 版本（inMs 500、outMs 2500、fit cover、focalX 0.3、audio keep；durationMs=2000），`mediaAssets` 账本按 ingest stdout 写入（assetId 任取 uuid、original 全字段照抄）；`aspectTargets: ["landscape","portrait"]`。手工编辑后跑 `node --input-type=module -e "…validate…"` 或直接靠 render-scene 第 1 步校验（validateVideoProject 拦形状错）。

- [ ] **Step 2: 成功路径渲染**

```bash
node scripts/video/render-scene.mjs --project $EVID/smoke.video-project.json --out $EVID/out --narration $EVID/narr
echo "exit=$?"
```

Expected: exit=0；日志含 `媒体镜头 1/2`、双画幅 `末帧 YAVG=<远大于16>`、aac 门禁通过；`$EVID/out/{landscape,portrait}.mp4` 存在且 ffprobe 1280×720 / 720×1280、24fps、总帧数=量化帧图；`render-manifest.json` 的两画幅各含 `media:[{…trimBefore:12(500ms@24fps 半进位=12), frames:48, audio:"keep"}]`；项目文件 RenderRecords 追加 4 条（2 镜头×2 画幅），媒体镜头条目带 `assetDigests`。

- [ ] **Step 3: 双跑确定性（解码帧相等，非容器字节——端口在 props 里逐跑不同）**

```bash
node scripts/video/render-scene.mjs --project $EVID/smoke.video-project.json --out $EVID/out2 --narration $EVID/narr
for a in landscape portrait; do
  for n in 0 30 71; do
    ffmpeg -y -v error -i $EVID/out/$a.mp4 -vf "select=eq(n\\,$n)" -vsync 0 -frames:v 1 $EVID/f1.png
    ffmpeg -y -v error -i $EVID/out2/$a.mp4 -vf "select=eq(n\\,$n)" -vsync 0 -frames:v 1 $EVID/f2.png
    node --input-type=module -e "import{decodeFrameHash}from'./scripts/video/frame-compare.mjs';const a=await decodeFrameHash(process.argv[1]),b=await decodeFrameHash(process.argv[2]);if(a!==b){console.error('MISMATCH',process.argv[3],a,b);process.exit(1)}console.log('EQ',process.argv[3],a.slice(0,12))" $EVID/f1.png $EVID/f2.png "$a#$n"
  done
done
```

Expected: 6 行 EQ（首帧/中段/末帧 × 两画幅解码帧哈希相等）。

- [ ] **Step 4: 反证两路（失败语义 + aac 反向象限）**

```bash
# ① 仓漂移：移走仓文件 → 退出码≠0 且项目文件不被回写（G3）
sha_before=$(sha256sum $EVID/smoke.video-project.json | cut -d' ' -f1)
mv $EVID/store/original/<storeKey> $EVID/store/stash.bin
node scripts/video/render-scene.mjs --project $EVID/smoke.video-project.json --out $EVID/out3 ; echo "exit=$?"   # 期望非 0 且报「媒体文件缺失」
sha_after=$(sha256sum $EVID/smoke.video-project.json | cut -d' ' -f1)
[ "$sha_before" = "$sha_after" ] && echo "PROJECT-UNTOUCHED ✓"
mv $EVID/store/stash.bin $EVID/store/original/<storeKey>
# ② mute 反证：copy 项目改 audio=mute、去掉 --narration → 渲染成功但无音频流
node scripts/video/render-scene.mjs --project $EVID/mute.video-project.json --out $EVID/out-mute
ffprobe -v error -select_streams a -show_entries stream=codec_name -of csv=p=0 $EVID/out-mute/landscape.mp4   # 期望空输出（无音频流）
```

（`mute.video-project.json` = smoke 副本改 `audio:"mute"` 且镜头 1 `narrationText:""`。）

- [ ] **Step 5: A1 金标准复跑（spec-only 逐字节恒等）**

```bash
cp artifacts/video-studio-dataviz/e2e.video-project.json $EVID/a1/golden.video-project.json
node scripts/video/render-scene.mjs --project $EVID/a1/golden.video-project.json --out $EVID/a1/out
# props 逐字节比对（新旧两跑的 timeline props 文件；旧跑在 artifacts/video-studio-dataviz/render/）
diff <(cat artifacts/video-studio-dataviz/render/*.props*.json 2>/dev/null | sort) <(cat $EVID/a1/out/*.props*.json | sort) && echo "PROPS-BYTE-IDENTICAL ✓"
# contentDigest 对账（与 dataviz 既有 render-manifest 里的 contentDigest 逐一相等，含 4ac94b11…/8f2b26ad… 前缀）
```

Expected: props 逐字节相等；contentDigest 集合与旧跑完全一致（黑帧门禁对纯 spec 渲染放行——dataviz 末帧是内容帧）。（若 props 文件名形状不同，按 outDir 实际产物调整 diff 目标——判定标准不变：逐字节。）

- [ ] **Step 6: 证据归档 + 台账核对 + 提交**

`$EVID/evidence.md` 记录：成功输出摘要（帧数/YAVG/aac）、双跑 EQ 六行、反证两路输出、A1 比对结论、`wc -l artifacts/tts-usage.jsonl` = 34（零计费）。证据目录不入库（媒体不入库约定——`git status` 确认未被跟踪则不 add；若被跟踪需加 .gitignore 条目）。

无代码改动则无提交；若反证/冒烟暴露缺陷，修复走 TDD（新测试 RED → 修 → GREEN → 全量）后按 Task 归属补提交。

---

## Self-Review 记录

- **Spec coverage**：§1 B1（Task 2）/B2（Task 1）/B3+B4（Task 6 OffthreadVideo original+audio）/B5（Task 3/6 trimBefore 半进位）/B6（Task 7 黑帧门禁）；§2 G1-G3（Task 3）/G4（Task 3+7）/G5（Task 3+7+8）/G6-G7（Task 3+7）/G8（Task 7）；S 系列（无新 S 项——Task 2 服务属 B1）；E1-E3（Task 6）；A1（Task 4）/A2（Task 7 溢出门禁沿用——媒体镜头无旁白对齐路径，`--allow-truncate` 语义不变）；D1（Task 5）；X1（Task 3 键序测试 + Task 8 A1）/X3（verify-determinism/export-shot-svg 不动）/X4（Task 1 再导出）。§6 冒烟逐条 = Task 8 步骤。
- **Placeholder scan**：无 TBD/「适当处理」；Task 8 的 `<storeKey>` 是命令模板变量（步骤 1 产出的实际值代入），非遗留占位。
- **Type consistency**：`buildTimelineShotMedia` 产出的 media 对象键序/键名与 Task 6 `TimelineMediaProps` 字段一一对应（src/assetWidth/assetHeight/inMs/outMs/fit/focalX/audio/trimBefore）；`collectMediaShots` entry 形状在 Task 3 测试与 Task 7 消费一致（mediaByShot.get → buildTimelineShotMedia/buildShotAssetDigests 同 entry）；`planDurationAlignments` 新形状在 Task 4 测试与 tts-narration 调用点一致。
- **Review Focus**：五条各自钉进 Task 3（#1 键序精确串/#2 半进位/#3 两条负路径/#4 四象限/#5 解析健壮性）与 Task 8（#1 A1 复跑/#3 删文件反证/#4 mute 反证）。
