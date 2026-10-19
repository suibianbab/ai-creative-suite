# P2.5-T2 媒体导入与内容寻址媒体仓 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 `@acs/media-store` 包（probe/store/ingest/proxy 四模块）+ `scripts/video/media-ingest.mjs` CLI + Next 双路由（POST 上传导入、GET 流式取文件），使本地上传的实拍媒体经 ffprobe/解码/sha256 核验后落入内容寻址仓并产出契约合法的 `MediaAsset`。

**Architecture:** 核心逻辑全在 Node-only 新包 `packages/media-store`（不得进 `@acs/video-document`——该包被浏览器代码 import）；CLI 与 Next 路由都是薄壳。仓布局 `root/original/<storeKey>` + `root/proxy/<stem>.proxy.mp4`，storeKey 内容寻址幂等。任何失败路径零残留（临时目录与半成品全清），账本写入不在本刀（T3）。

**Tech Stack:** TypeScript（NodeNext，镜像 video-document 包骨架）、node:child_process spawnSync 调 ffprobe/ffmpeg（先例 `export-gif.mjs:173-191`）、node:crypto sha256/randomUUID、Next 16.4.0 路由（`params` 是 **Promise**，`Readable.toWeb` 流式响应）、node:test + tsx。

**Spec:** `docs/superpowers/specs/2026-10-19-video-studio-media-ingest-store-design.md`（规则表 P/S/D/W、失败语义 §3、测试清单 §4 全部源自 spec；本计划执行其全部条目）。

## Global Constraints

- 契约边界（T1 已定）：`original.durationMs` 200..600000；`storeKey = sha256 前 16 位小写 hex + ".mp4"|".webm"|".mov"`；fps 正有限（29.97 合法）；`proxy?` 可再生成。
- 代理上限 `PROXY_MAX_EDGE = 1280`；上传上限 500_000_000 字节（路由 413）。
- 错误消息**中文**（spec §2 表逐字），HTTP 码：415 扩展名 / 422 探测解码时长 / 500 转码与仓错误 / 400 表形状非法与 formData 缺字段 / 404 无文件 / 413 超大 / 403 跨站 / 503 非 development。
- 测试**零网络**；本地真实 ffmpeg/ffprobe 允许（`scripts/video/export-gif.test.mjs` 先例）；每个测试用 `mkdtempSync` 唯一临时目录，不污染仓库。
- Next 16.4.0：动态路由 `{ params }: { params: Promise<{ storeKey: string }> }`，`await params`（`apps/web/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md:82-100`）；写路由前该文档已核，执行中如遇 API 疑义以此文档为准。
- `.gitignore` **已天然覆盖** media-store：`artifacts/**` 忽略、仅 `.md`/`.json` 白名单（`.gitignore:17-21`），mp4/webm/mov 不在白名单——**不新增 gitignore 行**，仅在验收记录此核对结论。
- scripts/ 不在 pnpm workspace 包图内：CLI 经 `pathToFileURL(ROOT/packages/media-store/dist/index.js)` 动态导入（`export-shot-svg.mjs:21-26` 先例）。
- workspace 依赖用 `"workspace:*"` 协议（`apps/web/package.json` 先例）；提交信息含 `Co-Authored-By: Claude Code <noreply@anthropic.com>`；biome 全绿；台账 `artifacts/tts-usage.jsonl` 行数不变（本刀零 TTS）。

## spec → plan 接口细化（四处，均属 §1.1 注入点家族的补全，执行时记 Ruling）

1. spec 的 `openOriginal/openProxy` 落地为 `originalPath/proxyPath` **自带形状门**（非法 storeKey 直接 throw `storeKey 形状非法：<值>`）——路由无需单独校验步骤。
2. `ingestMediaFile` 注入点在 spec 的 `runProbe`/`runDecode` 之外补 `runTranscode?: typeof transcodeProxy` 与 `tempDir?: string`（W2 回滚与零残留的确定性测试需要）。
3. `IngestResult` 失败分支补 `reasonCode`（见 Task 4 类型），路由按它映射 HTTP 码——避免路由对中文消息做正则分派。
4. `runDecode` 与 `parseProbeOutput` 从 probe.ts 的内部步骤提升为导出函数（D1/P 表的单元测试与复用需要）。

---

### Task 1: 包骨架 + store.ts（S 表）

**Files:**
- Create: `packages/media-store/package.json`、`packages/media-store/tsconfig.json`、`packages/media-store/src/index.ts`、`packages/media-store/src/store.ts`
- Modify: 根 `package.json`（build 链插入两段）
- Test: `packages/media-store/src/store.test.ts`

**Interfaces:**
- Consumes: 无（首任务；`MediaAsset` 类型本任务不用）。
- Produces（后续任务经 `./store.js` 消费）:
  - `storeKeyFor(sha256: string, ext: "mp4"|"webm"|"mov"): string`
  - `resolveStoreRoot(): string`（env 门 + 默认 `~/.acs/media-store`）
  - `originalPath(root: string, storeKey: string): string`、`proxyPath(root, storeKey): string`（形状门 throw）
  - `STORE_KEY_PATTERN: RegExp`
  - `writeAtomically(dest: string, bytes: Uint8Array): "written" | "reused"`

- [ ] **Step 1: 包骨架（不 TDD——纯脚手架，随本任务交付物一起验证）**

`packages/media-store/package.json`（镜像 `packages/video-document/package.json`）：

```json
{
  "name": "@acs/media-store",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "tsc -p tsconfig.json && node --test \"dist/**/*.test.js\""
  },
  "dependencies": {
    "@acs/video-document": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.15.0",
    "typescript": "^5.9.3"
  }
}
```

`packages/media-store/tsconfig.json`（逐字镜像 video-document 的）：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

`packages/media-store/src/index.ts`：

```ts
export {
  originalPath,
  proxyPath,
  resolveStoreRoot,
  STORE_KEY_PATTERN,
  storeKeyFor,
  writeAtomically,
} from "./store.js";
```

根 `package.json` 的 `build` 链在 `--filter @acs/image-document build` 之后、`--filter @acs/api build` 之前插入：

```
&& pnpm --filter @acs/video-document run build && pnpm --filter @acs/media-store run build
```

（video-document 一并补入——它此前不在根 build 链，media-store 的 tsc 需其 dist 的 .d.ts；这是修一个潜在缺口。）

然后 `pnpm install`（链接新 workspace 包）并 `pnpm --filter @acs/media-store run build` 确认空包可编译。

- [ ] **Step 2: 写失败测试**

`packages/media-store/src/store.test.ts`：

```ts
// P2.5-T2 S 表：仓布局推导、storeKey 形状门（防穿越）、env 门、原子落盘幂等。
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  originalPath,
  proxyPath,
  resolveStoreRoot,
  storeKeyFor,
  writeAtomically,
} from "./store.js";

const SHA = "a".repeat(64);
const ROOT = mkdtempSync(path.join(tmpdir(), "acs-store-test-"));

test("storeKeyFor 取 sha256 前 16 位 + 扩展名", () => {
  assert.equal(storeKeyFor(SHA, "mp4"), "aaaaaaaaaaaaaaaa.mp4");
  assert.equal(storeKeyFor(SHA, "webm"), "aaaaaaaaaaaaaaaa.webm");
});

test("originalPath/proxyPath 布局：original/<storeKey> 与 proxy/<stem>.proxy.mp4", () => {
  const key = storeKeyFor(SHA, "mp4");
  assert.equal(
    originalPath(ROOT, key),
    path.join(ROOT, "original", "aaaaaaaaaaaaaaaa.mp4"),
  );
  assert.equal(
    proxyPath(ROOT, key),
    path.join(ROOT, "proxy", "aaaaaaaaaaaaaaaa.proxy.mp4"),
  );
});

test("storeKey 形状门：穿越与非法形状 throw（S4 前置）", () => {
  for (const bad of [
    "../aaaaaaaaaaaaaaaa.mp4",
    "..\\aaaaaaaaaaaaaaaa.mp4",
    "aaaaaaaaaaaaaaaA.mp4", // 大写 hex
    "aaaaaaaaaaaaaaaa.mp4x",
    "aaaaaaaaaaaaaaaa.gif",
    "aaaaaaaaaaaaaaaa",
    "",
  ]) {
    assert.throws(() => originalPath(ROOT, bad), /storeKey 形状非法/);
    assert.throws(() => proxyPath(ROOT, bad), /storeKey 形状非法/);
  }
});

test("resolveStoreRoot：env 绝对路径生效；相对路径大声拒绝（S2）；未设走默认", () => {
  const previous = process.env.ACS_MEDIA_STORE;
  try {
    process.env.ACS_MEDIA_STORE = path.join(ROOT, "env-store");
    assert.equal(resolveStoreRoot(), path.join(ROOT, "env-store"));
    process.env.ACS_MEDIA_STORE = "relative/dir";
    assert.throws(() => resolveStoreRoot(), /ACS_MEDIA_STORE 须为绝对路径/);
    delete process.env.ACS_MEDIA_STORE;
    const fallback = resolveStoreRoot();
    assert.ok(path.isAbsolute(fallback) && fallback.includes("media-store"));
  } finally {
    if (previous === undefined) delete process.env.ACS_MEDIA_STORE;
    else process.env.ACS_MEDIA_STORE = previous;
  }
});

test("writeAtomically：首写 written；同大小 reused 且文件未被重写；异大小大声失败（S3）", () => {
  const dest = originalPath(ROOT, storeKeyFor(SHA, "mp4"));
  const first = Buffer.from("content-addressed-bytes");
  assert.equal(writeAtomically(dest, first), "written");
  const mtimeBefore = statSync(dest).mtimeMs;
  assert.equal(writeAtomically(dest, first), "reused");
  assert.equal(statSync(dest).mtimeMs, mtimeBefore);
  assert.throws(
    () => writeAtomically(dest, Buffer.from("different-size")),
    /内容寻址冲突/,
  );
  assert.equal(readFileSync(dest).toString(), "content-addressed-bytes");
});

test("writeAtomically：写后无 .tmp 残留（目录内只有目标文件）", () => {
  const dir = path.join(ROOT, "residue-check");
  const dest = path.join(dir, "bbbbbbbbbbbbbbbb.mp4");
  writeAtomically(dest, Buffer.from("x"));
  assert.deepEqual(
    readdirSync(dir).filter((name) => name.endsWith(".tmp")),
    [],
  );
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm --filter @acs/media-store test`
Expected: 编译错误 `Cannot find module './store.js'`（模块不存在）——这就是本任务的 RED 形态。

- [ ] **Step 4: 实现 store.ts**

```ts
// P2.5-T2 内容寻址媒体仓布局与原子落盘（spec S 表）。storeKey 形状门是
// 防目录穿越的唯一闸门——originalPath/proxyPath 是路由直接消费的入口。
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const STORE_KEY_PATTERN = /^[0-9a-f]{16}\.(mp4|webm|mov)$/;

export function storeKeyFor(
  sha256: string,
  ext: "mp4" | "webm" | "mov",
): string {
  return `${sha256.slice(0, 16)}.${ext}`;
}

export function resolveStoreRoot(): string {
  const configured = process.env.ACS_MEDIA_STORE;
  if (configured !== undefined) {
    if (!path.isAbsolute(configured)) {
      throw new Error(`ACS_MEDIA_STORE 须为绝对路径（当前：${configured}）`);
    }
    return configured;
  }
  return path.join(homedir(), ".acs", "media-store");
}

function requireValidStoreKey(storeKey: string): void {
  if (!STORE_KEY_PATTERN.test(storeKey)) {
    throw new Error(`storeKey 形状非法：${storeKey}`);
  }
}

export function originalPath(root: string, storeKey: string): string {
  requireValidStoreKey(storeKey);
  return path.join(root, "original", storeKey);
}

export function proxyPath(root: string, storeKey: string): string {
  requireValidStoreKey(storeKey);
  return path.join(root, "proxy", `${storeKey.slice(0, 16)}.proxy.mp4`);
}

// 内容寻址幂等：同 storeKey 同大小复用（S3）；异大小 = 内容寻址被破坏，
// 大声失败不覆盖。写入走 同目录临时文件 + rename（原子替换），并发同内容
// 双写至多一次 rename 生效，无残片。
export function writeAtomically(
  dest: string,
  bytes: Uint8Array,
): "written" | "reused" {
  mkdirSync(path.dirname(dest), { recursive: true });
  if (existsSync(dest)) {
    if (statSync(dest).size === bytes.byteLength) return "reused";
    throw new Error(`仓内同 storeKey 文件大小不符（内容寻址冲突）：${dest}`);
  }
  const temp = path.join(
    path.dirname(dest),
    `.${path.basename(dest)}.${process.pid}.${Date.now()}.tmp`,
  );
  writeFileSync(temp, bytes);
  try {
    renameSync(temp, dest);
  } catch (error) {
    unlinkSync(temp);
    throw error;
  }
  return "written";
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @acs/media-store test`
Expected: 6 pass / 0 fail。

- [ ] **Step 6: 提交**

```bash
git add packages/media-store package.json pnpm-lock.yaml
git commit -m "feat(media-store): P2.5-T2 包骨架 + 仓布局/形状门/原子落盘（S 表）"
```

---

### Task 2: probe.ts（P 表）

**Files:**
- Create: `packages/media-store/src/probe.ts`
- Modify: `packages/media-store/src/index.ts`（追加导出）
- Test: `packages/media-store/src/probe.test.ts`

**Interfaces:**
- Consumes: 无（独立模块）。
- Produces:
  - `type ProbeResult = { durationMs; width; height; fps; codec; hasAudio; formatName }`（全 number/boolean/string 字面）
  - `type ProbeOutcome = { ok: true; probe: ProbeResult } | { ok: false; error: string }`
  - `parseFps(rate: string): number`（"30000/1001" → 29.97…；"0/0"/垃圾 → 0）
  - `parseProbeOutput(raw: string): ProbeOutcome`（纯函数，P1-P4）
  - `runProbe(filePath: string): ProbeOutcome`（spawnSync + P5 + ENOENT 中文）

- [ ] **Step 1: 写失败测试**

`packages/media-store/src/probe.test.ts`：

```ts
// P2.5-T2 P 表：ffprobe 解析与拒绝。纯函数部分用录制夹具（零进程），
// runProbe 用真实 ffprobe + ffmpeg 生成的夹具媒体（脚本测试先例）。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseFps, parseProbeOutput, runProbe } from "./probe.js";

const WORK = mkdtempSync(path.join(tmpdir(), "acs-probe-test-"));

// 生成夹具媒体：2 秒 640x360 24fps h264，带正弦音轨。
function makeTestVideo(name: string, withAudio: boolean): string {
  const file = path.join(WORK, name);
  const args = ["-v", "error", "-y"];
  args.push("-f", "lavfi", "-i", "testsrc=duration=2:size=640x360:rate=24");
  if (withAudio) args.push("-f", "lavfi", "-i", "sine=frequency=440:duration=2");
  args.push("-pix_fmt", "yuv420p");
  if (withAudio) args.push("-c:a", "aac", "-shortest");
  args.push(file);
  const spawned = spawnSync("ffmpeg", args, { encoding: "utf8" });
  assert.equal(spawned.status, 0, `ffmpeg 生成夹具失败: ${spawned.stderr}`);
  return file;
}

test("parseFps：分数帧率 30000/1001 → ≈29.97；0/0 与垃圾 → 0", () => {
  assert.ok(Math.abs(parseFps("30000/1001") - 30000 / 1001) < 1e-9);
  assert.equal(parseFps("0/0"), 0);
  assert.equal(parseFps("0/1"), 0);
  assert.equal(parseFps("garbage"), 0);
  assert.equal(parseFps("25"), 25);
});

test("parseProbeOutput：合法 JSON → 全字段（P0 正路径）", () => {
  const raw = JSON.stringify({
    streams: [
      { codec_type: "video", codec_name: "h264", width: 640, height: 360, r_frame_rate: "24/1" },
      { codec_type: "audio", codec_name: "aac" },
    ],
    format: { duration: "2.000000", format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
  });
  const outcome = parseProbeOutput(raw);
  assert.ok(outcome.ok);
  assert.equal(outcome.probe.durationMs, 2000);
  assert.equal(outcome.probe.width, 640);
  assert.equal(outcome.probe.height, 360);
  assert.equal(outcome.probe.fps, 24);
  assert.equal(outcome.probe.codec, "h264");
  assert.equal(outcome.probe.hasAudio, true);
});

test("parseProbeOutput P1：无视频流 → 拒", () => {
  const raw = JSON.stringify({ streams: [{ codec_type: "audio" }], format: { duration: "2" } });
  const outcome = parseProbeOutput(raw);
  assert.ok(!outcome.ok);
  assert.match(outcome.error, /文件不含视频流/);
});

test("parseProbeOutput P2：duration 缺失/非正 → 拒", () => {
  for (const duration of ["N/A", "0", "-1"]) {
    const outcome = parseProbeOutput(
      JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264", width: 640, height: 360, r_frame_rate: "24/1" }], format: { duration } }),
    );
    assert.ok(!outcome.ok);
    assert.match(outcome.error, /无法读取视频时长/);
  }
});

test("parseProbeOutput P3/P4：画幅非正整数 / 帧率 0 → 拒", () => {
  const base = { codec_type: "video", codec_name: "h264" };
  const badSize = parseProbeOutput(JSON.stringify({ streams: [{ ...base, width: 0, height: 360, r_frame_rate: "24/1" }], format: { duration: "2" } }));
  assert.ok(!badSize.ok && /无法读取视频画幅/.test(badSize.error));
  const badFps = parseProbeOutput(JSON.stringify({ streams: [{ ...base, width: 640, height: 360, r_frame_rate: "0/0" }], format: { duration: "2" } }));
  assert.ok(!badFps.ok && /无法读取视频帧率/.test(badFps.error));
});

test("runProbe 真文件：2s 640x360 24fps，hasAudio 随音轨", () => {
  const silent = runProbe(makeTestVideo("silent.mp4", false));
  assert.ok(silent.ok);
  assert.equal(silent.probe.durationMs, 2000);
  assert.equal(silent.probe.width, 640);
  assert.equal(silent.probe.height, 360);
  assert.equal(silent.probe.fps, 24);
  assert.equal(silent.probe.codec, "h264");
  assert.equal(silent.probe.hasAudio, false);
  const audible = runProbe(makeTestVideo("audible.mp4", true));
  assert.ok(audible.ok);
  assert.equal(audible.probe.hasAudio, true);
});

test("runProbe P5：文本改名 .mp4 → 拒且消息中文", () => {
  const fake = path.join(WORK, "fake.mp4");
  writeFileSync(fake, "这不是视频");
  const outcome = runProbe(fake);
  assert.ok(!outcome.ok);
  assert.match(outcome.error, /文件无法探测：ffprobe 失败/);
});

test("runProbe ENOENT：PATH 空 → ffprobe 不在路径 → 中文大声失败（Review Focus 2）", () => {
  const previousPath = process.env.PATH;
  try {
    process.env.PATH = "";
    const outcome = runProbe(path.join(WORK, "silent.mp4"));
    assert.ok(!outcome.ok);
    assert.match(outcome.error, /未找到 ffprobe（请安装 FFmpeg 并加入 PATH）/);
  } finally {
    process.env.PATH = previousPath;
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @acs/media-store test`
Expected: 新增测试全部因 `Cannot find module './probe.js'` 失败（RED），Task 1 的 6 条保持绿。

- [ ] **Step 3: 实现 probe.ts**

```ts
// P2.5-T2 P 表：ffprobe 包装 + 纯解析。runProbe 只负责进程与 P5；
// P1-P4 全在 parseProbeOutput（纯函数，零进程，录制夹具可测）。
import { spawnSync } from "node:child_process";

export type ProbeResult = {
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  hasAudio: boolean;
  formatName: string;
};

export type ProbeOutcome =
  | { ok: true; probe: ProbeResult }
  | { ok: false; error: string };

export function parseFps(rate: string): number {
  const match = /^(\d+)\/(\d+)$/.exec(rate.trim());
  if (match) {
    const denominator = Number(match[2]);
    return denominator === 0 ? 0 : Number(match[1]) / denominator;
  }
  const value = Number(rate);
  return Number.isFinite(value) ? value : 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

export function parseProbeOutput(raw: string): ProbeOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "文件无法探测：ffprobe 输出不可解析" };
  }
  const root = asRecord(parsed);
  const streams = Array.isArray(root?.streams) ? root.streams : [];
  const records = streams.map(asRecord);
  const video = records.find((stream) => stream?.codec_type === "video");
  if (!video) {
    return { ok: false, error: "文件不含视频流" };
  }
  const format = asRecord(root?.format);
  const durationSeconds = format ? Number(format.duration) : Number.NaN;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { ok: false, error: "无法读取视频时长（文件可能不完整）" };
  }
  const width = Number(video?.width);
  const height = Number(video?.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return { ok: false, error: "无法读取视频画幅（文件可能不完整）" };
  }
  const fps = parseFps(String(video?.r_frame_rate ?? ""));
  if (!Number.isFinite(fps) || fps <= 0) {
    return { ok: false, error: "无法读取视频帧率（文件可能不完整）" };
  }
  return {
    ok: true,
    probe: {
      durationMs: Math.round(durationSeconds * 1000),
      width,
      height,
      fps,
      codec: String(video?.codec_name ?? ""),
      hasAudio: records.some((stream) => stream?.codec_type === "audio"),
      formatName: String(format?.format_name ?? ""),
    },
  };
}

export function runProbe(filePath: string): ProbeOutcome {
  const spawned = spawnSync(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
    { encoding: "utf8" },
  );
  if (spawned.error) {
    return {
      ok: false,
      error: `未找到 ffprobe（请安装 FFmpeg 并加入 PATH）：${spawned.error.message}`,
    };
  }
  if (spawned.status !== 0) {
    const tail = (spawned.stderr ?? "").slice(-200);
    return { ok: false, error: `文件无法探测：ffprobe 失败（${tail}）` };
  }
  return parseProbeOutput(spawned.stdout);
}
```

`index.ts` 追加导出：

```ts
export {
  parseFps,
  parseProbeOutput,
  runProbe,
  type ProbeOutcome,
  type ProbeResult,
} from "./probe.js";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @acs/media-store test`
Expected: 14 pass / 0 fail（6 + 8）。

- [ ] **Step 5: 提交**

```bash
git add packages/media-store/src
git commit -m "feat(media-store): P2.5-T2 ffprobe 包装与纯解析（P 表）——分数帧率/无视频流/时长画幅帧率拒绝 + ENOENT 中文"
```

---

### Task 3: proxy.ts（W 表）

**Files:**
- Create: `packages/media-store/src/proxy.ts`
- Modify: `packages/media-store/src/index.ts`
- Test: `packages/media-store/src/proxy.test.ts`

**Interfaces:**
- Consumes: `runProbe`（Task 2）。
- Produces:
  - `PROXY_MAX_EDGE = 1280`
  - `needsProxy(probe: ProbeResult): boolean`
  - `transcodeProxy(inputPath: string, outputPath: string, probe: ProbeResult): { ok: true; sha256; bytes; width; height; note } | { ok: false; error: string }`（W2/W3 自核验）

- [ ] **Step 1: 写失败测试**

`packages/media-store/src/proxy.test.ts`：

```ts
// P2.5-T2 W 表：needsProxy 判定 + 真转码自核验（长边 ≤1280、时长差 <500ms、
// note 记 ffmpeg 版本）。夹具由 ffmpeg 生成（先例同 probe.test）。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { needsProxy, PROXY_MAX_EDGE, transcodeProxy } from "./proxy.js";
import { runProbe, type ProbeResult } from "./probe.js";

const WORK = mkdtempSync(path.join(tmpdir(), "acs-proxy-test-"));

function fixture(name: string, size: string): string {
  const file = path.join(WORK, name);
  const spawned = spawnSync(
    "ffmpeg",
    ["-v", "error", "-y", "-f", "lavfi", "-i", `testsrc=duration=2:size=${size}:rate=24`, "-pix_fmt", "yuv420p", file],
    { encoding: "utf8" },
  );
  assert.equal(spawned.status, 0, spawned.stderr);
  return file;
}

function probeOf(width: number, height: number, codec: string): ProbeResult {
  return { durationMs: 2000, width, height, fps: 24, codec, hasAudio: false, formatName: "mov,mp4" };
}

test("needsProxy W1：长边 >1280 或非浏览器 codec → true；否则 false", () => {
  assert.equal(needsProxy(probeOf(1920, 1080, "h264")), true);
  assert.equal(needsProxy(probeOf(1080, 1920, "h264")), true);
  assert.equal(needsProxy(probeOf(640, 360, "h264")), false);
  assert.equal(needsProxy(probeOf(1280, 720, "h264")), false);
  assert.equal(needsProxy(probeOf(640, 360, "hevc")), true);
});

test("transcodeProxy 真转码：1080p → 1280x720 h264，note 含 ffmpeg 版本（W3 自核验内含）", () => {
  const source = fixture("big.mp4", "1920x1080");
  const probed = runProbe(source);
  assert.ok(probed.ok);
  const output = path.join(WORK, "big.proxy.mp4");
  const result = transcodeProxy(source, output, probed.probe);
  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.equal(result.width, 1280);
  assert.equal(result.height, 720);
  assert.ok(result.bytes > 0);
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
  assert.match(result.note, /ffmpeg/i);
  assert.ok(existsSync(output));
  const verify = runProbe(output);
  assert.ok(verify.ok);
  assert.equal(verify.probe.codec, "h264");
  assert.ok(Math.abs(verify.probe.durationMs - 2000) < 500);
});

test("transcodeProxy 竖版：1080x1920 → 720x1280", () => {
  const source = fixture("tall.mp4", "1080x1920");
  const probed = runProbe(source);
  assert.ok(probed.ok);
  const result = transcodeProxy(source, path.join(WORK, "tall.proxy.mp4"), probed.probe);
  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.equal(result.width, 720);
  assert.equal(result.height, 1280);
});

test("PROXY_MAX_EDGE 常量钉死 1280", () => {
  assert.equal(PROXY_MAX_EDGE, 1280);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @acs/media-store test`
Expected: 新 4 条 `Cannot find module './proxy.js'`（RED），旧 14 条绿。

- [ ] **Step 3: 实现 proxy.ts**

```ts
// P2.5-T2 W 表：浏览器预览代理。needsProxy 判定 + 转码 + 自核验（W3：
// 产物过长边/时长差/不可解码 = 失败，删半成品）。note 记 ffmpeg 版本与参数
// 摘要——proxy 是可再生成字段，note 是再生成的配方指纹。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import { runProbe, type ProbeResult } from "./probe.js";

export const PROXY_MAX_EDGE = 1280;
const BROWSER_CODECS = new Set(["h264", "vp8", "vp9", "av1"]);
const PROXY_DURATION_TOLERANCE_MS = 500;

export function needsProxy(probe: ProbeResult): boolean {
  const longEdge = Math.max(probe.width, probe.height);
  return longEdge > PROXY_MAX_EDGE || !BROWSER_CODECS.has(probe.codec);
}

function ffmpegVersionLine(): string {
  const spawned = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  const firstLine = (spawned.stdout ?? "").split("\n")[0]?.trim();
  return firstLine !== undefined && firstLine !== "" ? firstLine : "ffmpeg 版本未知";
}

export function transcodeProxy(
  inputPath: string,
  outputPath: string,
  probe: ProbeResult,
):
  | { ok: true; sha256: string; bytes: number; width: number; height: number; note: string }
  | { ok: false; error: string } {
  const scale = `scale='if(gt(iw,ih),min(${PROXY_MAX_EDGE},iw),-2)':'if(gt(iw,ih),-2,min(${PROXY_MAX_EDGE},ih))'`;
  const args = ["-v", "error", "-y", "-i", inputPath, "-vf", scale, "-c:v", "libx264", "-crf", "23", "-pix_fmt", "yuv420p"];
  if (probe.hasAudio) args.push("-c:a", "aac", "-b:a", "128k");
  else args.push("-an");
  args.push(outputPath);
  const spawned = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (spawned.error || spawned.status !== 0) {
    try {
      unlinkSync(outputPath);
    } catch {}
    return {
      ok: false,
      error: `代理转码失败：${String(spawned.stderr ?? spawned.error?.message ?? "").slice(-300)}`,
    };
  }
  const verified = runProbe(outputPath);
  if (!verified.ok) {
    try {
      unlinkSync(outputPath);
    } catch {}
    return { ok: false, error: `代理转码核验失败：${verified.error}` };
  }
  const longEdge = Math.max(verified.probe.width, verified.probe.height);
  const durationDrift = Math.abs(verified.probe.durationMs - probe.durationMs);
  if (longEdge > PROXY_MAX_EDGE || durationDrift >= PROXY_DURATION_TOLERANCE_MS) {
    try {
      unlinkSync(outputPath);
    } catch {}
    return {
      ok: false,
      error: `代理转码核验失败：产物长边 ${longEdge} 或时长差 ${durationDrift}ms 越限`,
    };
  }
  const bytes = readFileSync(outputPath);
  return {
    ok: true,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.byteLength,
    width: verified.probe.width,
    height: verified.probe.height,
    note: `${ffmpegVersionLine()} | ${scale} | libx264 crf23 yuv420p${probe.hasAudio ? " + aac128k" : " | -an"}`,
  };
}
```

`index.ts` 追加：

```ts
export {
  needsProxy,
  PROXY_MAX_EDGE,
  transcodeProxy,
} from "./proxy.js";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @acs/media-store test`
Expected: 18 pass / 0 fail。

- [ ] **Step 5: 提交**

```bash
git add packages/media-store/src
git commit -m "feat(media-store): P2.5-T2 预览代理转码（W 表）——needsProxy/1280 上限/自核验/版本指纹"
```

---

### Task 4: ingest.ts 导入管线（D 表 + P6 + S1 + W2 回滚）

**Files:**
- Create: `packages/media-store/src/ingest.ts`
- Modify: `packages/media-store/src/index.ts`
- Test: `packages/media-store/src/ingest.test.ts`

**Interfaces:**
- Consumes: `runProbe`/`ProbeOutcome`（Task 2）、`needsProxy`/`transcodeProxy`（Task 3）、`storeKeyFor`/`originalPath`/`proxyPath`/`writeAtomically`（Task 1）、`MediaAsset` 类型（`@acs/video-document`）。
- Produces:
  - `type IngestReasonCode = "unsupported-format" | "probe-failed" | "decode-failed" | "duration-out-of-range" | "proxy-failed" | "store-error"`
  - `type IngestResult = { ok: true; asset: MediaAsset } | { ok: false; error: string; reasonCode: IngestReasonCode; cleanupDone: true }`
  - `runDecode(filePath: string): { ok: true } | { ok: false; error: string }`（D1 全片解码门，导出）
  - `ingestMediaFile(input)`（spec §1.1 签名 + 注入点 `runProbe`/`runDecode`/`runTranscode`/`tempDir`/`now`）

- [ ] **Step 1: 写失败测试**

`packages/media-store/src/ingest.test.ts`：

```ts
// P2.5-T2 导入管线：happy path、S1 扩展名门、P6 时长越界（注入探针）、
// D1 残片解码门、W2 转码失败回滚分寸（新写删/预存不动）、幂等复用。
// 真实 ffmpeg 夹具 + 注入假依赖两轨。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { MediaAsset } from "@acs/video-document";
import { ingestMediaFile } from "./ingest.js";
import { runProbe, type ProbeOutcome, type ProbeResult } from "./probe.js";

const WORK = mkdtempSync(path.join(tmpdir(), "acs-ingest-test-"));
const FIXTURE_BYTES_CACHE = new Map<string, Buffer>();

function makeTestVideo(name: string, size = "640x360"): Buffer {
  const cached = FIXTURE_BYTES_CACHE.get(name);
  if (cached) return cached;
  const file = path.join(WORK, name);
  const spawned = spawnSync(
    "ffmpeg",
    ["-v", "error", "-y", "-f", "lavfi", `-i`, `testsrc=duration=2:size=${size}:rate=24`, "-pix_fmt", "yuv420p", file],
    { encoding: "utf8" },
  );
  assert.equal(spawned.status, 0, spawned.stderr);
  const bytes = readFileSync(file);
  FIXTURE_BYTES_CACHE.set(name, bytes);
  return bytes;
}

function storeRoot(name: string): string {
  return mkdtempSync(path.join(tmpdir(), `acs-ingest-store-${name}-`));
}

const FIXED_NOW = "2026-10-19T12:00:00.000Z";

test("happy path：640x360 h264（无需代理）→ 契约合法 MediaAsset，文件落仓", async () => {
  const bytes = makeTestVideo("small.mp4");
  const root = storeRoot("happy");
  const result = await ingestMediaFile({ bytes, fileName: "小片.mp4", root, now: () => FIXED_NOW });
  assert.ok(result.ok, result.ok ? "" : result.error);
  const asset: MediaAsset = result.asset;
  assert.match(asset.assetId, /^[0-9a-f-]{36}$/);
  assert.equal(asset.createdAt, FIXED_NOW);
  assert.deepEqual(asset.origin, { kind: "local-upload", fileName: "小片.mp4" });
  assert.equal(asset.original.durationMs, 2000);
  assert.equal(asset.original.width, 640);
  assert.equal(asset.original.height, 360);
  assert.equal(asset.original.fps, 24);
  assert.equal(asset.original.codec, "h264");
  assert.equal(asset.original.hasAudio, false);
  assert.equal(asset.original.bytes, bytes.byteLength);
  assert.equal(asset.original.storeKey, `${asset.original.sha256.slice(0, 16)}.mp4`);
  assert.equal(asset.proxy, undefined);
  const stored = path.join(root, "original", asset.original.storeKey);
  assert.ok(existsSync(stored));
  assert.equal(readFileSync(stored).byteLength, bytes.byteLength);
  // spec §4.6：仓文件 sha256 复核一致
  assert.equal(
    createHash("sha256").update(readFileSync(stored)).digest("hex"),
    asset.original.sha256,
  );
});

test("happy path + 代理：1920x1080 → asset.proxy 存在且产物过核验", async () => {
  const bytes = makeTestVideo("big.mp4", "1920x1080");
  const root = storeRoot("proxy");
  const result = await ingestMediaFile({ bytes, fileName: "big.mp4", root });
  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.ok(result.asset.proxy);
  assert.equal(result.asset.proxy.width, 1280);
  assert.equal(result.asset.proxy.height, 720);
  assert.match(result.asset.proxy.note, /ffmpeg/i);
  assert.ok(existsSync(path.join(root, "proxy", `${result.asset.original.storeKey.slice(0, 16)}.proxy.mp4`)));
});

test("S1：扩展名不支持/无扩展名拒绝；.MP4 大写归一放行", async () => {
  const bytes = makeTestVideo("small.mp4");
  const root = storeRoot("s1");
  for (const bad of ["clip.gif", "clip", "clip.avi"]) {
    const result = await ingestMediaFile({ bytes, fileName: bad, root });
    assert.ok(!result.ok);
    assert.match(result.error, /不支持的媒体格式/);
    assert.equal(result.reasonCode, "unsupported-format");
  }
  const upper = await ingestMediaFile({ bytes, fileName: "CLIP.MP4", root });
  assert.ok(upper.ok, upper.ok ? "" : upper.error);
  assert.deepEqual(readdirSync(path.join(root, "original")).length, 1);
});

test("P6：时长越界（注入假探针 199ms / 600001ms）→ 拒且临时目录零残留", async () => {
  const bytes = makeTestVideo("small.mp4");
  const root = storeRoot("p6");
  const tempDir = mkdtempSync(path.join(tmpdir(), "acs-ingest-tempdir-"));
  for (const durationMs of [199, 600001]) {
    const fakeProbe = (filePath: string): ProbeOutcome => ({
      ok: true,
      probe: { durationMs, width: 640, height: 360, fps: 24, codec: "h264", hasAudio: false, formatName: "mov,mp4" },
    });
    const result = await ingestMediaFile({
      bytes, fileName: "clip.mp4", root, tempDir,
      runProbe: fakeProbe,
      runDecode: () => ({ ok: true }),
    });
    assert.ok(!result.ok);
    assert.match(result.error, new RegExp(`视频时长 ${durationMs}ms 越界`));
    assert.equal(result.reasonCode, "duration-out-of-range");
  }
  assert.deepEqual(readdirSync(tempDir), [], "失败后临时目录必须清空");
  assert.ok(!existsSync(path.join(root, "original")), "失败不得写仓");
});

test("D1：残片（截断 40%）→ 全片解码门拒，零残留", async () => {
  const full = makeTestVideo("small.mp4");
  const truncated = full.subarray(0, Math.floor(full.byteLength * 0.4));
  const root = storeRoot("d1");
  const tempDir = mkdtempSync(path.join(tmpdir(), "acs-ingest-tempdir2-"));
  const realProbe = runProbe; // 头部完整时探针可能通过——解码门才是残片的闸
  const result = await ingestMediaFile({
    bytes: truncated, fileName: "broken.mp4", root, tempDir,
    runProbe: (filePath) => realProbe(filePath),
  });
  assert.ok(!result.ok);
  assert.ok(
    result.reasonCode === "decode-failed" || result.reasonCode === "probe-failed",
    `残片应被探针或解码门拦截，实际 ${result.reasonCode}`,
  );
  assert.deepEqual(readdirSync(tempDir), []);
  assert.ok(!existsSync(path.join(root, "original")));
});

test("W2 回滚分寸：转码失败 → 本次新写 original 删除；预存同 storeKey 文件原样", async () => {
  const bytes = makeTestVideo("small.mp4");
  const root = storeRoot("w2");
  const sha = result0Sha(bytes);
  const storeKey = `${sha.slice(0, 16)}.mp4`;
  const fakeBigProbe = (filePath: string): ProbeOutcome => ({
    ok: true,
    probe: { durationMs: 2000, width: 1920, height: 1080, fps: 24, codec: "h264", hasAudio: false, formatName: "mov,mp4" },
  });
  const failTranscode = () => ({ ok: false as const, error: "代理转码失败：注入失败" });
  // 场景 A：仓内无预存 → 新写 original 被回滚删除
  const a = await ingestMediaFile({
    bytes, fileName: "big.mp4", root, runProbe: fakeBigProbe, runDecode: () => ({ ok: true }), runTranscode: failTranscode,
  });
  assert.ok(!a.ok);
  assert.equal(a.reasonCode, "proxy-failed");
  assert.ok(!existsSync(path.join(root, "original", storeKey)), "新写的 original 必须回滚删除");
  // 场景 B：仓内预存同 storeKey（伪造预存资产）→ 预存文件不得被删/被改
  const preexisting = path.join(root, "original", storeKey);
  mkdirSync(path.dirname(preexisting), { recursive: true });
  writeFileSync(preexisting, bytes);
  const mtimeBefore = statSync(preexisting).mtimeMs;
  const b = await ingestMediaFile({
    bytes, fileName: "big.mp4", root, runProbe: fakeBigProbe, runDecode: () => ({ ok: true }), runTranscode: failTranscode,
  });
  assert.ok(!b.ok);
  assert.ok(existsSync(preexisting), "预存文件不得被销毁");
  assert.equal(statSync(preexisting).mtimeMs, mtimeBefore);
});

test("幂等复用：同内容二次导入 → 同 storeKey 文件 mtime 不变（未重写）+ 新 assetId", async () => {
  const bytes = makeTestVideo("small.mp4");
  const root = storeRoot("idem");
  const first = await ingestMediaFile({ bytes, fileName: "a.mp4", root });
  assert.ok(first.ok);
  const stored = path.join(root, "original", first.asset.original.storeKey);
  const mtimeBefore = statSync(stored).mtimeMs;
  const second = await ingestMediaFile({ bytes, fileName: "b.mp4", root });
  assert.ok(second.ok);
  assert.equal(second.asset.original.storeKey, first.asset.original.storeKey);
  assert.notEqual(second.asset.assetId, first.asset.assetId);
  assert.equal(statSync(stored).mtimeMs, mtimeBefore, "复用路径不得重写仓文件");
});

function result0Sha(bytes: Buffer): string {
  // 与实现同算法的 sha256，供测试推导 storeKey
  return createHash("sha256").update(bytes).digest("hex");
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @acs/media-store test`
Expected: 新 7 条 `Cannot find module './ingest.js'`（RED），旧 18 条绿。

- [ ] **Step 3: 实现 ingest.ts**

```ts
// P2.5-T2 导入管线（spec §1.1/§3）：扩展名门(S1) → sha256/storeKey → 临时落盘
// → 探测(P) → 时长对账(P6) → 全片解码门(D1) → 原子落仓(S3) → 代理判定与
// 转码(W) → MediaAsset。任何失败：临时目录清空、本次新写的仓文件回滚（预
// 存不动）、不产半成品资产；账本写入是调用方（T3）的事。
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MediaAsset } from "@acs/video-document";
import { needsProxy, transcodeProxy as defaultTranscode } from "./proxy.js";
import { runProbe as defaultProbe, type ProbeOutcome } from "./probe.js";
import { originalPath, proxyPath, storeKeyFor, writeAtomically } from "./store.js";

const SUPPORTED_EXTENSIONS = new Set(["mp4", "webm", "mov"]);
const MIN_DURATION_MS = 200;
const MAX_DURATION_MS = 600000;

export type IngestReasonCode =
  | "unsupported-format"
  | "probe-failed"
  | "decode-failed"
  | "duration-out-of-range"
  | "proxy-failed"
  | "store-error";

export type IngestOrigin = { kind: "local-upload"; fileName: string };

export type IngestResult =
  | { ok: true; asset: MediaAsset }
  | { ok: false; error: string; reasonCode: IngestReasonCode; cleanupDone: true };

export type RunDecodeResult = { ok: true } | { ok: false; error: string };

// D1 全片解码门：退出码 0 且 stderr 干净才算过（教训：退出码 0 ≠ 成功）。
export function runDecode(filePath: string): RunDecodeResult {
  const spawned = spawnSync("ffmpeg", ["-v", "error", "-i", filePath, "-f", "null", "-"], { encoding: "utf8" });
  if (spawned.error) {
    return { ok: false, error: `未找到 ffmpeg（请安装 FFmpeg 并加入 PATH）：${spawned.error.message}` };
  }
  if (spawned.status !== 0 || (spawned.stderr ?? "").trim() !== "") {
    const detail = `${spawned.stderr ?? ""}${spawned.status !== 0 ? `（退出码 ${spawned.status}）` : ""}`.slice(-300);
    return { ok: false, error: `文件无法完整解码：${detail}（文件可能损坏或不完整）` };
  }
  return { ok: true };
}

export async function ingestMediaFile(input: {
  bytes: Buffer | Uint8Array;
  fileName: string;
  root: string;
  generateProxy?: boolean;
  now?: () => string;
  runProbe?: (filePath: string) => ProbeOutcome;
  runDecode?: (filePath: string) => RunDecodeResult;
  runTranscode?: typeof defaultTranscode;
  tempDir?: string;
}): Promise<IngestResult> {
  const probeFn = input.runProbe ?? defaultProbe;
  const decodeFn = input.runDecode ?? runDecode;
  const transcodeFn = input.runTranscode ?? defaultTranscode;
  let tempDir: string | undefined;
  const cleanup = () => {
    if (tempDir !== undefined) rmSync(tempDir, { recursive: true, force: true });
  };
  const fail = (error: string, reasonCode: IngestReasonCode): IngestResult => {
    cleanup();
    return { ok: false, error, reasonCode, cleanupDone: true };
  };
  try {
    const extension = input.fileName.includes(".")
      ? (input.fileName.split(".").pop() ?? "").toLowerCase()
      : "";
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      return fail(
        `不支持的媒体格式 ${extension === "" ? "（无扩展名）" : `.${extension}`}：仅支持 mp4 / webm / mov`,
        "unsupported-format",
      );
    }
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const storeKey = storeKeyFor(sha256, extension as "mp4" | "webm" | "mov");
    tempDir = mkdtempSync(path.join(input.tempDir ?? tmpdir(), "acs-ingest-"));
    const tempFile = path.join(tempDir, `source.${extension}`);
    writeFileSync(tempFile, input.bytes);

    const probed = probeFn(tempFile);
    if (!probed.ok) return fail(probed.error, "probe-failed");
    const probe = probed.probe;
    if (probe.durationMs < MIN_DURATION_MS || probe.durationMs > MAX_DURATION_MS) {
      return fail(
        `视频时长 ${probe.durationMs}ms 越界：仅支持 ${MIN_DURATION_MS}ms..10 分钟`,
        "duration-out-of-range",
      );
    }
    const decoded = decodeFn(tempFile);
    if (!decoded.ok) return fail(decoded.error, "decode-failed");

    const dest = originalPath(input.root, storeKey);
    const existedBefore = existsSync(dest);
    const wroteOriginal = writeAtomically(dest, input.bytes) === "written";

    const baseAsset = (proxy?: MediaAsset["proxy"]): MediaAsset => ({
      assetId: randomUUID(),
      createdAt: input.now?.() ?? new Date().toISOString(),
      origin: { kind: "local-upload", fileName: input.fileName },
      original: {
        sha256,
        bytes: input.bytes.byteLength,
        durationMs: probe.durationMs,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        codec: probe.codec,
        hasAudio: probe.hasAudio,
        storeKey,
      },
      ...(proxy === undefined ? {} : { proxy }),
    });

    if (input.generateProxy !== false && needsProxy(probe)) {
      const transcoded = transcodeFn(tempFile, proxyPath(input.root, storeKey), probe);
      if (!transcoded.ok) {
        // W2 回滚分寸：仅删本次新写；预存文件背后是既有资产，无权销毁。
        if (wroteOriginal && !existedBefore) {
          try {
            unlinkSync(dest);
          } catch {}
        }
        return fail(transcoded.error, "proxy-failed");
      }
      const asset = baseAsset({
        sha256: transcoded.sha256,
        bytes: transcoded.bytes,
        width: transcoded.width,
        height: transcoded.height,
        note: transcoded.note,
      });
      cleanup();
      return { ok: true, asset };
    }
    const asset = baseAsset();
    cleanup();
    return { ok: true, asset };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), "store-error");
  }
}
```

`index.ts` 追加：

```ts
export {
  ingestMediaFile,
  runDecode,
  type IngestOrigin,
  type IngestReasonCode,
  type IngestResult,
} from "./ingest.js";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @acs/media-store test`
Expected: 25 pass / 0 fail。若 D1 测试对截断文件的拦截路径落在 `probe-failed`（moov 不完整时探针先行失败），断言已允许两码之一——但需人工确认 stderr 中确有拦截证据。

- [ ] **Step 5: 提交**

```bash
git add packages/media-store/src
git commit -m "feat(media-store): P2.5-T2 导入管线（D1 解码门/P6 对账/S1 门/W2 回滚分寸/reasonCode）"
```

---

### Task 5: CLI + Next 双路由 + web 接线 + 全栈回归

**Files:**
- Create: `scripts/video/media-ingest.mjs`、`scripts/video/media-ingest.test.mjs`、`apps/web/src/app/api/media/ingest/route.ts`、`apps/web/src/app/api/media/ingest/route.test.ts`、`apps/web/src/app/api/media/file/[storeKey]/route.ts`、`apps/web/src/app/api/media/file/[storeKey]/route.test.ts`
- Modify: `apps/web/package.json`（依赖 + 测试 glob）

**Interfaces:**
- Consumes: `ingestMediaFile`/`resolveStoreRoot`/`originalPath`/`proxyPath`（Task 1/4），Next 16 `params: Promise<...>`。
- Produces: 对外 HTTP 面（POST `/api/media/ingest`、GET `/api/media/file/[storeKey]`）与 CLI——T3 预览与镜头卡的依赖。

- [ ] **Step 1: CLI 失败/成功测试先写**

`scripts/video/media-ingest.test.mjs`：

```js
// P2.5-T2 CLI：真实文件成功（stdout JSON 过 validateVideoProject）与失败
// （exit ≠0、stderr 中文、仓零残留）。夹具 ffmpeg 生成，仓/临时均用 tmp。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(ROOT, "scripts/video/media-ingest.mjs");
const WORK = mkdtempSync(path.join(tmpdir(), "acs-cli-test-"));
const STORE = mkdtempSync(path.join(tmpdir(), "acs-cli-store-"));

function makeVideo(name) {
  const file = path.join(WORK, name);
  const spawned = spawnSync(
    "ffmpeg",
    ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=640x360:rate=24", "-pix_fmt", "yuv420p", file],
    { encoding: "utf8" },
  );
  assert.equal(spawned.status, 0, spawned.stderr);
  return file;
}

test("成功：stdout 打印契约合法的 MediaAsset JSON", async () => {
  const run = spawnSync(
    process.execPath,
    [CLI, "--file", makeVideo("ok.mp4"), "--store", STORE],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  const asset = JSON.parse(run.stdout);
  const { validateVideoProject } = await import(
    path.join(ROOT, "packages/video-document/dist/index.js")
  );
  const document = {
    schemaVersion: 1,
    id: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b3001",
    title: "媒体导入 CLI 测试",
    brief: { sentence: "导入一段实拍", aspectTargets: ["landscape"] },
    shots: [],
    renderRecords: [],
    deliveries: [],
    savedVersion: 1,
    mediaAssets: [asset],
  };
  validateVideoProject(document); // 契约级联校验：资产形状合法即不抛
  assert.equal(asset.origin.kind, "local-upload");
});

test("失败：文本改名 .mp4 → exit 1、stderr 中文、仓零残留", () => {
  const fake = path.join(WORK, "fake.mp4");
  writeFileSync(fake, "不是视频");
  const run = spawnSync(
    process.execPath,
    [CLI, "--file", fake, "--store", STORE],
    { encoding: "utf8" },
  );
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /文件无法探测|不含视频流|无法完整解码/);
  assert.ok(!readdirSync(STORE).some((entry) => entry === "original"));
});

test("--store 相对路径 → 用法错误 exit 2", () => {
  const run = spawnSync(process.execPath, [CLI, "--file", makeVideo("x.mp4"), "--store", "relative"], { encoding: "utf8" });
  assert.equal(run.status, 2);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test scripts/video/media-ingest.test.mjs`
Expected: 3 条失败——CLI 文件不存在（spawnSync python… 实为 node 直接跑不存在路径 → status ≠ 0 但断言 JSON.parse 失败）。RED 形态 = `SyntaxError`/`Cannot find module`。

- [ ] **Step 3: 实现 CLI**

`scripts/video/media-ingest.mjs`：

```js
#!/usr/bin/env node
// P2.5-T2：本地媒体导入 CLI（spec §1）。读文件 → @acs/media-store 导入管线
// → stdout 打印 MediaAsset JSON；失败 exit 1 + stderr 中文。仓默认
// ACS_MEDIA_STORE（未设 = ~/.acs/media-store），--store 覆盖（须绝对路径）。
// 用法: node scripts/video/media-ingest.mjs --file <path> [--store <abs dir>] [--no-proxy]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({
  options: {
    file: { type: "string" },
    store: { type: "string" },
    "no-proxy": { type: "boolean", default: false },
  },
});

if (!values.file || (values.store && !path.isAbsolute(values.store))) {
  console.error(
    "用法: node scripts/video/media-ingest.mjs --file <path> [--store <abs dir>] [--no-proxy]",
  );
  process.exit(2);
}
if (values.store) process.env.ACS_MEDIA_STORE = values.store;

const { ingestMediaFile, resolveStoreRoot } = await import(
  pathToFileURL(path.join(ROOT, "packages/media-store/dist/index.js")).href
);
const bytes = readFileSync(values.file);
const result = await ingestMediaFile({
  bytes,
  fileName: path.basename(values.file),
  root: resolveStoreRoot(),
  generateProxy: !values["no-proxy"],
});
if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}
console.log(JSON.stringify(result.asset, null, 2));
```

- [ ] **Step 4: 跑 CLI 测试确认通过**

Run: `pnpm --filter @acs/media-store run build && node --test scripts/video/media-ingest.test.mjs`
Expected: 3 pass。

- [ ] **Step 5: 路由测试先写**

`apps/web/package.json`：dependencies 增 `"@acs/media-store": "workspace:*"`；test 脚本改

```json
"test": "node --import tsx --test \"src/app/video-studio/*.test.ts\" \"src/app/api/**/*.test.ts\""
```

`apps/web/src/app/api/media/ingest/route.test.ts`：

```ts
// P2.5-T2 路由：直接调 POST handler（绕过 Next 服务器）。NODE_ENV 门、
// formData、错误映射（reasonCode → HTTP 码）。仓/临时用 tmp。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { POST } from "./route";

const WORK = mkdtempSync(path.join(tmpdir(), "acs-route-test-"));

function makeVideoBytes(name: string): Buffer {
  const file = path.join(WORK, name);
  const spawned = spawnSync(
    "ffmpeg",
    ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=640x360:rate=24", "-pix_fmt", "yuv420p", file],
    { encoding: "utf8" },
  );
  assert.equal(spawned.status, 0, spawned.stderr);
  return readFileSync(file);
}

function post(file: File): Response {
  const form = new FormData();
  form.append("file", file);
  return POST(new Request("http://localhost:3210/api/media/ingest", { method: "POST", body: form }));
}

test("NODE_ENV 门：非 development → 503", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const response = await post(new File([makeVideoBytes("gate.mp4")], "gate.mp4", { type: "video/mp4" }));
    assert.equal(response.status, 503);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("成功：development + 有效文件 → 200 {asset}；坏扩展 → 415；坏内容 → 422", async () => {
  const previousEnv = process.env.NODE_ENV;
  const previousStore = process.env.ACS_MEDIA_STORE;
  const store = mkdtempSync(path.join(tmpdir(), "acs-route-store-"));
  process.env.NODE_ENV = "development";
  process.env.ACS_MEDIA_STORE = store;
  try {
    const ok = await post(new File([makeVideoBytes("ok.mp4")], "ok.mp4", { type: "video/mp4" }));
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as { asset: { assetId: string; original: { storeKey: string } } };
    assert.match(body.asset.assetId, /^[0-9a-f-]{36}$/);
    assert.match(body.asset.original.storeKey, /^[0-9a-f]{16}\.mp4$/);

    const badExt = await post(new File([Buffer.from("x")], "clip.gif", { type: "application/octet-stream" }));
    assert.equal(badExt.status, 415);

    const badContent = await post(new File([Buffer.from("这不是视频")], "fake.mp4", { type: "video/mp4" }));
    assert.equal(badContent.status, 422);
    assert.ok(!readdirSync(store).includes("original"), "失败不得写仓");
  } finally {
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
    if (previousStore === undefined) delete process.env.ACS_MEDIA_STORE;
    else process.env.ACS_MEDIA_STORE = previousStore;
  }
});

test("缺 file 字段 → 400", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const form = new FormData();
    form.append("notfile", "x");
    const response = await POST(
      new Request("http://localhost:3210/api/media/ingest", { method: "POST", body: form }),
    );
    assert.equal(response.status, 400);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("origin 异源 → 403；content-length 超限 → 413（spec §4.11 全码位）", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const crossSiteForm = new FormData();
    crossSiteForm.append("file", new File([Buffer.from("x")], "clip.mp4", { type: "video/mp4" }));
    const crossSite = await POST(
      new Request("http://localhost:3210/api/media/ingest", {
        method: "POST",
        body: crossSiteForm,
        headers: { origin: "http://evil.example" },
      }),
    );
    assert.equal(crossSite.status, 403);

    const oversized = await POST(
      new Request("http://localhost:3210/api/media/ingest", {
        method: "POST",
        body: "x",
        headers: { "content-length": "500000001" },
      }),
    );
    assert.equal(oversized.status, 413);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
```

`apps/web/src/app/api/media/file/[storeKey]/route.test.ts`：

```ts
// P2.5-T2 GET 文件路由：形状门 400、original 命中 200、proxy 回退、404、
// Range 206。params 是 Promise（Next 16），直接构造 ctx。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ingestMediaFile } from "@acs/media-store";
import { GET } from "./route";

const WORK = mkdtempSync(path.join(tmpdir(), "acs-get-test-"));

async function get(url: string, headers?: Record<string, string>): Promise<Response> {
  const storeKey = decodeURIComponent(url.split("/").pop() ?? "");
  return GET(
    new Request(`http://localhost:3210/api/media/file/${storeKey}`, { headers }),
    { params: Promise.resolve({ storeKey }) },
  );
}

test("形状非法 storeKey → 400；合法形状但仓内无文件 → 404", async () => {
  assert.equal((await get("http://x/api/media/file/../evil.mp4")).status, 400);
  assert.equal((await get("http://x/api/media/file/cccccccccccccccc.mp4")).status, 404);
});

test("original 命中 → 200 正确 Content-Type 与字节一致；Range → 206 分片；proxy 回退命中", async () => {
  const previousStore = process.env.ACS_MEDIA_STORE;
  const store = mkdtempSync(path.join(tmpdir(), "acs-get-store-"));
  process.env.ACS_MEDIA_STORE = store;
  try {
    const file = path.join(WORK, "src.mp4");
    const spawned = spawnSync(
      "ffmpeg",
      ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=640x360:rate=24", "-pix_fmt", "yuv420p", file],
      { encoding: "utf8" },
    );
    assert.equal(spawned.status, 0, spawned.stderr);
    const result = await ingestMediaFile({ bytes: readFileSync(file), fileName: "src.mp4", root: store });
    assert.ok(result.ok);
    const storeKey = result.asset.original.storeKey;

    const full = await get(`http://x/api/media/file/${storeKey}`);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("content-type"), "video/mp4");
    assert.equal(full.headers.get("accept-ranges"), "bytes");
    const disk = readFileSync(path.join(store, "original", storeKey));
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), disk);

    const partial = await get(`http://x/api/media/file/${storeKey}`, { range: "bytes=0-99" });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get("content-range"), `bytes 0-99/${disk.byteLength}`);
    assert.equal((await partial.arrayBuffer()).byteLength, 100);

    // proxy 回退：删掉 original，仅留 proxy → 仍 200（T3 预览素材缺失降级依赖）
    rmSync(path.join(store, "original", storeKey));
    mkdirSync(path.join(store, "proxy"), { recursive: true });
    writeFileSync(path.join(store, "proxy", `${storeKey.slice(0, 16)}.proxy.mp4`), Buffer.from("proxy-bytes"));
    const fallback = await get(`http://x/api/media/file/${storeKey}`);
    assert.equal(fallback.status, 200);
    assert.deepEqual(Buffer.from(await fallback.arrayBuffer()), Buffer.from("proxy-bytes"));
  } finally {
    if (previousStore === undefined) delete process.env.ACS_MEDIA_STORE;
    else process.env.ACS_MEDIA_STORE = previousStore;
  }
});
```

- [ ] **Step 6: 跑路由测试确认失败**

Run: `pnpm --filter @acs/web test`
Expected: 新路由测试因 `Cannot find module './route'` 失败（RED）；既有 126 条保持绿（glob 扩展不影响旧路径）。

- [ ] **Step 7: 实现两个路由**

`apps/web/src/app/api/media/ingest/route.ts`：

```ts
// P2.5-T2 媒体上传导入（spec §1.2）：dev 门/origin/413/formData → 导入管线。
// 不写项目文档——返回 MediaAsset，账本追加是工作台（T3）的职责。
import { ingestMediaFile, resolveStoreRoot, type IngestReasonCode } from "@acs/media-store";

const MAX_UPLOAD_BYTES = 500_000_000;

const STATUS_BY_REASON: Record<IngestReasonCode, number> = {
  "unsupported-format": 415,
  "probe-failed": 422,
  "decode-failed": 422,
  "duration-out-of-range": 422,
  "proxy-failed": 500,
  "store-error": 500,
};

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "媒体导入仅在本地开发环境开放。" }, { status: 503 });
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "跨站请求已拒绝。" }, { status: 403 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES) {
    return Response.json({ error: "媒体文件过大（上限 500MB）。" }, { status: 413 });
  }
  let file: File;
  try {
    const form = await request.formData();
    const candidate = form.get("file");
    if (!(candidate instanceof File)) throw new Error("missing file");
    file = candidate;
  } catch {
    return Response.json(
      { error: "请求须为 multipart/form-data 且含 file 字段。" },
      { status: 400 },
    );
  }
  let root: string;
  try {
    root = resolveStoreRoot();
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
  const result = await ingestMediaFile({
    bytes: Buffer.from(await file.arrayBuffer()),
    fileName: file.name,
    root,
  });
  if (!result.ok) {
    return Response.json(
      { error: result.error },
      { status: STATUS_BY_REASON[result.reasonCode] },
    );
  }
  return Response.json({ asset: result.asset });
}
```

`apps/web/src/app/api/media/file/[storeKey]/route.ts`：

```ts
// P2.5-T2 媒体文件流式 GET（spec §1.2）：storeKey 形状门（防穿越）→
// original 命中 → proxy 回退 → 404。Range 单段 206（预览 seek 最小需要）。
import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { originalPath, proxyPath, resolveStoreRoot } from "@acs/media-store";

const CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

function streamFile(
  filePath: string,
  contentType: string,
  size: number,
  rangeHeader: string | null,
): Response {
  if (rangeHeader !== null) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (match === null) {
      return new Response(null, { status: 416, headers: { "accept-ranges": "bytes" } });
    }
    const start = match[1] === "" ? 0 : Number(match[1]);
    const end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
    if (start > end || start >= size) {
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${size}` },
      });
    }
    return new Response(
      Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream,
      {
        status: 206,
        headers: {
          "content-type": contentType,
          "content-length": String(end - start + 1),
          "content-range": `bytes ${start}-${end}/${size}`,
          "accept-ranges": "bytes",
        },
      },
    );
  }
  return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream, {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-length": String(size),
      "accept-ranges": "bytes",
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeKey: string }> },
) {
  const { storeKey } = await params;
  let root: string;
  try {
    root = resolveStoreRoot();
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
  let original: string;
  let proxy: string;
  try {
    original = originalPath(root, storeKey);
    proxy = proxyPath(root, storeKey);
  } catch {
    return Response.json({ error: "storeKey 形状非法。" }, { status: 400 });
  }
  const extension = storeKey.split(".")[1] ?? "";
  const contentType = CONTENT_TYPES[extension];
  if (contentType === undefined) {
    return Response.json({ error: "storeKey 形状非法。" }, { status: 400 });
  }
  for (const candidate of [
    [original, contentType] as const,
    [proxy, "video/mp4"] as const,
  ]) {
    try {
      const stat = statSync(candidate[0]);
      return streamFile(candidate[0], candidate[1], stat.size, request.headers.get("range"));
    } catch {
      // 未命中，试下一个
    }
  }
  return Response.json({ error: "仓内无此媒体文件。" }, { status: 404 });
}
```

- [ ] **Step 8: 跑路由测试确认通过 + pnpm install 链接依赖**

Run: `pnpm install && pnpm --filter @acs/media-store run build && pnpm --filter @acs/web test`
Expected: 旧 126 + 新 7 条全绿。

- [ ] **Step 9: 全栈回归 + biome + 提交**

```bash
pnpm --filter @acs/media-store test        # 25 pass
pnpm --filter @acs/video-document test     # 104 pass
pnpm --filter @acs/video-scene test        # 131 pass
pnpm --filter @acs/web test                # 126 + 路由测试全绿
pnpm --filter @acs/web run typecheck       # 零错
node --test "scripts/video/*.test.mjs"     # 57 + 3 = 60 pass
pnpm -r typecheck                          # 含新包零错
npx biome check --write packages/media-store scripts/video/media-ingest.mjs scripts/video/media-ingest.test.mjs "apps/web/src/app/api/media/**"
wc -l artifacts/tts-usage.jsonl            # 34 不变
git add packages/media-store scripts/video/media-ingest.mjs scripts/video/media-ingest.test.mjs apps/web
git commit -m "feat(video-studio): P2.5-T2 media-ingest CLI + Next 双路由（上传导入/流式取文件）+ web 接线"
```

---

## Review Focus（spec 未点名、最可能咬人的五类输入——已各自钉进所属任务的测试）

1. **storeKey 路径穿越注入**（`../`、反斜杠、大小写 hex、错扩展名）→ originalPath/proxyPath 形状门 throw，GET 400 —— Task 1 Step 2 形状门 7 例 + Task 5 GET `../evil.mp4` 400。
2. **ffmpeg/ffprobe 不在 PATH**（用户机器未装）→ 中文大声失败而非 ENOENT 栈炸 —— Task 2 Step 1 的 ENOENT 测试已钉（`process.env.PATH` 置空/恢复包裹，断言 `未找到 ffprobe（请安装 FFmpeg 并加入 PATH）`）。
3. **空文件 / 无扩展名 / `.MP4` 大写** → S1 拒前两者、归一放行大写（Windows 用户常态）—— Task 4 Step 1 S1 三例已钉。
4. **仓被部分手删**（original 没了 proxy 还在）→ GET 命中 proxy 返回 200（T3 预览降级的依赖面），合法形状无文件 → 404 —— Task 5 GET proxy 回退测试已钉。
5. **转码失败的回滚分寸**（新写删 / 预存不动）→ W2 双场景 —— Task 4 Step 1 W2 A/B 两场景已钉。

---

## 全量验收（Task 5 Step 9 汇总，执行者逐条对照）

- spec §4 测试清单 1-13 全部有对应测试落账（1↔T2、2↔T2 文本+T4 截断（spec 说的 1 帧短素材归 P6 家族，T4 注入 199ms 覆盖该类）、3↔T2 parseFps、4↔T1、5↔T1、6↔T4 happy（含仓文件 sha256 复核）/幂等 mtime、7↔T4 P6/D1+零残留、8↔T3、9↔T3、10↔T5 CLI、11↔T5 POST（503/403/413/400/415/422/200 全码位）、12↔T5 GET（400/404/200/206/proxy 回退）、13↔T5 glob）。
- spec §6 验收 1-5：计数目标 media-store 25 / video-document 104 / video-scene 131 / web 133（126+7）/ scripts 60；typecheck `-r` 含新包；biome；gitignore 核对结论记入提交信息（无需改行）；台账 34 行。
