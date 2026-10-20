// P2.5-T6（spec §2.3 U5）：下载成功直接应用的单事务落盘。
// 纯函数在「最新文档」上追加账本并应用默认媒体镜头修订；编排函数只保存一次，
// 不 catch save——调用方据此在失败时不 setEditor。
import {
  type MediaAsset,
  reviseWorkingVersion,
  type VideoProject,
} from "@acs/video-document";
import { appendMediaAsset } from "./media-assets";
import {
  buildMediaRevisePatch,
  mediaDraftForAsset,
} from "./media-clip-templates";

export type ImportStockDeps = {
  requestImport: (
    pageTitle: string,
    derivativeUrl: string,
  ) => Promise<MediaAsset>;
  save: (document: VideoProject) => Promise<VideoProject>;
  newVersionId: () => string;
};

export function applyStockAsset(
  latest: VideoProject,
  shotId: string,
  asset: MediaAsset,
  newVersionId: string,
): { document: VideoProject; applied: boolean; message: string } {
  const withAsset: VideoProject = {
    ...latest,
    mediaAssets: appendMediaAsset(latest.mediaAssets, asset),
  };
  const index = latest.shots.findIndex((s) => s.shotId === shotId);
  if (index === -1) {
    return {
      document: withAsset,
      applied: false,
      message: "素材已入库；原镜头已不存在，请在镜头卡中选择",
    };
  }
  const shot = latest.shots[index]!;
  const working = shot.contentVersions.find(
    (version) => version.versionId === shot.workingVersionId,
  );
  if (!working) {
    throw new Error(
      `镜头 ${shotId} 的工作版本 ${shot.workingVersionId} 不存在`,
    );
  }
  const { patch, error } = buildMediaRevisePatch(
    mediaDraftForAsset(asset),
    withAsset.mediaAssets ?? [],
    working.narrationText,
  );
  // 默认草稿理论上恒合法；这里仍是防御——非法时不产生半成品文档。
  if (error !== null || patch === null) {
    throw new Error(error ?? `无法为素材 ${asset.assetId} 构造媒体镜头修订`);
  }
  const document = reviseWorkingVersion(withAsset, shotId, patch, newVersionId);
  return {
    document,
    applied: true,
    message: `素材已下载并应用（镜头 ${index + 1}）`,
  };
}

export async function importStockForShot(
  latest: VideoProject,
  shotId: string,
  pageTitle: string,
  derivativeUrl: string,
  deps: ImportStockDeps,
): Promise<{ document: VideoProject; message: string }> {
  const asset = await deps.requestImport(pageTitle, derivativeUrl);
  const { document, message } = applyStockAsset(
    latest,
    shotId,
    asset,
    deps.newVersionId(),
  );
  // 账本与镜头修订一次保存；save 失败直接向上抛，调用方不得 setEditor。
  const saved = await deps.save(document);
  return { document: saved, message };
}
