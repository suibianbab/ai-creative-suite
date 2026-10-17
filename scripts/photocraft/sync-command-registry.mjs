// M4(d) 命令注册表同步（ADR-0012 pin+regression 纪律的机械化）：
// 从钉死的 photocraft-cli 导出 `commands --json` 注册表，与本仓所有用到
// 原生命令的地方（capability manifest、dev bridge 适配器、apps/api 作业
// 映射与 worker 步骤）做双向 diff——
//   1) 我方在用的命令在注册表里缺失 → 退出码 1（换版本前必须补齐的回归）；
//   2) 注册表里尚未接入的命令 → 候选扩容清单（按菜单分组，供能力扩容评审）。
// 用法：node scripts/photocraft/sync-command-registry.mjs [--json] [--cli <path>]

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const DEFAULT_CLI = resolve(
  ROOT,
  ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe",
);

// 会引用原生命令 id 的文件（相对仓库根）。
const USED_SOURCES = [
  "scripts/photocraft/capability-manifest.mjs",
  "scripts/photocraft/native-command-adapter.mjs",
  "scripts/photocraft/selection-adapter.mjs",
  "scripts/photocraft/dev-bridge.mjs",
  "apps/api/src/image-projects/photocraft-edit-jobs.ts",
  "apps/api/src/image-projects/photocraft-edit-worker.ts",
];

const COMMAND_ID = /^"[a-z][a-zA-Z]*\.[a-zA-Z][a-zA-Z.]*"$/;
// 带点的文件名（input.pcraft、generated.png…）不是命令 id。
const FILE_EXTENSION =
  /\.(pcraft|psd|png|jpe?g|webp|exr|tiff?|gif|svg|json|pcdroplet)$/;

export function collectUsedIds(sources) {
  const used = new Map(); // id -> [file, ...]
  for (const [file, text] of sources) {
    for (const match of text.match(/"[^"\n]+"/g) ?? []) {
      if (!COMMAND_ID.test(match)) continue;
      const id = match.slice(1, -1);
      if (FILE_EXTENSION.test(id)) continue;
      const where = used.get(id) ?? [];
      if (!where.includes(file)) where.push(file);
      used.set(id, where);
    }
  }
  return used;
}

export function diffRegistry(registryEntries, usedIds) {
  const registry = new Map(registryEntries.map((entry) => [entry.id, entry]));
  const missing = [];
  const disabled = [];
  for (const [id, files] of [...usedIds].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const entry = registry.get(id);
    if (!entry) missing.push({ id, files });
    else if (!entry.enabled) disabled.push({ id, files });
  }
  // 候选扩容：注册表中已启用但本仓尚未使用的命令，按菜单路径分组。
  const candidates = new Map();
  for (const entry of registryEntries) {
    if (!entry.enabled || usedIds.has(entry.id)) continue;
    const group = entry.menu?.join(" › ") ?? "(无菜单)";
    const list = candidates.get(group) ?? [];
    list.push(entry.id);
    candidates.set(group, list);
  }
  for (const list of candidates.values()) list.sort();
  const sortedCandidates = new Map(
    [...candidates.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  return { missing, disabled, candidates: sortedCandidates };
}

export function exportRegistry(cliPath) {
  const output = execFileSync(cliPath, ["commands", "--json"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const entries = JSON.parse(output);
  if (!Array.isArray(entries) || entries.some((e) => typeof e?.id !== "string"))
    throw new Error("commands --json 输出不是命令注册表数组");
  return entries;
}

function renderReport({
  registryCount,
  usedCount,
  missing,
  disabled,
  candidates,
}) {
  const lines = [
    `PhotoCraft 命令注册表同步（共 ${registryCount} 条命令，本仓在用 ${usedCount} 条）`,
  ];
  if (missing.length) {
    lines.push("", "✗ 注册表缺失的在用命令（升级 pin 前必须补齐映射）：");
    for (const item of missing)
      lines.push(`  ${item.id}  ← ${item.files.join(", ")}`);
  } else {
    lines.push("✓ 本仓在用的命令全部存在于钉死版本的注册表");
  }
  if (disabled.length) {
    lines.push("", "△ 在用但注册表标记为需上下文启用（信息项，不计失败）：");
    for (const item of disabled)
      lines.push(`  ${item.id}  ← ${item.files.join(", ")}`);
  }
  lines.push("", "候选扩容清单（已启用、尚未接入任何能力）：");
  const groups = [...candidates.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [group, ids] of groups)
    lines.push(`  [${group}] ${ids.length} 条: ${ids.join(", ")}`);
  return lines.join("\n");
}

export async function main(argv = process.argv.slice(2)) {
  const asJson = argv.includes("--json");
  const cliFlag = argv.indexOf("--cli");
  const cliPath = resolve(
    cliFlag >= 0
      ? argv[cliFlag + 1]
      : (process.env.PHOTOCRAFT_CLI_PATH ?? DEFAULT_CLI),
  );
  const sources = await Promise.all(
    USED_SOURCES.map(async (file) => [
      file,
      await readFile(resolve(ROOT, file), "utf8"),
    ]),
  );
  const usedIds = collectUsedIds(sources);
  const registry = exportRegistry(cliPath);
  const result = {
    registryCount: registry.length,
    usedCount: usedIds.size,
    ...diffRegistry(registry, usedIds),
  };
  if (asJson) console.log(JSON.stringify(result, null, 2));
  else console.log(renderReport(result));
  if (result.missing.length) process.exitCode = 1;
}

if (argv0endsInThisFile()) await main();

function argv0endsInThisFile() {
  return (
    process.argv[1] &&
    resolve(process.argv[1]) === resolve(import.meta.filename ?? "")
  );
}
