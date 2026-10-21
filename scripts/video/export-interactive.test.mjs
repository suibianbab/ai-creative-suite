// P3-A 交互交付（Task 3）：导出管线的纯函数单测（不写盘，CLI 主路径另跑）。

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
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
import { fileURLToPath } from "node:url";
import { validateVideoProject } from "./delivery.mjs";
import { buildInteractiveExport } from "./export-interactive.mjs";

const FIXTURE = new URL(
  "./fixtures/interactive-sample.video-project.json",
  import.meta.url,
);
const CLI = fileURLToPath(new URL("./export-interactive.mjs", import.meta.url));

function fixture() {
  return validateVideoProject(JSON.parse(readFileSync(FIXTURE, "utf8")));
}

// 最小媒体资产账本：让改造后的第 2 镜头先通过文档校验，再撞上「仅 spec」门禁。
function mediaClipProject() {
  const project = structuredClone(fixture());
  const assetId = "88888888-8888-4888-8888-888888888888";
  const shot = project.shots[1];
  const version = shot.contentVersions.find(
    (candidate) => candidate.versionId === shot.workingVersionId,
  );
  version.sceneSource = {
    type: "media-clip",
    mediaAssetId: assetId,
    inMs: 0,
    outMs: 3100,
    fit: "cover",
    focalX: 0.5,
    audio: "mute",
  };
  project.mediaAssets = [
    {
      assetId,
      createdAt: "2026-10-21T00:00:00.000Z",
      origin: { kind: "local-upload", fileName: "demo.mp4" },
      original: {
        sha256: "a".repeat(64),
        bytes: 123456,
        durationMs: 30000,
        width: 1920,
        height: 1080,
        fps: 30,
        codec: "h264",
        hasAudio: true,
        storeKey: `${"a".repeat(16)}.mp4`,
      },
    },
  ];
  return validateVideoProject(project);
}

test("夹具导出：3 步、正整数 frameMap、sha256(html) 摘要与 data-total", () => {
  const { html, versionIds, frameMap, digest } = buildInteractiveExport({
    project: fixture(),
    fps: 12,
    aspect: "landscape",
  });
  assert.equal(versionIds.length, 3);
  assert.deepEqual(frameMap, [24, 37, 24]);
  for (const frames of frameMap)
    assert.ok(Number.isInteger(frames) && frames >= 1);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(digest, createHash("sha256").update(html, "utf8").digest("hex"));
  assert.ok(html.includes('data-total="3"'));
});

test("步骤顺序按 shots[].order，与数组序无关（spec R2）", () => {
  const original = buildInteractiveExport({
    project: fixture(),
    fps: 12,
    aspect: "landscape",
  });
  // 深拷贝后把数组倒序，各 shot 的 order 保持不变：顺序必须仍由 order 决定。
  const reordered = structuredClone(fixture());
  reordered.shots.reverse();
  const reversed = buildInteractiveExport({
    project: reordered,
    fps: 12,
    aspect: "landscape",
  });
  assert.deepEqual(reversed.versionIds, original.versionIds);
  assert.deepEqual(reversed.frameMap, original.frameMap);
  assert.equal(reversed.html, original.html);
});

test("确定性：同输入两次导出 html 逐字节一致且不含项目 id/时间戳", () => {
  const first = buildInteractiveExport({
    project: fixture(),
    fps: 12,
    aspect: "landscape",
  });
  const second = buildInteractiveExport({
    project: fixture(),
    fps: 12,
    aspect: "landscape",
  });
  assert.equal(first.html, second.html);
  assert.equal(first.digest, second.digest);
  // spec R6：页面不写项目 id，也不写任何 ISO 时间戳。
  assert.ok(!first.html.includes(fixture().id));
  assert.doesNotMatch(first.html, /\d{4}-\d{2}-\d{2}T/);
});

test("渲染期错误带镜头号，且不推荐本 CLI 没有的 --frame", () => {
  const project = structuredClone(fixture());
  const shot = project.shots[0];
  const version = shot.contentVersions.find(
    (candidate) => candidate.versionId === shot.workingVersionId,
  );
  version.durationMs = 1000;
  version.sceneSource.spec.durationMs = 1000;
  // 1000ms@24fps=24 帧；fps 1 → ceil(24/24)=1 个采样帧，触发「采样帧数 1 不足 2」。
  assert.throws(
    () => buildInteractiveExport({ project, fps: 1, aspect: "landscape" }),
    (error) => {
      assert.match(error.message, /镜头 1/);
      assert.ok(!error.message.includes("--frame"));
      // 采样帧数 = ceil(durationFrames / (24 / fps))：提高 fps 才会增帧。
      assert.match(error.message, /提高 --fps/);
      assert.ok(!error.message.includes("降低 --fps"));
      return true;
    },
  );
});

test("非 spec 镜头整次拒绝：指名镜头 2 与 media-clip", () => {
  assert.throws(
    () =>
      buildInteractiveExport({
        project: mediaClipProject(),
        fps: 12,
        aspect: "landscape",
      }),
    (error) => {
      assert.match(error.message, /镜头 2/);
      assert.match(error.message, /media-clip/);
      return true;
    },
  );
});

test("参数门禁：fps 不整除与画幅枚举", () => {
  assert.throws(
    () =>
      buildInteractiveExport({
        project: fixture(),
        fps: 5,
        aspect: "landscape",
      }),
    /不整除/,
  );
  assert.throws(
    () =>
      buildInteractiveExport({
        project: fixture(),
        fps: 12,
        aspect: "square",
      }),
    /landscape\/portrait/,
  );
  // 原型链上的键（constructor/toString…）不算合法枚举。
  assert.throws(
    () =>
      buildInteractiveExport({
        project: fixture(),
        fps: 12,
        aspect: "constructor",
      }),
    /landscape\/portrait/,
  );
});

test("0 镜头项目整次拒绝：提示步骤数为 0", () => {
  const project = structuredClone(fixture());
  project.shots = [];
  assert.throws(
    () => buildInteractiveExport({ project, fps: 12, aspect: "landscape" }),
    /步骤数为 0/,
  );
});

test("CLI 成功输出：步数、帧数、字节数、交付短 id、savedVersion 与 index.html", () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "export-interactive-"));
  try {
    const projectPath = path.join(workDir, "sample.video-project.json");
    const outDir = path.join(workDir, "out");
    copyFileSync(FIXTURE, projectPath);

    const stdout = execFileSync(
      process.execPath,
      [CLI, "--project", projectPath, "--out", outDir],
      { encoding: "utf8" },
    );

    assert.match(stdout, /3 步/);
    assert.match(stdout, /共 \d+ 帧/);
    assert.match(stdout, /字节/);
    assert.match(stdout, /DeliveryRecord [0-9a-f]{8}/);
    assert.match(stdout, /savedVersion=2/);
    assert.ok(existsSync(path.join(outDir, "index.html")));
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("CLI 未知参数：统一中文前缀且不泄漏 Node 错误码", () => {
  const result = spawnSync(process.execPath, [CLI, "--bogus", "1"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.match(output, /\[export-interactive\]/);
  assert.ok(!output.includes("ERR_PARSE_ARGS_UNKNOWN_OPTION"));
});

// —— 修复 I-1：交付入口不接受与数组序不一致的叙事顺序 ——
test("倒序夹具经 validateVideoProject 拒绝（顺序不变量）", () => {
  const project = fixture();
  project.shots.reverse();
  assert.throws(() => validateVideoProject(project), /must be >/);
});

// —— 修复 I-2：先落账校验、后写盘；第 1001 条失败不得覆盖旧产物 ——
function legacyDelivery(index, versionId) {
  return {
    deliveryId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    at: "2026-10-21T00:00:00.000Z",
    versionIds: [versionId],
    renderIds: [],
    frameMap: [24],
  };
}

test("第 1001 条交付落账失败：旧 index.html 与项目文件逐字节不变", () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "export-interactive-"));
  try {
    const projectPath = path.join(workDir, "full.video-project.json");
    const outDir = path.join(workDir, "out");
    const raw = JSON.parse(readFileSync(FIXTURE, "utf8"));
    const versionId = raw.shots[0].workingVersionId;
    raw.deliveries = Array.from({ length: 1000 }, (_, index) =>
      legacyDelivery(index, versionId),
    );
    writeFileSync(projectPath, `${JSON.stringify(raw, null, 2)}\n`);
    mkdirSync(outDir, { recursive: true });
    const htmlPath = path.join(outDir, "index.html");
    const sentinel = Buffer.from("PREVIOUS-VALID-HTML-SENTINEL");
    writeFileSync(htmlPath, sentinel);
    const projectBytesBefore = readFileSync(projectPath);

    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [CLI, "--project", projectPath, "--out", outDir],
          { encoding: "utf8" },
        ),
      (error) => {
        assert.notEqual(error.status, 0);
        const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
        assert.match(output, /\[export-interactive\]/);
        // 落账失败（不是写盘失败）且原因准确：上限校验发生在任何写盘之前。
        assert.match(output, /落账失败/);
        assert.match(output, /deliveries must be an array of at most 1000/);
        return true;
      },
    );

    // 落账校验先于任何写盘：旧产物与账本都必须原样（equals 避免失败时
    // 对大 Buffer 生成巨型 diff，Node 26 下会拖垮测试进程）。
    assert.ok(readFileSync(htmlPath).equals(sentinel), "index.html 被改写");
    assert.ok(
      readFileSync(projectPath).equals(projectBytesBefore),
      "项目文件被改写",
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("正常导出覆盖旧 index.html 且台账 +1（先落账后写盘的成功路径）", () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "export-interactive-"));
  try {
    const projectPath = path.join(workDir, "sample.video-project.json");
    const outDir = path.join(workDir, "out");
    copyFileSync(FIXTURE, projectPath);
    mkdirSync(outDir, { recursive: true });
    const htmlPath = path.join(outDir, "index.html");
    writeFileSync(htmlPath, "PREVIOUS-VALID-HTML-SENTINEL");

    execFileSync(
      process.execPath,
      [CLI, "--project", projectPath, "--out", outDir],
      { encoding: "utf8" },
    );

    const html = readFileSync(htmlPath, "utf8");
    assert.ok(html.startsWith("<!doctype html>"));
    assert.ok(!html.includes("PREVIOUS-VALID-HTML-SENTINEL"));
    const next = validateVideoProject(
      JSON.parse(readFileSync(projectPath, "utf8")),
    );
    assert.equal(next.deliveries.length, 1);
    assert.equal(next.savedVersion, 2);
    assert.equal(next.deliveries[0].kind, "interactive-html");
    assert.equal(next.deliveries[0].outputRef, "index.html");
    assert.match(next.deliveries[0].digest, /^[0-9a-f]{64}$/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("项目回写失败：恢复旧 index.html 且账本不变", () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "export-interactive-"));
  const projectPath = path.join(workDir, "sample.video-project.json");
  try {
    const outDir = path.join(workDir, "out");
    copyFileSync(FIXTURE, projectPath);
    mkdirSync(outDir, { recursive: true });
    const htmlPath = path.join(outDir, "index.html");
    const sentinel = Buffer.from("PREVIOUS-VALID-HTML-SENTINEL");
    writeFileSync(htmlPath, sentinel);
    const projectBytesBefore = readFileSync(projectPath);
    // Windows：rename 覆盖只读文件 EPERM。HTML rename 已成功、项目 rename
    // 失败 → 交付器必须走恢复分支，而不是留下新 HTML + 旧账本。
    chmodSync(projectPath, 0o444);

    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [CLI, "--project", projectPath, "--out", outDir],
          { encoding: "utf8" },
        ),
      (error) => {
        assert.notEqual(error.status, 0);
        const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
        assert.match(output, /\[export-interactive\]/);
        assert.match(output, /写盘失败/);
        return true;
      },
    );

    assert.ok(readFileSync(htmlPath).equals(sentinel), "旧 index.html 未恢复");
    assert.ok(
      readFileSync(projectPath).equals(projectBytesBefore),
      "项目文件被改写",
    );
  } finally {
    try {
      chmodSync(projectPath, 0o666);
    } catch {
      // 文件可能已被清理；清理失败不掩盖断言结果。
    }
    rmSync(workDir, { recursive: true, force: true });
  }
});
