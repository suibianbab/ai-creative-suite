import { readFileSync } from "node:fs";
const project = JSON.parse(
  readFileSync(
    "D:/codex/animate/.claude/worktrees/video-next-n456/artifacts/video-studio-semantic-mixed/project-final.json",
    "utf8",
  ),
);
const response = await fetch("http://localhost:3225/api/video/render", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ project, styleBible: null, narrated: true }),
});
const text = await response.text();
console.log("status:", response.status);
console.log(text.slice(0, 600));
