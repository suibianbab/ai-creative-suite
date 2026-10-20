// P2.5-T2 内容寻址媒体仓公共面（store → probe → proxy → ingest 逐任务落）。

export {
  type IngestOrigin,
  type IngestReasonCode,
  type IngestResult,
  ingestMediaFile,
  runDecode,
} from "./ingest.js";
export {
  type ProbeOutcome,
  type ProbeResult,
  parseFps,
  parseProbeOutput,
  runProbe,
} from "./probe.js";
export { needsProxy, PROXY_MAX_EDGE, transcodeProxy } from "./proxy.js";
export {
  importStockCandidate,
  type StockImportReasonCode,
  type StockImportResult,
} from "./stock/import.js";
export * from "./stock/types.js";
export * from "./stock/wikimedia.js";
export {
  originalPath,
  proxyPath,
  resolveStoreRoot,
  STORE_KEY_PATTERN,
  storeKeyFor,
  writeAtomically,
} from "./store.js";
