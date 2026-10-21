// P3-B Task 4：出片 props 组装纯函数单测（不跑 Remotion、不启浏览器、零网络）。
// 第一条是抽取重构的「逐字节一致」金标准：无 three 项目的完整 props（spec +
// media + 旁白 + 字幕 + 转场）与改动前 render-scene.mjs 内联构造的输出逐字节对拍；
// 后两条钉 three 镜头与 media-clip 同形 props 的取值口径。
import assert from "node:assert/strict";
import test from "node:test";
import { buildTimelineProps } from "./render-scene.props.mjs";

const FPS = 24;

// —— 金标准夹具：无 three 项目 ——
function specOf(componentId, durationMs) {
  return {
    specVersion: 1,
    componentId,
    durationMs,
    params: { title: componentId },
  };
}

const GOLDEN_TIMELINE = {
  shots: [
    { shotIndex: 0, startFrame: 0, frames: 24 },
    { shotIndex: 1, startFrame: 24, frames: 48 },
    { shotIndex: 2, startFrame: 72, frames: 12 },
  ],
  totalFrames: 84,
};

const GOLDEN_SHOT_ENTRIES = [
  {
    shot: { shotId: "s1" },
    version: { versionId: "v1" },
    spec: specOf("poster-title", 1000),
  },
  {
    shot: { shotId: "s2" },
    version: { versionId: "v2" },
    media: {
      mediaAssetId: "a1",
      inMs: 500,
      outMs: 2500,
      fit: "cover",
      focalX: 0.4,
      audio: "keep",
    },
  },
  {
    shot: { shotId: "s3" },
    version: { versionId: "v3" },
    spec: specOf("text-animation", 500),
  },
];

const GOLDEN_MEDIA_BY_SHOT = new Map([
  [
    1,
    {
      shotIndex: 1,
      asset: { width: 1920, height: 1080, storeKey: "0123456789abcdef.mp4" },
      media: {
        mediaAssetId: "a1",
        inMs: 500,
        outMs: 2500,
        fit: "cover",
        focalX: 0.4,
        audio: "keep",
      },
    },
  ],
]);

const GOLDEN_NARRATION_BY_SHOT = new Map([
  [0, { shotIndex: 0, propsSrc: "http://127.0.0.1:4100/s1-v1.wav" }],
]);

const GOLDEN_SUBTITLES_BY_SHOT = new Map([
  [0, { cues: [{ text: "甲", startMs: 0, endMs: 400 }] }],
]);

const GOLDEN_TRANSITIONS = [{ boundary: 0, kind: "fade", durationMs: 500 }];

// 改动前 render-scene.mjs 内联构造的序列化结果（键序：spec|media, startFrame,
// frames, narration?, subtitles?；顶层 shots 在前、transitions 在后）。
const GOLDEN_JSON =
  '{"shots":[' +
  '{"spec":{"specVersion":1,"componentId":"poster-title","durationMs":1000,"params":{"title":"poster-title"}},' +
  '"startFrame":0,"frames":24,' +
  '"narration":{"audioSrc":"http://127.0.0.1:4100/s1-v1.wav"},' +
  '"subtitles":{"cues":[{"text":"甲","startMs":0,"endMs":400}]}},' +
  '{"media":{"src":"http://127.0.0.1:4100/original/0123456789abcdef.mp4",' +
  '"assetWidth":1920,"assetHeight":1080,"inMs":500,"outMs":2500,"fit":"cover",' +
  '"focalX":0.4,"audio":"keep","trimBefore":12},' +
  '"startFrame":24,"frames":48},' +
  '{"spec":{"specVersion":1,"componentId":"text-animation","durationMs":500,"params":{"title":"text-animation"}},' +
  '"startFrame":72,"frames":12}' +
  '],"transitions":[{"boundary":0,"kind":"fade","durationMs":500}]}';

test("按画幅组装的 props：无 three 项目与旧输出逐字节一致", () => {
  const props = buildTimelineProps({
    timeline: GOLDEN_TIMELINE,
    shotEntries: GOLDEN_SHOT_ENTRIES,
    mediaByShot: GOLDEN_MEDIA_BY_SHOT,
    threeByShot: new Map(),
    mediaUrlBase: "http://127.0.0.1:4100",
    threeUrlBase: null,
    narrationByShot: GOLDEN_NARRATION_BY_SHOT,
    subtitlesByShot: GOLDEN_SUBTITLES_BY_SHOT,
    transitions: GOLDEN_TRANSITIONS,
    fps: FPS,
  });
  assert.equal(JSON.stringify(props), GOLDEN_JSON);
});

// —— three 镜头：与 buildTimelineShotMedia 同形（media 块喂既有 OffthreadVideo）——
function bakedOf(overrides = {}) {
  return {
    shotIndex: 0,
    aspect: "landscape",
    storeKey: "aabbccddeeff0011.mp4",
    clipSha256: "a".repeat(64),
    framesDigest: "b".repeat(64),
    frameHashes: ["c".repeat(64)],
    threeVersion: "0.186.1",
    chromiumVersion: "156.0.8078.4",
    glRenderer: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))",
    frames: 24,
    ...overrides,
  };
}

function threeTimeline(frames) {
  return {
    shots: [{ shotIndex: 0, startFrame: 0, frames }],
    totalFrames: frames,
  };
}

function threeProps({ frames, baked, threeUrlBase }) {
  return buildTimelineProps({
    timeline: threeTimeline(frames),
    shotEntries: [
      {
        shot: { shotId: "s1" },
        version: { versionId: "v1" },
        three: { componentId: "orbit3d", componentVersion: 1 },
      },
    ],
    mediaByShot: new Map(),
    threeByShot: new Map([[0, baked]]),
    mediaUrlBase: null,
    threeUrlBase,
    narrationByShot: new Map(),
    subtitlesByShot: new Map(),
    transitions: [],
    fps: FPS,
  });
}

test("按画幅组装的 props：three 镜头生成 media 块（inMs=0、fit=contain、trimBefore=0）", () => {
  const props = threeProps({
    frames: 24,
    baked: bakedOf(),
    threeUrlBase: "http://127.0.0.1:4321",
  });
  assert.deepEqual(props, {
    shots: [
      {
        media: {
          src: "http://127.0.0.1:4321/original/aabbccddeeff0011.mp4",
          assetWidth: 1280,
          assetHeight: 720,
          inMs: 0,
          outMs: 1000,
          fit: "contain",
          focalX: 0.5,
          audio: "mute",
          trimBefore: 0,
        },
        startFrame: 0,
        frames: 24,
      },
    ],
  });
});

test("按画幅组装的 props：three 镜头 outMs = round(frames/24*1000)", () => {
  // landscape 13 帧 → 541.67ms 半进位外取整 → 542
  const landscape = threeProps({
    frames: 13,
    baked: bakedOf({ aspect: "landscape", frames: 13 }),
    threeUrlBase: "http://127.0.0.1:4321",
  });
  assert.equal(landscape.shots[0].media.outMs, 542);

  // portrait 25 帧 → 1041.67ms → 1042；素材宽高取该画幅的 DIMENSIONS
  const portrait = threeProps({
    frames: 25,
    baked: bakedOf({ aspect: "portrait", frames: 25 }),
    threeUrlBase: "http://127.0.0.1:4321",
  });
  assert.equal(portrait.shots[0].media.outMs, 1042);
  assert.equal(portrait.shots[0].media.assetWidth, 720);
  assert.equal(portrait.shots[0].media.assetHeight, 1280);
});
