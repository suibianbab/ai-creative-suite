import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  packPortableProject,
  restorePortableBundle,
  verifyPortableBundle,
} from "./portable-package.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const { validateVideoProject } = await import(
  pathToFileURL(path.join(ROOT, "packages/video-document/dist/index.js")).href
);
const INTERIOR = path.join(
  ROOT,
  "artifacts/video-studio-composition-templates-2026-10-23/interior.video-project.json",
);
const BIBLE = path.join(
  ROOT,
  "artifacts/video-studio-composition-templates-2026-10-23/interior.style-bible.json",
);
const OLD = path.join(
  ROOT,
  "artifacts/video-studio-shot-editor/baseline.video-project.json",
);

async function sandbox(t) {
  const root = await mkdtemp(path.join(tmpdir(), "acs-portable-test-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return root;
}

async function prepared(root) {
  const bytes = Buffer.from("portable-media-fixture");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const storeKey = `${sha256.slice(0, 16)}.mp4`;
  const storeRoot = path.join(root, "source-store");
  await mkdir(path.join(storeRoot, "original"), { recursive: true });
  await writeFile(path.join(storeRoot, "original", storeKey), bytes);
  const project = JSON.parse(await readFile(INTERIOR, "utf8"));
  project.mediaAssets = [
    {
      assetId: randomUUID(),
      createdAt: new Date().toISOString(),
      origin: { kind: "local-upload", fileName: "fixture.mp4" },
      original: {
        sha256,
        bytes: bytes.length,
        durationMs: 2000,
        width: 640,
        height: 360,
        fps: 24,
        codec: "h264",
        hasAudio: false,
        storeKey,
      },
    },
  ];
  validateVideoProject(project);
  const projectFile = path.join(root, "source.json");
  await writeFile(projectFile, JSON.stringify(project));
  return { project, projectFile, storeRoot, storeKey, sha256 };
}

test("媒体与 Style Bible 项目打包、核验、跨仓恢复；原文件字节保持", async (t) => {
  const root = await sandbox(t);
  const source = await prepared(root);
  const bundle = path.join(root, "bundle");
  const manifest = await packPortableProject({
    projectFile: source.projectFile,
    styleBibleFile: BIBLE,
    storeRoot: source.storeRoot,
    out: bundle,
  });
  assert.equal(manifest.files.length, 3);
  const verified = await verifyPortableBundle(bundle);
  assert.equal(verified.project.id, source.project.id);
  const restored = await restorePortableBundle({
    bundle,
    out: path.join(root, "restored"),
    storeRoot: path.join(root, "target-store"),
  });
  assert.equal(restored.installedMedia, 1);
  assert.equal(
    await readFile(restored.projectFile, "utf8"),
    await readFile(source.projectFile, "utf8"),
  );
  assert.deepEqual(
    await readFile(
      path.join(root, "target-store", "original", source.storeKey),
    ),
    await readFile(path.join(source.storeRoot, "original", source.storeKey)),
  );
  const reused = await restorePortableBundle({
    bundle,
    out: path.join(root, "restored-again"),
    storeRoot: path.join(root, "target-store"),
  });
  assert.equal(reused.installedMedia, 0);
});

test("旧无媒体项目仍可打包与恢复，不增加项目字段", async (t) => {
  const root = await sandbox(t);
  const bundle = path.join(root, "old-bundle");
  const manifest = await packPortableProject({
    projectFile: OLD,
    storeRoot: path.join(root, "empty-store"),
    out: bundle,
  });
  assert.deepEqual(
    manifest.files.map((entry) => entry.path),
    ["project.video-project.json"],
  );
  const result = await restorePortableBundle({
    bundle,
    storeRoot: path.join(root, "new-store"),
    out: path.join(root, "old-restored"),
  });
  assert.deepEqual(
    JSON.parse(await readFile(result.projectFile, "utf8")),
    JSON.parse(await readFile(OLD, "utf8")),
  );
});

test("缺媒体、错摘要、缺风格文件都拒绝且不产生成功包", async (t) => {
  const root = await sandbox(t);
  const source = await prepared(root);
  await rm(path.join(source.storeRoot, "original", source.storeKey));
  await assert.rejects(
    packPortableProject({
      projectFile: source.projectFile,
      styleBibleFile: BIBLE,
      storeRoot: source.storeRoot,
      out: path.join(root, "missing"),
    }),
    /媒体原件.*缺失/,
  );
  await writeFile(
    path.join(source.storeRoot, "original", source.storeKey),
    "wrong",
  );
  await assert.rejects(
    packPortableProject({
      projectFile: source.projectFile,
      styleBibleFile: BIBLE,
      storeRoot: source.storeRoot,
      out: path.join(root, "wrong"),
    }),
    /媒体原件与账本不符/,
  );
  await assert.rejects(
    packPortableProject({
      projectFile: source.projectFile,
      storeRoot: source.storeRoot,
      out: path.join(root, "no-style"),
    }),
    /Style Bible/,
  );
  assert.deepEqual(
    (await readdir(root)).filter((name) =>
      ["missing", "wrong", "no-style"].includes(name),
    ),
    [],
  );
});

test("篡改包文件与 manifest 路径穿越在恢复前拒绝", async (t) => {
  const root = await sandbox(t);
  const source = await prepared(root);
  const bundle = path.join(root, "bundle");
  await packPortableProject({
    projectFile: source.projectFile,
    styleBibleFile: BIBLE,
    storeRoot: source.storeRoot,
    out: bundle,
  });
  const mediaFile = path.join(bundle, "media", "original", source.storeKey);
  await writeFile(mediaFile, "tampered");
  await assert.rejects(verifyPortableBundle(bundle), /大小或 SHA-256 不符/);
  await assert.rejects(
    restorePortableBundle({
      bundle,
      storeRoot: path.join(root, "target"),
      out: path.join(root, "restored"),
    }),
    /大小或 SHA-256 不符/,
  );
  const manifestFile = path.join(bundle, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  manifest.files[0].path = "../escape";
  await writeFile(manifestFile, JSON.stringify(manifest));
  await assert.rejects(verifyPortableBundle(bundle), /非法文件项或路径/);
});

test("目标仓同键冲突与已存在输出目录不覆盖原文件", async (t) => {
  const root = await sandbox(t);
  const source = await prepared(root);
  const bundle = path.join(root, "bundle");
  await packPortableProject({
    projectFile: source.projectFile,
    styleBibleFile: BIBLE,
    storeRoot: source.storeRoot,
    out: bundle,
  });
  const targetStore = path.join(root, "target-store");
  await mkdir(path.join(targetStore, "original"), { recursive: true });
  const target = path.join(targetStore, "original", source.storeKey);
  await writeFile(target, "existing-user-content");
  await assert.rejects(
    restorePortableBundle({
      bundle,
      storeRoot: targetStore,
      out: path.join(root, "restored"),
    }),
    /同键文件.*冲突/,
  );
  assert.equal(await readFile(target, "utf8"), "existing-user-content");
  const occupied = path.join(root, "occupied");
  await mkdir(occupied);
  await writeFile(path.join(occupied, "keep.txt"), "keep");
  await assert.rejects(
    packPortableProject({
      projectFile: source.projectFile,
      styleBibleFile: BIBLE,
      storeRoot: source.storeRoot,
      out: occupied,
    }),
    /输出目录已存在/,
  );
  assert.equal(await readFile(path.join(occupied, "keep.txt"), "utf8"), "keep");
});

test("Style Bible 与当前媒体工作镜头不兼容时在打包前拒绝", async (t) => {
  const root = await sandbox(t);
  const source = await prepared(root);
  const shot = source.project.shots[0];
  const version = shot.contentVersions.find(
    (candidate) => candidate.versionId === shot.workingVersionId,
  );
  assert.ok(version);
  version.sceneSource = {
    type: "media-clip",
    mediaAssetId: source.project.mediaAssets[0].assetId,
    inMs: 0,
    outMs: 2000,
    fit: "contain",
    focalX: 0.5,
    audio: "mute",
  };
  validateVideoProject(source.project);
  await writeFile(source.projectFile, JSON.stringify(source.project));
  const out = path.join(root, "incompatible");
  await assert.rejects(
    packPortableProject({
      projectFile: source.projectFile,
      styleBibleFile: BIBLE,
      storeRoot: source.storeRoot,
      out,
    }),
    /Style Bible 与工作镜头不兼容/,
  );
  assert.equal((await readdir(root)).includes("incompatible"), false);
});

test("恢复目标不能落在包内，原包保持可再次校验", async (t) => {
  const root = await sandbox(t);
  const bundle = path.join(root, "bundle");
  await packPortableProject({
    projectFile: OLD,
    storeRoot: path.join(root, "source-store"),
    out: bundle,
  });
  await assert.rejects(
    restorePortableBundle({
      bundle,
      storeRoot: path.join(root, "target-store"),
      out: path.join(bundle, "restored"),
    }),
    /不能位于原项目包内部/,
  );
  await assert.rejects(
    restorePortableBundle({
      bundle,
      storeRoot: path.join(bundle, "store"),
      out: path.join(root, "restored"),
    }),
    /不能位于原项目包内部/,
  );
  assert.equal(
    (await verifyPortableBundle(bundle)).project.id,
    JSON.parse(await readFile(OLD, "utf8")).id,
  );
});

test("恢复输出与媒体仓互相包含时前置拒绝，不留下目录", async (t) => {
  const root = await sandbox(t);
  const source = await prepared(root);
  const bundle = path.join(root, "bundle");
  await packPortableProject({
    projectFile: source.projectFile,
    styleBibleFile: BIBLE,
    storeRoot: source.storeRoot,
    out: bundle,
  });
  const out = path.join(root, "nested-output");
  await assert.rejects(
    restorePortableBundle({ bundle, out, storeRoot: path.join(out, "store") }),
    /不能互相包含/,
  );
  assert.deepEqual(
    (await readdir(root)).filter((name) => name === "nested-output"),
    [],
  );
  const storeRoot = path.join(root, "nested-store");
  await assert.rejects(
    restorePortableBundle({
      bundle,
      out: path.join(storeRoot, "output"),
      storeRoot,
    }),
    /不能互相包含/,
  );
  assert.deepEqual(
    (await readdir(root)).filter((name) => name === "nested-store"),
    [],
  );
});

test("包内未列出文件与符号链接必须被拒绝", async (t) => {
  const root = await sandbox(t);
  const source = await prepared(root);
  const bundle = path.join(root, "bundle");
  await packPortableProject({
    projectFile: source.projectFile,
    styleBibleFile: BIBLE,
    storeRoot: source.storeRoot,
    out: bundle,
  });
  const extra = path.join(bundle, "media", "original", "extra.txt");
  await writeFile(extra, "unlisted");
  await assert.rejects(verifyPortableBundle(bundle), /未列出/);
  await rm(extra);
  const target = path.join(bundle, "media", "original", source.storeKey);
  await rm(target);
  try {
    await symlink(
      path.join(source.storeRoot, "original", source.storeKey),
      target,
      "file",
    );
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error.code)) {
      t.diagnostic(`Windows 当前权限不允许创建文件符号链接：${error.code}`);
      return;
    }
    throw error;
  }
  await assert.rejects(verifyPortableBundle(bundle), /普通文件/);
});

test("媒体账本超过项目 schema 的 1000 条上限时打包前拒绝", async (t) => {
  const root = await sandbox(t);
  const source = await prepared(root);
  source.project.mediaAssets = Array.from({ length: 1001 }, (_, i) => {
    const digest = createHash("sha256").update(`fixture-${i}`).digest("hex");
    return {
      ...source.project.mediaAssets[0],
      assetId: randomUUID(),
      original: {
        ...source.project.mediaAssets[0].original,
        sha256: digest,
        storeKey: `${digest.slice(0, 16)}.mp4`,
      },
    };
  });
  await writeFile(source.projectFile, JSON.stringify(source.project));
  const out = path.join(root, "too-many");
  await assert.rejects(
    packPortableProject({
      projectFile: source.projectFile,
      styleBibleFile: BIBLE,
      storeRoot: source.storeRoot,
      out,
    }),
    /mediaAssets must be an array of at most 1000 entries/,
  );
  assert.deepEqual(
    (await readdir(root)).filter((name) => name === "too-many"),
    [],
  );
});

test("manifest 文件项超过包格式上限时给出专门错误", async (t) => {
  const root = await sandbox(t);
  const bundle = path.join(root, "bundle");
  await packPortableProject({
    projectFile: OLD,
    storeRoot: path.join(root, "empty-store"),
    out: bundle,
  });
  const manifestFile = path.join(bundle, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  manifest.files = Array.from({ length: 1003 }, () => manifest.files[0]);
  await writeFile(manifestFile, JSON.stringify(manifest));
  await assert.rejects(
    verifyPortableBundle(bundle),
    /manifest 超过包格式 v1 上限/,
  );
});
