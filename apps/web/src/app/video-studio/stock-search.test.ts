// P2.5-T5 在线素材面板状态机（spec §4 web stock-search）：相位流转、拒绝/选择/已入库、
// 有效档位与可下载判定。全零网络：只构造 StockCandidate 夹具。
import assert from "node:assert/strict";
import test from "node:test";
import type { StockCandidate } from "@acs/media-store";
import {
  canDownload,
  effectiveDerivativeUrl,
  importFailed,
  importStarted,
  importSucceeded,
  initialStockSearchState,
  rejectCandidate,
  searchFailed,
  searchSucceeded,
  selectDerivative,
  startSearch,
  unrejectCandidate,
} from "./stock-search";

const URL_720 = "https://upload.wikimedia.org/wikipedia/commons/720.webm";
const URL_480 = "https://upload.wikimedia.org/wikipedia/commons/480.webm";

function candidate(overrides: Partial<StockCandidate> = {}): StockCandidate {
  return {
    sourceId: "wikimedia",
    pageTitle: "File:Clouds.webm",
    displayTitle: "Clouds",
    sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Clouds.webm",
    durationMs: 4000,
    width: 1280,
    height: 720,
    mime: "video/webm",
    license: { name: "CC BY-SA 4.0", author: "Demo Author" },
    derivatives: [
      {
        url: URL_720,
        mime: "video/webm",
        container: "webm",
        width: 1280,
        height: 720,
        label: "720p",
      },
      {
        url: URL_480,
        mime: "video/webm",
        container: "webm",
        width: 854,
        height: 480,
        label: "480p",
      },
    ],
    defaultDerivativeUrl: URL_720,
    ...overrides,
  };
}

test("S1：初始状态为 idle，空查询、空候选、无错误", () => {
  assert.deepEqual(initialStockSearchState(), {
    phase: "idle",
    query: "",
    candidates: [],
    rejected: {},
    selected: {},
    imported: [],
    error: null,
  });
});

test("S2：startSearch 进入 searching，清空旧候选/拒绝/选择/已入库与错误（不 mutate 入参）", () => {
  const a = candidate();
  const before = {
    ...initialStockSearchState(),
    phase: "results" as const,
    query: "旧词",
    candidates: [a],
    rejected: { [a.pageTitle]: "题材不符" as const },
    selected: { [a.pageTitle]: URL_480 },
    imported: [a.pageTitle],
    error: "旧错误",
  };
  const snapshot = structuredClone(before);
  const next = startSearch(before, "云海");
  assert.deepEqual(next, {
    phase: "searching",
    query: "云海",
    candidates: [],
    rejected: {},
    selected: {},
    imported: [],
    error: null,
  });
  assert.deepEqual(before, snapshot, "入参不得被修改");
  assert.notEqual(next, before);
});

test("S3：searchSucceeded 进入 results、替换候选、清错误，仅保留仍在册候选的拒绝/选择/已入库", () => {
  const a = candidate();
  const b = candidate({
    pageTitle: "File:Ocean.webm",
    displayTitle: "Ocean",
  });
  const before = {
    ...initialStockSearchState(),
    phase: "searching" as const,
    query: "云",
    candidates: [a, b],
    rejected: {
      [a.pageTitle]: "题材不符" as const,
      [b.pageTitle]: "质量低" as const,
    },
    selected: { [a.pageTitle]: URL_480, [b.pageTitle]: URL_720 },
    imported: [a.pageTitle, b.pageTitle],
    error: "旧错误",
  };
  const snapshot = structuredClone(before);
  const next = searchSucceeded(before, [a]);
  assert.equal(next.phase, "results");
  assert.deepEqual(next.candidates, [a]);
  assert.equal(next.error, null);
  assert.deepEqual(next.rejected, { [a.pageTitle]: "题材不符" });
  assert.deepEqual(next.selected, { [a.pageTitle]: URL_480 });
  assert.deepEqual(next.imported, [a.pageTitle]);
  assert.deepEqual(before, snapshot, "入参不得被修改");
});

test("S4：searchFailed 保留旧候选，置 error 相位与原文消息", () => {
  const a = candidate();
  const before = {
    ...initialStockSearchState(),
    phase: "searching" as const,
    query: "云",
    candidates: [a],
  };
  const message = "在线素材检索失败：网络超时（可重试或改用本地上传）";
  const next = searchFailed(before, message);
  assert.equal(next.phase, "error");
  assert.equal(next.error, message);
  assert.deepEqual(next.candidates, [a]);
  assert.deepEqual(before.candidates, [a], "入参不得被修改");
});

test("S5：selectDerivative 写入 selected；effectiveDerivativeUrl 优先手选，非法 URL 回退默认", () => {
  const a = candidate();
  const selectedState = selectDerivative(
    initialStockSearchState(),
    a.pageTitle,
    URL_480,
  );
  assert.equal(selectedState.selected[a.pageTitle], URL_480);
  assert.equal(effectiveDerivativeUrl(selectedState, a), URL_480);

  assert.equal(
    effectiveDerivativeUrl(initialStockSearchState(), a),
    URL_720,
    "未手选时取默认档位",
  );

  const outside = selectDerivative(
    initialStockSearchState(),
    a.pageTitle,
    "https://upload.wikimedia.org/wikipedia/commons/evil.webm",
  );
  assert.equal(
    effectiveDerivativeUrl(outside, a),
    URL_720,
    "不在候选档位中的 URL 回退默认",
  );

  const noDefault = candidate({ defaultDerivativeUrl: undefined });
  assert.equal(
    effectiveDerivativeUrl(initialStockSearchState(), noDefault),
    null,
  );
});

test("S6：rejectCandidate 记录原因，unrejectCandidate 撤销且不 mutate 入参", () => {
  const a = candidate();
  const rejectedState = rejectCandidate(
    initialStockSearchState(),
    a.pageTitle,
    "许可不明",
  );
  assert.equal(rejectedState.rejected[a.pageTitle], "许可不明");

  const snapshot = structuredClone(rejectedState);
  const restored = unrejectCandidate(rejectedState, a.pageTitle);
  assert.deepEqual(restored.rejected, {});
  assert.deepEqual(rejectedState, snapshot, "入参不得被修改");
  assert.notEqual(restored.rejected, rejectedState.rejected);
});

test("S7：importStarted 置 importing；importSucceeded 去重写入 imported 回 results；importFailed 回 results 带 error", () => {
  const a = candidate();
  const base = searchSucceeded(initialStockSearchState(), [a]);
  assert.equal(importStarted(base, a.pageTitle).phase, "importing");

  const done = importSucceeded(base, a.pageTitle);
  assert.equal(done.phase, "results");
  assert.deepEqual(done.imported, [a.pageTitle]);
  const again = importSucceeded(done, a.pageTitle);
  assert.deepEqual(again.imported, [a.pageTitle], "同一候选不重复入册");

  const failed = importFailed(done, "素材导入失败：ffprobe 失败");
  assert.equal(failed.phase, "results");
  assert.equal(failed.error, "素材导入失败：ffprobe 失败");
});

test("S8：canDownload 优先返回 disabledReason 原文，其次要求有效档位", () => {
  assert.deepEqual(canDownload(candidate({ disabledReason: "许可不明" })), {
    ok: false,
    reason: "许可不明",
  });
  assert.deepEqual(
    canDownload(
      candidate({
        disabledReason: "无受支持的分辨率档位（仅 mp4/webm/mov）",
      }),
    ),
    { ok: false, reason: "无受支持的分辨率档位（仅 mp4/webm/mov）" },
  );
  assert.deepEqual(
    canDownload(
      candidate({ derivatives: [], defaultDerivativeUrl: undefined }),
    ),
    { ok: false, reason: "无可用分辨率档位" },
  );
  assert.deepEqual(canDownload(candidate()), { ok: true });
  assert.deepEqual(
    canDownload(candidate({ defaultDerivativeUrl: undefined })),
    { ok: true },
    "无默认档位但仍有候选档位时可下载",
  );
});
