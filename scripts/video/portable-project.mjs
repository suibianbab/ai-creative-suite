#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// Usage:
//   node scripts/video/portable-project.mjs pack --project P --out DIR [--store DIR] [--style-bible B]
//   node scripts/video/portable-project.mjs verify --bundle DIR
//   node scripts/video/portable-project.mjs restore --bundle DIR --out DIR [--store DIR]
import { parseArgs } from "node:util";
import {
  packPortableProject,
  restorePortableBundle,
  verifyPortableBundle,
} from "./portable-package.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const { resolveStoreRoot } = await import(
  pathToFileURL(path.join(ROOT, "packages/media-store/dist/index.js")).href
);

const [command, ...args] = process.argv.slice(2);
const usage =
  "用法：portable-project.mjs pack --project <json> --out <新目录> [--store <绝对路径>] [--style-bible <json>] | verify --bundle <目录> | restore --bundle <目录> --out <新目录> [--store <绝对路径>]";
try {
  if (!["pack", "verify", "restore"].includes(command)) throw new Error(usage);
  const { values } = parseArgs({
    args,
    options: {
      project: { type: "string" },
      out: { type: "string" },
      store: { type: "string" },
      "style-bible": { type: "string" },
      bundle: { type: "string" },
    },
    strict: true,
  });
  let result;
  if (command === "pack") {
    if (!values.project || !values.out || values.bundle) throw new Error(usage);
    result = await packPortableProject({
      projectFile: path.resolve(values.project),
      out: path.resolve(values.out),
      storeRoot: values.store ?? resolveStoreRoot(),
      styleBibleFile: values["style-bible"]
        ? path.resolve(values["style-bible"])
        : undefined,
    });
  } else if (command === "verify") {
    if (
      !values.bundle ||
      values.out ||
      values.project ||
      values.store ||
      values["style-bible"]
    )
      throw new Error(usage);
    const verified = await verifyPortableBundle(path.resolve(values.bundle));
    result = {
      projectId: verified.project.id,
      files: verified.manifest.files.length,
      valid: true,
    };
  } else {
    if (
      !values.bundle ||
      !values.out ||
      values.project ||
      values["style-bible"]
    )
      throw new Error(usage);
    result = await restorePortableBundle({
      bundle: path.resolve(values.bundle),
      out: path.resolve(values.out),
      storeRoot: values.store ?? resolveStoreRoot(),
    });
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
