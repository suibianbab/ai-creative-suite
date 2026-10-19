// P2.5-T4（spec §2 G1-G7）媒体镜头出片装配纯逻辑：收集/核验/props/证据。
// 依赖全注入（fs/hash），单测零网络零 Remotion；编排由 render-scene.mjs 做。
// roundHalfUp 从 @acs/video-document dist 动态取（scripts 不进 TS 源，
// media-ingest.mjs 同款 pathToFileURL 模式）。
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const { roundHalfUp } = await import(
  pathToFileURL(path.join(ROOT, "packages/video-document/dist/index.js")).href
);

const STORE_KEY_PATTERN = /^[0-9a-f]{16}\.(mp4|webm|mov)$/;

// G1：media 镜头 → entry（含账本资产快照）。问题收集不抛——调用方统一大声拒。
export function collectMediaShots(project, mediaAssets) {
  const entries = [];
  const problems = [];
  for (const [shotIndex, shot] of project.shots.entries()) {
    const version = shot.contentVersions.find(
      (candidate) => candidate.versionId === shot.workingVersionId,
    );
    if (!version || version.sceneSource.type !== "media-clip") continue;
    const media = version.sceneSource;
    const asset = mediaAssets.find((a) => a.assetId === media.mediaAssetId);
    if (!asset) {
      problems.push(
        `镜头 ${shotIndex + 1} 素材不在账本：${media.mediaAssetId}（mediaAssets 无此 assetId，请先上传或恢复账本）`,
      );
      continue;
    }
    if (media.outMs > asset.original.durationMs) {
      problems.push(
        `镜头 ${shotIndex + 1} 片段出点 ${media.outMs}ms 超素材时长 ${asset.original.durationMs}ms（媒体镜头时长=出点−入点，出点以素材时长为上限）`,
      );
      continue;
    }
    entries.push({
      shotIndex,
      shotId: shot.shotId,
      versionId: version.versionId,
      durationMs: version.durationMs,
      media: {
        mediaAssetId: media.mediaAssetId,
        inMs: media.inMs,
        outMs: media.outMs,
        fit: media.fit,
        focalX: media.focalX,
        audio: media.audio,
      },
      asset: {
        assetId: asset.assetId,
        storeKey: asset.original.storeKey,
        sha256: asset.original.sha256,
        width: asset.original.width,
        height: asset.original.height,
        fps: asset.original.fps,
        durationMs: asset.original.durationMs,
      },
    });
  }
  return { entries, problems };
}

// B5：源内起始帧 = 半进位（与 quantizeTimeline 同口径），props/manifest 单点计算。
export function mediaTrimBefore(inMs, fps) {
  return roundHalfUp((inMs * fps) / 1000);
}

// G2：镜头 props 的 media 通道。不含合成宽高——裁切在组件内 useVideoConfig 现算，
// props 两画幅逐字节一致（X1 纪律在媒体路径的延续）。
export function buildTimelineShotMedia(entry, src, fps) {
  return {
    media: {
      src,
      assetWidth: entry.asset.width,
      assetHeight: entry.asset.height,
      inMs: entry.media.inMs,
      outMs: entry.media.outMs,
      fit: entry.media.fit,
      focalX: entry.media.focalX,
      audio: entry.media.audio,
      trimBefore: mediaTrimBefore(entry.media.inMs, fps),
    },
  };
}

// G3：渲染前仓核对（仓是事实源、账本 sha 是钉子）。存在性 + sha256 双查；
// hashFile 可异步（CLI 传流式实现）。形状门在 fs 之前（账本被手改也不触盘）；
// 仓根以原串进错误文案（指路 ACS_MEDIA_STORE，不做平台化斜杠改写）。
export async function verifyMediaAssets(entries, deps) {
  const problems = [];
  for (const entry of entries) {
    if (!STORE_KEY_PATTERN.test(entry.asset.storeKey)) {
      problems.push(
        `storeKey 形状非法：${entry.asset.storeKey}（账本可能被手改，拒绝出片）`,
      );
      continue;
    }
    const file = path.join(deps.storeRoot, "original", entry.asset.storeKey);
    if (!deps.existsSync(file)) {
      problems.push(
        `媒体文件缺失：${entry.asset.storeKey}（仓根 ACS_MEDIA_STORE=${deps.storeRoot}，请检查媒体仓与项目账本是否同机同步）`,
      );
      continue;
    }
    const sha = await deps.hashFile(file);
    if (sha !== entry.asset.sha256) {
      problems.push(
        `素材摘要不符：${entry.asset.storeKey} 账本 ${entry.asset.sha256.slice(0, 12)}… 实测 ${sha.slice(0, 12)}…（仓文件被改动，内容寻址被破坏，拒绝出片）`,
      );
    }
  }
  return problems;
}

// G4：aac 存在性判定四象限单点（旁白轨 ∨ 媒体 keep 原声）。
export function buildHasAudioTrack(narrationEntries, mediaEntries) {
  return (
    narrationEntries.length > 0 ||
    mediaEntries.some((entry) => entry.media.audio === "keep")
  );
}

// B6/G5：末帧黑帧检测。signalstats 的 metadata=print 走 stderr、逐帧多行统计，
// 取最后一个 YAVG；无匹配返回 null（调用方对 null 必须大声处理，不静默放行）。
const YAVG_RE = /YAVG=([0-9]+(?:\.[0-9]+)?)/g;
export function parseTailYavg(text) {
  const matches = [...`${text}`.matchAll(YAVG_RE)];
  if (matches.length === 0) return null;
  return Number(matches[matches.length - 1][1]);
}
export function isBlackTail(yavg, threshold = 16) {
  return yavg !== null && yavg <= threshold;
}

// G6：manifest.aspects[aspect].media 逐镜头证据（修订文档 §3 数据流行 5/6）。
export function buildManifestMedia(entries, timeline, fps) {
  return entries.map((entry) => ({
    shotIndex: entry.shotIndex,
    versionId: entry.versionId,
    mediaAssetId: entry.media.mediaAssetId,
    storeKey: entry.asset.storeKey,
    sha256: entry.asset.sha256,
    inMs: entry.media.inMs,
    outMs: entry.media.outMs,
    trimBefore: mediaTrimBefore(entry.media.inMs, fps),
    frames: timeline.shots[entry.shotIndex].frames,
    audio: entry.media.audio,
  }));
}

// G7：RenderRecord.assetDigests（T1 契约字段，T4 首个写入方）。
export function buildShotAssetDigests(entry) {
  return { [entry.media.mediaAssetId]: entry.asset.sha256 };
}
