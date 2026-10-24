// Portable VideoProject directory bundle. The project schema stays unchanged;
// media originals and the referenced Style Bible travel alongside it.
import { randomUUID } from "node:crypto";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sha256File } from "./sha256-file.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const {
  validateVideoProject,
  validateStyleBible,
  resolveStyleBibleRef,
  workingStyleIssues,
} = await import(
  pathToFileURL(path.join(ROOT, "packages/video-document/dist/index.js")).href
);
const { originalPath, STORE_KEY_PATTERN } = await import(
  pathToFileURL(path.join(ROOT, "packages/media-store/dist/index.js")).href
);

const FORMAT = "acs-video-portable";
const PROJECT_FILE = "project.video-project.json";
const STYLE_FILE = "style-bible.json";
const SHA = /^[0-9a-f]{64}$/;
const MAX_MEDIA_FILES = 1000;
const comparePath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

function fail(message) {
  throw new Error(`项目包：${message}`);
}

function within(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

async function exists(file) {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function ensureDirectory(dir, created) {
  const first = await mkdir(dir, { recursive: true });
  if (!first) return;
  let current = path.resolve(dir);
  const firstCreated = path.resolve(first);
  if (!within(firstCreated, current))
    fail(`创建目录返回异常路径：${firstCreated}`);
  for (;;) {
    created.push(current);
    if (current === firstCreated) break;
    const parent = path.dirname(current);
    if (parent === current) fail(`无法确定新建目录边界：${dir}`);
    current = parent;
  }
}

async function removeCreatedDirectories(created) {
  const failures = [];
  for (const dir of [...new Set(created)].sort((a, b) => b.length - a.length)) {
    try {
      await rmdir(dir);
    } catch (error) {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code))
        failures.push(error);
    }
  }
  return failures;
}

function throwAfterCleanup(error, failures) {
  if (failures.length)
    throw new AggregateError([error, ...failures], error.message);
  throw error;
}

async function regularFile(file, label) {
  let info;
  try {
    info = await lstat(file);
  } catch (error) {
    if (error.code === "ENOENT") fail(`${label}缺失：${file}`);
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink())
    fail(`${label}须为普通文件：${file}`);
  return info;
}

async function plainDirectory(dir, label) {
  let info;
  try {
    info = await lstat(dir);
  } catch (error) {
    if (error.code === "ENOENT") fail(`${label}缺失：${dir}`);
    throw error;
  }
  if (!info.isDirectory() || info.isSymbolicLink())
    fail(`${label}须为普通目录：${dir}`);
}

function mediaFiles(project) {
  const files = new Map();
  for (const asset of project.mediaAssets ?? []) {
    const { storeKey, sha256, bytes } = asset.original;
    if (
      !STORE_KEY_PATTERN.test(storeKey) ||
      storeKey.slice(0, 16) !== sha256.slice(0, 16)
    )
      fail(`素材 ${asset.assetId} 的 storeKey 与摘要不一致`);
    const relative = `media/original/${storeKey}`;
    const old = files.get(relative);
    if (old && (old.sha256 !== sha256 || old.bytes !== bytes))
      fail(`素材 storeKey 冲突：${storeKey}`);
    files.set(relative, { path: relative, sha256, bytes });
  }
  return [...files.values()].sort(comparePath);
}

function rejectExternalBindings(project) {
  for (const [shotIndex, shot] of project.shots.entries()) {
    if (
      shot.contentVersions.some(
        (version) => version.sceneSource.type === "editor-binding",
      )
    )
      fail(`镜头 ${shotIndex + 1} 含外部编辑器源，目前无法完整打包`);
  }
}

async function readProject(file) {
  await regularFile(file, "项目文件");
  let raw;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch {
    fail("项目文件不是合法 JSON");
  }
  const project = validateVideoProject(raw);
  rejectExternalBindings(project);
  mediaFiles(project);
  return project;
}

async function readBible(file, project) {
  if (!project.styleBibleRef) {
    if (file) fail("项目未引用 Style Bible，不应附带无关风格文件");
    return null;
  }
  if (!file) fail("项目引用 Style Bible，须提供 --style-bible");
  await regularFile(file, "Style Bible");
  let raw;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch {
    fail("Style Bible 文件不是合法 JSON");
  }
  const bible = validateStyleBible(raw);
  const version = await resolveStyleBibleRef(project.styleBibleRef, bible);
  const issues = workingStyleIssues(project, version);
  if (issues.length) fail(`Style Bible 与工作镜头不兼容：${issues.join("；")}`);
  return bible;
}

async function fileEntry(file, relative) {
  const info = await regularFile(file, relative);
  return { path: relative, bytes: info.size, sha256: await sha256File(file) };
}

function safeEntry(entry) {
  if (
    !entry ||
    typeof entry !== "object" ||
    typeof entry.path !== "string" ||
    !(
      entry.path === PROJECT_FILE ||
      entry.path === STYLE_FILE ||
      /^media\/original\/[0-9a-f]{16}\.(mp4|webm|mov)$/.test(entry.path)
    ) ||
    !Number.isSafeInteger(entry.bytes) ||
    entry.bytes < 0 ||
    typeof entry.sha256 !== "string" ||
    !SHA.test(entry.sha256)
  )
    fail("manifest 含非法文件项或路径");
}

async function bundleFile(bundle, relative) {
  const parts = relative.split("/");
  let current = bundle;
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    await plainDirectory(current, "包内目录");
  }
  return path.join(bundle, ...parts);
}

async function verifyEntry(bundle, entry) {
  const file = await bundleFile(bundle, entry.path);
  const info = await regularFile(file, "包内文件");
  if (info.size !== entry.bytes || (await sha256File(file)) !== entry.sha256)
    fail(`包内文件大小或 SHA-256 不符：${entry.path}`);
  return file;
}

export async function packPortableProject({
  projectFile,
  out,
  storeRoot,
  styleBibleFile,
}) {
  if (!path.isAbsolute(storeRoot)) fail("媒体仓路径须为绝对路径");
  const project = await readProject(projectFile);
  const media = mediaFiles(project);
  await readBible(styleBibleFile, project);
  for (const entry of media) {
    const source = originalPath(storeRoot, path.basename(entry.path));
    const info = await regularFile(source, "媒体原件");
    if (
      info.size !== entry.bytes ||
      (await sha256File(source)) !== entry.sha256
    )
      fail(`媒体原件与账本不符：${entry.path}`);
  }
  if (await exists(out)) fail(`输出目录已存在：${out}`);
  const createdDirs = [];
  let temp;
  try {
    await ensureDirectory(path.dirname(out), createdDirs);
    temp = await mkdtemp(path.join(path.dirname(out), ".acs-video-pack-"));
    const entries = [];
    const projectTarget = path.join(temp, PROJECT_FILE);
    await copyFile(projectFile, projectTarget);
    entries.push(await fileEntry(projectTarget, PROJECT_FILE));
    if (project.styleBibleRef) {
      const styleTarget = path.join(temp, STYLE_FILE);
      await copyFile(styleBibleFile, styleTarget);
      entries.push(await fileEntry(styleTarget, STYLE_FILE));
    }
    if (media.length)
      await mkdir(path.join(temp, "media", "original"), { recursive: true });
    for (const item of media) {
      const target = path.join(temp, ...item.path.split("/"));
      await copyFile(originalPath(storeRoot, path.basename(item.path)), target);
      const actual = await fileEntry(target, item.path);
      if (actual.bytes !== item.bytes || actual.sha256 !== item.sha256)
        fail(`复制时媒体原件发生变化：${item.path}`);
      entries.push(actual);
    }
    const manifest = {
      format: FORMAT,
      formatVersion: 1,
      projectId: project.id,
      files: entries.sort(comparePath),
    };
    await writeFile(
      path.join(temp, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    // Re-verify the snapshot before publishing the directory as successful.
    await verifyPortableBundle(temp);
    if (await exists(out)) fail(`输出目录已存在：${out}`);
    await rename(temp, out);
    return manifest;
  } catch (error) {
    const failures = [];
    if (temp) {
      try {
        await rm(temp, { recursive: true, force: true });
      } catch (cleanupError) {
        failures.push(cleanupError);
      }
    }
    failures.push(...(await removeCreatedDirectories(createdDirs)));
    throwAfterCleanup(error, failures);
  }
}

export async function verifyPortableBundle(bundle) {
  await plainDirectory(bundle, "项目包");
  const manifestFile = path.join(bundle, "manifest.json");
  const manifestInfo = await regularFile(manifestFile, "manifest");
  if (manifestInfo.size > 256 * 1024) fail("manifest 超过 256 KiB");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  } catch {
    fail("manifest 不是合法 JSON");
  }
  if (
    !manifest ||
    manifest.format !== FORMAT ||
    manifest.formatVersion !== 1 ||
    typeof manifest.projectId !== "string" ||
    !Array.isArray(manifest.files)
  )
    fail("manifest 格式无效或版本不支持");
  if (manifest.files.length > MAX_MEDIA_FILES + 2)
    fail(`manifest 超过包格式 v1 上限（${MAX_MEDIA_FILES} 个独立原件）`);
  const listed = new Map();
  for (const entry of manifest.files) {
    safeEntry(entry);
    if (listed.has(entry.path)) fail(`manifest 路径重复：${entry.path}`);
    listed.set(entry.path, entry);
  }
  if (!listed.has(PROJECT_FILE)) fail("manifest 缺项目文件");
  for (const entry of listed.values()) await verifyEntry(bundle, entry);
  const project = await readProject(path.join(bundle, PROJECT_FILE));
  if (project.id !== manifest.projectId)
    fail("manifest 项目 ID 与项目文件不符");
  await readBible(
    project.styleBibleRef ? path.join(bundle, STYLE_FILE) : null,
    project,
  );
  const expected = new Map([
    [PROJECT_FILE, listed.get(PROJECT_FILE)],
    ...(project.styleBibleRef ? [[STYLE_FILE, listed.get(STYLE_FILE)]] : []),
    ...mediaFiles(project).map((entry) => [entry.path, entry]),
  ]);
  if (
    expected.size !== listed.size ||
    [...expected.keys()].some((key) => !listed.has(key))
  )
    fail("manifest 文件集合与项目引用不一致");
  for (const asset of mediaFiles(project)) {
    const entry = listed.get(asset.path);
    if (entry.bytes !== asset.bytes || entry.sha256 !== asset.sha256)
      fail(`manifest 与素材账本不符：${asset.path}`);
  }
  // Reject unexpected symlinks and files, including an unlisted replacement
  // hidden under a valid directory. Only the four fixed entry classes exist.
  const rootNames = (await readdir(bundle)).sort();
  const expectedRoot = [
    "manifest.json",
    PROJECT_FILE,
    ...(project.styleBibleRef ? [STYLE_FILE] : []),
    ...(mediaFiles(project).length ? ["media"] : []),
  ].sort();
  if (JSON.stringify(rootNames) !== JSON.stringify(expectedRoot))
    fail("包内存在未列出的根目录文件");
  if (mediaFiles(project).length) {
    const originalDir = path.join(bundle, "media", "original");
    if (
      JSON.stringify((await readdir(path.join(bundle, "media"))).sort()) !==
      JSON.stringify(["original"])
    )
      fail("媒体目录含未列出的内容");
    const names = (await readdir(originalDir)).sort();
    if (
      JSON.stringify(names) !==
      JSON.stringify(
        mediaFiles(project)
          .map((entry) => path.basename(entry.path))
          .sort(),
      )
    )
      fail("媒体目录含未列出的文件");
  }
  return {
    manifest,
    project,
    styleBibleFile: project.styleBibleRef
      ? path.join(bundle, STYLE_FILE)
      : null,
  };
}

export async function restorePortableBundle({ bundle, storeRoot, out }) {
  if (!path.isAbsolute(storeRoot)) fail("目标媒体仓路径须为绝对路径");
  if (within(bundle, out) || within(bundle, storeRoot))
    fail("恢复输出和目标媒体仓不能位于原项目包内部");
  if (within(out, storeRoot) || within(storeRoot, out))
    fail("恢复输出与目标媒体仓不能互相包含");
  const verified = await verifyPortableBundle(bundle);
  if (await exists(out)) fail(`恢复输出目录已存在：${out}`);
  const media = mediaFiles(verified.project);
  const originalDir = path.join(storeRoot, "original");
  if (await exists(storeRoot)) await plainDirectory(storeRoot, "目标媒体仓");
  if (await exists(originalDir))
    await plainDirectory(originalDir, "目标原件目录");
  // Validate every pre-existing destination before installing any new file.
  for (const entry of media) {
    const destination = originalPath(storeRoot, path.basename(entry.path));
    if (!(await exists(destination))) continue;
    const info = await regularFile(destination, "目标仓原件");
    if (
      info.size !== entry.bytes ||
      (await sha256File(destination)) !== entry.sha256
    )
      fail(`目标仓同键文件与项目摘要冲突：${entry.path}`);
  }
  const createdDirs = [];
  let tempOut;
  const created = [];
  try {
    if (media.length) await ensureDirectory(originalDir, createdDirs);
    await ensureDirectory(path.dirname(out), createdDirs);
    tempOut = await mkdtemp(
      path.join(path.dirname(out), ".acs-video-restore-"),
    );
    for (const entry of media) {
      const destination = originalPath(storeRoot, path.basename(entry.path));
      if (await exists(destination)) continue;
      const tempAsset = path.join(
        originalDir,
        `.${path.basename(entry.path)}.${randomUUID()}.tmp`,
      );
      try {
        await copyFile(path.join(bundle, ...entry.path.split("/")), tempAsset);
        const copied = await fileEntry(tempAsset, entry.path);
        if (copied.bytes !== entry.bytes || copied.sha256 !== entry.sha256)
          fail(`恢复时包内原件发生变化：${entry.path}`);
        try {
          // link is create-only: a concurrent writer cannot be overwritten.
          await link(tempAsset, destination);
          created.push(destination);
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
          const existing = await fileEntry(destination, entry.path);
          if (
            existing.bytes !== entry.bytes ||
            existing.sha256 !== entry.sha256
          )
            fail(`目标仓同键文件与项目摘要冲突：${entry.path}`);
        }
      } finally {
        await rm(tempAsset, { force: true });
      }
    }
    await copyFile(
      path.join(bundle, PROJECT_FILE),
      path.join(tempOut, PROJECT_FILE),
    );
    const projectCopy = await fileEntry(
      path.join(tempOut, PROJECT_FILE),
      PROJECT_FILE,
    );
    const projectListed = verified.manifest.files.find(
      (item) => item.path === PROJECT_FILE,
    );
    if (
      projectCopy.bytes !== projectListed.bytes ||
      projectCopy.sha256 !== projectListed.sha256
    )
      fail("恢复时项目文件发生变化");
    if (verified.styleBibleFile) {
      await copyFile(verified.styleBibleFile, path.join(tempOut, STYLE_FILE));
      const styleCopy = await fileEntry(
        path.join(tempOut, STYLE_FILE),
        STYLE_FILE,
      );
      const styleListed = verified.manifest.files.find(
        (item) => item.path === STYLE_FILE,
      );
      if (
        styleCopy.bytes !== styleListed.bytes ||
        styleCopy.sha256 !== styleListed.sha256
      )
        fail("恢复时 Style Bible 文件发生变化");
    }
    if (await exists(out)) fail(`恢复输出目录已存在：${out}`);
    await rename(tempOut, out);
    return {
      projectFile: path.join(out, PROJECT_FILE),
      styleBibleFile: verified.styleBibleFile
        ? path.join(out, STYLE_FILE)
        : null,
      installedMedia: created.length,
    };
  } catch (error) {
    const failures = [];
    if (tempOut) {
      try {
        await rm(tempOut, { recursive: true, force: true });
      } catch (cleanupError) {
        failures.push(cleanupError);
      }
    }
    for (const file of created.reverse()) {
      try {
        await unlink(file);
      } catch (cleanupError) {
        if (cleanupError.code !== "ENOENT") failures.push(cleanupError);
      }
    }
    failures.push(...(await removeCreatedDirectories(createdDirs)));
    throwAfterCleanup(error, failures);
  }
}
