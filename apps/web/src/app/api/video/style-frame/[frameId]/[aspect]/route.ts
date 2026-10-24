import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { styleFramePath } from "../../style-frame-local";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ frameId: string; aspect: string }> },
) {
  if (process.env.NODE_ENV !== "development")
    return Response.json({ error: "本地关键帧不可用" }, { status: 503 });
  const { frameId, aspect } = await params;
  let file: string;
  try {
    file = styleFramePath(frameId, aspect);
    const size = statSync(file).size;
    return new Response(
      Readable.toWeb(createReadStream(file)) as ReadableStream,
      {
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(size),
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    return Response.json({ error: "关键帧不存在或链接无效" }, { status: 404 });
  }
}
