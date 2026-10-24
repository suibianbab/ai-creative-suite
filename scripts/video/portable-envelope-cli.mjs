#!/usr/bin/env node
// The Next route invokes this as a separate Node process. Turbopack cannot
// resolve a workspace-relative dynamic import expression at runtime.
import { readFile, writeFile } from "node:fs/promises";
import {
  createPortableEnvelope,
  restorePortableEnvelope,
} from "./portable-envelope.mjs";

const [action, input, output, storeRoot] = process.argv.slice(2);
try {
  if (!input || !output || !storeRoot) throw new Error("缺少项目包 CLI 参数");
  if (action === "export") {
    const { project, styleBible } = JSON.parse(await readFile(input, "utf8"));
    const text = await createPortableEnvelope({
      project,
      styleBible,
      storeRoot,
    });
    await writeFile(output, text, { flag: "wx" });
  } else if (action === "import") {
    const text = await readFile(input, "utf8");
    const result = await restorePortableEnvelope({ text, storeRoot });
    await writeFile(output, JSON.stringify(result), { flag: "wx" });
  } else {
    throw new Error("项目包操作无效");
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
