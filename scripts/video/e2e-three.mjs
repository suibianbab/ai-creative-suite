#!/usr/bin/env node
// P3-B Task 6：three 镜头端到端确定性验收（VID-025，零 TTS 计费）。
// 不需要 dev server、浏览器或端口：夹具复制进 os.tmpdir() 临时目录后只跑两个 CLI。
//   烘焙 A/B：同一项目副本各起一个独立进程（各自新浏览器），framesDigest/clipSha256 必须相同；
//   出片 A/B：两份独立项目副本（render-scene 会回写 RenderRecord），landscape.mp4 必须逐字节一致；
//   manifest 3D 证据 → 首帧亮度 → RenderRecord 重校验 → 台账行数 → 临时目录残留。
// 退出码: 0 = 全部断言通过；1 = `[e2e-three] FAIL at <步骤>: <原因>`。
// E2E_KEEP=1 保留临时目录并打印路径（默认 finally 删除）。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { validateVideoProject } from "./delivery.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const FIXTURE = path.join(
  ROOT,
  "scripts/video/fixtures/three-sample.video-project.json",
);
const BAKE_CLI = path.join(ROOT, "scripts/video/bake-three.mjs");
const RENDER_CLI = path.join(ROOT, "scripts/video/render-scene.mjs");
const USAGE_LEDGER = path.join(ROOT, "artifacts/tts-usage.jsonl");
const ASPECTS = ["landscape", "portrait"];
const THREE_SHOT_INDEX = 0;
// fixture 3D 镜头 1000ms @24fps → 24 帧（manifest.frameHashes 条数基准）。
const THREE_SHOT_FRAMES = 24;
const EXPECTED_USAGE_LINES = 34;
const THREE_TEMP_PREFIX = "acs-three-";
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

let tempDir = null;

function describeError(error) {
  if (error === undefined || error === null) return "";
  if (typeof error === "string") return error;
  return error.message ?? String(error);
}

function cleanup() {
  if (!tempDir) return;
  if (process.env.E2E_KEEP) {
    console.log(`[e2e-three] E2E_KEEP 已设置，保留临时目录: ${tempDir}`);
    return;
  }
  try {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  } catch {
    // 清理失败不能掩盖原始失败原因。
  }
}

function fail(step, error) {
  console.error(`[e2e-three] FAIL at ${step}: ${describeError(error)}`);
  cleanup();
  process.exit(1);
}

function at(step, fn) {
  try {
    return fn();
  } catch (error) {
    fail(step, error);
  }
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function usageLines() {
  try {
    return readFileSync(USAGE_LEDGER, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0).length;
  } catch (error) {
    // 契约：台账缺失按 0 行；其他读取错误必须暴露。
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
}

function listThreeTempDirs() {
  return readdirSync(tmpdir()).filter((name) =>
    name.startsWith(THREE_TEMP_PREFIX),
  );
}

function runCli(script, args, timeout) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `CLI exit ${result.status}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  return result.stdout ?? "";
}

// bake-three 每个任务打印三行；这里只取「job 头」与紧随其后的摘要行。
function parseBake(stdout) {
  const results = [];
  let current = null;
  for (const line of stdout.split(/\r?\n/)) {
    const job =
      /^\[bake-three\] (landscape|portrait) \d+x\d+ 镜头 \d+ (\d+) 帧 → ([0-9a-f]{16}\.mp4)$/.exec(
        line,
      );
    if (job) {
      current = {
        aspect: job[1],
        frames: Number(job[2]),
        storeKey: job[3],
      };
      results.push(current);
      continue;
    }
    const digest =
      /^\[bake-three\] framesDigest=([0-9a-f]{64}) clipSha256=([0-9a-f]{64})$/.exec(
        line,
      );
    if (digest && current) {
      current.framesDigest = digest[1];
      current.clipSha256 = digest[2];
    }
  }
  return results;
}

// Remotion 自带 ffmpeg 是 `--disable-filters` 定制构建：没有 signalstats/select/metadata
// （只启用 scale/colorspace 等少量过滤器）。因此仍用同一二进制（与烘焙同源，不依赖
// PATH 上的 ffmpeg）把首帧 area 缩放成 1×1 PNG，再在 Node 侧按 BT.601 求亮度均值。
// 口径：黑帧 RGB 均值 0（signalstats 黑帧 YAVG=16），阈值 >16 只比原口径更严。
function firstFrameLuma(videoPath) {
  const result = spawnSync(
    "pnpm",
    [
      "--filter",
      "@acs/remotion-engine",
      "exec",
      "remotion",
      "ffmpeg",
      "-v",
      "error",
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-vf",
      "scale=1:1:flags=area",
      "-c:v",
      "png",
      "-f",
      "image2pipe",
      "-",
    ],
    {
      cwd: ROOT,
      shell: true,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `ffmpeg exit ${result.status}: ${String(result.stderr ?? "").slice(0, 400)}`,
    );
  const { r, g, b } = decodePng1x1(result.stdout ?? Buffer.alloc(0));
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function decodePng1x1(buffer) {
  const start = buffer.indexOf(PNG_SIGNATURE);
  assert.ok(start >= 0, "ffmpeg 未返回 PNG");
  let offset = start + PNG_SIGNATURE.length;
  let header = null;
  const idat = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
      };
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  assert.ok(header, "PNG 缺少 IHDR");
  assert.equal(header.width, 1, "PNG 宽不是 1");
  assert.equal(header.height, 1, "PNG 高不是 1");
  assert.equal(header.bitDepth, 8, "PNG 位深不是 8");
  assert.ok(
    header.colorType === 2 || header.colorType === 6,
    `意外的 PNG colorType ${header.colorType}`,
  );
  const channels = header.colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  // 1×1 图只有一行一个像素：任何 PNG 行滤波器都退化为原值（无左/上邻居）。
  assert.equal(raw.length, 1 + channels, "1×1 PNG 扫描行长度不符");
  return { r: raw[1], g: raw[2], b: raw[3] };
}

async function main() {
  const usageBefore = at("计费台账（读取前）", usageLines);
  const threeTempBefore = at("临时目录基线", listThreeTempDirs);
  const fixture = at("读取夹具", () => readJson(FIXTURE));
  const mediaAssetsBefore = fixture.mediaAssets?.length ?? 0;

  tempDir = mkdtempSync(path.join(tmpdir(), "e2e-three-"));
  const projectPath = path.join(tempDir, "project.json");
  const rerunProjectPath = path.join(tempDir, "project-rerun.json");
  at("临时目录与夹具", () => {
    copyFileSync(FIXTURE, projectPath);
    copyFileSync(FIXTURE, rerunProjectPath);
  });

  // —— 1. 烘焙 A/B：同一项目副本、两个独立进程、两次新浏览器 ——
  const bakeA = at("烘焙 A", () =>
    parseBake(
      runCli(
        BAKE_CLI,
        ["--project", projectPath, "--out", path.join(tempDir, "bake-a")],
        300_000,
      ),
    ),
  );
  const bakeB = at("烘焙 B", () =>
    parseBake(
      runCli(
        BAKE_CLI,
        ["--project", projectPath, "--out", path.join(tempDir, "bake-b")],
        300_000,
      ),
    ),
  );
  at("烘焙输出形状", () => {
    for (const [label, results] of [
      ["A", bakeA],
      ["B", bakeB],
    ]) {
      assert.equal(
        results.length,
        ASPECTS.length,
        `烘焙 ${label} 任务数 ${results.length} ≠ ${ASPECTS.length}`,
      );
      for (const item of results) {
        assert.equal(
          item.frames,
          THREE_SHOT_FRAMES,
          `烘焙 ${label} ${item.aspect} 帧数 ${item.frames} ≠ ${THREE_SHOT_FRAMES}`,
        );
        assert.match(item.framesDigest, /^[0-9a-f]{64}$/);
        assert.match(item.clipSha256, /^[0-9a-f]{64}$/);
      }
    }
  });
  at("烘焙 A/B 确定性", () =>
    assert.deepEqual(
      bakeB,
      bakeA,
      "两次独立烘焙的 framesDigest/clipSha256 不一致",
    ),
  );
  const bakeByAspect = new Map(bakeA.map((item) => [item.aspect, item]));
  console.log("[e2e-three] 烘焙 A/B 一致（framesDigest / clipSha256）:");
  for (const item of bakeA) {
    console.log(
      `  ${item.aspect}: ${item.frames} 帧 framesDigest=${item.framesDigest} clipSha256=${item.clipSha256}`,
    );
  }

  // —— 2. 出片 A/B：独立项目副本（render-scene 会回写 RenderRecord）——
  const renderAOut = path.join(tempDir, "render-a");
  const renderBOut = path.join(tempDir, "render-b");
  at("出片 A", () =>
    runCli(
      RENDER_CLI,
      ["--project", projectPath, "--out", renderAOut],
      600_000,
    ),
  );
  at("出片 B", () =>
    runCli(
      RENDER_CLI,
      ["--project", rerunProjectPath, "--out", renderBOut],
      600_000,
    ),
  );

  const videosA = {};
  for (const aspect of ASPECTS) {
    const file = path.join(renderAOut, `${aspect}.mp4`);
    videosA[aspect] = file;
  }
  at("出片产物存在且非空", () => {
    for (const aspect of ASPECTS) {
      const file = videosA[aspect];
      assert.ok(existsSync(file), `缺少 ${aspect}.mp4`);
      assert.ok(statSync(file).size > 0, `${aspect}.mp4 为空`);
    }
  });

  const hashesA = {};
  const hashesB = {};
  at("出片 A/B 字节一致", () => {
    for (const aspect of ASPECTS) {
      hashesA[aspect] = sha256(videosA[aspect]);
      hashesB[aspect] = sha256(path.join(renderBOut, `${aspect}.mp4`));
    }
    assert.equal(
      hashesA.landscape,
      hashesB.landscape,
      "两次完整出片的 landscape.mp4 SHA-256 不一致",
    );
  });
  console.log("[e2e-three] 出片 A/B SHA-256:");
  for (const aspect of ASPECTS) {
    console.log(
      `  ${aspect}: A=${hashesA[aspect]} B=${hashesB[aspect]}${hashesA[aspect] === hashesB[aspect] ? "（一致）" : ""}`,
    );
  }

  // —— 3. manifest 3D 证据：SwiftShader + 逐帧哈希条数 + 与烘焙摘要互证 ——
  const manifest = at("读取 manifest", () =>
    readJson(path.join(renderAOut, "render-manifest.json")),
  );
  const evidence = {};
  at("manifest 3D 证据", () => {
    for (const aspect of ASPECTS) {
      const shots = manifest.aspects?.[aspect]?.three?.shots;
      assert.ok(
        Array.isArray(shots) && shots.length === 1,
        `${aspect}.three.shots 应恰有 1 条`,
      );
      const shot = shots[0];
      assert.equal(shot.shotIndex, THREE_SHOT_INDEX, "shotIndex 不符");
      assert.match(
        shot.glRenderer,
        /SwiftShader/,
        "glRenderer 未含 SwiftShader",
      );
      assert.equal(
        shot.frameHashes.length,
        THREE_SHOT_FRAMES,
        `${aspect} frameHashes 条数 ${shot.frameHashes.length} ≠ ${THREE_SHOT_FRAMES}`,
      );
      const baked = bakeByAspect.get(aspect);
      assert.equal(
        shot.framesDigest,
        baked.framesDigest,
        `${aspect} manifest framesDigest 与独立烘焙不一致`,
      );
      assert.match(shot.threeVersion, /^\d+\.\d+\.\d+$/);
      assert.match(shot.chromiumVersion, /^\d+/);
      evidence[aspect] = shot;
    }
  });
  console.log(
    `[e2e-three] manifest 3D 证据: ${ASPECTS.map((aspect) => `${aspect} frameHashes=${evidence[aspect].frameHashes.length}`).join(", ")}`,
  );
  console.log(
    `[e2e-three] 渲染环境: Chromium=${evidence.landscape.chromiumVersion}｜three=${evidence.landscape.threeVersion}｜渲染器=${evidence.landscape.glRenderer}`,
  );

  // —— 4. 非黑：3D 镜头首帧（整片第 0 帧）亮度 > 16 ——
  const luma = at("首帧亮度提取", () => firstFrameLuma(videosA.landscape));
  at("非黑断言", () =>
    assert.ok(luma > 16, `3D 镜头首帧亮度 ${luma.toFixed(2)} ≤ 16（疑似黑帧）`),
  );
  console.log(
    `[e2e-three] landscape 3D 镜头首帧亮度=${luma.toFixed(2)}（>16）`,
  );

  // —— 5. RenderRecord：three 七字段 + 重校验通过 + mediaAssets 不变 ——
  at("RenderRecord 与重校验", () => {
    for (const [label, file] of [
      ["A", projectPath],
      ["B", rerunProjectPath],
    ]) {
      const project = validateVideoProject(readJson(file));
      assert.equal(
        project.mediaAssets.length,
        mediaAssetsBefore,
        `项目 ${label} mediaAssets 长度变化`,
      );
      const records = project.renderRecords.filter(
        (record) => record.three !== undefined,
      );
      assert.equal(
        records.length,
        ASPECTS.length,
        `项目 ${label} 带 three 的 RenderRecord 数 ${records.length} ≠ ${ASPECTS.length}`,
      );
      for (const record of records) {
        for (const key of [
          "componentId",
          "componentVersion",
          "threeVersion",
          "chromiumVersion",
          "glRenderer",
          "framesDigest",
          "clipSha256",
        ]) {
          assert.ok(
            Object.hasOwn(record.three, key),
            `RenderRecord.three 缺少 ${key}`,
          );
        }
        assert.equal(record.three.componentId, "orbit3d", "componentId 不符");
        assert.match(
          record.three.glRenderer,
          /SwiftShader/,
          "RenderRecord.glRenderer 未含 SwiftShader",
        );
        const aspect = record.outputAssetRef.endsWith("landscape.mp4")
          ? "landscape"
          : "portrait";
        const baked = bakeByAspect.get(aspect);
        assert.equal(
          record.three.framesDigest,
          baked.framesDigest,
          `项目 ${label} ${aspect} framesDigest 与独立烘焙不一致`,
        );
        assert.equal(
          record.three.clipSha256,
          baked.clipSha256,
          `项目 ${label} ${aspect} clipSha256 与独立烘焙不一致`,
        );
      }
    }
  });

  // —— 6. 零计费 + 无新增临时残留 ——
  const usageAfter = at("计费台账（读取后）", usageLines);
  at("零计费", () => {
    assert.equal(usageAfter, usageBefore, "TTS 台账行数发生变化");
    assert.equal(
      usageAfter,
      EXPECTED_USAGE_LINES,
      `TTS 台账应为 ${EXPECTED_USAGE_LINES} 行`,
    );
  });
  const threeTempAfter = at("临时目录复查", listThreeTempDirs);
  at("无 acs-three-* 残留", () => {
    const leaked = threeTempAfter.filter(
      (name) => !threeTempBefore.includes(name),
    );
    assert.deepEqual(
      leaked,
      [],
      `运行后出现 acs-three-* 残留: ${leaked.join(", ")}`,
    );
  });

  console.log(
    `[e2e-three] OK: 烘焙 A/B 一致；landscape.mp4 双跑 SHA-256 ${hashesA.landscape}；首帧亮度 ${luma.toFixed(2)}；台账 ${usageBefore}→${usageAfter} 行（零计费）；无 acs-three-* 残留`,
  );
}

try {
  await main();
} catch (error) {
  fail("启动", error);
} finally {
  cleanup();
}
