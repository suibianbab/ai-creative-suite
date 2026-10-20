"use client";

// P2.6-T7 镜头卡内在线素材搜索面板（spec §2.3 U4/U5/U7）：薄组件——
// 搜索/拒绝/选档/导入流程全走 stock-search.ts 纯状态机，下载成功经页面回调
// 在最新文档上单事务落盘。候选类型只从状态机派生；@acs/media-store 是
// Node-only，本文件不得 value-import。
import { useRef, useState } from "react";
import {
  canDownload,
  effectiveDerivativeUrl,
  importFailed,
  importStarted,
  importSucceeded,
  initialStockSearchState,
  rejectCandidate,
  type StockRejectReason,
  type StockSearchState,
  searchFailed,
  searchSucceeded,
  selectDerivative,
  startSearch,
  unrejectCandidate,
} from "./stock-search";

type StockCandidate = StockSearchState["candidates"][number];
type StockDerivative = StockCandidate["derivatives"][number];

const REJECT_REASONS: StockRejectReason[] = [
  "题材不符",
  "文字画面",
  "质量低",
  "许可不明",
  "其他",
];

// §3：检索失败的唯一兜底文案（路由已给 error 时以路由为准）。
const SEARCH_FALLBACK =
  "在线素材检索失败：网络或服务异常（可重试或改用本地上传）";

const DEFAULT_REJECT_REASON: StockRejectReason = "题材不符";

function derivativeOptionLabel(derivative: StockDerivative): string {
  const size =
    derivative.estimatedBytes !== undefined
      ? ` · ≈${(derivative.estimatedBytes / (1024 * 1024)).toFixed(1)}MB`
      : "";
  return `${derivative.label} · ${derivative.width}×${derivative.height}${size}`;
}

export function StockSearchPanel({
  disabled,
  onImportStock,
}: {
  disabled: boolean;
  onImportStock: (pageTitle: string, derivativeUrl: string) => Promise<string>;
}) {
  const [state, setState] = useState<StockSearchState>(initialStockSearchState);
  // 「不采用」的原因选择是纯 UI 草稿（只在点击时交给状态机），不进项目文档。
  const [rejectReasons, setRejectReasons] = useState<
    Record<string, StockRejectReason>
  >({});
  const searching = state.phase === "searching";
  const importing = state.phase === "importing";
  // U6：失败后卡内提供「重试」——记住最后一次导入尝试，成功即清空，
  // 避免把无关的检索失败也变成可重试的导入。
  const lastAttempt = useRef<{
    candidate: StockCandidate;
    derivativeUrl: string;
  } | null>(null);

  const runSearch = async () => {
    const query = state.query.trim();
    if (query === "" || searching || importing || disabled) return;
    lastAttempt.current = null;
    setState((previous) => startSearch(previous, query));
    let failure: string | null = null;
    try {
      const response = await fetch(
        `/api/media/stock/search?q=${encodeURIComponent(query)}`,
      );
      const payload = (await response.json().catch(() => ({}))) as {
        candidates?: StockCandidate[];
        error?: string;
      };
      const candidates = payload.candidates;
      if (!response.ok) {
        failure = payload.error ?? SEARCH_FALLBACK;
      } else if (!Array.isArray(candidates)) {
        failure = SEARCH_FALLBACK;
      } else {
        setState((previous) => searchSucceeded(previous, candidates));
        return;
      }
    } catch {
      failure = SEARCH_FALLBACK;
    }
    setState((previous) => searchFailed(previous, failure ?? SEARCH_FALLBACK));
  };

  const handleImport = async (candidate: StockCandidate) => {
    if (disabled || importing) return;
    if (!canDownload(candidate).ok) return;
    const derivativeUrl = effectiveDerivativeUrl(state, candidate);
    if (derivativeUrl === null) return;
    setState((previous) => importStarted(previous, candidate.pageTitle));
    lastAttempt.current = { candidate, derivativeUrl };
    try {
      await onImportStock(candidate.pageTitle, derivativeUrl);
      lastAttempt.current = null;
      setState((previous) => importSucceeded(previous, candidate.pageTitle));
    } catch (error) {
      setState((previous) =>
        importFailed(
          previous,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  };

  const visibleCandidates = state.candidates.filter(
    (candidate) => state.rejected[candidate.pageTitle] === undefined,
  );
  const rejectedCandidates = state.candidates.filter(
    (candidate) => state.rejected[candidate.pageTitle] !== undefined,
  );

  return (
    <section className="stock-search-panel">
      <span className="stock-search-heading">
        在线素材搜索（Wikimedia Commons）
      </span>
      <div className="stock-search-row">
        <input
          className="stock-search-input"
          value={state.query}
          maxLength={80}
          placeholder="关键词（如 clouds）"
          aria-label="在线素材搜索关键词"
          disabled={disabled || searching || importing}
          onChange={(event) =>
            setState((previous) => ({
              ...previous,
              query: event.target.value,
            }))
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void runSearch();
            }
          }}
        />
        <button
          type="button"
          className="stock-search-button"
          disabled={
            disabled ||
            searching ||
            importing ||
            state.query.trim().length === 0
          }
          onClick={() => void runSearch()}
        >
          {searching ? "检索中…" : "搜索"}
        </button>
      </div>
      {state.error ? (
        <p className="stock-search-error" role="alert">
          {state.error}
          {lastAttempt.current ? (
            <>
              {" "}
              <button
                type="button"
                className="stock-search-button"
                disabled={disabled || importing}
                onClick={() => {
                  const attempt = lastAttempt.current;
                  if (attempt) void handleImport(attempt.candidate);
                }}
              >
                重试
              </button>
            </>
          ) : null}
        </p>
      ) : null}
      {visibleCandidates.length > 0 ? (
        <ul className="stock-candidates">
          {visibleCandidates.map((candidate) => {
            const download = canDownload(candidate);
            const derivativeUrl = effectiveDerivativeUrl(state, candidate);
            const imported = state.imported.includes(candidate.pageTitle);
            return (
              <li key={candidate.pageTitle} className="stock-candidate">
                {candidate.thumbnailUrl ? (
                  <img
                    className="stock-candidate-thumb"
                    src={candidate.thumbnailUrl}
                    alt={candidate.displayTitle}
                  />
                ) : null}
                <div className="stock-candidate-body">
                  <span className="stock-candidate-title">
                    {candidate.displayTitle}
                  </span>
                  {candidate.license?.author ? (
                    <span className="stock-candidate-meta">
                      作者：{candidate.license.author}
                    </span>
                  ) : null}
                  <span className="stock-candidate-meta">
                    {candidate.license?.name ?? "许可不明"}
                  </span>
                  <span className="stock-candidate-meta">
                    {(candidate.durationMs / 1000).toFixed(1)}s ·{" "}
                    {candidate.width}×{candidate.height}
                  </span>
                  <a
                    className="stock-source-link"
                    href={candidate.sourcePageUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    来源页
                  </a>
                  {candidate.disabledReason ? (
                    <span className="stock-badge stock-badge-disabled">
                      {candidate.disabledReason}
                    </span>
                  ) : null}
                  {imported ? (
                    <span className="stock-badge stock-badge-imported">
                      已入库
                    </span>
                  ) : null}
                  {candidate.disabledReason === "许可不明" ? (
                    <span className="stock-candidate-hint">
                      许可不明：不提供下载（请更换素材或改用本地上传）
                    </span>
                  ) : null}
                  {candidate.derivatives.length > 0 ? (
                    <select
                      className="stock-derivative-select"
                      value={derivativeUrl ?? ""}
                      aria-label={`${candidate.displayTitle} 分辨率档位`}
                      disabled={disabled || importing || !download.ok}
                      onChange={(event) =>
                        setState((previous) =>
                          selectDerivative(
                            previous,
                            candidate.pageTitle,
                            event.target.value,
                          ),
                        )
                      }
                    >
                      {derivativeUrl === null ? (
                        <option value="">（无可用档位）</option>
                      ) : null}
                      {candidate.derivatives.map((derivative) => (
                        <option key={derivative.url} value={derivative.url}>
                          {derivativeOptionLabel(derivative)}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <div className="stock-candidate-actions">
                    <button
                      type="button"
                      className="stock-download"
                      disabled={
                        disabled ||
                        importing ||
                        !download.ok ||
                        derivativeUrl === null
                      }
                      onClick={() => void handleImport(candidate)}
                    >
                      {importing &&
                      lastAttempt.current?.candidate.pageTitle ===
                        candidate.pageTitle
                        ? "下载中…"
                        : "下载并应用"}
                    </button>
                    <select
                      className="stock-reject-select"
                      value={
                        rejectReasons[candidate.pageTitle] ??
                        DEFAULT_REJECT_REASON
                      }
                      aria-label={`${candidate.displayTitle} 不采用原因`}
                      disabled={disabled || importing}
                      onChange={(event) =>
                        setRejectReasons((previous) => ({
                          ...previous,
                          [candidate.pageTitle]: event.target
                            .value as StockRejectReason,
                        }))
                      }
                    >
                      {REJECT_REASONS.map((reason) => (
                        <option key={reason} value={reason}>
                          {reason}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="stock-reject"
                      disabled={disabled || importing}
                      onClick={() =>
                        setState((previous) =>
                          rejectCandidate(
                            previous,
                            candidate.pageTitle,
                            rejectReasons[candidate.pageTitle] ??
                              DEFAULT_REJECT_REASON,
                          ),
                        )
                      }
                    >
                      不采用
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {rejectedCandidates.length > 0 ? (
        <details className="stock-rejected">
          <summary>已拒绝（{rejectedCandidates.length}）</summary>
          <ul className="stock-rejected-list">
            {rejectedCandidates.map((candidate) => (
              <li key={candidate.pageTitle} className="stock-rejected-item">
                <span>
                  {candidate.displayTitle} ·{" "}
                  {state.rejected[candidate.pageTitle]}
                </span>
                <button
                  type="button"
                  className="stock-unreject"
                  disabled={disabled}
                  onClick={() =>
                    setState((previous) =>
                      unrejectCandidate(previous, candidate.pageTitle),
                    )
                  }
                >
                  撤销
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
