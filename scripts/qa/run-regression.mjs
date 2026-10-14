import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const registryPath = resolve(root, "qa/registry.json");
const tiers = new Set(["smoke", "integration", "oidc", "image-qa"]);
const mode = process.argv[2] ?? "validate";
if (![...tiers, "all", "validate"].includes(mode) || process.argv.length > 3) {
  throw new Error(
    "Usage: run-regression.mjs <validate|smoke|integration|oidc|image-qa|all>",
  );
}

function insideRoot(relative) {
  const target = resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error(`Path escapes repository: ${relative}`);
  }
  return target;
}

function words(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
  );
}

function validateRegistry(registry) {
  if (
    registry?.schemaVersion !== 1 ||
    !Array.isArray(registry.automated) ||
    !Array.isArray(registry.manual)
  ) {
    throw new Error("Invalid QA registry schema");
  }
  const ids = new Set();
  for (const item of [...registry.automated, ...registry.manual]) {
    if (
      typeof item.id !== "string" ||
      !/^[A-Z0-9]+-[0-9]{3}$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.title !== "string" ||
      !item.title.trim()
    ) {
      throw new Error(`Invalid or duplicate QA case ID: ${item.id}`);
    }
    ids.add(item.id);
  }
  for (const item of registry.automated) {
    if (
      !tiers.has(item.tier) ||
      typeof item.cwd !== "string" ||
      !words(item.argv) ||
      !["pnpm", "node", "python"].includes(item.argv[0]) ||
      item.argv.some((arg) => /[\r\n&|<>]/.test(arg)) ||
      !words(item.checks) ||
      (item.requiresFiles && !words(item.requiresFiles)) ||
      (item.requiresPorts &&
        (!Array.isArray(item.requiresPorts) ||
          item.requiresPorts.some(
            (port) => !Number.isInteger(port) || port < 1 || port > 65535,
          )))
    ) {
      throw new Error(`Invalid automated QA case: ${item.id}`);
    }
    const cwd = insideRoot(item.cwd);
    if (!existsSync(cwd))
      throw new Error(`Missing QA working directory: ${item.id}`);
    const script = item.argv.at(-1);
    if (
      (item.argv[0] === "node" || item.argv[0] === "python") &&
      script?.match(/\.(?:ts|js|mjs|py)$/) &&
      !existsSync(resolve(cwd, script))
    ) {
      throw new Error(`Missing QA test script: ${item.id}`);
    }
    for (const file of item.requiresFiles ?? []) insideRoot(file);
  }
  for (const item of registry.manual) {
    if (
      typeof item.fixture !== "string" ||
      !item.fixture.trim() ||
      !words(item.steps) ||
      !words(item.passCriteria)
    ) {
      throw new Error(`Invalid manual QA case: ${item.id}`);
    }
  }
  return registry;
}

function git(...args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

async function checkPostgres() {
  return await new Promise((resolvePort) => {
    const socket = createConnection({ host: "127.0.0.1", port: 5432 });
    socket.setTimeout(3000);
    socket.once("connect", () => {
      const sslRequest = Buffer.alloc(8);
      sslRequest.writeInt32BE(8, 0);
      sslRequest.writeInt32BE(80877103, 4);
      socket.write(sslRequest);
    });
    socket.once("data", (data) => {
      socket.destroy();
      resolvePort(data[0] === 0x4e || data[0] === 0x53);
    });
    for (const event of ["error", "timeout", "end"]) {
      socket.once(event, () => {
        socket.destroy();
        resolvePort(false);
      });
    }
  });
}

async function checkPort(port) {
  if (port === 5432) return await checkPostgres();
  if ([9000, 8180, 4112, 3000, 11435].includes(port)) {
    const url =
      port === 9000
        ? "http://127.0.0.1:9000/health"
        : port === 4112
          ? "http://127.0.0.1:4112/health"
          : port === 3000
            ? "http://localhost:3000/image-studio/photocraft"
            : port === 11435
              ? "http://127.0.0.1:11435/health"
              : "http://127.0.0.1:8180/realms/acs-dev/.well-known/openid-configuration";
    try {
      return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok;
    } catch {
      return false;
    }
  }
  return false;
}

async function prerequisites(item) {
  const missing = [];
  for (const file of item.requiresFiles ?? []) {
    try {
      await access(insideRoot(file));
    } catch {
      missing.push(`file ${file}`);
    }
  }
  for (const port of item.requiresPorts ?? []) {
    if (!(await checkPort(port))) missing.push(`127.0.0.1:${port}`);
  }
  return missing;
}

function run(item) {
  return new Promise((resolveRun) => {
    const child = spawn(item.argv[0], item.argv.slice(1), {
      cwd: insideRoot(item.cwd),
      stdio: "inherit",
      shell: process.platform === "win32",
      windowsHide: true,
    });
    child.once("error", (error) =>
      resolveRun({ exitCode: null, error: error.message }),
    );
    child.once("close", (code) => resolveRun({ exitCode: code, error: null }));
  });
}

const registry = validateRegistry(
  JSON.parse(await readFile(registryPath, "utf8")),
);
if (mode === "validate") {
  console.log(
    `QA registry valid: ${registry.automated.length} automated and ${registry.manual.length} manual cases`,
  );
  process.exit(0);
}

const selected = registry.automated.filter(
  (item) => mode === "all" || item.tier === mode,
);
const startedAt = new Date();
const report = {
  schemaVersion: 1,
  mode,
  startedAt: startedAt.toISOString(),
  finishedAt: "",
  gitCommit: git("rev-parse", "HEAD"),
  gitDirty: Boolean(git("status", "--porcelain")),
  nodeVersion: process.version,
  platform: process.platform,
  cases: [],
};

for (const item of selected) {
  const caseStarted = Date.now();
  const missing = await prerequisites(item);
  console.log(`\n[${item.id}] ${item.title}`);
  let result;
  if (missing.length) {
    result = {
      status: "BLOCKED",
      exitCode: null,
      reason: `Missing ${missing.join(", ")}`,
    };
  } else {
    const processResult = await run(item);
    const unavailableAfterFailure =
      processResult.exitCode === 0 ? [] : await prerequisites(item);
    result = {
      status:
        processResult.exitCode === 0
          ? "PASS"
          : unavailableAfterFailure.length
            ? "BLOCKED"
            : "FAIL",
      exitCode: processResult.exitCode,
      reason: unavailableAfterFailure.length
        ? `Infrastructure unavailable: ${unavailableAfterFailure.join(", ")}`
        : processResult.error,
    };
  }
  report.cases.push({
    id: item.id,
    tier: item.tier,
    title: item.title,
    checks: item.checks,
    durationMs: Date.now() - caseStarted,
    ...result,
  });
  console.log(
    `${result.status} ${item.id}${result.reason ? `: ${result.reason}` : ""}`,
  );
}

report.finishedAt = new Date().toISOString();
const reportDir = resolve(root, "qa/reports");
await mkdir(reportDir, { recursive: true });
const name = `qa-${mode}-${startedAt.toISOString().replaceAll(/[:.]/g, "-")}.json`;
const reportPath = resolve(reportDir, name);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
const passed = report.cases.filter((item) => item.status === "PASS").length;
console.log(
  `\n${mode}: ${passed}/${report.cases.length} passed. Report: ${reportPath}`,
);
if (passed !== report.cases.length) process.exitCode = 1;
