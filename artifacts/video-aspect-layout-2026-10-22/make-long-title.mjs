import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const project = JSON.parse(readFileSync(join(here, "source-video-project.json"), "utf8"));
// The pressure fixture starts before delivery: prior baseline renders describe
// different title bytes and must not be carried into this changed project.
project.renderRecords = [];
project.deliveries = [];
project.savedVersion = 1;
const titles = new Map([
  [0, "季度销量增长趋势与市场表现的完整观察"],
  [3, "增长趋势清晰可见，继续观察下一季度表现"],
]);
for (const [index, title] of titles) {
  const shot = project.shots[index];
  const version = shot.contentVersions.find(
    (item) => item.versionId === shot.workingVersionId,
  );
  if (version.sceneSource.type !== "spec") throw new Error("Expected spec shot");
  version.sceneSource.spec.params.title = title;
}
project.styleBibleRef = undefined;
writeFileSync(join(here, "long-title-source.json"), `${JSON.stringify(project, null, 2)}\n`);
console.log("long title fixture uses the same VideoProject and four shots");
