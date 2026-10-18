// 终评 Important#1（tts-narration CLI 冒烟，零网络）：文档接口是
// --allow-truncate，但 parseArgs 的 option key 曾写成 camelCase allowTruncate
// ——node:util 不做 kebab↔camel 转换，真实调用会 ERR_PARSE_ARGS_UNKNOWN_OPTION
// 崩在参数解析（e2e 恰好 0 对齐从未触发该分支才没暴露）。冒烟方式：不带
// --project 跑 CLI，必须在「缺 --project」处失败，而不是崩在解析。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CLI = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "tts-narration.mjs",
);

test("--allow-truncate 可解析：无参调用失败在「缺 --project」而非 UNKNOWN_OPTION", () => {
  const result = spawnSync(process.execPath, [CLI, "--allow-truncate"], {
    encoding: "utf8",
    env: { ...process.env, DASHSCOPE_API_KEY: "" },
  });
  assert.notEqual(result.status, 0, "必须以非零退出（缺 --project）");
  assert.match(result.stderr, /缺 --project/);
  assert.doesNotMatch(result.stderr, /UNKNOWN_OPTION/);
});
