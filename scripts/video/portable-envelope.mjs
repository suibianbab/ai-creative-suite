// Single-file browser transport for the already verified directory bundle.
// This local-development format deliberately caps total size; large projects
// continue to use the streaming directory CLI.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  packPortableProject,
  restorePortableBundle,
  verifyPortableBundle,
} from "./portable-package.mjs";

export const MAX_ENVELOPE_BYTES = 32 * 1024 * 1024;
const MAX_FILES = 1003;
const FORMAT = "acs-video-portable-envelope";
const SAFE_PATH =
  /^(manifest\.json|project\.video-project\.json|style-bible\.json|media\/original\/[0-9a-f]{16}\.(?:mp4|webm|mov))$/;
const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function fail(message) {
  throw new Error(`浏览器项目包：${message}`);
}

async function scratch() {
  return mkdtemp(path.join(tmpdir(), "acs-video-envelope-"));
}

function decodeEnvelope(text) {
  if (Buffer.byteLength(text) > MAX_ENVELOPE_BYTES)
    fail("文件超过浏览器 32 MiB 上限，请使用 CLI 目录包");
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    fail("不是合法 JSON");
  }
  if (
    !envelope ||
    envelope.format !== FORMAT ||
    envelope.formatVersion !== 1 ||
    !Array.isArray(envelope.files) ||
    envelope.files.length < 2 ||
    envelope.files.length > MAX_FILES
  )
    fail("格式无效、文件数超限或版本不支持");
  const seen = new Set();
  let decodedBytes = 0;
  for (const file of envelope.files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      !SAFE_PATH.test(file.path) ||
      typeof file.base64 !== "string" ||
      !BASE64.test(file.base64) ||
      seen.has(file.path)
    )
      fail("存在非法、重复的文件路径或无效 base64");
    seen.add(file.path);
    decodedBytes += Buffer.byteLength(file.base64, "base64");
    if (decodedBytes > MAX_ENVELOPE_BYTES) fail("解码后文件总量超限");
  }
  if (!seen.has("manifest.json") || !seen.has("project.video-project.json"))
    fail("缺少 manifest 或项目文件");
  return envelope;
}

export async function createPortableEnvelope({
  project,
  styleBible,
  storeRoot,
}) {
  const declaredMediaBytes = (project?.mediaAssets ?? []).reduce(
    (sum, asset) => sum + (asset?.original?.bytes ?? 0),
    0,
  );
  if (declaredMediaBytes > (MAX_ENVELOPE_BYTES * 3) / 4)
    fail("媒体原件超过浏览器单文件容量，请使用 CLI 目录包");
  const root = await scratch();
  try {
    const projectFile = path.join(root, "source.video-project.json");
    await writeFile(projectFile, JSON.stringify(project));
    let styleBibleFile;
    if (styleBible !== undefined && styleBible !== null) {
      styleBibleFile = path.join(root, "source.style-bible.json");
      await writeFile(styleBibleFile, JSON.stringify(styleBible));
    }
    const bundle = path.join(root, "bundle");
    const manifest = await packPortableProject({
      projectFile,
      styleBibleFile,
      storeRoot,
      out: bundle,
    });
    const estimatedBase64Bytes = [
      { bytes: Buffer.byteLength(JSON.stringify(manifest)) },
      ...manifest.files,
    ].reduce((sum, entry) => sum + 4 * Math.ceil(entry.bytes / 3), 0);
    if (estimatedBase64Bytes > MAX_ENVELOPE_BYTES)
      fail("文件超过浏览器 32 MiB 上限，请使用 CLI 目录包");
    const files = [];
    for (const entry of [{ path: "manifest.json" }, ...manifest.files]) {
      const bytes = await readFile(path.join(bundle, ...entry.path.split("/")));
      files.push({ path: entry.path, base64: bytes.toString("base64") });
    }
    const text = JSON.stringify({ format: FORMAT, formatVersion: 1, files });
    if (Buffer.byteLength(text) > MAX_ENVELOPE_BYTES)
      fail("文件超过浏览器 32 MiB 上限，请使用 CLI 目录包");
    return text;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function restorePortableEnvelope({ text, storeRoot }) {
  const envelope = decodeEnvelope(text);
  const root = await scratch();
  try {
    const bundle = path.join(root, "bundle");
    await mkdir(bundle);
    for (const file of envelope.files) {
      const target = path.join(bundle, ...file.path.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(file.base64, "base64"), {
        flag: "wx",
      });
    }
    await verifyPortableBundle(bundle);
    const restored = await restorePortableBundle({
      bundle,
      storeRoot,
      out: path.join(root, "restored"),
    });
    const project = JSON.parse(await readFile(restored.projectFile, "utf8"));
    const styleBible = restored.styleBibleFile
      ? JSON.parse(await readFile(restored.styleBibleFile, "utf8"))
      : null;
    return { project, styleBible, installedMedia: restored.installedMedia };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
