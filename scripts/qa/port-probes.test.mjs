// QA runner 的端口预检回归：VID-023（及 VID-017…VID-022）声明 requiresPorts:[3211]，
// 回归器必须认识 3211，否则标准入口会永远先判 BLOCKED。另覆盖 TCP 探针真值与
// 未登记端口的保守 false。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkPort, probeFor, probeTcp } from "./port-probes.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const REGISTRY = JSON.parse(
  readFileSync(path.join(ROOT, "qa/registry.json"), "utf8"),
);

function listenEphemeral() {
  return new Promise((resolveListen, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen(server));
  });
}

function closeServer(server) {
  return new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}

test("probeFor(3211) is a TCP probe function", () => {
  assert.equal(typeof probeFor(3211), "function");
});

test("every requiresPorts entry of automated QA cases has a probe", () => {
  for (const item of REGISTRY.automated) {
    for (const port of item.requiresPorts ?? []) {
      assert.notEqual(
        probeFor(port),
        null,
        `${item.id} requires port ${port} but no probe is registered`,
      );
    }
  }
});

test("probeTcp truth follows an ephemeral 127.0.0.1 listener", async () => {
  const server = await listenEphemeral();
  const { port } = server.address();
  try {
    assert.equal(await probeTcp(port), true);
  } finally {
    await closeServer(server);
  }
  assert.equal(await probeTcp(port), false);
});

test("unregistered ports are conservatively unavailable", async () => {
  assert.equal(probeFor(59999), null);
  assert.equal(await checkPort(59999), false);
});
