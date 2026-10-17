import type { ShotEvent, ShotStatus } from "./types.js";

// ADR 0003 §1.3：状态不落库，由事件推导。对某版本：最后一个相关事件决定状态
// （approved → approved；submitted → candidate；从未 submitted → draft）。
// 重做不改历史：旧版本被 approved 过就一直是 approved，直到被显式回滚/重批。
export function deriveStatus(
  events: ShotEvent[],
  versionId: string,
): ShotStatus {
  let status: ShotStatus = "draft";
  for (const event of events) {
    if (event.kind === "submitted" && event.versionId === versionId)
      status = "candidate";
    else if (event.kind === "approved" && event.versionId === versionId)
      status = "approved";
  }
  return status;
}

// approved_version 不落库（ADR 0003 §1.7）：取事件日志中最新 approved 事件引用的版本。
export function approvedVersionId(events: ShotEvent[]): string | null {
  let latest: string | null = null;
  for (const event of events) {
    if (event.kind === "approved") latest = event.versionId;
  }
  return latest;
}
