// P2.6-T5 Stock 源公共类型：候选、档位、禁用原因。后续任务只认这些名字。
export type StockDerivative = {
  url: string;
  mime: string;
  container: "mp4" | "webm" | "mov";
  width: number;
  height: number;
  label: string;
  estimatedBytes?: number;
};

export type StockCandidateDisabledReason =
  | "许可不明"
  | "无受支持的分辨率档位（仅 mp4/webm/mov）"
  | "时长超出支持范围（200ms..10 分钟）"
  | "全部档位超过 1920 长边";

export type StockCandidate = {
  sourceId: "wikimedia";
  pageTitle: string;
  displayTitle: string;
  sourcePageUrl: string;
  thumbnailUrl?: string;
  durationMs: number;
  width: number;
  height: number;
  mime: string;
  license: { name: string; author?: string; usageNote?: string } | null;
  derivatives: StockDerivative[];
  defaultDerivativeUrl?: string;
  disabledReason?: StockCandidateDisabledReason;
};
