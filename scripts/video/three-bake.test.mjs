// P3-B Task 3 烘焙内核单测：node --test scripts/video/three-bake.test.mjs
// 原则：全部用假 deps（不启浏览器、不跑 ffmpeg）；只让真实 HTTP 静态服务与
// 真实文件落盘参与，验证可观察行为（逐帧文件、摘要、编码产物、清理）。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  BAKE_FPS,
  bakeThreeShots,
  buildBakeJobs,
  ENCODE_TIMEOUT_MS,
  quoteShellArg,
  runEncoder,
} from "./bake-three.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const { quantizeTimeline } = await import(
  pathToFileURL(path.join(ROOT, "packages/video-document/dist/index.js")).href
);

const DEFAULT_RENDERER = "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))";

function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function sha256(data) {
  return sha256Buffer(Buffer.from(data, "utf8"));
}

function pngDataUrl(bytes) {
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

function threeSpec(durationMs, params = {}) {
  return {
    specVersion: 1,
    componentId: "orbit3d",
    componentVersion: 1,
    durationMs,
    seed: 7,
    background: "#101820",
    params,
  };
}

let nextId = 1;
function uuid() {
  const tail = String(nextId++).padStart(12, "0");
  return `00000000-0000-4000-8000-${tail}`;
}

function shotOf(order, durationMs, sceneSource) {
  const versionId = uuid();
  return {
    shotId: uuid(),
    order,
    locked: false,
    workingVersionId: versionId,
    contentVersions: [
      {
        versionId,
        createdAt: "2026-10-21T00:00:00.000Z",
        durationMs,
        description: `镜头 ${order + 1}`,
        narrationText: "",
        sceneSource,
        provenance: { engineId: "three-registry", engineVersion: "1" },
      },
    ],
    events: [
      {
        kind: "submitted",
        versionId,
        at: "2026-10-21T00:00:00.000Z",
        actor: "human",
      },
    ],
  };
}

function specShotSource() {
  return { type: "spec", spec: { specVersion: 1 } };
}

function threeShotSource(durationMs) {
  return { type: "three", spec: threeSpec(durationMs) };
}

function projectOf(shots) {
  return {
    schemaVersion: 1,
    id: uuid(),
    title: "烘焙测试",
    brief: { sentence: "测试", aspectTargets: ["landscape", "portrait"] },
    shots,
    renderRecords: [],
    deliveries: [],
    savedVersion: 1,
  };
}

function jobOf(overrides = {}) {
  return {
    aspect: "landscape",
    shotIndex: 0,
    label: "镜头 1",
    spec: threeSpec(1000),
    width: 64,
    height: 36,
    frames: 3,
    ...overrides,
  };
}

function tempDir(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "three-bake-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function realHashFile(file) {
  return sha256Buffer(readFileSync(file));
}

function makeHarness({
  frames = (frame) => pngDataUrl(`frame-${frame}`),
  info = {},
  consoleErrors = [],
} = {}) {
  const record = {
    pageClose: 0,
    contextClose: 0,
    browserClose: 0,
    configs: [],
    frameArgs: [],
    encodeCalls: 0,
  };
  const listeners = {};
  const page = {
    on(type, callback) {
      (listeners[type] ??= []).push(callback);
    },
    async addInitScript(_fn, config) {
      record.configs.push(config);
    },
    async goto() {
      for (const text of consoleErrors) {
        for (const callback of listeners.console ?? []) {
          callback({ type: () => "error", text: () => text });
        }
      }
    },
    async waitForFunction() {},
    async evaluate(fn, arg) {
      if (String(fn).includes("bakeInfo")) {
        return {
          info: {
            ready: true,
            threeVersion: "186",
            width: 64,
            height: 36,
            dpr: 1,
            antialias: false,
            preserveDrawingBuffer: true,
            glRenderer: DEFAULT_RENDERER,
            glVersion: "WebGL 2.0",
            colorSpace: "srgb",
            ...info,
          },
          error: null,
        };
      }
      record.frameArgs.push(arg);
      return frames(arg);
    },
    async close() {
      record.pageClose += 1;
    },
  };
  const context = {
    async newPage() {
      return page;
    },
    async close() {
      record.contextClose += 1;
    },
  };
  const browser = {
    version: () => "Chromium 999.0.0.0",
    async newContext() {
      return context;
    },
    async close() {
      record.browserClose += 1;
    },
  };
  return {
    record,
    deps: {
      launchBrowser: async () => browser,
      hashFile: realHashFile,
      encode: async (_framesDir, _fps, outFile) => {
        record.encodeCalls += 1;
        writeFileSync(outFile, "encoded-mp4-bytes");
      },
    },
  };
}

// —— buildBakeJobs ——

test("buildBakeJobs：帧数取累计量化的 span（与 quantizeTimeline 对拍）", () => {
  const project = projectOf([
    shotOf(0, 1000, specShotSource()),
    shotOf(1, 500, threeShotSource(500)),
    shotOf(2, 700, specShotSource()),
  ]);
  const jobs = buildBakeJobs({
    project,
    aspects: ["landscape", "portrait"],
  });
  const timeline = quantizeTimeline([1000, 500, 700], BAKE_FPS);

  assert.equal(BAKE_FPS, 24);
  assert.equal(jobs.length, 2);
  assert.deepEqual(
    jobs.map((job) => [
      job.aspect,
      job.shotIndex,
      job.frames,
      job.width,
      job.height,
    ]),
    [
      ["landscape", 1, timeline.shots[1].frames, 1280, 720],
      ["portrait", 1, timeline.shots[1].frames, 720, 1280],
    ],
  );
  assert.match(jobs[0].label, /镜头 2/);
  assert.equal(jobs[0].spec.componentId, "orbit3d");
  assert.equal(jobs[0].spec.params.shape, "box");
});

test("buildBakeJobs：无 three 镜头返回空数组", () => {
  const project = projectOf([
    shotOf(0, 1000, specShotSource()),
    shotOf(1, 1000, specShotSource()),
  ]);
  assert.deepEqual(
    buildBakeJobs({ project, aspects: ["landscape", "portrait"] }),
    [],
  );
});

// —— bakeThreeShots ——

test("bakeThreeShots：逐帧落盘、命名 %04d.png、framesDigest = sha256(逐帧 hex 用 \\n 串联)", async (t) => {
  const outDir = tempDir(t);
  const harness = makeHarness({
    frames: (frame) => pngDataUrl(`frame-payload-${frame}`),
  });
  const jobs = [jobOf({ frames: 3 })];

  const [result] = await bakeThreeShots({ jobs, outDir, deps: harness.deps });

  const framesDir = path.join(outDir, "frames", "landscape-shot-1");
  const hashes = [];
  for (let index = 0; index < 3; index += 1) {
    const file = path.join(framesDir, `${String(index).padStart(4, "0")}.png`);
    assert.ok(existsSync(file), `缺少 ${file}`);
    assert.equal(
      readFileSync(file, "utf8"),
      `frame-payload-${index}`,
      "落盘字节须与页面返回一致",
    );
    hashes.push(sha256Buffer(readFileSync(file)));
  }
  assert.equal(result.framesDigest, sha256(hashes.join("\n")));
  assert.equal(result.shotIndex, 0);
  assert.equal(result.aspect, "landscape");
});

test("bakeThreeShots：frameHashes 逐帧顺序与文件一致（供 manifest 消费）", async (t) => {
  const outDir = tempDir(t);
  const harness = makeHarness({
    frames: (frame) => pngDataUrl(`ordered-${frame}`),
  });

  const [result] = await bakeThreeShots({
    jobs: [jobOf({ frames: 4 })],
    outDir,
    deps: harness.deps,
  });

  const framesDir = path.join(outDir, "frames", "landscape-shot-1");
  const expected = [0, 1, 2, 3].map((index) =>
    sha256Buffer(
      readFileSync(
        path.join(framesDir, `${String(index).padStart(4, "0")}.png`),
      ),
    ),
  );
  assert.deepEqual(result.frameHashes, expected);
  assert.equal(result.frameHashes.length, 4);
});

test("bakeThreeShots：storeKey = clipSha256 前 16 位 + .mp4，落在 <out>/original/", async (t) => {
  const outDir = tempDir(t);
  const clipSha256 = `${"0123456789abcdef"}${"f".repeat(48)}`;
  const harness = makeHarness();
  harness.deps.hashFile = async () => clipSha256;

  const [result] = await bakeThreeShots({
    jobs: [jobOf({ frames: 2 })],
    outDir,
    deps: harness.deps,
  });

  assert.equal(result.clipSha256, clipSha256);
  assert.equal(result.storeKey, "0123456789abcdef.mp4");
  assert.equal(
    result.clipPath,
    path.join(outDir, "original", "0123456789abcdef.mp4"),
  );
  assert.ok(existsSync(result.clipPath));
  assert.equal(readFileSync(result.clipPath, "utf8"), "encoded-mp4-bytes");
});

test("bakeThreeShots：渲染器不含 SwiftShader 时中文报错并含镜头号", async (t) => {
  const outDir = tempDir(t);
  const harness = makeHarness({
    info: { glRenderer: "ANGLE (Intel, Intel(R) UHD Graphics, D3D11)" },
  });

  await assert.rejects(
    bakeThreeShots({ jobs: [jobOf()], outDir, deps: harness.deps }),
    (error) => {
      assert.match(error.message, /SwiftShader/);
      assert.match(error.message, /3D 输出不可复现，已拒绝/);
      assert.match(error.message, /镜头 1/);
      assert.match(error.message, /64x36/);
      assert.match(error.message, /landscape/);
      return true;
    },
  );
});

test("bakeThreeShots：页面 console error 时失败且带首条错误", async (t) => {
  const outDir = tempDir(t);
  const harness = makeHarness({
    consoleErrors: ["着色器编译失败：bad shader"],
  });

  await assert.rejects(
    bakeThreeShots({ jobs: [jobOf()], outDir, deps: harness.deps }),
    (error) => {
      assert.match(error.message, /镜头 1/);
      assert.match(error.message, /着色器编译失败：bad shader/);
      return true;
    },
  );
});

test("bakeThreeShots：帧数与 jobs 不符时失败", async (t) => {
  const outDir = tempDir(t);
  const harness = makeHarness({
    frames: (frame) =>
      frame < 2 ? pngDataUrl(`ok-${frame}`) : "not-a-png-data-url",
  });

  await assert.rejects(
    bakeThreeShots({
      jobs: [jobOf({ frames: 3 })],
      outDir,
      deps: harness.deps,
    }),
    (error) => {
      assert.match(error.message, /镜头 1/);
      assert.match(error.message, /PNG/);
      assert.match(error.message, /2\/3/);
      return true;
    },
  );
});

test("bakeThreeShots：编码失败时保留 ffmpeg 末 20 行 stderr", async (t) => {
  const outDir = tempDir(t);
  const framesDir = path.join(outDir, "frames");
  mkdirSync(framesDir, { recursive: true });
  const stderr = Array.from(
    { length: 25 },
    (_, i) => `stderr 行 ${i + 1}`,
  ).join("\n");
  const fakeSpawn = () => ({ status: 1, stdout: "", stderr });

  assert.throws(
    () =>
      runEncoder(
        framesDir,
        BAKE_FPS,
        path.join(framesDir, "clip.mp4"),
        fakeSpawn,
      ),
    (error) => {
      assert.match(error.message, /ffmpeg 编码失败/);
      assert.match(error.message, /stderr 行 25/);
      assert.match(error.message, /stderr 行 6/);
      assert.doesNotMatch(error.message, /stderr 行 5$/m);
      assert.doesNotMatch(error.message, /stderr 行 1$/m);
      return true;
    },
  );

  const harness = makeHarness();
  harness.deps.encode = () =>
    runEncoder(
      framesDir,
      BAKE_FPS,
      path.join(framesDir, "clip.mp4"),
      fakeSpawn,
    );

  await assert.rejects(
    bakeThreeShots({
      jobs: [jobOf({ frames: 2 })],
      outDir,
      deps: harness.deps,
    }),
    (error) => {
      assert.match(error.message, /镜头 1/);
      assert.match(error.message, /stderr 行 25/);
      return true;
    },
  );
});

// —— runEncoder：shell 拼接下的引号与超时（Codex 复核 A/B） ——
// 预期引号按平台在测试内独立推导，避免直接复用实现（否则同错同过）。
function expectedQuote(arg) {
  return process.platform === "win32"
    ? `"${arg.replaceAll('"', '""')}"`
    : `'${arg.replaceAll("'", "'\\''")}'`;
}

function captureSpawn(result = { status: 0, stdout: "", stderr: "" }) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    return result;
  };
  return { calls, spawn };
}

test("quoteShellArg：平台对应引号并转义内嵌引号", () => {
  if (process.platform === "win32") {
    assert.equal(quoteShellArg("a b"), '"a b"');
    assert.equal(quoteShellArg('x"y z'), '"x""y z"');
  } else {
    assert.equal(quoteShellArg("a b"), "'a b'");
    assert.equal(quoteShellArg("a'b c"), "'a'\\''b c'");
  }
});

test("quoteShellArg：Windows 结尾反斜杠加倍，避免吞掉收尾引号", () => {
  if (process.platform !== "win32") return;
  // CRT 解析 `"C:\dir\"` 时把 \" 当转义引号，收尾引号被吞、后续 token 并进来。
  assert.equal(
    quoteShellArg("C:\\dir with space\\"),
    '"C:\\dir with space\\\\"',
  );
  assert.equal(quoteShellArg("C:\\plain"), '"C:\\plain"');
});

test("runEncoder：非超时的进程错误不谎报超时", () => {
  const { spawn } = captureSpawn({
    status: null,
    stdout: "",
    stderr: "",
    error: Object.assign(new Error("spawn pnpm ENOENT"), { code: "ENOENT" }),
  });
  const framesDir = path.join(tmpdir(), "frames-enoent");

  assert.throws(
    () =>
      runEncoder(framesDir, BAKE_FPS, path.join(framesDir, "clip.mp4"), spawn),
    (error) => {
      assert.match(error.message, /进程错误/);
      assert.match(error.message, /ENOENT/);
      assert.doesNotMatch(error.message, /超时（timeout=/);
      return true;
    },
  );
});

test("runEncoder：含空格的帧目录与输出路径在 shell 下是带引号的单 token", () => {
  const { calls, spawn } = captureSpawn();
  const framesDir = path.join(tmpdir(), "frames with space");
  const outFile = path.join(tmpdir(), "out dir", "clip with space.mp4");

  runEncoder(framesDir, BAKE_FPS, outFile, spawn);

  assert.equal(calls.length, 1);
  const { command, args } = calls[0];
  const expectedFrames = expectedQuote(path.join(framesDir, "%04d.png"));
  const expectedOut = expectedQuote(outFile);

  assert.equal(command, expectedQuote("pnpm"), "pnpm 命令名须预加引号");
  assert.ok(args.includes(expectedFrames), "帧目录须为带引号的单 token");
  assert.ok(args.includes(expectedOut), "输出路径须为带引号的单 token");
  // 任何含空白的元素都必须整体带引号——漏一个就会被 shell 拆成多个 token。
  const [open, close] = process.platform === "win32" ? ['"', '"'] : ["'", "'"];
  for (const arg of args) {
    if (/\s/.test(arg)) {
      assert.ok(
        arg.startsWith(open) && arg.endsWith(close),
        `含空格的参数未整体加引号: ${arg}`,
      );
    }
  }
  // 头部元素同样逐项加引号，避免 "@acs/remotion-engine" 等被 shell 重解释。
  for (const head of [
    "--filter",
    "@acs/remotion-engine",
    "remotion",
    "ffmpeg",
  ]) {
    assert.ok(args.includes(expectedQuote(head)), `头部参数未加引号: ${head}`);
  }
});

test("runEncoder：超时（status=null + error）时报中文错误，含超时值与 stderr 末行", () => {
  const { calls, spawn } = captureSpawn({
    status: null,
    stdout: "",
    stderr: "frame=12 fps=24\n最后一行 stderr",
    signal: "SIGTERM",
    error: Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" }),
  });
  const framesDir = path.join(tmpdir(), "frames-timeout");

  assert.throws(
    () =>
      runEncoder(framesDir, BAKE_FPS, path.join(framesDir, "clip.mp4"), spawn),
    (error) => {
      assert.match(error.message, /ffmpeg 编码失败/);
      assert.match(error.message, new RegExp(String(ENCODE_TIMEOUT_MS)));
      assert.match(error.message, /超时|timeout/);
      assert.match(error.message, /最后一行 stderr/);
      return true;
    },
  );
  assert.equal(calls[0].options.timeout, ENCODE_TIMEOUT_MS, "须设置编码超时");
});

test("bakeThreeShots：编码超时错误仍带镜头号与画幅前缀", async (t) => {
  const outDir = tempDir(t);
  const harness = makeHarness();
  harness.deps.encode = (_framesDir, _fps, outFile) =>
    runEncoder(
      path.dirname(outFile),
      BAKE_FPS,
      outFile,
      captureSpawn({
        status: null,
        stdout: "",
        stderr: "超时前的 stderr",
        error: Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" }),
      }).spawn,
    );

  await assert.rejects(
    bakeThreeShots({
      jobs: [jobOf({ frames: 2 })],
      outDir,
      deps: harness.deps,
    }),
    (error) => {
      assert.match(error.message, /镜头 1/);
      assert.match(error.message, /landscape/);
      assert.match(error.message, new RegExp(String(ENCODE_TIMEOUT_MS)));
      return true;
    },
  );
});

test("bakeThreeShots：两个镜头字节相同 → 同 storeKey 不互相覆盖", async (t) => {
  const outDir = tempDir(t);
  const fixedSha = "a".repeat(64);
  const harness = makeHarness();
  harness.deps.hashFile = async () => fixedSha;
  let call = 0;
  harness.deps.encode = async (_framesDir, _fps, outFile) => {
    call += 1;
    writeFileSync(outFile, `clip-body-${call}`);
  };

  const results = await bakeThreeShots({
    jobs: [
      jobOf({ shotIndex: 0, label: "镜头 1", frames: 2 }),
      jobOf({ shotIndex: 1, label: "镜头 2", frames: 2 }),
    ],
    outDir,
    deps: harness.deps,
  });

  assert.equal(results.length, 2);
  assert.equal(results[0].storeKey, results[1].storeKey);
  assert.equal(call, 2, "两个镜头都要编码");
  const stored = path.join(outDir, "original", `${fixedSha.slice(0, 16)}.mp4`);
  assert.equal(
    readFileSync(stored, "utf8"),
    "clip-body-1",
    "先写入的片段不被覆盖",
  );
});

test("bakeThreeShots：任何失败都不留下克隆页面/浏览器进程", async (t) => {
  const outDir = tempDir(t);
  const harness = makeHarness({
    info: { glRenderer: "ANGLE (Intel, Intel(R) UHD Graphics, D3D11)" },
  });

  await assert.rejects(
    bakeThreeShots({ jobs: [jobOf()], outDir, deps: harness.deps }),
    /SwiftShader/,
  );
  assert.equal(harness.record.pageClose, 1, "page 须关闭");
  assert.equal(harness.record.contextClose, 1, "context 须关闭");
  assert.equal(harness.record.browserClose, 1, "browser 须关闭");
});
