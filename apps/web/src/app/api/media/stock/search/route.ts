// P2.6-T6 在线素材检索（dev 门）：Wikimedia Commons 查询 → 归一化候选。
// 纯薄转发：校验关键词后取上游 JSON，归一化失败统一按 502 收口。
import {
  buildWikimediaSearchUrl,
  normalizeWikimediaPages,
} from "@acs/media-store";
import { isStockSourceEnabled } from "../../../../video-studio/stock-capability";

const USER_AGENT = "ACS-VideoStudio/0.1 (local development)";
const FETCH_TIMEOUT_MS = 15_000;
const MAX_QUERY_LENGTH = 80;
const FAILURE_SUFFIX = "（可重试或改用本地上传）";

function searchFailure(reason: string) {
  return Response.json(
    { error: `在线素材检索失败：${reason}${FAILURE_SUFFIX}` },
    { status: 502 },
  );
}

export async function GET(request: Request) {
  if (!isStockSourceEnabled()) {
    return Response.json(
      { error: "在线搜索仅在本地开发环境开放。" },
      { status: 503 },
    );
  }

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (q === "") {
    return Response.json({ error: "搜索关键词不能为空。" }, { status: 400 });
  }
  if (q.length > MAX_QUERY_LENGTH) {
    return Response.json(
      { error: "搜索关键词过长（上限 80 字符）。" },
      { status: 400 },
    );
  }

  let response: Response;
  try {
    response = await fetch(buildWikimediaSearchUrl(q), {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    return searchFailure(
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!response.ok) {
    return searchFailure(`HTTP ${response.status}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return searchFailure("Wikimedia 响应不可解析");
  }

  const normalized = normalizeWikimediaPages(body);
  if (!normalized.ok) {
    return searchFailure(normalized.error);
  }
  return Response.json({ candidates: normalized.candidates });
}
