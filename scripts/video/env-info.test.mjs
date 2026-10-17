// env-info 探测模块测试：node --test scripts/video/env-info.test.mjs
// 用 process.execPath 当假浏览器（有版本资源的可执行文件），不依赖机器装 Chrome。
import assert from "node:assert/strict";
import test from "node:test";
import { browserLabel } from "./env-info.mjs";

test("可执行文件存在时返回带版本的标识", () => {
  const label = browserLabel(process.execPath);
  if (process.platform === "win32") {
    // Windows 读文件版本资源（chrome.exe --version 会转入既有会话不出版本号），
    // 形如 "Node.js 22.22.2" / "Google Chrome 131.0.6778.86"
    assert.match(label, /^Node\.js \d+\.\d+\.\d+/);
  } else {
    assert.match(label, /^v\d+\.\d+\.\d+/);
  }
});

test("可执行文件不存在或探测失败时返回 unavailable 标记，不抛异常", () => {
  assert.equal(
    browserLabel("Z:/no/such/browser.exe"),
    "unavailable (probe failed)",
  );
});

test("空路径返回 unavailable 标记（Remotion 自带 headless shell 场景）", () => {
  assert.equal(browserLabel(""), "unavailable (no explicit executable)");
});
