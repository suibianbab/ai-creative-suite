// P2.5-T2 媒体文件流式 GET（spec §1.2）：storeKey 形状门（防穿越）→
// original 命中 → proxy 回退 → 404。Range 单段 206（预览 seek 最小需要）。
// P2.5-T3 P5：?variant=proxy → proxy 优先（预览 src），original 回退；
// 缺省 original 优先（既有行为不变）。
import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { originalPath, proxyPath, resolveStoreRoot } from "@acs/media-store";

const CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  // 任务 1（2026-10-28）：图片素材内容类型。
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

function streamFile(
  filePath: string,
  contentType: string,
  size: number,
  rangeHeader: string | null,
): Response {
  if (rangeHeader !== null) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (match === null) {
      return new Response(null, {
        status: 416,
        headers: { "accept-ranges": "bytes" },
      });
    }
    const start = match[1] === "" ? 0 : Number(match[1]);
    const end =
      match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
    if (start > end || start >= size) {
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${size}` },
      });
    }
    return new Response(
      Readable.toWeb(
        createReadStream(filePath, { start, end }),
      ) as ReadableStream,
      {
        status: 206,
        headers: {
          "content-type": contentType,
          "content-length": String(end - start + 1),
          "content-range": `bytes ${start}-${end}/${size}`,
          "accept-ranges": "bytes",
        },
      },
    );
  }
  return new Response(
    Readable.toWeb(createReadStream(filePath)) as ReadableStream,
    {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-length": String(size),
        "accept-ranges": "bytes",
      },
    },
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeKey: string }> },
) {
  const { storeKey } = await params;
  let root: string;
  try {
    root = resolveStoreRoot();
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
  let original: string;
  let proxy: string;
  try {
    original = originalPath(root, storeKey);
    proxy = proxyPath(root, storeKey);
  } catch {
    return Response.json({ error: "storeKey 形状非法。" }, { status: 400 });
  }
  const extension = storeKey.split(".")[1] ?? "";
  const contentType = CONTENT_TYPES[extension];
  if (contentType === undefined) {
    return Response.json({ error: "storeKey 形状非法。" }, { status: 400 });
  }
  const preferProxy =
    new URL(request.url).searchParams.get("variant") === "proxy";
  const candidates = preferProxy
    ? [[proxy, "video/mp4"] as const, [original, contentType] as const]
    : [[original, contentType] as const, [proxy, "video/mp4"] as const];
  for (const candidate of candidates) {
    try {
      const stat = statSync(candidate[0]);
      return streamFile(
        candidate[0],
        candidate[1],
        stat.size,
        request.headers.get("range"),
      );
    } catch {
      // 未命中，试下一个
    }
  }
  return Response.json({ error: "仓内无此媒体文件。" }, { status: 404 });
}
