// P2.5-T5 在线素材面板纯状态机（spec §2.3 面板 / §4 web stock-search）：
// 全部为不可变更新；StockCandidate 仅 type import（该包 Node-only，客户端不得 value-import）。
import type { StockCandidate } from "@acs/media-store";

export type StockRejectReason =
  | "题材不符"
  | "文字画面"
  | "质量低"
  | "许可不明"
  | "其他";

export type StockSearchPhase =
  | "idle"
  | "searching"
  | "results"
  | "importing"
  | "error";

export type StockSearchState = {
  phase: StockSearchPhase;
  query: string;
  candidates: StockCandidate[];
  rejected: Record<string, StockRejectReason>;
  selected: Record<string, string>;
  imported: string[];
  error: string | null;
};

export function initialStockSearchState(): StockSearchState {
  return {
    phase: "idle",
    query: "",
    candidates: [],
    rejected: {},
    selected: {},
    imported: [],
    error: null,
  };
}

export function startSearch(
  s: StockSearchState,
  query: string,
): StockSearchState {
  return {
    ...s,
    phase: "searching",
    query,
    candidates: [],
    rejected: {},
    selected: {},
    imported: [],
    error: null,
  };
}

export function searchSucceeded(
  s: StockSearchState,
  candidates: StockCandidate[],
): StockSearchState {
  const present = new Set(candidates.map((candidate) => candidate.pageTitle));
  const keepPresent = <T>(record: Record<string, T>): Record<string, T> =>
    Object.fromEntries(
      Object.entries(record).filter(([pageTitle]) => present.has(pageTitle)),
    );
  return {
    ...s,
    phase: "results",
    candidates,
    rejected: keepPresent(s.rejected),
    selected: keepPresent(s.selected),
    imported: s.imported.filter((pageTitle) => present.has(pageTitle)),
    error: null,
  };
}

export function searchFailed(
  s: StockSearchState,
  error: string,
): StockSearchState {
  return { ...s, phase: "error", error };
}

export function selectDerivative(
  s: StockSearchState,
  pageTitle: string,
  url: string,
): StockSearchState {
  return { ...s, selected: { ...s.selected, [pageTitle]: url } };
}

export function rejectCandidate(
  s: StockSearchState,
  pageTitle: string,
  reason: StockRejectReason,
): StockSearchState {
  return { ...s, rejected: { ...s.rejected, [pageTitle]: reason } };
}

export function unrejectCandidate(
  s: StockSearchState,
  pageTitle: string,
): StockSearchState {
  const rejected = { ...s.rejected };
  delete rejected[pageTitle];
  return { ...s, rejected };
}

export function importStarted(
  s: StockSearchState,
  _pageTitle: string,
): StockSearchState {
  return { ...s, phase: "importing", error: null };
}

export function importSucceeded(
  s: StockSearchState,
  pageTitle: string,
): StockSearchState {
  return {
    ...s,
    phase: "results",
    imported: s.imported.includes(pageTitle)
      ? s.imported
      : [...s.imported, pageTitle],
    error: null,
  };
}

export function importFailed(
  s: StockSearchState,
  error: string,
): StockSearchState {
  return { ...s, phase: "results", error };
}

function derivativeUrls(c: StockCandidate): string[] {
  return c.derivatives.map((derivative) => derivative.url);
}

export function canDownload(
  c: StockCandidate,
): { ok: true } | { ok: false; reason: string } {
  if (c.disabledReason) {
    return { ok: false, reason: c.disabledReason };
  }
  const url = c.defaultDerivativeUrl ?? c.derivatives[0]?.url;
  if (!url) {
    return { ok: false, reason: "无可用分辨率档位" };
  }
  return { ok: true };
}

export function effectiveDerivativeUrl(
  s: StockSearchState,
  c: StockCandidate,
): string | null {
  const urls = derivativeUrls(c);
  const selected = s.selected[c.pageTitle];
  if (selected && urls.includes(selected)) {
    return selected;
  }
  if (c.defaultDerivativeUrl && urls.includes(c.defaultDerivativeUrl)) {
    return c.defaultDerivativeUrl;
  }
  return null;
}
