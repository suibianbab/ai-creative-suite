import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const { resolveStyleBibleRef, validateStyleBible, workingStyleIssues } =
  await import(
    pathToFileURL(path.join(ROOT, "packages/video-document/dist/index.js")).href
  );

export async function verifyProjectStyleBible(project, filePath) {
  if (!project.styleBibleRef) return null;
  if (!filePath)
    throw new Error(
      "项目引用 Style Bible；须传 --style-bible <独立风格规范.json>",
    );
  const bible = validateStyleBible(JSON.parse(readFileSync(filePath, "utf8")));
  const version = await resolveStyleBibleRef(project.styleBibleRef, bible);
  const issues = workingStyleIssues(project, version);
  if (issues.length)
    throw new Error(`Style Bible 画面偏离：${issues.join("；")}`);
  return { ref: project.styleBibleRef, version };
}
