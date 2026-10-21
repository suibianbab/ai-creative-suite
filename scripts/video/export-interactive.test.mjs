// P3-A 交互交付（Task 3）：导出管线的纯函数单测（不写盘，CLI 主路径另跑）。

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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
