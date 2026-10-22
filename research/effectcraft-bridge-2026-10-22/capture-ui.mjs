// Capture real EffectCraft desktop panels through its documented MCP bridge.
import { spawn } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const cli = process.env.EFFECTCRAFT_CLI;
if (!cli) throw new Error("Set EFFECTCRAFT_CLI to the v0.14.0 executable");
const here = path.dirname(fileURLToPath(import.meta.url));
const tag = process.env.EFFECTCRAFT_CAPTURE_TAG || "default";
const child = spawn(cli, ["mcp", "--bridge", "9877"], {
  stdio: ["pipe", "pipe", "pipe"],
});
let nextId = 1;
const pending = new Map();
createInterface({ input: child.stdout }).on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === undefined) return;
  const p = pending.get(message.id);
  if (!p) return;
  pending.delete(message.id);
  clearTimeout(p.timer);
  if (message.error) p.reject(new Error(JSON.stringify(message.error)));
  else p.resolve(message.result);
});
let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});
function request(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timeout: ${stderr}`));
    }, 15000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
  });
}
try {
  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "acs-effectcraft-spike", version: "0.1" },
  });
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );
  const list = await request("tools/list");
  if (!list.tools.some((tool) => tool.name === "screenshot"))
    throw new Error("EffectCraft bridge has no screenshot tool");
  for (const panel of ["Timeline", "Composition"]) {
    const output = path.join(
      here,
      `effectcraft-ui-${panel.toLowerCase()}-${tag}.png`,
    );
    const result = await request("tools/call", {
      name: "screenshot",
      arguments: { panel, path: output, max_side: 1600 },
    });
    if (result.isError) throw new Error(JSON.stringify(result.content));
    console.log(`${panel}: ${output}`);
  }
} finally {
  child.stdin.end();
  child.kill();
}
