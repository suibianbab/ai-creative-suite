// M3 提议-确认环：开放词汇候选的自动选中决策（P1-1 整改时从 page.tsx 抽出
// 为纯函数——闭包旧 state 的自动选中 bug 修复后，决策本身也需要可单测的
// 低于/等于/高于阈值与 protect 永不自动的状态转移用例）。
export const TAU_AUTO = 0.75;

// 补充A 整改（codex 审核 2026-10-16）：候选分数是本集合内的 CLIP 相对排名
// 权重（softmax 归一），不是「该区域正确的概率」；跨题材标注集校准（各领域
// top-1 命中率 / 误自动选中率 / 样本数）完成并达到预设误选门槛前，自动选中
// 保持关闭——所有候选统一走一次人工确认，遥测仍记录 topScore 供校准。
export const TAU_AUTO_ENABLED = false;

export type RingCandidateScore = Readonly<{ score: number }>;

/**
 * τ_auto 决策：仅 target 模式、开关启用、且 top-1 分数 ≥ τ 时自动选中候选①
 * （预览即提议，单步可撤销）；protect 永不自动——保护框选错的代价是静默漏
 * 保护。等于阈值也算命中（≥ 语义）。
 */
export function shouldAutoSelectCandidate<Candidate extends RingCandidateScore>(
  mode: "target" | "protect",
  candidates: readonly Candidate[],
  options: Readonly<{ tauAuto?: number; enabled?: boolean }> = {},
): boolean {
  const { tauAuto = TAU_AUTO, enabled = TAU_AUTO_ENABLED } = options;
  if (!enabled || mode !== "target") return false;
  const top = candidates[0];
  return Boolean(top && top.score >= tauAuto);
}

/** 环出口类别（M4 τ 校准回流的分桶字段，与 page.tsx 遥测一致）。 */
export function ringOutcome(
  auto: boolean,
  autoTop: boolean | undefined,
  chosen: number | null,
  ordinal: number,
): "auto" | "override" | "confirm" {
  if (auto) return "auto";
  // 自动选中后被人工换掉（chosen 停在 0）→ τ 定得过低的直接证据。
  if (autoTop && chosen === 0 && ordinal !== 0) return "override";
  return "confirm";
}
