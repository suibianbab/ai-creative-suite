// P1-C：乐观并发必须在一个 readwrite 事务内完成 get→比较→put。
// 两个标签页各自基于同一版本保存时，存储层必须让恰有一个成功、
// 另一个收到 VideoProjectConflictError，而不是后写静默覆盖先写。

import assert from "node:assert/strict";
import test from "node:test";
import type { VideoProject } from "@acs/video-document";
import { IDBFactory } from "fake-indexeddb";
import {
  openVideoProject,
  readVideoProjectVersion,
  saveVideoProject,
  VideoProjectConflictError,
  VideoProjectMutationError,
} from "./local-video-projects.js";

// 最小合法 VideoProject（validateVideoProject 只深查形状；spec 深校验归 video-scene）。
function makeProject(overrides: Partial<VideoProject> = {}): VideoProject {
  return {
    schemaVersion: 1,
    id: "11111111-1111-4111-8111-111111111111",
    title: "并发测试项目",
    savedVersion: 1,
    brief: {
      sentence: "做一个8秒的线描动画，标题是山水发布",
      aspectTargets: ["landscape"],
    },
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

    const fulfilled = results.filter((result) => result.status === "fulfilled");
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

// —— P1-B：不可变文档版本（快照 + 只追加演进） ——

test("每个已保存版本留有快照，可读回 v2 与 v3", async () => {
  await withTabs(async () => {
    const v2 = await saveVideoProject(makeProject()); // v2
    const edited = structuredClone(v2);
    edited.title = "改后的标题";
    const v3 = await saveVideoProject(edited); // v3

    const snapshot2 = await readVideoProjectVersion(v2.id, 2);
    const snapshot3 = await readVideoProjectVersion(v3.id, 3);
    assert.ok(snapshot2 && snapshot3);
    assert.equal(snapshot2.title, "并发测试项目", "v2 是旧标题的原始快照");
    assert.equal(snapshot3.title, "改后的标题");
    assert.equal(await readVideoProjectVersion(v2.id, 99), null);
  });
});

test("改写旧内容版本的保存被拒（VideoProjectMutationError）", async () => {
  await withTabs(async () => {
    const v2 = await saveVideoProject(makeProject());
    const tampered = structuredClone(v2);
    tampered.shots[0]!.contentVersions[0]!.description = "篡改旧版描述";
    await assert.rejects(
      () => saveVideoProject(tampered),
      VideoProjectMutationError,
    );
  });
});

test("v1 单记录库升级到 v2：既有记录迁移为快照，可继续保存", async () => {
  await withTabs(async () => {
    // 造一个 v1 结构的旧库：只有 projects store、单条当前记录
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("acs-video-studio-local", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("projects", { keyPath: "id" });
      };
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("projects", "readwrite");
        const legacy = makeProject(); // savedVersion 1，v1 时代的存量文档
        transaction
          .objectStore("projects")
          .put({ id: legacy.id, title: legacy.title, updatedAt: 1, savedVersion: 1, document: legacy });
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });

    const reopened = await openVideoProject("11111111-1111-4111-8111-111111111111");
    assert.ok(reopened);
    const next = await saveVideoProject({
      ...reopened,
      title: "迁移后继续编辑",
    }); // 升级到 v2 后继续保存（原样重存会走幂等重放）
    assert.equal(next.savedVersion, 2);
    const migrated = await readVideoProjectVersion(reopened.id, 1);
    assert.ok(migrated, "v1 存量记录升级后成为可读快照");
  });
});
