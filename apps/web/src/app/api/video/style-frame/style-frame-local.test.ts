import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { StyleBible, VideoProject } from "@acs/video-document";
import { styleVersionDigest } from "@acs/video-document";
import {
  pruneOldestStyleFrames,
  renderStyleFrame,
  styleFramePath,
  styleFrameRoot,
} from "./style-frame-local";

const AT = "2026-10-24T00:00:00.000Z";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][a-f0-9]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const PALETTE = {
  background: "#101820",
  foreground: "#f3e6cf",
  secondary: "#e8b04b",
  accent: "#e8b04b",
  object: "#c98548",
};

export async function buildBibleForTest(): Promise<StyleBible> {
  return buildBible();
}

async function buildBible(): Promise<StyleBible> {
  const versionId = "22222222-2222-4222-8222-222222222222";
  return {
    schemaVersion: 1,
    id: "11111111-1111-4111-8111-111111111111",
    currentVersionId: versionId,
    versions: [
      {
        versionId,
        createdAt: AT,
        name: "深蓝暖金",
        palette: PALETTE,
        fontFamily: "NotoSansSC",
        lightingPreset: "orbit3d-fixed-soft-studio",
      },
    ],
  };
}

export async function styledProject(): Promise<VideoProject> {
  const bible = await buildBible();
  const specShotId = "44444444-4444-4444-8444-444444444444";
  const specVersionId = specShotId;
  const project: VideoProject = {
    schemaVersion: 1,
    id: "33333333-3333-4333-8333-333333333333",
    title: "frame sample",
    savedVersion: 1,
    brief: { sentence: "one shot", aspectTargets: ["landscape", "portrait"] },
    shots: [
      {
        shotId: specShotId,
        order: 0,
        locked: false,
        workingVersionId: specVersionId,
        contentVersions: [
          {
            versionId: specVersionId,
            createdAt: AT,
            durationMs: 2000,
            description: "text",
            narrationText: "",
            sceneSource: {
              type: "spec",
              spec: {
                specVersion: 1,
                componentId: "text-animation",
                componentVersion: 1,
                durationMs: 2000,
                seed: 7,
                background: PALETTE.background,
                params: {
                  title: "代表帧",
                  titleColor: PALETTE.foreground,
                  subtitleColor: PALETTE.secondary,
                  entrance: "fade-up",
                  enterMs: 400,
                },
              },
            },
            provenance: { engineId: "planner-rules", engineVersion: "1" },
          },
        ],
        events: [],
      },
    ],
    renderRecords: [],
    deliveries: [],
  };
  return {
    ...project,
    styleBibleRef: {
      bibleId: bible.id,
      versionId: bible.currentVersionId,
      digest: await styleVersionDigest(
        bible.versions.find((v) => v.versionId === bible.currentVersionId)!,
      ),
    },
  };
}

function fakeStillRenderer(seen: Array<{ aspect: string; frame: number }>) {
  return async (args: {
    aspect: "landscape" | "portrait";
    frameIndex: number;
    outPath: string;
    propsPath: string;
  }) => {
    seen.push({ aspect: args.aspect, frame: args.frameIndex });
    const spec = JSON.parse(readFileSync(args.propsPath, "utf8"));
    assert.equal(spec.spec.componentId, "text-animation");
    assert.equal(spec.spec.durationMs, 2000);
    writeFileSync(args.outPath, `png-bytes-${args.aspect}`.padEnd(128, "."));
  };
}

test("renderStyleFrame 用真实命令路径渲染双画幅关键帧并返回摘要", async () => {
  const project = await styledProject();
  const seen: Array<{ aspect: string; frame: number }> = [];
  const result = await renderStyleFrame(project, await buildBible(), {
    shotId: project.shots[0]!.shotId,
    frameMs: 800,
    renderStill: fakeStillRenderer(seen),
  });
  assert.match(result.frameId, UUID_RE);
  assert.equal(result.frameIndex, 19);
  assert.deepEqual(seen.map((item) => item.aspect).sort(), [
    "landscape",
    "portrait",
  ]);
  assert.ok(seen.every((item) => item.frame === 19));
  for (const frame of result.keyframes) {
    assert.equal(frame.bytes, 128);
    assert.match(frame.digest, /^[0-9a-f]{64}$/);
    assert.equal(
      frame.outputRef,
      `style-frame/${result.frameId}/${frame.aspect}.png`,
    );
    assert.equal(
      frame.url,
      `/api/video/style-frame/${result.frameId}/${frame.aspect}`,
    );
    assert.ok(existsSync(styleFramePath(result.frameId, frame.aspect)));
  }
  // 产物与摘要一致：直接重算文件 SHA-256 对照
  const crypto = await import("node:crypto");
  for (const frame of result.keyframes) {
    const file = styleFramePath(result.frameId, frame.aspect);
    const digest = crypto
      .createHash("sha256")
      .update(readFileSync(file))
      .digest("hex");
    assert.equal(digest, frame.digest);
  }
});

test("pruneOldestStyleFrames 只保留最近 MAX 个作业目录", () => {
  // 独立临时目录：不与真实关键帧缓存（.tools/video-style-frames）互删
  const root = mkdtempSync(path.join(tmpdir(), "style-frames-prune-"));
  try {
    const ids = Array.from(
      { length: 32 },
      (_, index) =>
        `${String(index + 1).padStart(8, "0")}-0000-4000-8000-000000000000`,
    );
    // 顺序创建（mtime 递增）
    for (const id of ids) mkdirSync(path.join(root, id), { recursive: true });
    pruneOldestStyleFrames(root, 30);
    const remaining = readdirSync(root);
    assert.equal(remaining.length, 30);
    assert.ok(remaining.includes(ids[31]!));
    assert.ok(!remaining.includes(ids[0]!));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
