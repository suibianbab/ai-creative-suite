import { execFileSync } from "node:child_process";
import { capabilities } from "./capability-manifest.mjs";

let cachedCatalog;

export function nativeCatalog(cli) {
  if (!cachedCatalog) {
    const entries = JSON.parse(
      execFileSync(cli, ["commands", "--json"], {
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      }),
    );
    if (!Array.isArray(entries) || entries.length < 100)
      throw new Error("PhotoCraft 命令目录无效");
    cachedCatalog = new Map(
      entries.map(({ id, label, params }) => [id, { id, label, params }]),
    );
  }
  return cachedCatalog;
}

export function validateNativeSteps(cli, commands) {
  if (!Array.isArray(commands) || commands.length < 1 || commands.length > 64)
    throw new Error("PhotoCraft 命令步骤数无效");
  const catalog = nativeCatalog(cli);
  for (const step of commands) {
    if (
      !step ||
      !catalog.has(step.id) ||
      !step.params ||
      typeof step.params !== "object" ||
      Array.isArray(step.params)
    )
      throw new Error(`PhotoCraft 命令无效：${step?.id ?? "unknown"}`);
  }
}

export async function executeNativePlan({ cli, input, output, commands, run }) {
  validateNativeSteps(cli, commands);
  const args = ["run", input];
  for (const step of commands) {
    args.push("--cmd", step.id, "--params", JSON.stringify(step.params));
  }
  args.push("--out", output);
  await run(args);
}

export function supportedCapabilities(cli) {
  const catalog = nativeCatalog(cli);
  const groups = {
    selection: [
      "select.object",
      "select.lasso",
      "select.rect",
      "select.refineEdge",
      "select.colorRange",
      "select.inverse",
      "select.modify.expand",
      "select.modify.contract",
      "select.modify.feather",
    ],
  };
  for (const capability of Object.values(capabilities)) {
    groups[capability.group] ??= [];
    groups[capability.group].push(...capability.nativeIds);
  }
  return Object.fromEntries(
    Object.entries(groups).map(([group, ids]) => [
      group,
      [...new Set(ids)].map((id) => catalog.get(id)).filter(Boolean),
    ]),
  );
}
