// P2.5-T3 第七族（媒体镜头）编辑纯逻辑（spec §2.3 M 表）：草稿/行内校验/软预警。
// 产物是 ContentVersion 级 mediaClip patch（非 spec params），与六族不同类；
// 非法 {patch:null,error} 不清文档（沿转场 C1 语义）。
import type { MediaAsset, SceneSource } from "@acs/video-document";
import { speechAwareDurationMs } from "./planner";

export const MEDIA_TEMPLATE_ID = "media-clip";
export const MEDIA_TEMPLATE_LABEL = "媒体镜头（选素材设入出点）";

// M6：组件模板下拉的受控 value——工作版本已是 media-clip 且未选换装模板时，
// 下拉默认停在本族条目（媒体↔spec 换装的入口恒可见恒可撤，终评 F1）。
export function mediaTemplateSelectValue(
  pendingTemplateId: string,
  mediaSourcePresent: boolean,
): string {
  return pendingTemplateId === "" && mediaSourcePresent
    ? MEDIA_TEMPLATE_ID
    : pendingTemplateId;
}

const INTEGER_TEXT = /^[0-9]+$/;

export type MediaEditDraft = {
  assetId: string;
  inMsText: string;
  outMsText: string;
  fit: "cover" | "contain";
  focalPercentText: string;
  audio: "mute" | "keep";
};

// P2.5-T5：素材直接落成媒体镜头时的默认草稿（stock 导入共用最小默认值）。
// N6：种子出点按旁白语速需求取 max(2000, 400+300×字)（素材够长时）——
// 固定 2000 会给长旁白镜头埋下「出片期才爆旁白溢出」的远距离失败。
export function mediaDraftForAsset(
  asset: MediaAsset,
  narrationText?: string,
): MediaEditDraft {
  const narrationMs =
    narrationText === undefined
      ? 2000
      : speechAwareDurationMs(2000, narrationText);
  return {
    assetId: asset.assetId,
    inMsText: "0",
    outMsText: String(
      Math.min(Math.max(2000, narrationMs), asset.original.durationMs),
    ),
    fit: "cover",
    focalPercentText: "50",
    audio: "mute",
  };
}

export function draftMediaFromVersion(
  working:
    | { sceneSource: SceneSource; durationMs: number; narrationText?: string }
    | undefined,
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
    draft: mediaDraftForAsset(first, working?.narrationText),
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
  // 终评 Important：素材无音轨时 keep 无意义——行内拒，避免存进文档后才在
  // 出片阶段大声失败（静默丢原声的旧路径已由渲染期 G1 兜底）。
  if (draft.audio === "keep" && !asset.original.hasAudio) {
    return {
      patch: null,
      error: `素材无音轨，无法保留原声：${draft.assetId}（请改选「静音」或更换素材）`,
      warnings: [],
    };
  }
  const warnings: string[] = [];
  // M4 非整帧（fps=29.97 时为浮点近似，预警非阻塞，T4 兑现取整语义）
  const fps = asset.original.fps;
  if ((inMs * fps) % 1000 !== 0 || (outMs * fps) % 1000 !== 0) {
    warnings.push(`入/出点非整帧（素材 ${fps}fps），出片将按帧取整`);
  }
  // M5→N6 语速溢出：从预警升级为应用时错误——非阻断版本会把「片段装不下
  // 旁白」拖到出片期 500（绑定动作离反馈太远，混合样片实测）。素材够长
  // 时扩出点即可；不够长则精简旁白。种子出点已按预算扩（mediaDraftForAsset）。
  const spanMs = outMs - inMs;
  const neededMs = speechAwareDurationMs(spanMs, narrationText);
  if (neededMs > spanMs) {
    const headroom = asset.original.durationMs - inMs;
    return {
      patch: null,
      error:
        headroom >= neededMs
          ? `旁白按语速需 ${(neededMs / 1000).toFixed(1)}s，超出片段 ${(spanMs / 1000).toFixed(1)}s：请把出点扩到 ≥${inMs + neededMs}ms（素材最长 ${asset.original.durationMs}ms）`
          : `旁白按语速需 ${(neededMs / 1000).toFixed(1)}s，素材剩余仅 ${(headroom / 1000).toFixed(1)}s：请精简旁白或换更长的素材`,
      warnings: [],
    };
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
