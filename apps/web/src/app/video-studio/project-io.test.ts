// P1-A：导出/导入的纯逻辑部分。文件下载与 file picker 在 page.tsx 接线。
import assert from "node:assert/strict";
import test from "node:test";
import { exportFileName, parseProjectJson } from "./project-io.js";

test("exportFileName：标题-短id.video-project.json", () => {
  assert.equal(
    exportFileName({
      title: "山水发布",
      id: "12345678-1234-4123-8123-123456789abc",
    }),
    "山水发布-12345678.video-project.json",
  );
  assert.equal(
    exportFileName({ title: "", id: "12345678-1234-4123-8123-123456789abc" }),
    "video-project-12345678.video-project.json",
  );
});

test("parseProjectJson：合法 JSON 通过；非法 JSON/非法文档给出可读错误", () => {
  const valid = JSON.stringify({
    schemaVersion: 1,
    id: "12345678-1234-4123-8123-123456789abc",
    title: "t",
    savedVersion: 1,
    brief: { sentence: "s", aspectTargets: ["landscape"] },
    shots: [],
    renderRecords: [],
    deliveries: [],
  });
  assert.equal(
    parseProjectJson(valid).id,
    "12345678-1234-4123-8123-123456789abc",
  );

  assert.throws(() => parseProjectJson("{oops"), /不是合法 JSON/);
  assert.throws(
    () =>
      parseProjectJson(
        JSON.stringify({ schemaVersion: 2, id: "x", title: "t" }),
      ),
    /不是合法 VideoProject/,
  );
});
