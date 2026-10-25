import { spawn } from "node:child_process";
import path from "node:path";
import type { ThreeSceneSpec } from "@acs/video-document";
import { interactiveOptions } from "../../../video-studio/interactive-export";
import { isSameOriginRequest } from "../../same-origin";
import { workspaceRoot } from "../render/render-local";

export const runtime = "nodejs";
const MAX_BODY = 300_000;
const MAX_PNG = 8 * 1024 * 1024;

function renderFrame(
  spec: ThreeSceneSpec,
  aspect: string,
  frameIndex: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const root = workspaceRoot();
    const child = spawn(
      process.execPath,
      [path.join(root, "scripts/video/render-three-preview.mjs")],
      {
        cwd: root,
        windowsHide: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const chunks: Buffer[] = [];
    let bytes = 0;
    let errorText = "";
    const timeout = setTimeout(() => child.kill(), 45_000);
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_PNG) child.kill();
      else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errorText = `${errorText}${chunk.toString()}`.slice(-3000);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0 || bytes > MAX_PNG)
        reject(new Error(errorText || `3D 预览进程失败（${code}）`));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(JSON.stringify({ spec, aspect, frameIndex }));
  });
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development")
    return Response.json(
      { error: "3D 预览仅在本地开发环境开放" },
      { status: 503 },
    );
  if (!isSameOriginRequest(request))
    return Response.json({ error: "跨站请求已拒绝" }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY)
    return Response.json({ error: "3D 预览请求过大" }, { status: 413 });
  try {
    const body = await request.text();
    if (Buffer.byteLength(body) > MAX_BODY)
      return Response.json({ error: "3D 预览请求过大" }, { status: 413 });
    const payload = JSON.parse(body) as {
      spec: ThreeSceneSpec;
      aspect: string;
      frameIndex: number;
    };
    interactiveOptions(payload.spec);
    if (!["landscape", "portrait"].includes(payload.aspect))
      throw new Error("画幅无效");
    const frames = Math.ceil((payload.spec.durationMs * 24) / 1000);
    if (
      !Number.isInteger(frames) ||
      frames < 1 ||
      frames > 2400 ||
      !Number.isInteger(payload.frameIndex) ||
      payload.frameIndex < 0 ||
      payload.frameIndex >= frames
    )
      throw new Error("3D 预览帧号无效");
    const png = await renderFrame(
      payload.spec,
      payload.aspect,
      payload.frameIndex,
    );
    return new Response(new Uint8Array(png), {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "3D 预览失败" },
      { status: 400 },
    );
  }
}
