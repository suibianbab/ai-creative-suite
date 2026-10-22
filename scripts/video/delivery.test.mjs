import assert from "node:assert/strict";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { commitDeliveryFiles } from "./delivery.mjs";

function withTempFiles(run) {
  const root = mkdtempSync(path.join(tmpdir(), "acs-delivery-test-"));
  try {
    return run(root);
  } finally {
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(root));
    assert.ok(
      relative && !relative.startsWith("..") && !path.isAbsolute(relative),
    );
    rmSync(root, { recursive: true, force: true });
  }
}

test("交付写盘成功：产物与项目同时更新，临时文件清净", () => {
  withTempFiles((root) => {
    const projectPath = path.join(root, "project.json");
    const outputPath = path.join(root, "shot.svg");
    const stagedOutputPath = path.join(root, ".shot.tmp.svg");
    writeFileSync(projectPath, '{"savedVersion":1}\n');
    writeFileSync(stagedOutputPath, "new-svg");

    commitDeliveryFiles({
      stagedOutputPath,
      outputPath,
      projectPath,
      nextProject: { savedVersion: 2, deliveries: [{ outputRef: "shot.svg" }] },
    });

    assert.equal(readFileSync(outputPath, "utf8"), "new-svg");
    assert.equal(JSON.parse(readFileSync(projectPath, "utf8")).savedVersion, 2);
    assert.deepEqual(readdirSync(root).sort(), ["project.json", "shot.svg"]);
  });
});

test("项目回写失败：已有产物恢复原字节，项目不留成功记录", () => {
  withTempFiles((root) => {
    const projectPath = path.join(root, "project.json");
    const outputPath = path.join(root, "landscape.gif");
    const stagedOutputPath = path.join(root, ".landscape.tmp.gif");
    const originalProject = '{"savedVersion":1,"deliveries":[]}\n';
    writeFileSync(projectPath, originalProject);
    writeFileSync(outputPath, "old-gif");
    writeFileSync(stagedOutputPath, "new-gif");
    let renames = 0;

    assert.throws(
      () =>
        commitDeliveryFiles(
          {
            stagedOutputPath,
            outputPath,
            projectPath,
            nextProject: {
              savedVersion: 2,
              deliveries: [{ outputRef: "landscape.gif" }],
            },
          },
          {
            renameFile(from, to) {
              renames++;
              if (renames === 2) throw new Error("模拟项目回写失败");
              renameSync(from, to);
            },
          },
        ),
      /模拟项目回写失败/,
    );
    assert.equal(readFileSync(projectPath, "utf8"), originalProject);
    assert.equal(readFileSync(outputPath, "utf8"), "old-gif");
    assert.deepEqual(readdirSync(root).sort(), [
      "landscape.gif",
      "project.json",
    ]);
  });
});

test("项目回写失败：原本没有产物时删掉新产物，项目不留成功记录", () => {
  withTempFiles((root) => {
    const projectPath = path.join(root, "project.json");
    const outputPath = path.join(root, "shot.svg");
    const stagedOutputPath = path.join(root, ".shot.tmp.svg");
    const originalProject = '{"savedVersion":1,"deliveries":[]}\n';
    writeFileSync(projectPath, originalProject);
    writeFileSync(stagedOutputPath, "new-svg");
    let renames = 0;

    assert.throws(
      () =>
        commitDeliveryFiles(
          {
            stagedOutputPath,
            outputPath,
            projectPath,
            nextProject: {
              savedVersion: 2,
              deliveries: [{ outputRef: "shot.svg" }],
            },
          },
          {
            renameFile(from, to) {
              renames++;
              if (renames === 2) throw new Error("模拟项目回写失败");
              renameSync(from, to);
            },
          },
        ),
      /模拟项目回写失败/,
    );
    assert.equal(readFileSync(projectPath, "utf8"), originalProject);
    assert.deepEqual(readdirSync(root), ["project.json"]);
  });
});
