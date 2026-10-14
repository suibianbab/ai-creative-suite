import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  executeNativePlan,
  supportedCapabilities,
} from "./native-command-adapter.mjs";

const cli = resolve(
  ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe",
);
const groups = supportedCapabilities(cli);
assert.ok(
  groups.adjustment.some(({ id }) => id === "layer.newAdjustmentLayer.curves"),
);
assert.ok(groups.text.some(({ id }) => id === "type.create"));
let captured;
await executeNativePlan({
  cli,
  input: "input.png",
  output: "output.pcraft",
  commands: [{ id: "type.create", params: { x: 20, y: 30, text: "ABC" } }],
  run: async (args) => {
    captured = args;
  },
});
assert.deepEqual(captured.slice(0, 2), ["run", "input.png"]);
assert.deepEqual(captured.slice(-2), ["--out", "output.pcraft"]);
await assert.rejects(
  () =>
    executeNativePlan({
      cli,
      input: "input.png",
      output: "output.pcraft",
      commands: [{ id: "not.a.photocraft.command", params: {} }],
      run: async () => {},
    }),
  /命令无效/,
);
console.log(
  "PASS: pinned PhotoCraft command catalog and reusable native executor",
);
