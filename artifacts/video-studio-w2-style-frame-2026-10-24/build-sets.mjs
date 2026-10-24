#!/usr/bin/env node
// W2 三套内部对照（文字动效 / 数据解释 / 竖版字幕）构建脚本：
// 生成带 Style Bible 的源项目 → 经 /api/video/style-frame 生成真实渲染器横竖关键帧
// → appendStyleFrameConfirmation 把关键帧摘要钉进确认记录 → CLI 双画幅出片。
// 运行前置：本工作树 web dev server 在 BASE_URL；packages 已 build。
// 用法：node --import tsx artifacts/video-studio-w2-style-frame-2026-10-24/build-sets.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const OUT = path.join(ROOT, "artifacts/video-studio-w2-style-frame-2026-10-24");
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3219";
mkdirSync(OUT, { recursive: true });

const dist = await import(
  pathToFileURL(path.join(ROOT, "packages/video-document/dist/index.js")).href
);
const sampleGalleryModule = await import(
  pathToFileURL(
    path.join(ROOT, "apps/web/src/app/video-studio/sample-gallery.ts"),
  ).href
);

const PALETTE = {
  background: "#101820",
  foreground: "#f3e6cf",
  secondary: "#e8b04b",
  accent: "#e8b04b",
  object: "#c98548",
};

function makeBible(name) {
  const versionId = crypto.randomUUID();
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    currentVersionId: versionId,
    versions: [
      {
        versionId,
        createdAt: new Date().toISOString(),
        name,
        palette: PALETTE,
        fontFamily: "NotoSansSC",
        lightingPreset: "orbit3d-fixed-soft-studio",
      },
    ],
  };
}

function textShot(order, title, entrance, durationMs, narrationText = "") {
  const versionId = crypto.randomUUID();
  return {
    shotId: versionId,
    order,
    locked: false,
    workingVersionId: versionId,
    contentVersions: [
      {
        versionId,
        createdAt: new Date().toISOString(),
        durationMs,
        description: `文字镜头：${title}`,
        narrationText,
        sceneSource: {
          type: "spec",
          spec: {
            specVersion: 1,
            componentId: "text-animation",
            componentVersion: 1,
            durationMs,
            seed: order + 11,
            background: PALETTE.background,
            params: {
              title,
              titleColor: PALETTE.foreground,
              subtitleColor: PALETTE.secondary,
              entrance,
              enterMs: 400,
            },
          },
        },
        provenance: { engineId: "w2-comparison", engineVersion: "1" },
      },
    ],
    events: [],
  };
}

async function confirmKeyframes(project, bible, shotIndex, frameMs) {
  const shot = project.shots[shotIndex];
  const response = await fetch(`${BASE_URL}/api/video/style-frame`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE_URL },
    body: JSON.stringify({ project, styleBible: bible, shotId: shot.shotId, frameMs }),
  });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  const confirmed = await dist.appendStyleFrameConfirmation(project, {
    shotId: shot.shotId,
    frameMs,
    keyframes: payload.keyframes.map((frame) => ({
      aspect: frame.aspect,
      digest: frame.digest,
      bytes: frame.bytes,
      outputRef: frame.outputRef,
    })),
    note: "内部对照构建：机械确认（真实渲染关键帧；非人工审片）",
  });
  // 关键帧证据复制进 artifacts 目录（服务端 .tools 缓存会被滚动清理）
  for (const frame of payload.keyframes) {
    const image = await fetch(`${BASE_URL}${frame.url}`);
    assert.equal(image.status, 200);
    writeFileSync(path.join(OUT, frame.outputRef.replace("style-frame/", "").replace("/", "-")), Buffer.from(await image.arrayBuffer()));
  }
  return { confirmed, frameId: payload.frameId, frameIndex: payload.frameIndex };
}

function writeJson(name, value) {
  const file = path.join(OUT, name);
  writeFileSync(file, JSON.stringify(value, null, 2));
  console.log("written", path.relative(ROOT, file));
}

// —— Set A 文字动效：三条纯文字镜头（fade-up / scale-in / fade-up 收束）——
const setABible = makeBible("文字动效对照");
let setA = {
  schemaVersion: 1,
  id: crypto.randomUUID(),
  title: "W2 内部对照 A · 文字动效",
  savedVersion: 1,
  brief: { sentence: "文字动效对照", aspectTargets: ["landscape", "portrait"] },
  shots: [
    textShot(0, "标题入场", "fade-up", 2200),
    textShot(1, "重点强调", "scale-in", 2000),
    textShot(2, "收束句", "fade-up", 2000),
  ],
  renderRecords: [],
  deliveries: [],
};
setA = await dist.applyStyleBible(setA, setABible, setABible.currentVersionId);
const setAConfirmed = await confirmKeyframes(setA, setABible, 0, 900);
writeJson("text-motion.style-bible.json", setABible);
writeJson("text-motion.video-project.json", setAConfirmed.confirmed);

// —— Set B 数据解释：画廊 data 样片（标题/柱状/数字/结论）——
const setData = await sampleGalleryModule.createGallerySample("data");
assert(setData.bible, "data 样片应带 Style Bible");
const setBConfirmed = await confirmKeyframes(
  setData.project,
  setData.bible,
  0,
  900,
);
writeJson("data-explain.style-bible.json", setData.bible);
writeJson("data-explain.video-project.json", setBConfirmed.confirmed);

// —— Set C 竖版字幕：已提交的 STEM 终版项目 + 缓存旁白（零新计费，先核缓存）——
const stemSource = path.join(
  ROOT,
  "artifacts/video-studio-stem-sample-final-2026-10-23",
);
const setCProject = JSON.parse(
  readFileSync(path.join(stemSource, "stem.video-project.json"), "utf8"),
);
const setCBible = JSON.parse(
  readFileSync(path.join(stemSource, "stem.style-bible.json"), "utf8"),
);
const firstSpecShotIndex = setCProject.shots.findIndex((shot) => {
  const working = shot.contentVersions.find(
    (version) => version.versionId === shot.workingVersionId,
  );
  return working?.sceneSource.type === "spec";
});
assert(firstSpecShotIndex >= 0, "STEM 项目应有 spec 镜头可选代表帧");
const setCConfirmed = await confirmKeyframes(
  setCProject,
  setCBible,
  firstSpecShotIndex,
  900,
);
writeJson("portrait-subtitles.video-project.json", setCConfirmed.confirmed);

// TTS 缓存核对：每段旁白文本的缓存键必须已存在，否则有声链路标记未验证。
const ttsShared = path.join(path.dirname(ROOT), ".git");
const ttsCacheRoot = "D:/codex/animate/.git/acs-video-tts/cache";
const cacheReport = { model: "cosyvoice-v3-flash", voice: "longanyang", missing: [] };
for (const shot of setCConfirmed.confirmed.shots) {
  const working = shot.contentVersions.find(
    (version) => version.versionId === shot.workingVersionId,
  );
  if (!working?.narrationText?.trim()) continue;
  const key = createHash("sha256")
    .update(
      JSON.stringify({ model: cacheReport.model, voice: cacheReport.voice, text: working.narrationText }),
    )
    .digest("hex");
  if (!existsSync(path.join(ttsCacheRoot, `${key}.wav`)))
    cacheReport.missing.push(working.narrationText.slice(0, 12));
}
writeJson("tts-cache-check.json", cacheReport);
console.log(
  `build-sets done: A shots=${setAConfirmed.confirmed.shots.length} frame=${setAConfirmed.frameIndex}; B shots=${setBConfirmed.confirmed.shots.length}; C shots=${setCConfirmed.confirmed.shots.length} ttsMissing=${cacheReport.missing.length}`,
);
