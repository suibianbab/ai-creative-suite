// D2 Task4：buildNarrationEntries 纯函数单测（不跑 Remotion）。
// 装配规则：资产目录有 <shotId>-<versionId>.wav 的镜头 → entry（绝对路径 +
// 时长核对 + 溢出标记）；缺失 = 无音轨不报错（打印提示）；wav 时长按注入的
// probe 读取（CLI 注入 ffprobe，测试注入固定值——单测不依赖外部进程）。

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildNarrationEntries } from "./tts-sse.mjs";

const WORKDIR = mkdtempSync(path.join(tmpdir(), "acs-narration-"));
test.after(() => rmSync(WORKDIR, { recursive: true, force: true }));

const FPS = 24;

function shot(shotId, versionId, durationMs, narrationText) {
  return {
    shotId,
    order: 0,
    locked: false,
    workingVersionId: versionId,
    contentVersions: [
      {
        versionId,
        createdAt: "2026-10-18T00:00:00.000Z",
        durationMs,
        description: "",
        narrationText,
        sceneSource: { type: "spec", spec: {} },
        provenance: { engineId: "planner-rules", engineVersion: "1" },
      },
    ],
    events: [],
  };
}

function project(shots) {
  return {
    schemaVersion: 1,
    id: "p1",
    title: "t",
    brief: { sentence: "s", aspectTargets: ["landscape"] },
    shots,
    renderRecords: [],
    deliveries: [],
    savedVersion: 1,
  };
}

// 帧图（24fps，7500ms/镜头 = 180 帧）：直接构造 quantizeTimeline 同形状
function timelineOf(shotFrames) {
  let start = 0;
  return {
    shots: shotFrames.map((frames, shotIndex) => {
      const span = { shotIndex, startFrame: start, frames };
      start += frames;
      return span;
    }),
    totalFrames: start,
  };
}

function placeWav(name) {
  writeFileSync(path.join(WORKDIR, name), "RIFF-fake");
  return WORKDIR;
}

test("装配：目录有 2/3 wav → 2 entries + 缺失提示；entry 带绝对路径与 span 口径时长", () => {
  const proj = project([
    shot("s1", "v1", 7500, "勾股定理。"),
    shot("s2", "v2", 7500, "要点。"),
    shot("s3", "v3", 7500, "谢谢观看。"),
  ]);
  placeWav("s1-v1.wav");
  placeWav("s2-v2.wav");
  // s3 缺资产；注入 probe：s1 音频 1.64s（span 3125ms 内）、s2 不该被探到
  const probed = [];
  const { entries, notices } = buildNarrationEntries(
    proj,
    WORKDIR,
    timelineOf([180, 180, 180]),
    FPS,
    (wav) => {
      probed.push(path.basename(wav));
      return 1640;
    },
  );
  assert.equal(entries.length, 2);
  assert.deepEqual(probed, ["s1-v1.wav", "s2-v2.wav"], "只探存在的资产");
  assert.equal(entries[0].shotIndex, 0);
  assert.equal(entries[0].audioSrc, path.join(WORKDIR, "s1-v1.wav"));
  assert.equal(entries[0].durationMs, 1640);
  assert.equal(entries[0].spanMs, 7500, "span 换算用帧数/fps（180/24*1000）");
  assert.equal(entries[0].overflow, false);
  assert.equal(entries[1].shotIndex, 1);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /s3-v3\.wav/);
});

test("溢出：wav 时长 > span → overflow=true（Sequence 截断到镜头 span，CLI 告警）", () => {
  const proj = project([shot("s1", "v1", 3000, "长旁白")]);
  placeWav("s1-v1.wav");
  const { entries, warnings } = buildNarrationEntries(
    proj,
    WORKDIR,
    timelineOf([72]), // 3000ms @24fps
    FPS,
    () => 4200,
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].overflow, true);
  assert.equal(entries[0].spanMs, 3000);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /镜头 1.*4200ms.*3000ms/);
});

test("narrationText 为空的镜头即使目录有同名 wav 也不装配（旁白以落档文本为准）", () => {
  const proj = project([shot("s1", "v1", 7500, "")]);
  placeWav("s1-v1.wav");
  const { entries, notices } = buildNarrationEntries(
    proj,
    WORKDIR,
    timelineOf([180]),
    FPS,
    () => 1000,
  );
  assert.equal(entries.length, 0);
  // 空文本不算「缺失资产」提示（本来就不该有旁白）
  assert.equal(notices.length, 0);
});
