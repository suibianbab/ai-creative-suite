import assert from "node:assert/strict";
import test from "node:test";
import { assertAppendOnlyEvolution } from "./evolve.js";
import { reviseWorkingVersion } from "./operations.js";
import {
  appendStyleFrameConfirmation,
  buildWorkingSetSnapshot,
  contentVersionDigest,
  styleConfirmationStatus,
  workingSetDigest,
} from "./style-confirmation.js";
import type { StyleBible, VideoProject } from "./types.js";
import { validateVideoProject } from "./validate.js";

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const ID3 = "33333333-3333-4333-8333-333333333333";
const ID4 = "44444444-4444-4444-8444-444444444444";
const ID5 = "55555555-5555-4555-8555-555555555555";
const AT = "2026-10-24T00:00:00.000Z";

const KEYFRAMES = [
  {
    aspect: "landscape" as const,
    digest: "a".repeat(64),
    bytes: 1234,
    outputRef: "style-frame/11111111-1111-4111-8111-111111111111/landscape.png",
  },
  {
    aspect: "portrait" as const,
    digest: "b".repeat(64),
    bytes: 2345,
    outputRef: "style-frame/11111111-1111-4111-8111-111111111111/portrait.png",
  },
];

function styledBible(): StyleBible {
  return {
    schemaVersion: 1,
    id: ID,
    currentVersionId: ID2,
    versions: [
      {
        versionId: ID2,
        createdAt: AT,
        name: "深蓝暖金",
        palette: {
          background: "#101820",
          foreground: "#f3e6cf",
          secondary: "#e8b04b",
          accent: "#e8b04b",
          object: "#c98548",
        },
        fontFamily: "NotoSansSC",
        lightingPreset: "orbit3d-fixed-soft-studio",
      },
    ],
  };
}

function sample(): VideoProject {
  const project: VideoProject = {
    schemaVersion: 1,
    id: ID3,
    title: "confirm sample",
    savedVersion: 1,
    brief: { sentence: "two shots", aspectTargets: ["landscape", "portrait"] },
    shots: [0, 1].map((order) => ({
      shotId: order ? ID5 : ID4,
      order,
      locked: false,
      workingVersionId: order ? ID5 : ID4,
      contentVersions: [
        {
          versionId: order ? ID5 : ID4,
          createdAt: AT,
          durationMs: 2000,
          description: "initial",
          narrationText: "",
          sceneSource: {
            type: "spec" as const,
            spec: {
              specVersion: 1,
              componentId: "text-animation",
              componentVersion: 1,
              durationMs: 2000,
              seed: order,
              background: "#101820",
              params: {
                title: `shot ${order}`,
                titleColor: "#f3e6cf",
                subtitleColor: "#e8b04b",
                entrance: "fade-up",
                enterMs: 400,
              },
            },
          },
          provenance: { engineId: "planner-rules", engineVersion: "1" },
        },
      ],
      events: [],
    })),
    renderRecords: [],
    deliveries: [],
  };
  return {
    ...project,
    styleBibleRef: {
      bibleId: ID,
      versionId: ID2,
      digest: "0".repeat(64),
    },
  };
}

test("快照摘要覆盖工作版本、转场与风格引用", async () => {
  const project = sample();
  const snapshot = await buildWorkingSetSnapshot(project);
  assert.equal(snapshot.entries.length, 2);
  assert.ok(snapshot.entries.every((entry) => /^[0-9a-f]{64}$/.test(entry.contentDigest)));
  assert.ok(/^[0-9a-f]{64}$/.test(await workingSetDigest(project)));
  // 同一项目两次计算结果一致
  assert.equal(await workingSetDigest(project), await workingSetDigest(project));
  // 改转场后摘要变化
  const withFade = {
    ...project,
    transitions: [{ boundary: 0, kind: "fade" as const, durationMs: 300 }],
  };
  assert.notEqual(await workingSetDigest(withFade), await workingSetDigest(project));
});

test("追加确认绑定版本/帧/风格摘要，未确认与变更后均判失效", async () => {
  const project = sample();
  const noConfirm = await styleConfirmationStatus(project);
  assert.equal(noConfirm.valid, false);

  const confirmed = await appendStyleFrameConfirmation(project, {
    shotId: ID4,
    frameMs: 800,
    keyframes: KEYFRAMES,
    note: "首镜代表帧",
    at: AT,
  });
  const record = confirmed.styleFrameConfirmations!.at(-1)!;
  assert.equal(record.versionId, ID4);
  assert.equal(record.frameIndex, 19); // floor(800*24/1000)
  assert.match(record.contentDigest, /^[0-9a-f]{64}$/);
  assert.equal(record.actor, "human");
  validateVideoProject(confirmed);

  const ok = await styleConfirmationStatus(confirmed);
  assert.equal(ok.valid, true);

  // 内容变化（镜头 2 追加新工作版本）→ 旧确认失效
  const edited = reviseWorkingVersion(
    confirmed,
    ID5,
    {
      spec: {
        specVersion: 1,
        componentId: "text-animation",
        componentVersion: 1,
        durationMs: 2000,
        seed: 1,
        background: "#101820",
        params: {
          title: "shot 1 edited",
          titleColor: "#f3e6cf",
          subtitleColor: "#e8b04b",
          entrance: "fade-up",
          enterMs: 400,
        },
      },
    },
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    AT,
  );
  const stale = await styleConfirmationStatus(edited);
  assert.equal(stale.valid, false);
  assert.match(stale.reason, /内容|版本/);

  // 风格引用变化 → 失效
  const restyled = {
    ...confirmed,
    styleBibleRef: { ...confirmed.styleBibleRef!, versionId: ID4 },
  };
  const styleChanged = await styleConfirmationStatus(restyled);
  assert.equal(styleChanged.valid, false);
  assert.match(styleChanged.reason, /风格/);
});

test("再确认后恢复有效；旧确认数组只追加保留", async () => {
  const project = sample();
  const first = await appendStyleFrameConfirmation(project, {
    shotId: ID4,
    frameMs: 0,
    keyframes: KEYFRAMES,
    at: AT,
  });
  const edited = reviseWorkingVersion(
    first,
    ID5,
    {
      spec: {
        specVersion: 1,
        componentId: "text-animation",
        componentVersion: 1,
        durationMs: 2000,
        seed: 1,
        background: "#101820",
        params: {
          title: "shot 1 edited",
          titleColor: "#f3e6cf",
          subtitleColor: "#e8b04b",
          entrance: "fade-up",
          enterMs: 400,
        },
      },
    },
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    AT,
  );
  const second = await appendStyleFrameConfirmation(edited, {
    shotId: ID4,
    frameMs: 100,
    keyframes: KEYFRAMES,
    at: AT,
  });
  assert.equal(second.styleFrameConfirmations!.length, 2);
  const status = await styleConfirmationStatus(second);
  assert.equal(status.valid, true);
  assert.equal(status.confirmation!.confirmationId, second.styleFrameConfirmations![1]!.confirmationId);
});

test("append 拒绝非 spec 镜头、越界帧、坏关键帧与缺失风格引用", async () => {
  const project = sample();
  await assert.rejects(
    appendStyleFrameConfirmation({ ...project, styleBibleRef: undefined }, {
      shotId: ID4,
      frameMs: 0,
      keyframes: KEYFRAMES,
    }),
    /Style Bible/,
  );
  await assert.rejects(
    appendStyleFrameConfirmation(project, {
      shotId: "99999999-9999-4999-8999-999999999999",
      frameMs: 0,
      keyframes: KEYFRAMES,
    }),
    /镜头/,
  );
  await assert.rejects(
    appendStyleFrameConfirmation(project, {
      shotId: ID4,
      frameMs: 2000,
      keyframes: KEYFRAMES,
    }),
    /frameMs/,
  );
  await assert.rejects(
    appendStyleFrameConfirmation(project, {
      shotId: ID4,
      frameMs: 10,
      keyframes: [KEYFRAMES[0]!],
    }),
    /关键帧/,
  );
  await assert.rejects(
    appendStyleFrameConfirmation(project, {
      shotId: ID4,
      frameMs: 10,
      keyframes: KEYFRAMES.map((frame) => ({ ...frame, digest: "xyz" })),
    }),
    /digest/,
  );
});

test("媒体镜头可被钉进快照但不能选作代表帧", async () => {
  const project = sample();
  const withMedia = {
    ...project,
    mediaAssets: [
      {
        assetId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        createdAt: AT,
        origin: { kind: "local-upload" as const, fileName: "clip.mp4" },
        original: {
          sha256: "d".repeat(64),
          bytes: 1000,
          durationMs: 2000,
          width: 1280,
          height: 720,
          fps: 30,
          codec: "h264",
          hasAudio: false,
          storeKey: `${"d".repeat(16)}.mp4`,
        },
      },
    ],
    shots: [
      ...project.shots,
      {
        shotId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        order: 2,
        locked: false,
        workingVersionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        contentVersions: [
          {
            versionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            createdAt: AT,
            durationMs: 2000,
            description: "media shot",
            narrationText: "",
            sceneSource: {
              type: "media-clip" as const,
              mediaAssetId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              inMs: 0,
              outMs: 2000,
              fit: "cover" as const,
              focalX: 0.5,
              audio: "mute" as const,
            },
            provenance: { engineId: "planner-rules", engineVersion: "1" },
          },
        ],
        events: [],
      },
    ],
  } satisfies VideoProject;
  validateVideoProject(withMedia);
  // 媒体镜头进入工作集快照（摘要覆盖全部镜头）
  const snapshot = await buildWorkingSetSnapshot(withMedia);
  assert.equal(snapshot.entries.length, 3);
  await assert.rejects(
    appendStyleFrameConfirmation(withMedia, {
      shotId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      frameMs: 0,
      keyframes: KEYFRAMES,
    }),
    /媒体|程序化/,
  );
});

test("contentVersionDigest 与 canonicalJson 摘要同源", async () => {
  const project = sample();
  const digest = await contentVersionDigest(
    project.shots[0]!.contentVersions[0]!,
  );
  assert.match(digest, /^[0-9a-f]{64}$/);
});

test("validateVideoProject 拒绝形状非法的确认记录", async () => {
  const project = sample();
  const confirmed = await appendStyleFrameConfirmation(project, {
    shotId: ID4,
    frameMs: 0,
    keyframes: KEYFRAMES,
    at: AT,
  });
  const record = confirmed.styleFrameConfirmations![0]!;
  const bad = (patch: Record<string, unknown>) =>
    validateVideoProject({
      ...confirmed,
      styleFrameConfirmations: [{ ...record, ...patch }],
    });
  assert.throws(() => bad({ shotId: "99999999-9999-4999-8999-999999999999" }), /shotId/);
  assert.throws(() => bad({ versionId: ID5 }), /versionId/);
  assert.throws(() => bad({ contentDigest: "nothex" }), /contentDigest/);
  assert.throws(() => bad({ frameMs: 9999 }), /frameMs/);
  assert.throws(() => bad({ frameIndex: 999 }), /frameIndex/);
  assert.throws(() => bad({ actor: "ai" }), /actor/);
  assert.throws(
    () => bad({ confirmationId: "not-a-uuid" }),
    /confirmationId/,
  );
  assert.throws(
    () =>
      validateVideoProject({
        ...confirmed,
        styleFrameConfirmations: [record, record],
      }),
    /duplicated/,
  );
  // 旧项目（无确认数组）读取不受影响
  validateVideoProject(project);
});

test("确认账本纳入只追加演进纪律", async () => {
  const project = sample();
  const confirmed = await appendStyleFrameConfirmation(project, {
    shotId: ID4,
    frameMs: 0,
    keyframes: KEYFRAMES,
    at: AT,
  });
  assertAppendOnlyEvolution(project, confirmed); // 追加合法
  assert.throws(
    () => assertAppendOnlyEvolution(confirmed, project),
    /styleFrameConfirmations/,
  );
  const rewritten = structuredClone(confirmed);
  rewritten.styleFrameConfirmations![0]!.note = "改写旧签收";
  assert.throws(
    () => assertAppendOnlyEvolution(confirmed, rewritten),
    /styleFrameConfirmations/,
  );
});
