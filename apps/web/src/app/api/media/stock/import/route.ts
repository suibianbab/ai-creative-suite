// P2.6-T6 在线素材导入（dev 门/同源/状态码映射）：客户端只传 pageTitle 与
// derivativeUrl，服务端重取元数据、下载、核验并发布素材。
import {
  importStockCandidate,
  resolveStoreRoot,
  type StockImportReasonCode,
} from "@acs/media-store";
import { isSameOriginRequest } from "../../../same-origin";

const MAX_PAGE_TITLE_LENGTH = 255;
const MAX_DERIVATIVE_URL_LENGTH = 2000;

const STATUS_BY_REASON: Record<StockImportReasonCode, number> = {
  "too-large": 413,
  unlicensed: 422,
  mismatch: 422,
  unsupported: 422,
  ingest: 422,
  upstream: 502,
  timeout: 504,
  "store-error": 500,
};

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json(
      { error: "在线搜索仅在本地开发环境开放。" },
      { status: 503 },
    );
  }
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "跨站请求已拒绝。" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "请求须为 JSON 且含 pageTitle 与 derivativeUrl。" },
      { status: 400 },
    );
  }
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : null;
  const pageTitle = record?.pageTitle;
  const derivativeUrl = record?.derivativeUrl;
  if (
    typeof pageTitle !== "string" ||
    pageTitle.trim() === "" ||
    pageTitle.length > MAX_PAGE_TITLE_LENGTH ||
    typeof derivativeUrl !== "string" ||
    derivativeUrl.trim() === "" ||
    derivativeUrl.length > MAX_DERIVATIVE_URL_LENGTH
  ) {
    return Response.json(
      { error: "请求须为 JSON 且含 pageTitle 与 derivativeUrl。" },
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

  const result = await importStockCandidate({ pageTitle, derivativeUrl, root });
  if (!result.ok) {
    return Response.json(
      { error: result.error },
      { status: STATUS_BY_REASON[result.reasonCode] },
    );
  }
  return Response.json({ asset: result.asset });
}
