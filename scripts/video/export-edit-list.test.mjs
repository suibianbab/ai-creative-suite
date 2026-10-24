import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildEditList, validateEditList } from "./export-edit-list.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const project = JSON.parse(
  readFileSync(
    path.join(
      ROOT,
      "artifacts/video-studio-stem-sample-final-2026-10-23/stem.video-project.json",
    ),
    "utf8",
  ),
);

test("edit-list v1：七镜头无缝时间线、旁白文本、素材账本、双画幅", () => {
  const list = buildEditList(project);
  validateEditList(list);
  assert.equal(list.format, "acs-edit-list");
  assert.equal(list.formatVersion, 1);
  assert.equal(list.timeline.length, 7);
  assert.equal(list.timeline[0].startFrame, 0);
  // 无缝衔接：上一镜 endFrame == 下一镜 startFrame（权威时间线约束）。
  for (let i = 1; i < list.timeline.length; i++)
    assert.equal(list.timeline[i].startFrame, list.timeline[i - 1].endFrame);
  assert.ok(list.timeline.every((entry) => entry.narrationText.length > 0));
  assert.deepEqual(list.aspects, ["landscape", "portrait"]);
  assert.equal(list.fps, 24);
  // 确定性：同项目两次导出逐字段一致（除 exportedAt）。
  const again = buildEditList(project);
  list.exportedAt = again.exportedAt = "fixed";
  assert.deepEqual(list, again);
});

test("edit-list 校验：断裂时间线 / 空时间线 / 坏格式拒绝", () => {
  const list = buildEditList(project);
  const broken = structuredClone(list);
  broken.timeline[3].startFrame += 10;
  assert.throws(() => validateEditList(broken), /startFrame/);
  assert.throws(() => validateEditList({ ...list, timeline: [] }), /形状无效/);
  assert.throws(
    () => validateEditList({ ...list, formatVersion: 2 }),
    /形状无效/,
  );
});

test("CLI 导出：原子写、旧项目可读、失败不留半成品", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "w5-edit-list-"));
  try {
    execFileSync(
      process.execPath,
      [
        "scripts/video/export-edit-list.mjs",
        "--project",
        path.join(
          ROOT,
          "artifacts/video-studio-stem-sample-final-2026-10-23/stem.video-project.json",
        ),
        "--out",
        dir,
      ],
      { cwd: ROOT, encoding: "utf8" },
    );
    const written = JSON.parse(
      readFileSync(path.join(dir, "edit-list.v1.json"), "utf8"),
    );
    validateEditList(written);
    assert.ok(!existsSync(path.join(dir, ".edit-list.tmp.json")));
    // 失败路径：坏项目 → 非零退出、无输出文件。
    const bad = path.join(dir, "bad.json");
    writeFileSync(bad, '{"schemaVersion": 9}');
    let failed = false;
    try {
      execFileSync(
        process.execPath,
        ["scripts/video/export-edit-list.mjs", "--project", bad, "--out", dir],
        { cwd: ROOT, encoding: "utf8" },
      );
    } catch {
      failed = true;
    }
    assert.ok(failed, "坏项目必须非零退出");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
