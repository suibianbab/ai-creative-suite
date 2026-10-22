import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { renderOutputPath } from "../../render-local";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string; aspect: string }> },
) {
  if (process.env.NODE_ENV !== "development")
    return Response.json({ error: "本地导出不可用" }, { status: 503 });
  const { jobId, aspect } = await params;
  let file: string;
  try {
    file = renderOutputPath(jobId, aspect);
    const size = statSync(file).size;
    return new Response(
      Readable.toWeb(createReadStream(file)) as ReadableStream,
      {
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(size),
          "Content-Disposition": `attachment; filename="${aspect}.mp4"`,
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    return Response.json(
      { error: "导出文件不存在或链接无效" },
      { status: 404 },
    );
  }
}
