import {
  resolveStyleBibleRef,
  validateStyleBible,
  validateVideoProject,
  workingStyleIssues,
} from "@acs/video-document";
import { approvalStatus } from "../../../video-studio/frame-approval";
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
  let narrated = false;
  try {
    const body = await request.text();
    if (Buffer.byteLength(body) > MAX_BODY)
      return Response.json({ error: "项目超过 8 MiB 上限" }, { status: 413 });
    const payload = JSON.parse(body);
    if (payload.narrated !== undefined && typeof payload.narrated !== "boolean")
      throw new Error("有声出片选项必须为布尔值");
    narrated = payload.narrated === true;
    project = validateVideoProject(payload.project);
    if (project.shots.length === 0) throw new Error("空项目不能出片");
    if (
      narrated &&
      !project.shots.some((shot) =>
        shot.contentVersions.some(
          (version) =>
            version.versionId === shot.workingVersionId &&
            Boolean(version.narrationText?.trim()),
        ),
      )
    )
      throw new Error("当前镜头没有旁白文本，请先填写旁白再生成有声版");
    if (project.styleBibleRef) {
      bible = validateStyleBible(payload.styleBible);
      const version = await resolveStyleBibleRef(project.styleBibleRef, bible);
      const issues = workingStyleIssues(project, version);
      if (issues.length) throw new Error(issues.join("；"));
    }
    // —— C1 服务端闸门：W2 代表帧确认不能只靠工作台前置检查，直连本 API
    //（CLI/外部 POST）同样要在真实出片前复验每条确认绑定的内容版本、风格
    // 版本与双画幅帧摘要（approvalStatus 重渲染比对，不信任何客户端布尔）。
    // 无确认记录 = 功能未启用，不拦截（旧项目兼容契约，同工作台口径）。 ——
    const approval = await approvalStatus(project);
    if (!approval.valid)
      throw new Error(
        `代表帧确认已失效，未导出：${approval.reasons.join("；")}`,
      );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "项目无效" },
      { status: 400 },
    );
  }
  if (narrated && !process.env.DASHSCOPE_API_KEY)
    return Response.json(
      { error: "未配置 DASHSCOPE_API_KEY，无法生成有声版" },
      { status: 503 },
    );
  active = true;
  try {
    const result = await renderLocalProject(project, bible, { narrated });
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
