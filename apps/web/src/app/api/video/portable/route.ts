import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { resolveStoreRoot } from "@acs/media-store";
import { validateStyleBible, validateVideoProject } from "@acs/video-document";
import { isSameOriginRequest } from "../../same-origin";
import { workspaceRoot } from "../render/render-local";

export const runtime = "nodejs";
const MAX_REQUEST_BYTES = 34 * 1024 * 1024;

const execFileAsync = promisify(execFile);

async function runEnvelopeCli(
  action: "export" | "import",
  input: string,
  storeRoot: string,
): Promise<string> {
  const scratch = await mkdtemp(path.join(tmpdir(), "acs-portable-api-"));
  try {
    const inputFile = path.join(scratch, "input.json");
    const outputFile = path.join(scratch, "output.json");
    await writeFile(inputFile, input);
    try {
      await execFileAsync(
        process.execPath,
        [
          path.join(workspaceRoot(), "scripts/video/portable-envelope-cli.mjs"),
          action,
          inputFile,
          outputFile,
          storeRoot,
        ],
        { timeout: 120_000, maxBuffer: 1024 * 1024, windowsHide: true },
      );
    } catch (error) {
      const stderr =
        typeof error === "object" && error && "stderr" in error
          ? String(error.stderr).trim()
          : "";
      throw new Error(stderr || "项目包处理失败");
    }
    return readFile(outputFile, "utf8");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development")
    return Response.json(
      { error: "项目包仅在本地开发环境开放" },
      { status: 503 },
    );
  if (!isSameOriginRequest(request))
    return Response.json({ error: "跨站请求已拒绝" }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES)
    return Response.json(
      { error: "项目包请求超过 34 MiB 上限" },
      { status: 413 },
    );
  let payload: Record<string, unknown>;
  try {
    const body = await request.text();
    if (Buffer.byteLength(body) > MAX_REQUEST_BYTES)
      return Response.json(
        { error: "项目包请求超过 34 MiB 上限" },
        { status: 413 },
      );
    payload = JSON.parse(body);
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw new Error("项目包请求格式无效");
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "项目包请求无效" },
      { status: 400 },
    );
  }
  try {
    const storeRoot = resolveStoreRoot();
    if (payload.action === "export") {
      const project = validateVideoProject(payload.project);
      const styleBible = project.styleBibleRef
        ? validateStyleBible(payload.styleBible)
        : undefined;
      const envelope = await runEnvelopeCli(
        "export",
        JSON.stringify({ project, styleBible }),
        storeRoot,
      );
      return new Response(envelope, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${project.id}.acs-video-package.json"`,
          "Cache-Control": "no-store",
        },
      });
    }
    if (payload.action === "import") {
      if (typeof payload.envelope !== "string")
        throw new Error("请选择工作台导出的单文件项目包");
      let restored: unknown;
      try {
        restored = JSON.parse(
          await runEnvelopeCli("import", payload.envelope, storeRoot),
        );
      } catch (error) {
        if (error instanceof SyntaxError)
          throw new Error(
            "项目包恢复结果不是合法 JSON，请重试或使用 CLI 校验项目包",
          );
        throw error;
      }
      return Response.json(restored, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    throw new Error("项目包操作无效");
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "项目包操作失败" },
      { status: 400 },
    );
  }
}
