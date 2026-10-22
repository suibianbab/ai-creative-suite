import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGallerySample } from "../../apps/web/src/app/video-studio/sample-gallery.ts";
import { validateVideoProject } from "../../packages/video-document/dist/index.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const { project: sample, bible } = await createGallerySample("data");
// This is the existing data gallery storyboard with frame-aligned 3 s shots.
// EffectCraft only supplies native shot visuals; VideoProject remains the timeline.
const project = validateVideoProject({
  ...sample,
  title: "季度销量 · EffectCraft 动效桥验证",
  brief: {
    ...sample.brief,
    sentence:
      "四镜头季度销量数据动画，逐镜 3 秒；横版和竖版使用同一 VideoProject。",
  },
  shots: sample.shots.map((shot) => ({
    ...shot,
    contentVersions: shot.contentVersions.map((version) => ({
      ...version,
      durationMs: 3000,
      sceneSource:
        version.sceneSource.type === "spec"
          ? {
              ...version.sceneSource,
              spec: { ...version.sceneSource.spec, durationMs: 3000 },
            }
          : version.sceneSource,
    })),
  })),
});
writeFileSync(
  join(here, "source-video-project.json"),
  `${JSON.stringify(project, null, 2)}\n`,
);
if (bible)
  writeFileSync(
    join(here, "style-bible.json"),
    `${JSON.stringify(bible, null, 2)}\n`,
  );
writeFileSync(
  join(here, "shot-map.json"),
  `${JSON.stringify(
    project.shots.map((shot, i) => ({
      shotId: shot.shotId,
      order: shot.order,
      durationMs: 3000,
      landscapeComp: `L_0${i + 1}`,
      portraitComp: `P_0${i + 1}`,
    })),
    null,
    2,
  )}\n`,
);
console.log(`${project.shots.length} shots; 12000 ms; ${project.id}`);
