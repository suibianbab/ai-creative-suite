// VID-023 导出资产的断言口径（e2e 与单测共用）：
// 契约见 packages/video-document/src/types.ts —— 作者在 origin.license.author，
// proxy 是资产顶层可选字段（original 内没有 proxy）。返回空数组即全部通过，
// 否则按检查顺序给出 { step, detail }，e2e 用第一条失败退出。
const SOURCE_PAGE =
  "https://commons.wikimedia.org/wiki/File:Clouds-seloncourt.ogv";

export function stockAssetViolations(asset) {
  const violations = [];
  const push = (step, detail) => violations.push({ step, detail });

  if (
    asset.origin.kind !== "stock-source" ||
    asset.origin.sourceId !== "wikimedia"
  )
    push("origin", JSON.stringify(asset.origin));
  if (asset.origin.sourcePageUrl !== SOURCE_PAGE)
    push("sourcePageUrl", asset.origin.sourcePageUrl);
  if (asset.origin.license.name !== "CC BY 2.0")
    push("license", asset.origin.license.name);
  if (asset.origin.license.author !== "Thomas Bresson")
    push("author", asset.origin.license.author);
  if (Number.isNaN(Date.parse(asset.origin.retrievedAt)))
    push("retrievedAt", asset.origin.retrievedAt);
  if (asset.original.width !== 854 || asset.original.height !== 480)
    push("尺寸", `${asset.original.width}x${asset.original.height}`);
  if (asset.original.durationMs !== 28600)
    push("时长", String(asset.original.durationMs));
  if (asset.original.hasAudio !== false)
    push("hasAudio", String(asset.original.hasAudio));
  const sha256 = asset.original.sha256;
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256))
    push("sha256", String(sha256));
  // sha256 已坏时不推导 storeKey，保持与逐项短路时代一致的诊断（先报 sha256）。
  else if (asset.original.storeKey !== `${sha256.slice(0, 16)}.webm`)
    push("storeKey", asset.original.storeKey);
  if (asset.proxy !== undefined) push("proxy", "不应生成 proxy");

  return violations;
}
