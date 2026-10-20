// P2.5-T2 媒体上传导入（spec §1.2）：dev 门/origin/413/formData → 导入管线。
// 不写项目文档——返回 MediaAsset，账本追加是工作台（T3）的职责。
import {
  type IngestReasonCode,
  ingestMediaFile,
  resolveStoreRoot,
} from "@acs/media-store";
import { isSameOriginRequest } from "../../same-origin";

const MAX_UPLOAD_BYTES = 500_000_000;

const STATUS_BY_REASON: Record<IngestReasonCode, number> = {
  "unsupported-format": 415,
  "probe-failed": 422,
  "decode-failed": 422,
  "duration-out-of-range": 422,
  "proxy-failed": 500,
  "store-error": 500,
};

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json(
      { error: "媒体导入仅在本地开发环境开放。" },
      { status: 503 },
    );
  }
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "跨站请求已拒绝。" }, { status: 403 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES) {
    return Response.json(
      { error: "媒体文件过大（上限 500MB）。" },
      { status: 413 },
    );
  }
  let file: File;
  try {
    const form = await request.formData();
    const candidate = form.get("file");
    if (!(candidate instanceof File)) throw new Error("missing file");
    file = candidate;
  } catch {
    return Response.json(
      { error: "请求须为 multipart/form-data 且含 file 字段。" },
      { status: 400 },
    );
  }
  let root: string;
  try {
    root = resolveStoreRoot();
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
  const result = await ingestMediaFile({
    bytes: Buffer.from(await file.arrayBuffer()),
    fileName: file.name,
    root,
  });
  if (!result.ok) {
    return Response.json(
      { error: result.error },
      { status: STATUS_BY_REASON[result.reasonCode] },
    );
  }
  return Response.json({ asset: result.asset });
}
