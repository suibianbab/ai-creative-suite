import assert from "node:assert/strict";
import test from "node:test";
import type { VideoProject } from "@acs/video-document";
import { unboundSlotReasons } from "./slot-gate";

// P1-2（Codex 复核 2026-10-28）：未绑定素材位的最终导出闸——占位画面
// 自身诚实，但成功出片路径必须区分「草稿预览」与「素材齐备成片」。
// 纯函数：统计工作版本仍带【素材位】前缀的镜头并给出可操作原因。

function project(
  shots: Array<{ desc: string; source: "spec" | "media" }>,
): VideoProject {
  return {
    schemaVersion: 1,
    id: "p1",
    title: "产品片",
    brief: { sentence: "", aspectTargets: ["landscape", "portrait"] },
    shots: shots.map((s, i) => {
      const versionId = `v-${i}`;
      return {
        shotId: `s-${i}`,
        order: i,
        locked: false,
        workingVersionId: versionId,
        contentVersions: [
          {
            versionId,
            createdAt: "2026-10-28T00:00:00.000Z",
            durationMs: 3000,
            description: s.desc,
            narrationText: "旁白",
            sceneSource:
              s.source === "spec"
                ? { type: "spec", spec: {} }
                : {
                    type: "media-clip",
                    mediaAssetId: "a1",
                    inMs: 0,
                    outMs: 2800,
                    fit: "cover",
                    focalX: 0.5,
                    audio: "mute",
                  },
            provenance: { engineId: "planner-semantic", engineVersion: "1" },
          },
        ],
        events: [],
      };
    }),
    renderRecords: [],
    deliveries: [],
    savedVersion: 1,
  };
}

test("slot-gate：无素材位 → 放行（空原因）", () => {
  assert.deepEqual(
    unboundSlotReasons(
      project([
        { desc: "开场（标题）", source: "spec" },
        { desc: "产品整体照片（素材位）已绑定后的普通描述", source: "media" },
      ]),
    ),
    [],
  );
});

test("slot-gate：工作版本带【素材位】前缀 → 阻断原因点名镜头与种类", () => {
  const reasons = unboundSlotReasons(
    project([
      { desc: "开场（标题）", source: "spec" },
      { desc: "【素材位】产品整体照片——开场建立第一印象", source: "spec" },
      { desc: "【素材位】品牌LOGO照片——收尾", source: "spec" },
    ]),
  );
  assert.equal(reasons.length, 2);
  assert.match(reasons[0]!, /镜头 2/);
  assert.match(reasons[0]!, /产品整体照片/);
  assert.match(reasons[0]!, /绑定/);
  assert.match(reasons[1]!, /镜头 3/);
});

test("slot-gate：历史版本里的素材位不算（只看工作版本）", () => {
  // 绑定后占位版本仍在链上，但工作版本已剥离前缀 → 放行。
  const p = project([{ desc: "产品整体照片——开场", source: "media" }]);
  p.shots[0]!.contentVersions.push({
    versionId: "v-old",
    createdAt: "2026-10-27T00:00:00.000Z",
    durationMs: 3000,
    description: "【素材位】产品整体照片——开场",
    narrationText: "旁白",
    sceneSource: { type: "spec", spec: {} },
    provenance: { engineId: "planner-semantic", engineVersion: "1" },
  });
  assert.deepEqual(unboundSlotReasons(p), []);
});
