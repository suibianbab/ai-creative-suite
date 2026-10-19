#!/usr/bin/env node
// P2.5-T2：本地媒体导入 CLI（spec §1）。读文件 → @acs/media-store 导入管线
// → stdout 打印 MediaAsset JSON；失败 exit 1 + stderr 中文。仓默认
// ACS_MEDIA_STORE（未设 = ~/.acs/media-store），--store 覆盖（须绝对路径）。
// 用法: node scripts/video/media-ingest.mjs --file <path> [--store <abs dir>] [--no-proxy]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const { values } = parseArgs({
  options: {
    file: { type: "string" },
    store: { type: "string" },
    "no-proxy": { type: "boolean", default: false },
  },
});

if (!values.file || (values.store && !path.isAbsolute(values.store))) {
  console.error(
    "用法: node scripts/video/media-ingest.mjs --file <path> [--store <abs dir>] [--no-proxy]",
  );
  process.exit(2);
}
if (values.store) process.env.ACS_MEDIA_STORE = values.store;

const { ingestMediaFile, resolveStoreRoot } = await import(
  pathToFileURL(path.join(ROOT, "packages/media-store/dist/index.js")).href
);
// F6：读文件/解析仓根的失败也走"exit 1 + stderr 中文"，不裸抛英文堆栈
const bytes = (() => {
  try {
    return readFileSync(values.file);
  } catch {
    console.error(`无法读取文件：${values.file}（路径不存在或不可读）`);
    process.exit(1);
  }
})();
const root = (() => {
  try {
    return resolveStoreRoot();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
})();
const result = await ingestMediaFile({
  bytes,
  fileName: path.basename(values.file),
  root,
  generateProxy: !values["no-proxy"],
});
if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}
console.log(JSON.stringify(result.asset, null, 2));
