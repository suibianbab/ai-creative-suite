// P2-A（ADR 0003 §2.3）：可信渲染组件的确定性静态门禁。
// 组件是 (spec, ctx) → SvgNode 的纯函数——墙钟/未播种随机/网络/存储一律
// 禁止。此测试双重职责：
//   1) 自检：扫描器对每类违禁片段必须报出对应标签（证明门禁真的能抓）；
//   2) 巡检：对 src/components 全部组件源码扫描，出现即失败并点名文件。
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { scanForbiddenSource } from "./determinism-gate.js";

test("门禁自检：每类违禁 API 都被报出标签", () => {
  const cases: Array<[string, string]> = [
    ["const t = Date.now();", "墙钟 Date.now"],
    ["const d = new Date(0);", "墙钟 new Date"],
    ["const p = performance.now();", "墙钟 performance.now"],
    ["const r = Math.random();", "未播种随机 Math.random"],
    [
      "const b = crypto.getRandomValues(new Uint8Array(8));",
      "未播种随机 crypto",
    ],
    ["const x = await fetch('https://example.com');", "网络 fetch"],
    ["const w = new WebSocket('w://x');", "网络 WebSocket"],
    ["const h = new XMLHttpRequest();", "网络 XMLHttpRequest"],
    ["const s = new EventSource('/s');", "网络 EventSource"],
    ["navigator.sendBeacon('/b');", "网络 sendBeacon"],
    ["localStorage.setItem('k', 'v');", "存储 localStorage"],
  ];
  for (const [code, label] of cases) {
    const hits = scanForbiddenSource(code);
    assert.ok(
      hits.some((hit) => hit.includes(label.split(" ")[1] ?? label)),
      `扫描器漏报 ${label}：源码「${code}」命中 ${JSON.stringify(hits)}`,
    );
  }
});

test("门禁自检：合法源码（ctx.random、ctx.frame）不误报", () => {
  assert.deepEqual(
    scanForbiddenSource(
      "const x = ctx.random(); const t = ctx.frame / ctx.fps;",
    ),
    [],
  );
});

test("巡检：内置注册组件源码不含违禁 API", () => {
  const dir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/components",
  );
  const files = readdirSync(dir).filter(
    (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
  );
  assert.ok(
    files.length >= 3,
    `应至少扫到 3 个组件源文件，实际 ${files.length}`,
  );
  for (const name of files) {
    const hits = scanForbiddenSource(
      readFileSync(path.join(dir, name), "utf8"),
    );
    assert.deepEqual(hits, [], `${name} 违反确定性契约（ADR 0003 §2.3）`);
  }
});
