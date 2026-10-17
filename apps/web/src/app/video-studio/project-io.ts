import { type VideoProject, validateVideoProject } from "@acs/video-document";

// 导出文件名：<标题>-<短id>.video-project.json（P1-A：工作台→CLI 的去程）。
export function exportFileName(project: Pick<VideoProject, "title" | "id">) {
  const title = project.title.trim() || "video-project";
  return `${title}-${project.id.slice(0, 8)}.video-project.json`;
}

// 导入解析（P1-A：CLI 回写件→工作台的回程入口）。JSON 语法错误与
// 文档校验错误都转成可读中文，UI 原样展示给用户。
export function parseProjectJson(text: string): VideoProject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      "导出文件不是合法 JSON，请确认选择的是工作台导出的项目文件",
    );
  }
  try {
    return validateVideoProject(parsed);
  } catch (error) {
    throw new Error(
      `文件不是合法 VideoProject: ${error instanceof Error ? error.message : "未知错误"}`,
    );
  }
}
