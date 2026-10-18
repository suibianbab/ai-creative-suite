// D4 导出扩充：单镜头 SVG 导出 CLI 的纯辅助单测（ffmpeg 无关；渲染注入在 e2e 验证）。

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  resolveShot,
  sampledFrameCount,
  shotFrames,
} from "./export-shot-svg.mjs";

const T = "2026-10-18T00:00:00.000Z";
function project() {
  const v1 = randomUUID();
  const v2 = randomUUID();
  return {
    schemaVersion: 1,
    id: randomUUID(),
    title: "SVG 单测",
    brief: { sentence: "占位", aspectTargets: ["landscape"] },
    shots: [
      {
        shotId: randomUUID(),
        order: 0,
        locked: false,
        workingVersionId: v1,
        contentVersions: [
          {
            versionId: v1,
            createdAt: T,
            durationMs: 2000,
            description: "",
            narrationText: "一。",
            sceneSource: {
              type: "spec",
              spec: {
                componentId: "text-animation",
                componentVersion: 1,
                seed: 1,
                durationMs: 2000,
                background: "#fff",
                params: {},
              },
            },
            provenance: { engineId: "x", engineVersion: "1" },
          },
        ],
        events: [{ at: T, kind: "submitted", actor: "human" }],
      },
      {
        shotId: randomUUID(),
        order: 1,
        locked: false,
        workingVersionId: v2,
        contentVersions: [
          {
            versionId: v2,
            createdAt: T,
            durationMs: 3100,
            description: "",
            narrationText: "二。",
            sceneSource: { type: "text", text: "外部文本" },
            provenance: { engineId: "x", engineVersion: "1" },
          },
        ],
        events: [{ at: T, kind: "submitted", actor: "human" }],
      },
    ],
    renderRecords: [],
    deliveries: [],
    savedVersion: 1,
  };
}

test("resolveShot 1 基序号解析 working 版本", () => {
  // 1 号 → shots[0]（spec 源）；若实现误为 0 基会落到 2 号 text 源并抛「仅 spec」。
  const p = project();
  const { shot, version } = resolveShot(p, 1);
  assert.equal(version.versionId, shot.workingVersionId);
  assert.equal(version.sceneSource.type, "spec");
});

test("resolveShot 越界报错给出合法范围", () => {
  assert.throws(() => resolveShot(project(), 3), /1\.\.2/);
  assert.throws(() => resolveShot(project(), 0), /1\.\.2/);
});

test("resolveShot 非 spec 场景源拒绝并指路", () => {
  // 计划括注定案：校验放进 resolveShot，非 spec 场景源在此 throw。
  assert.throws(() => resolveShot(project(), 2), /仅 spec/);
});

test("shotFrames 与出片量化口径一致", () => {
  assert.equal(shotFrames(2000), 48);
  assert.equal(shotFrames(3100), 74);
});

test("sampledFrameCount 整除精确、非整除拒绝", () => {
  assert.equal(sampledFrameCount(48, 12), 24);
  assert.equal(sampledFrameCount(74, 12), 37);
  assert.throws(() => sampledFrameCount(48, 10), /合法值/);
});
