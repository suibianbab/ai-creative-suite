import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import ts from "typescript";
import { capabilities } from "./capability-manifest.mjs";

const root = resolve(import.meta.dirname, "../..");
const source = join(root, "apps/web/src/app/image-studio/photocraft");
const output = join(root, ".tools/photocraft-tests");
await mkdir(output, { recursive: true });
for (const name of [
  "planner-catalog.ts",
  "instruction.ts",
  "instruction-ir.ts",
  "default-strategy.ts",
  "operation-constraints.ts",
  "instruction.test.ts",
  "instruction-ir.test.ts",
  "default-strategy.test.ts",
  "operation-constraints.test.ts",
  "instruction-eval-cases.ts",
  "instruction-eval.test.ts",
]) {
  const text = await readFile(join(source, name), "utf8");
  const compiled = ts.transpileModule(text, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: name,
  });
  await writeFile(
    join(output, name.replace(/\.ts$/, ".js")),
    compiled.outputText,
  );
}
const require = createRequire(import.meta.url);
const { plannerCapabilities } = require(join(output, "planner-catalog.js"));
assert.deepEqual(
  plannerCapabilities.map((item) => item.operation).sort(),
  Object.keys(capabilities).sort(),
  "planner and native bridge capabilities must stay in sync",
);
const result = spawnSync(
  process.execPath,
  [
    "--test",
    join(output, "instruction.test.js"),
    join(output, "instruction-ir.test.js"),
    join(output, "default-strategy.test.js"),
    join(output, "operation-constraints.test.js"),
    join(output, "instruction-eval.test.js"),
  ],
  {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  },
);
process.exitCode = result.status ?? 1;
