import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const fixture = path.join(
  root,
  "scripts/video/fixtures/interactive-sample.video-project.json",
);

test("CLI：未绑定素材位即退出，不写成功渲染记录", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "acs-slot-gate-"));
  try {
    const project = JSON.parse(readFileSync(fixture, "utf8"));
    const shot = project.shots[0];
    const working = shot.contentVersions.find(
      (version) => version.versionId === shot.workingVersionId,
    );
    working.description = "已删说明前缀";
    working.assetSlot = { kind: "产品整体照片" };
    const file = path.join(dir, "project.json");
    writeFileSync(file, JSON.stringify(project));
    const result = spawnSync(
      process.execPath,
      [
        path.join(root, "scripts/video/render-scene.mjs"),
        "--project",
        file,
        "--out",
        path.join(dir, "out"),
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /未绑定素材位/);
    assert.equal(
      JSON.parse(readFileSync(file, "utf8")).renderRecords.length,
      0,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
