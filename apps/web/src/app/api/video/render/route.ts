import {
  resolveStyleBibleRef,
  validateStyleBible,
  validateVideoProject,
  workingStyleIssues,
} from "@acs/video-document";
import { isSameOriginRequest } from "../../same-origin";
import { renderLocalProject } from "./render-local";

export const runtime = "nodejs";
const MAX_BODY = 8 * 1024 * 1024;
let active = false;

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development")
    return Response.json(
      { error: "视频直出仅在本地开发环境开放" },
      { status: 503 },
    );
  if (!isSameOriginRequest(request))
    return Response.json({ error: "跨站请求已拒绝" }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY)
    return Response.json({ error: "项目超过 8 MiB 上限" }, { status: 413 });
  if (active)
    return Response.json(
      { error: "已有视频在出片，请完成后重试" },
      { status: 409 },
    );
  let project;
  let bible = null;
  try {
    const body = await request.text();
    if (Buffer.byteLength(body) > MAX_BODY)
      return Response.json({ error: "项目超过 8 MiB 上限" }, { status: 413 });
    const payload = JSON.parse(body);
    project = validateVideoProject(payload.project);
    if (project.shots.length === 0) throw new Error("空项目不能出片");
    if (project.styleBibleRef) {
      bible = validateStyleBible(payload.styleBible);
      const version = await resolveStyleBibleRef(project.styleBibleRef, bible);
      const issues = workingStyleIssues(project, version);
      if (issues.length) throw new Error(issues.join("；"));
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "项目无效" },
      { status: 400 },
    );
  }
  active = true;
  try {
    const result = await renderLocalProject(project, bible);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "出片失败" },
      { status: 500 },
    );
  } finally {
    active = false;
  }
}
