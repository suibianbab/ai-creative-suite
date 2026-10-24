#!/usr/bin/env node
// Exercise the real render API with a pre-nodeTextColor flow-diagram project.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const source = path.join(
  root,
  "artifacts/video-studio-stem-sample-final-2026-10-23",
);
const out = path.join(root, ".tools/legacy-flow-style-qa");
mkdirSync(out, { recursive: true });
const bible = JSON.parse(
  readFileSync(path.join(source, "stem.style-bible.json"), "utf8"),
);
const palette = bible.versions[0].palette;
const project = JSON.parse(
  readFileSync(path.join(source, "stem.video-project.json"), "utf8"),
);
const shot = project.shots[0];
const version = shot.contentVersions.find(
  (item) => item.versionId === shot.workingVersionId,
);
shot.contentVersions = [version];
shot.events = shot.events.filter(
  (event) => event.versionId === version.versionId,
);
version.narrationText = "";
version.sceneSource = {
  type: "spec",
  spec: {
    specVersion: 1,
    componentId: "flow-diagram",
    componentVersion: 1,
    durationMs: version.durationMs,
    seed: 41,
    background: palette.background,
    params: {
      title: "旧流程图",
      nodes: [
        { label: "提交", x: 260, y: 500, kind: "box" },
        { label: "通过", x: 740, y: 500, kind: "box" },
      ],
      edges: [{ from: "提交", to: "通过" }],
      boxColor: palette.secondary,
      arrowColor: palette.accent,
      textColor: palette.foreground,
      enterMs: 400,
      drawMs: 400,
    },
  },
};
project.shots = [shot];
project.renderRecords = [];
project.deliveries = [];
delete project.transitions;
// W2 门禁：风格项目出片须持有效代表帧确认。本 API 回归用机械确认过闸——
// 关键帧摘要是占位值，只验证门禁逻辑，不冒充人工审片。
const { appendStyleFrameConfirmation } = await import(
  pathToFileURL(
    path.join(root, "packages/video-document/dist/index.js"),
  ).href
);
const confirmed = await appendStyleFrameConfirmation(project, {
  shotId: shot.shotId,
  frameMs: 0,
  keyframes: (["landscape", "portrait"]).map((aspect, index) => ({
    aspect,
    digest: (index === 0 ? "a" : "b").repeat(64),
    bytes: 128,
    outputRef: `style-frame/00000000-0000-4000-8000-00000000000${index}/${aspect}.png`,
  })),
  note: "API 回归机械确认（非人工审片）",
});
const response = await fetch(
  `${process.env.BASE_URL ?? "http://127.0.0.1:3210"}/api/video/render`,
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: process.env.BASE_URL ?? "http://127.0.0.1:3210",
    },
    body: JSON.stringify({ project: confirmed, styleBible: bible }),
  },
);
const body = await response.json();
assert.equal(response.status, 200, JSON.stringify(body));
assert.equal(body.downloads.length, 2);
assert.equal(body.project.renderRecords.length, 2);
assert.equal(
  body.project.shots[0].contentVersions[0].sceneSource.spec.params
    .nodeTextColor,
  undefined,
);
writeFileSync(
  path.join(out, "api-report.json"),
  JSON.stringify(
    { pass: true, status: response.status, downloads: body.downloads },
    null,
    2,
  ),
);
console.log("LEGACY FLOW STYLE API PASS");
