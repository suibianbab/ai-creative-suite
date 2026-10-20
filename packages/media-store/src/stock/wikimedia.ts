// P2.6-T5 W1-W6：Wikimedia Commons 纯适配器（零网络）。只做检索 URL、响应
// 归一化、许可/档位/默认档位与 URL 白名单/成员校验；下载编排在后续任务。
import type {
  StockCandidate,
  StockCandidateDisabledReason,
  StockDerivative,
} from "./types.js";

const WIKIMEDIA_API = "https://commons.wikimedia.org/w/api.php";
const COMMONS_PATH_PREFIX = "/wikipedia/commons/";
const ASSET_HOST = "upload.wikimedia.org";
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 50;
const MAX_QUERY_LENGTH = 80;
const MIN_DURATION_MS = 200;
const MAX_DURATION_MS = 600_000;
const MAX_LONG_EDGE = 1920;
const DEFAULT_TIER_HEIGHT = 720;
const DEFAULT_TIER_MAX_WIDTH = 1280;
const SUPPORTED_CONTAINERS = new Set(["mp4", "webm", "mov"]);
const KNOWN_VIDEO_EXTENSIONS = new Set([
  ...SUPPORTED_CONTAINERS,
  "ogv",
  "ogg",
  "mpeg",
  "mpg",
  "m4v",
  "avi",
  "mkv",
  "wmv",
  "flv",
]);
const FALLBACK_MIME: Record<StockDerivative["container"], string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

type WikimediaPageResult =
  | { ok: true; candidates: StockCandidate[] }
  | { ok: false; error: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function clampSearchLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_SEARCH_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_SEARCH_LIMIT);
}

// W1：action=query&generator=search&gsrsearch=filetype:video <kw>&gsrnamespace=6
// &gsrlimit=10&prop=videoinfo&viprop=…&viurlwidth=320&format=json&formatversion=2
export function buildWikimediaSearchUrl(
  query: string,
  limit: number = DEFAULT_SEARCH_LIMIT,
): string {
  const url = new URL(WIKIMEDIA_API);
  const keyword = query.trim().slice(0, MAX_QUERY_LENGTH);
  url.searchParams.set("action", "query");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrsearch", `filetype:video ${keyword}`);
  url.searchParams.set("gsrnamespace", "6");
  url.searchParams.set("gsrlimit", String(clampSearchLimit(limit)));
  url.searchParams.set("prop", "videoinfo");
  url.searchParams.set("viprop", "url|size|mime|extmetadata|derivatives");
  url.searchParams.set("viurlwidth", "320");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  return url.href;
}

// W2：按 pageTitle 重取 videoinfo（含 derivatives），供下载前服务端二次校验。
export function buildWikimediaVideoInfoUrl(pageTitle: string): string {
  const url = new URL(WIKIMEDIA_API);
  url.searchParams.set("action", "query");
  url.searchParams.set("titles", pageTitle);
  url.searchParams.set("prop", "videoinfo");
  url.searchParams.set("viprop", "url|size|mime|extmetadata|derivatives");
  url.searchParams.set("viurlwidth", "320");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  return url.href;
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function decodeEntities(value: string): string {
  return value.replace(
    /&(?:amp|lt|gt|quot|#39|#x27|apos|nbsp);/gi,
    (entity) => HTML_ENTITIES[entity.toLowerCase()] ?? entity,
  );
}

// W6：解码常见实体 → 去标签 → 折叠空白；空串视为缺失。
function stripHtml(value: string): string {
  return decodeEntities(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function metadataString(
  extmetadata: Record<string, unknown>,
  key: string,
): string | null {
  const entry = asRecord(extmetadata[key]);
  const value = entry?.value;
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

// W3：LicenseShortName → name；Artist → author（洗 HTML）；LicenseUrl +
// AttributionRequired → usageNote。无 LicenseShortName 视为许可不明。
function mapLicense(
  extmetadata: Record<string, unknown>,
): StockCandidate["license"] {
  const rawName = metadataString(extmetadata, "LicenseShortName");
  const name = rawName ? truncate(stripHtml(rawName), 100) : "";
  if (!name) return null;

  const license: NonNullable<StockCandidate["license"]> = { name };
  const rawAuthor = metadataString(extmetadata, "Artist");
  const author = rawAuthor ? truncate(stripHtml(rawAuthor), 200) : "";
  if (author) license.author = author;

  const usageParts: string[] = [];
  const rawLicenseUrl = metadataString(extmetadata, "LicenseUrl");
  const licenseUrl = rawLicenseUrl ? stripHtml(rawLicenseUrl) : "";
  if (licenseUrl) usageParts.push(licenseUrl);
  const attributionRequired =
    metadataString(extmetadata, "AttributionRequired")?.trim().toLowerCase() ===
    "true";
  if (attributionRequired) usageParts.push("须署名");
  const usageNote = truncate(usageParts.join(" · "), 200);
  if (usageNote) license.usageNote = usageNote;

  return license;
}

function extensionFromUrl(url: string): string {
  const pathOnly = url.split(/[?#]/, 1)[0] ?? url;
  const lastDot = pathOnly.lastIndexOf(".");
  if (lastDot < 0) return "";
  return pathOnly.slice(lastDot + 1).toLowerCase();
}

function displayTitleFrom(title: string): string {
  const withoutPrefix = title.startsWith("File:") ? title.slice(5) : title;
  const lastDot = withoutPrefix.lastIndexOf(".");
  if (lastDot > 0) {
    const extension = withoutPrefix.slice(lastDot + 1).toLowerCase();
    if (KNOWN_VIDEO_EXTENSIONS.has(extension)) {
      return withoutPrefix.slice(0, lastDot);
    }
  }
  return withoutPrefix;
}

function labelFrom(transcodeKey: string | null): string {
  if (transcodeKey) {
    const match = /(\d{3,4})p/i.exec(transcodeKey);
    if (match?.[1]) return `${match[1]}p`;
  }
  return "原片";
}

// W4：按 src 扩展名只留 mp4/webm/mov（大小写不敏感），按 URL 去重、宽度升序；
// estimatedBytes = bandwidth（字节/秒）× durationSeconds，仅展示用。
function parseDerivatives(
  rawDerivatives: unknown[],
  durationSeconds: number,
): StockDerivative[] {
  const seenUrls = new Set<string>();
  const derivatives: StockDerivative[] = [];

  for (const rawDerivative of rawDerivatives) {
    const record = asRecord(rawDerivative);
    if (!record) continue;
    const src = record.src;
    if (typeof src !== "string" || seenUrls.has(src)) continue;
    const extension = extensionFromUrl(src);
    if (!SUPPORTED_CONTAINERS.has(extension)) continue;
    const container = extension as StockDerivative["container"];
    const width = Number(record.width);
    const height = Number(record.height);
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      continue;
    }

    seenUrls.add(src);
    const type = typeof record.type === "string" ? record.type : "";
    const mime = type.split(";")[0]?.trim() || FALLBACK_MIME[container];
    const transcodeKey =
      typeof record.transcodekey === "string" ? record.transcodekey : null;
    const derivative: StockDerivative = {
      url: src,
      mime,
      container,
      width,
      height,
      label: labelFrom(transcodeKey),
    };
    const bandwidth = Number(record.bandwidth);
    if (Number.isFinite(bandwidth) && bandwidth > 0) {
      derivative.estimatedBytes = Math.round(bandwidth * durationSeconds);
    }
    derivatives.push(derivative);
  }

  return derivatives.sort(
    (left, right) => left.width - right.width || left.height - right.height,
  );
}

function fitsLongEdge(derivative: StockDerivative): boolean {
  return Math.max(derivative.width, derivative.height) <= MAX_LONG_EDGE;
}

// 默认档位：宽度 ≤1280 的档位里最接近 720p 者，否则全档位里最接近 720p 者。
// 720p 档位以 transcodekey 的 NNNp 为准（竖片 height 不是 720），原片用 height。
function tierHeight(derivative: StockDerivative): number {
  const match = /^(\d{3,4})p$/.exec(derivative.label);
  return match?.[1] ? Number(match[1]) : derivative.height;
}

function pickDefaultDerivative(
  derivatives: StockDerivative[],
): StockDerivative | undefined {
  const eligible = derivatives.filter(
    (derivative) => derivative.width <= DEFAULT_TIER_MAX_WIDTH,
  );
  const pool = eligible.length > 0 ? eligible : derivatives;
  let best: StockDerivative | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const derivative of pool) {
    const distance = Math.abs(tierHeight(derivative) - DEFAULT_TIER_HEIGHT);
    if (distance < bestDistance) {
      best = derivative;
      bestDistance = distance;
    }
  }
  return best;
}

function normalizePage(rawPage: unknown): StockCandidate | null {
  const page = asRecord(rawPage);
  if (!page) return null;
  const title = typeof page.title === "string" ? page.title : null;
  const videoInfoList = Array.isArray(page.videoinfo) ? page.videoinfo : null;
  const videoInfo = videoInfoList ? asRecord(videoInfoList[0]) : null;
  if (!title || !videoInfo) return null;

  // W2：缺 videoinfo/derivatives 的页面跳过。
  const rawDerivatives = Array.isArray(videoInfo.derivatives)
    ? videoInfo.derivatives
    : null;
  if (!rawDerivatives) return null;
  const sourcePageUrl =
    typeof videoInfo.descriptionurl === "string"
      ? videoInfo.descriptionurl
      : null;
  if (!sourcePageUrl) return null;
  const durationSeconds = Number(videoInfo.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) return null;

  const durationMs = Math.round(durationSeconds * 1000);
  const extmetadata = asRecord(videoInfo.extmetadata) ?? {};
  const license = mapLicense(extmetadata);
  const supportedDerivatives = parseDerivatives(
    rawDerivatives,
    durationSeconds,
  );
  const derivatives = supportedDerivatives.filter(fitsLongEdge);
  const defaultDerivative = pickDefaultDerivative(derivatives);

  // 优先级：许可不明 > 时长越界 > 无档位 > 全部超 1920 长边。
  let disabledReason: StockCandidateDisabledReason | undefined;
  if (!license) {
    disabledReason = "许可不明";
  } else if (durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
    disabledReason = "时长超出支持范围（200ms..10 分钟）";
  } else if (supportedDerivatives.length === 0) {
    disabledReason = "无受支持的分辨率档位（仅 mp4/webm/mov）";
  } else if (derivatives.length === 0) {
    disabledReason = "全部档位超过 1920 长边";
  }

  const width = Number(videoInfo.width);
  const height = Number(videoInfo.height);
  const candidate: StockCandidate = {
    sourceId: "wikimedia",
    pageTitle: title,
    displayTitle: displayTitleFrom(title),
    sourcePageUrl,
    durationMs,
    width: Number.isFinite(width) ? width : 0,
    height: Number.isFinite(height) ? height : 0,
    mime: typeof videoInfo.mime === "string" ? videoInfo.mime : "",
    license,
    derivatives,
  };
  if (typeof videoInfo.thumburl === "string" && videoInfo.thumburl) {
    candidate.thumbnailUrl = videoInfo.thumburl;
  }
  if (defaultDerivative) {
    candidate.defaultDerivativeUrl = defaultDerivative.url;
  }
  if (disabledReason) candidate.disabledReason = disabledReason;
  return candidate;
}

// W2：formatversion=2 下 query.pages 是数组；任何畸形结构返回结构化失败，
// 不抛裸栈。单个畸形页面跳过，合法页面照常产出候选。
export function normalizeWikimediaPages(json: unknown): WikimediaPageResult {
  const root = asRecord(json);
  const query = asRecord(root?.query);
  const pages = query?.pages;
  if (!Array.isArray(pages)) {
    return { ok: false, error: "Wikimedia 响应不可解析" };
  }
  const candidates: StockCandidate[] = [];
  for (const page of pages) {
    const candidate = normalizePage(page);
    if (candidate) candidates.push(candidate);
  }
  return { ok: true, candidates };
}

// W5：https + 精确 host + /wikipedia/commons/ 前缀 + 无端口/凭据。
export function isAllowedWikimediaAssetUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    parsed.hostname === ASSET_HOST &&
    parsed.port === "" &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.pathname.startsWith(COMMONS_PATH_PREFIX)
  );
}

// W5 成员校验：URL 必须与候选档位精确相等（重取后的主门）。
export function findDerivative(
  candidate: StockCandidate,
  url: string,
): StockDerivative | null {
  return (
    candidate.derivatives.find((derivative) => derivative.url === url) ?? null
  );
}
