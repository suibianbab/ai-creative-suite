#!/usr/bin/env node
// media-server 中断安全回归（2026-10-28 渲染死因）：Chrome 155+ 的
// compositor 取帧会中途放弃下载连接；旧实现 createReadStream(...).pipe(res)
// 未接 error，客户端放弃即未捕获错误击杀服务进程，后续帧提取全部
// ECONNREFUSED。本测试：多次中途放弃 + 一次整取，服务必须始终存活。
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");

test("media-server：客户端中途放弃不击杀服务，后续整取仍 200", async () => {
  const storeRoot = mkdtempSync(path.join(tmpdir(), "msrv-test-"));
  mkdirSync(path.join(storeRoot, "original"), { recursive: true });
  // 16 hex 命名 + 128KB 假 mp4（够大让中断发生在流中段）。
  const key = "00112233445566ff.mp4";
  const big = Buffer.alloc(128 * 1024, 7);
  writeFileSync(path.join(storeRoot, "original", key), big);

  const child = spawn(
    process.execPath,
    [
      path.join(ROOT, "scripts/video/media-server.mjs"),
      "--root",
      storeRoot,
      "--files",
      key,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  try {
    const port = await new Promise((resolve, reject) => {
      child.stdout.on("data", (chunk) => {
        const match = /"port":(\d+)/.exec(String(chunk));
        if (match) resolve(Number(match[1]));
      });
      child.on("exit", () => reject(new Error("服务提前退出")));
      setTimeout(() => reject(new Error("端口上报超时")), 10_000);
    });
    const url = `http://127.0.0.1:${port}/original/${key}`;

    // 中途放弃 × 5（收到首字节即 abort，模拟 compositor 放弃下载）。
    for (let i = 0; i < 5; i++) {
      const controller = new AbortController();
      const response = await fetch(url, { signal: controller.signal });
      const reader = response.body.getReader();
      await reader.read();
      controller.abort();
    }
    // 服务必须仍活着并能整取。
    const full = await fetch(url);
    assert.equal(full.status, 200);
    const bytes = Buffer.from(await full.arrayBuffer());
    assert.equal(bytes.length, big.length);
    assert.ok(bytes[0] === 7 && bytes.at(-1) === 7);
  } finally {
    child.kill();
    rmSync(storeRoot, { recursive: true, force: true });
  }
});
