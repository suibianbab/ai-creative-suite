import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateVideoProject } from "../../packages/video-document/dist/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => JSON.parse(readFileSync(path.join(here, name), "utf8"));
const sha = (name) =>
  createHash("sha256")
    .update(readFileSync(path.join(here, name)))
    .digest("hex");
const source = validateVideoProject(read("source-video-project.json"));
// Style Bible is kept with the source storyboard; the platform explicitly
// refuses to guarantee the color/light of external media clips.
const { styleBibleRef: _sourceStyleBibleRef, ...renderSource } = source;
const assets = read("ingested-assets.json");
const byComp = new Map(assets.map(({ comp, asset }) => [comp, asset]));
const map = read("shot-map.json");
const now = new Date().toISOString();
const nativeRef = `sha256:${sha("data-motion-edited.ecproj")}`;
const mediaAssets = assets.map(({ asset }) => asset);

// The source project's 4 shots remain authoritative. Per-shot versions attach
// EffectCraft source and both rendered variants without duplicating the timeline.
const enrichedShots = source.shots.map((shot, i) => {
  const original = shot.contentVersions.find(
    (v) => v.versionId === shot.workingVersionId,
  );
  if (!original) throw new Error(`Missing working version for shot ${i + 1}`);
  const editorId = randomUUID();
  const landscapeId = randomUUID();
  const portraitId = randomUUID();
  const makeMedia = (comp, versionId) => ({
    ...original,
    versionId,
    createdAt: now,
    sceneSource: {
      type: "media-clip",
      mediaAssetId: byComp.get(comp).assetId,
      inMs: 0,
      outMs: 3000,
      fit: "contain",
      focalX: 0.5,
      audio: "mute",
    },
    provenance: {
      engineId: "effectcraft",
      engineVersion: "0.14.0",
      parentVersionId: editorId,
    },
  });
  return {
    ...shot,
    contentVersions: [
      ...shot.contentVersions,
      {
        ...original,
        versionId: editorId,
        createdAt: now,
        sceneSource: {
          type: "editor-binding",
          engineId: "effectcraft",
          engineVersion: "0.14.0",
          assetId: nativeRef,
        },
        provenance: {
          engineId: "effectcraft",
          engineVersion: "0.14.0",
          parentVersionId: original.versionId,
        },
      },
      makeMedia(map[i].landscapeComp, landscapeId),
      makeMedia(map[i].portraitComp, portraitId),
    ],
    events: [
      ...shot.events,
      ...[editorId, landscapeId, portraitId].map((versionId) => ({
        kind: "submitted",
        versionId,
        at: now,
        actor: "human",
      })),
    ],
    // The renderer consumes the aspect-specific media working version.
    workingVersionId: landscapeId,
    _portraitVersionId: portraitId,
  };
});
for (const aspect of ["landscape", "portrait"]) {
  const project = validateVideoProject({
    ...renderSource,
    savedVersion: source.savedVersion + 1,
    brief: { ...source.brief, aspectTargets: [aspect] },
    mediaAssets,
    shots: enrichedShots.map((shot) => {
      const { _portraitVersionId, ...clean } = shot;
      return {
        ...clean,
        workingVersionId:
          aspect === "portrait" ? _portraitVersionId : clean.workingVersionId,
      };
    }),
  });
  writeFileSync(
    path.join(here, `handoff-${aspect}.json`),
    `${JSON.stringify(project, null, 2)}\n`,
  );
}
const manifest = {
  projectId: source.id,
  editor: "EffectCraft 0.14.0",
  nativeSource: {
    file: "data-motion-edited.ecproj",
    assetId: nativeRef,
    sha256: sha("data-motion-edited.ecproj"),
  },
  shots: map.map((entry) => ({
    ...entry,
    landscape: {
      comp: entry.landscapeComp,
      file: `clips-final/${entry.landscapeComp}.mp4`,
      sha256: sha(`clips-final/${entry.landscapeComp}.mp4`),
      mediaAssetId: byComp.get(entry.landscapeComp).assetId,
    },
    portrait: {
      comp: entry.portraitComp,
      file: `clips-final/${entry.portraitComp}.mp4`,
      sha256: sha(`clips-final/${entry.portraitComp}.mp4`),
      mediaAssetId: byComp.get(entry.portraitComp).assetId,
    },
  })),
};
writeFileSync(
  path.join(here, "bridge-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  `VideoProject ${source.id}, ${source.shots.length} shots, 2 aspects`,
);
