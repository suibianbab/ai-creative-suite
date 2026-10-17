// P1-C：乐观并发必须在一个 readwrite 事务内完成 get→比较→put。
// 两个标签页各自基于同一版本保存时，存储层必须让恰有一个成功、
// 另一个收到 VideoProjectConflictError，而不是后写静默覆盖先写。
import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import type { VideoProject } from "@acs/video-document";
import {
  saveVideoProject,
  VideoProjectConflictError,
} from "./local-video-projects.ts";

// 最小合法 VideoProject（validateVideoProject 只深查形状；spec 深校验归 video-scene）。
function makeProject(overrides: Partial<VideoProject> = {}): VideoProject {
  return {
    schemaVersion: 1,
    id: "11111111-1111-4111-8111-111111111111",
    title: "并发测试项目",
    savedVersion: 1,
    brief: { sentence: "做一个8秒的线描动画，标题是山水发布", aspectTargets: ["landscape"] },
    shots: [
      {
        shotId: "22222222-2222-4222-8222-222222222222",
        order: 0,
        locked: false,
        contentVersions: [
          {
            versionId: "33333333-3333-4333-8333-333333333333",
            createdAt: "2026-10-17T00:00:00.000Z",
            durationMs: 8000,
            description: "线描",
            narrationText: "",
            sceneSource: {
              type: "spec",
              spec: {
                specVersion: 1,
                componentId: "line-drawing",
                componentVersion: 1,
                durationMs: 8000,
                seed: 7,
                background: "#ffffff",
                params: {},
              },
            },
            provenance: { engineId: "rules-planner", engineVersion: "1" },
          },
        ],
        events: [],
        workingVersionId: "33333333-3333-4333-8333-333333333333",
      },
    ],
    renderRecords: [],
    deliveries: [],
    ...overrides,
  };
}

function withTabs<T>(body: () => Promise<T>): Promise<T> {
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory() as unknown as IDBFactory;
  return body().finally(() => {
    globalThis.indexedDB = previous;
  });
}

test("双标签并发保存：恰有一个成功，另一个收到冲突错误", async () => {
  await withTabs(async () => {
    const stored = await saveVideoProject(makeProject()); // v2 落库
    assert.equal(stored.savedVersion, 2);

    // 两个标签页都基于 v2 编辑（彼此不可见），并发保存
    const editA = makeProject({ ...stored, title: "标签页A的修改" });
    const editB = makeProject({ ...stored, title: "标签页B的修改" });
    const results = await Promise.allSettled([
      saveVideoProject(editA),
      saveVideoProject(editB),
    ]);

    const fulfilled = results.filter(
      (result) => result.status === "fulfilled",
    );
    const rejected = results.filter((result) => result.status === "rejected");
    assert.equal(fulfilled.length, 1, "恰有一个保存成功");
    assert.equal(rejected.length, 1, "另一个必须被拒绝");
    assert.ok(
      rejected[0]?.status === "rejected" &&
        rejected[0].reason instanceof VideoProjectConflictError,
      `拒绝原因应为冲突错误，实际: ${String(rejected[0]?.status === "rejected" && rejected[0].reason)}`,
    );
    assert.equal(
      fulfilled[0]?.status === "fulfilled" && fulfilled[0].value.savedVersion,
      3,
    );
  });
});

test("串行保存正常递增，重放幂等", async () => {
  await withTabs(async () => {
    const first = await saveVideoProject(makeProject()); // v2
    const second = await saveVideoProject(first); // 重放：同内容
    assert.equal(second.savedVersion, 2, "重放不递增");
    const third = await saveVideoProject({ ...first, title: "改标题" }); // v3
    assert.equal(third.savedVersion, 3);
  });
});
