// P2.5-T3 第七族（媒体镜头）编辑纯逻辑（spec §2.3 M 表）：草稿/行内校验/软预警。
// 产物是 ContentVersion 级 mediaClip patch（非 spec params），与六族不同类；
// 非法 {patch:null,error} 不清文档（沿转场 C1 语义）。
import type { MediaAsset, SceneSource } from "@acs/video-document";
import { speechAwareDurationMs } from "./planner";

export const MEDIA_TEMPLATE_ID = "media-clip";
export const MEDIA_TEMPLATE_LABEL = "媒体镜头（选素材设入出点）";

const INTEGER_TEXT = /^[0-9]+$/;

export type MediaEditDraft = {
  assetId: string;
  inMsText: string;
  outMsText: string;
  fit: "cover" | "contain";
  focalPercentText: string;
  audio: "mute" | "keep";
};

export function draftMediaFromVersion(
  working: { sceneSource: SceneSource; durationMs: number } | undefined,
  assets: MediaAsset[],
): { draft: MediaEditDraft | null; error: string | null } {
  if (working && working.sceneSource.type === "media-clip") {
    const media = working.sceneSource;
    return {
      draft: {
        assetId: media.mediaAssetId,
        inMsText: String(media.inMs),
        outMsText: String(media.outMs),
        fit: media.fit,
        focalPercentText: String(Math.round(media.focalX * 100)),
        audio: media.audio,
      },
      error: null,
    };
  }
  const first = assets[0];
  if (!first) {
    return { draft: null, error: "项目尚无媒体素材，请先在素材面板上传" };
  }
  return {
    draft: {
      assetId: first.assetId,
      inMsText: "0",
      outMsText: String(Math.min(2000, first.original.durationMs)),
      fit: "cover",
      focalPercentText: "50",
      audio: "mute",
    },
    error: null,
  };
}

export function buildMediaRevisePatch(
  draft: MediaEditDraft,
  assets: MediaAsset[],
  narrationText: string,
): {
  patch: {
    narrationText: string;
    mediaClip: {
      mediaAssetId: string;
      inMs: number;
      outMs: number;
      fit: "cover" | "contain";
      focalX: number;
      audio: "mute" | "keep";
    };
  } | null;
  error: string | null;
  warnings: string[];
} {
  const asset = assets.find((a) => a.assetId === draft.assetId);
  if (!asset) {
    return {
      patch: null,
      error: `素材不存在或已移除：${draft.assetId}`,
      warnings: [],
    };
  }
  if (!INTEGER_TEXT.test(draft.inMsText)) {
    return { patch: null, error: "入点须为 ≥0 的整数毫秒", warnings: [] };
  }
  if (!INTEGER_TEXT.test(draft.outMsText)) {
    return { patch: null, error: "出点须为 ≥0 的整数毫秒", warnings: [] };
  }
  const inMs = Number(draft.inMsText);
  const outMs = Number(draft.outMsText);
  if (inMs < 0) {
    return { patch: null, error: "入点须为 ≥0 的整数毫秒", warnings: [] };
  }
  if (outMs < inMs + 200 || outMs > asset.original.durationMs) {
    return {
      patch: null,
      error: `出点越界：须满足 入点+200 ≤ 出点 ≤ 素材时长 ${asset.original.durationMs}ms（当前 入=${inMs} 出=${outMs}）`,
      warnings: [],
    };
  }
  if (!INTEGER_TEXT.test(draft.focalPercentText)) {
    return { patch: null, error: "focal 百分比须为 0..100 整数", warnings: [] };
  }
  const focalPercent = Number(draft.focalPercentText);
  if (focalPercent < 0 || focalPercent > 100) {
    return { patch: null, error: "focal 百分比须为 0..100 整数", warnings: [] };
  }
  if (draft.fit !== "cover" && draft.fit !== "contain") {
    return { patch: null, error: "fit 须为 cover 或 contain", warnings: [] };
  }
  if (draft.audio !== "mute" && draft.audio !== "keep") {
    return { patch: null, error: "audio 须为 mute 或 keep", warnings: [] };
  }
  const warnings: string[] = [];
  // M4 非整帧（fps=29.97 时为浮点近似，预警非阻塞，T4 兑现取整语义）
  const fps = asset.original.fps;
  if ((inMs * fps) % 1000 !== 0 || (outMs * fps) % 1000 !== 0) {
    warnings.push(`入/出点非整帧（素材 ${fps}fps），出片将按帧取整`);
  }
  // M5 语速溢出（与 shot-edit 同一速度模型；对齐语义归 T4，不自动改时长）
  const spanMs = outMs - inMs;
  const neededMs = speechAwareDurationMs(spanMs, narrationText);
  if (neededMs > spanMs) {
    warnings.push(
      `旁白按语速需 ${(neededMs / 1000).toFixed(1)}s，超出片段 ${(spanMs / 1000).toFixed(1)}s`,
    );
  }
  return {
    patch: {
      narrationText,
      mediaClip: {
        mediaAssetId: draft.assetId,
        inMs,
        outMs,
        fit: draft.fit,
        focalX: focalPercent / 100,
        audio: draft.audio,
      },
    },
    error: null,
    warnings,
  };
}
