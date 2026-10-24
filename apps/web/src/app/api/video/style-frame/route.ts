import {
  resolveStyleBibleRef,
  validateStyleBible,
  validateVideoProject,
  workingStyleIssues,
} from "@acs/video-document";
import { isSameOriginRequest } from "../../same-origin";
import { renderStyleFrame } from "./style-frame-local";

export const runtime = "nodejs";
const MAX_BODY = 8 * 1024 * 1024;
let active = false;

// W2 风格代表帧：真实渲染器出的横竖关键帧。与出片路由同款边界——
// 仅本地开发、同源、体积上限、单作业互斥；失败不落任何证据文件。
export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development")
    return Response.json(
      { error: "风格关键帧渲染仅在本地开发环境开放" },
      { status: 503 },
    );
  if (!isSameOriginRequest(request))
    return Response.json({ error: "跨站请求已拒绝" }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY)
    return Response.json({ error: "项目超过 8 MiB 上限" }, { status: 413 });
  if (active)
    return Response.json(
      { error: "已有风格关键帧在渲染，请完成后重试" },
      { status: 409 },
    );
  let project;
  let bible = null;
  let shotId = "";
  let frameMs = 0;
  try {
    const body = await request.text();
    if (Buffer.byteLength(body) > MAX_BODY)
      return Response.json({ error: "项目超过 8 MiB 上限" }, { status: 413 });
    const payload = JSON.parse(body);
    if (typeof payload.shotId !== "string" || payload.shotId.length === 0)
      throw new Error("shotId 必须为非空字符串");
    if (!Number.isInteger(payload.frameMs) || payload.frameMs < 0)
      throw new Error("frameMs 必须为非负整数毫秒");
    shotId = payload.shotId;
    frameMs = payload.frameMs;
    project = validateVideoProject(payload.project);
    if (!project.styleBibleRef)
      throw new Error("项目未链接 Style Bible，请先创建并应用风格规范");
    bible = validateStyleBible(payload.styleBible);
    const version = await resolveStyleBibleRef(project.styleBibleRef, bible);
    const issues = workingStyleIssues(project, version);
    if (issues.length) throw new Error(issues.join("；"));
    const shot = project.shots.find((entry) => entry.shotId === shotId);
    if (!shot) throw new Error(`镜头 ${shotId} 不存在`);
    const working = shot.contentVersions.find(
      (versionEntry) => versionEntry.versionId === shot.workingVersionId,
    );
    if (!working) throw new Error("镜头工作版本缺失");
    if (working.sceneSource.type !== "spec")
      throw new Error(
        "代表帧只能选程序化画面镜头（媒体/3D 镜头暂不支持关键帧确认）",
      );
    if (frameMs >= working.durationMs)
      throw new Error(`frameMs 须为 0..${working.durationMs - 1} 的整数毫秒`);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "请求无效" },
      { status: 400 },
    );
  }
  active = true;
  try {
    const result = await renderStyleFrame(project, bible, { shotId, frameMs });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "关键帧渲染失败" },
      { status: 500 },
    );
  } finally {
    active = false;
  }
}
