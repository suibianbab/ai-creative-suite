// P2.5-T3 素材面板纯逻辑（spec §2.2 U 表）：账本追加、预览 src（proxy 优先，
// 依赖 GET ?variant=proxy 的回退语义）、列表标签。组件只做渲染/状态接线。
import type { MediaAsset } from "@acs/video-document";

export function appendMediaAsset(
  assets: MediaAsset[] | undefined,
  asset: MediaAsset,
): MediaAsset[] {
  if ((assets ?? []).some((existing) => existing.assetId === asset.assetId)) {
    throw new Error(`素材 ${asset.assetId} 已在账本中（assetId 必须唯一）`);
  }
  return [...(assets ?? []), asset];
}

export function mediaSrcUrl(asset: MediaAsset): string {
  return `/api/media/file/${asset.original.storeKey}${
    asset.proxy ? "?variant=proxy" : ""
  }`;
}

export function assetLabel(asset: MediaAsset, all: MediaAsset[]): string {
  const fileName =
    asset.origin.kind === "local-upload"
      ? asset.origin.fileName
      : asset.origin.sourcePageUrl;
  const duplicate =
    all.filter(
      (existing) => existing.original.storeKey === asset.original.storeKey,
    ).length > 1;
  return `「${fileName}」 ${asset.original.width}×${asset.original.height} · ${(
    asset.original.durationMs / 1000
  ).toFixed(1)}s · 本地上传${duplicate ? "（同内容已在册）" : ""}`;
}
