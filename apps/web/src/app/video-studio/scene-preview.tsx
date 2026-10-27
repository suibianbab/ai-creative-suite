"use client";

import {
  type AspectTarget,
  activeSubtitleCue,
  buildSubtitleCues,
  EXPORT_DIMENSIONS,
  EXPORT_FPS,
  type MediaAsset,
  mapGlobalFrame,
  type QuantizedTimeline,
  type ShotTransition,
  type ThreeSceneSpec,
  transitionOverlayAt,
} from "@acs/video-document";
import {
  assertNodeBudget,
  defaultRegistry,
  reactSvgAttrs,
  type SceneSpec,
  type SvgNode,
  safeFrameRect,
  seededRandom,
  validateSceneSpec,
} from "@acs/video-scene";
import {
  type CSSProperties,
  createElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { mediaSrcUrl } from "./media-assets";
import {
  mediaClipCss,
  mediaSeekTargetSec,
  shouldSeekVideo,
} from "./media-preview";
import {
  advanceGlobalFrame,
  shotCanvasContext,
  singleShotSpanFrames,
} from "./piece-preview";
import { previewTransitionWindows } from "./transitions-draft";

// SvgNode 数据树 → React 元素（自 remotion-engine 同名渲染器复制，web 不依赖
// remotion-engine；属性名经 reactSvgAttrs 转 React 驏峰，text 与 children 二选一）。
export function SvgTree({ node }: { node: SvgNode }) {
  const children =
    node.text ??
    node.children?.map((child, index) => <SvgTree key={index} node={child} />);
  return createElement(node.tag, reactSvgAttrs(node.attrs), children);
}

// 双画幅预览（2026-10-23 brief §三A）：预览画布坐标与出片一致
// （EXPORT_DIMENSIONS 的 1280×720 / 720×1280，24fps），显示尺寸只由 CSS 缩放。
const [LANDSCAPE_W, LANDSCAPE_H] = EXPORT_DIMENSIONS.landscape;

// 静态帧画布：validate → render → 节点预算 → SVG。单镜头预览与整片预览共用。
// fps/durationFrames 可覆盖：单镜与整片预览都必须传 24fps + 量化 span 帧数
// （与出片一致）；默认值即横版出片坐标。
export function SpecCanvas({
  spec,
  frame,
  width = LANDSCAPE_W,
  height = LANDSCAPE_H,
  fps = EXPORT_FPS,
  durationFrames,
}: {
  spec: SceneSpec;
  frame: number;
  width?: number;
  height?: number;
  fps?: number;
  durationFrames?: number;
}) {
  const validated = useMemo(
    () => validateSceneSpec(spec, defaultRegistry),
    [spec],
  );
  const component = defaultRegistry.get(
    validated.componentId,
    validated.componentVersion,
  );
  const spanFrames =
    durationFrames ?? Math.ceil((validated.durationMs / 1000) * fps);
  const clampedFrame = Math.min(Math.max(frame, 0), spanFrames - 1);
  const node = component.render(validated, {
    frame: clampedFrame,
    fps,
    durationFrames: spanFrames,
    width,
    height,
    random: seededRandom(validated.seed),
  });
  assertNodeBudget(node); // 与渲染桥同一出站上限（ADR 0003 §2.4）
  return (
    <svg
      className="preview-canvas"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <SvgTree node={node} />
    </svg>
  );
}

// 画幅切换 + 安全区辅助线开关（brief §三A）：仅存在于预览 DOM，
// 永不进入导出路径（渲染 CLI 不经过这些组件）。
function PreviewAspectControls({
  aspect,
  onAspectChange,
  showSafeGuide,
  onSafeGuideChange,
}: {
  aspect: AspectTarget;
  onAspectChange: (aspect: AspectTarget) => void;
  showSafeGuide: boolean;
  onSafeGuideChange: (show: boolean) => void;
}) {
  return (
    <span className="preview-aspect-controls">
      <button
        type="button"
        className={`preview-aspect-toggle${aspect === "landscape" ? " is-active" : ""}`}
        aria-pressed={aspect === "landscape"}
        onClick={() => onAspectChange("landscape")}
      >
        横版
      </button>
      <button
        type="button"
        className={`preview-aspect-toggle${aspect === "portrait" ? " is-active" : ""}`}
        aria-pressed={aspect === "portrait"}
        onClick={() => onAspectChange("portrait")}
      >
        竖版
      </button>
      <label className="safe-guide-toggle">
        <input
          type="checkbox"
          checked={showSafeGuide}
          onChange={(event) => onSafeGuideChange(event.target.checked)}
        />
        安全区
      </label>
    </span>
  );
}

// 安全区辅助线：与组件布局同一 10% 口径（safeFrameRect），按画布比例换算成
// 百分比定位——显示缩放不影响其与内容的相对关系。仅预览检查用。
function SafeGuideOverlay({
  width,
  height,
}: {
  width: number;
  height: number;
}) {
  const rect = safeFrameRect(width, height);
  return (
    <div
      className="safe-guide"
      aria-hidden="true"
      style={{
        left: `${(rect.x / width) * 100}%`,
        top: `${(rect.y / height) * 100}%`,
        width: `${(rect.width / width) * 100}%`,
        height: `${(rect.height / height) * 100}%`,
      }}
    >
      <span className="safe-guide-label">安全区（仅预览）</span>
    </div>
  );
}

// 出片画布尺寸（aspect → width/height），供舞台包裹与 SpecCanvas/MediaStage。
function stageDimensions(aspect: AspectTarget) {
  const [width, height] = EXPORT_DIMENSIONS[aspect];
  return { width, height };
}

// 预览舞台：宽度显式 min(100%, 72vh×宽高比)（竖版限高、横版满列），
// 高度由 aspect-ratio 推导——不依赖 grid 拉伸（.piece-stage 带
// container-type:inline-size，auto 边距下 fit-content 会塌成 0）。
function stageStyle(aspect: AspectTarget) {
  const { width, height } = stageDimensions(aspect);
  const ratio = (width / height).toFixed(4);
  return {
    aspectRatio: `${width} / ${height}`,
    width: `min(100%, calc(72vh * ${ratio}))`,
  } as CSSProperties;
}

// 帧预览：rAF 只驱动预览时钟（performance.now 算 dt → 推进帧号），
// 组件本身仍然只吃 frame——与渲染路径同一份 (spec, ctx) 契约。
// 24fps + 量化帧数与出片同口径（singleShotSpanFrames）。
export function ScenePreview({ spec }: { spec: SceneSpec }) {
  const [aspect, setAspect] = useState<AspectTarget>("landscape");
  const [showSafeGuide, setShowSafeGuide] = useState(false);
  const validated = useMemo(
    () => validateSceneSpec(spec, defaultRegistry),
    [spec],
  );
  const durationFrames = singleShotSpanFrames(validated.durationMs);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);

  useEffect(() => {
    if (!playing) return;
    lastTsRef.current = performance.now();
    const tick = (timestamp: number) => {
      const deltaMs = timestamp - lastTsRef.current;
      lastTsRef.current = timestamp;
      setFrame((current) => {
        const next = current + (deltaMs / 1000) * EXPORT_FPS;
        return next >= durationFrames ? 0 : next; // 预览循环播放
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, durationFrames]);

  const clampedFrame = Math.min(frame, durationFrames - 1);
  const stage = stageDimensions(aspect);

  return (
    <div className="preview-box">
      <div className="piece-stage" style={stageStyle(aspect)}>
        <SpecCanvas
          spec={spec}
          frame={clampedFrame}
          width={stage.width}
          height={stage.height}
          fps={EXPORT_FPS}
          durationFrames={durationFrames}
        />
        {showSafeGuide ? (
          <SafeGuideOverlay width={stage.width} height={stage.height} />
        ) : null}
      </div>
      <div className="preview-controls">
        <button
          type="button"
          className="preview-toggle"
          onClick={() => setPlaying((value) => !value)}
        >
          {playing ? "暂停" : "播放"}
        </button>
        <input
          className="preview-slider"
          type="range"
          min={0}
          max={durationFrames - 1}
          step={1}
          value={Math.floor(clampedFrame)}
          onChange={(event) => {
            setPlaying(false);
            setFrame(Number(event.target.value));
          }}
        />
        <span className="preview-frame">
          第 {Math.floor(clampedFrame) + 1} / {durationFrames} 帧
        </span>
        <PreviewAspectControls
          aspect={aspect}
          onAspectChange={setAspect}
          showSafeGuide={showSafeGuide}
          onSafeGuideChange={setShowSafeGuide}
        />
      </div>
    </div>
  );
}

// —— P1 整片预览：rAF 驱动全局帧（24fps 帧图）→ mapGlobalFrame → 镜头本地帧 ——
// P2.5-T3（spec §2.4 P1）：扩联合识媒体镜头。既有 spec 项不带 kind 字段、
// 形状逐字节不变（判别用没有 kind）；media/three/missing 项带 kind。
export type TimelinePreviewItem =
  | {
      spec: SceneSpec;
      startFrame: number;
      frames: number;
      // 字幕近似层（spec R3 预览侧）：无字级时间戳，均匀分布；出片走精确时间戳。
      narrationText?: string;
    }
  | {
      kind: "media";
      assetId: string;
      inMs: number;
      outMs: number;
      fit: "cover" | "contain";
      focalX: number;
      startFrame: number;
      frames: number;
      narrationText?: string;
    }
  | {
      kind: "missing";
      reason: string;
      startFrame: number;
      frames: number;
    }
  | {
      kind: "three";
      spec: ThreeSceneSpec;
      startFrame: number;
      frames: number;
    };

const threeFrameCache = new Map<string, string>();
const threeFramePending = new Map<string, Promise<string>>();

function ThreeStage({
  item,
  aspect,
}: {
  item: Extract<TimelinePreviewItem, { kind: "three" }>;
  aspect: AspectTarget;
}) {
  const representativeFrame = Math.min(
    Math.floor(item.frames / 2),
    Math.ceil((item.spec.durationMs * EXPORT_FPS) / 1000) - 1,
  );
  const key = JSON.stringify([item.spec, aspect, representativeFrame]);
  const [image, setImage] = useState<string | null>(
    () => threeFrameCache.get(key) ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const cached = threeFrameCache.get(key);
    if (cached) {
      setImage(cached);
      setError(null);
      return;
    }
    let live = true;
    setImage(null);
    setError(null);
    let pending = threeFramePending.get(key);
    if (!pending) {
      pending = (async () => {
        const response = await fetch("/api/video/three-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spec: item.spec,
            aspect,
            frameIndex: representativeFrame,
          }),
        });
        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error ?? "3D 代表帧生成失败");
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        const url = `data:image/png;base64,${btoa(binary)}`;
        if (threeFrameCache.size >= 12)
          threeFrameCache.delete(threeFrameCache.keys().next().value!);
        threeFrameCache.set(key, url);
        return url;
      })().finally(() => threeFramePending.delete(key));
      threeFramePending.set(key, pending);
    }
    void pending.then(
      (url) => {
        if (live) setImage(url);
      },
      (cause) => {
        if (live)
          setError(
            cause instanceof Error ? cause.message : "3D 代表帧生成失败",
          );
      },
    );
    return () => {
      live = false;
    };
  }, [key, item.spec, aspect, representativeFrame]);
  if (error)
    return (
      <div className="media-missing" role="alert">
        3D 预览失败：{error}
      </div>
    );
  if (!image)
    return (
      <div className="media-missing" role="status">
        正在生成 3D 代表帧…
      </div>
    );
  return (
    <img
      className="three-preview-image"
      src={image}
      alt={`${aspect === "portrait" ? "竖版" : "横版"} 3D 镜头代表帧`}
      style={{ width: "100%", height: "100%", objectFit: "fill" }}
    />
  );
}

// P2/P3/P4：媒体镜头预览——muted <video> + cover/contain 裁切 + 帧驱动 seek
//（80ms 节流防抖）；文件 404/解码错降级占位，不炸页。音频恒静音：
// 预览本无声，audio:"keep" 是 T4 出片混音语义。
function MediaStage({
  asset,
  item,
  localFrame,
  stageWidth,
  stageHeight,
}: {
  asset: MediaAsset | undefined;
  item: Extract<TimelinePreviewItem, { kind: "media" }>;
  localFrame: number;
  // 舞台 = 出片画布坐标（与 MediaClipLayer 的 useVideoConfig 同源口径），
  // cover 裁切/contain 留边才与导出一致。
  stageWidth: number;
  stageHeight: number;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !asset || failed) return;
    const targetSec = mediaSeekTargetSec(item.inMs, localFrame, EXPORT_FPS);
    if (shouldSeekVideo(video.currentTime, targetSec)) {
      video.currentTime = targetSec;
    }
  }, [localFrame, item.inMs, asset, failed]);
  if (!asset) {
    return (
      <div className="media-missing" role="img" aria-label="素材缺失">
        素材缺失：资产不在账本
      </div>
    );
  }
  if (failed) {
    return (
      <div className="media-missing" role="img" aria-label="素材文件不可用">
        素材缺失：文件无法加载或解码（其余镜头不受影响）
      </div>
    );
  }
  // 任务 1（2026-10-28）：图片资产预览——<img> 同 cover/contain 裁切口径
  //（无 seek/无音轨；出点即展示时长）。缺失/损坏同样降级占位。
  if (asset.original.kind === "image") {
    const css = mediaClipCss(
      asset.original.width,
      asset.original.height,
      stageWidth,
      stageHeight,
      item.fit,
      item.focalX,
    );
    return (
      <img
        className="media-stage"
        src={mediaSrcUrl(asset)}
        style={css}
        alt=""
        onError={() => setFailed(true)}
      />
    );
  }
  const css = mediaClipCss(
    asset.original.width,
    asset.original.height,
    stageWidth,
    stageHeight,
    item.fit,
    item.focalX,
  );
  return (
    <video
      ref={videoRef}
      className="media-stage"
      src={mediaSrcUrl(asset)}
      style={css}
      muted
      playsInline
      preload="metadata"
      onError={() => setFailed(true)}
    />
  );
}

export function TimelinePreview({
  items,
  timeline,
  transitions,
  assets,
}: {
  items: TimelinePreviewItem[];
  timeline: QuantizedTimeline;
  // P1 转场（Feature ④ spec R4）：与出片同一 resolve/overlay helper（A3 双端一致）。
  transitions?: ShotTransition[];
  // P2.5-T3 P1/P4：媒体镜头资产账本（缺失条目走 missing 占位）。
  assets?: MediaAsset[];
}) {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [aspect, setAspect] = useState<AspectTarget>("landscape");
  const [showSafeGuide, setShowSafeGuide] = useState(false);
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);
  const totalFrames = timeline.totalFrames;
  const assetsById = useMemo(
    () => new Map((assets ?? []).map((asset) => [asset.assetId, asset])),
    [assets],
  );

  useEffect(() => {
    if (!playing) return;
    lastTsRef.current = performance.now();
    const tick = (timestamp: number) => {
      const deltaMs = timestamp - lastTsRef.current;
      lastTsRef.current = timestamp;
      setFrame((current) =>
        advanceGlobalFrame(current, (deltaMs / 1000) * EXPORT_FPS, totalFrames),
      );
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, totalFrames]);

  const mapping = mapGlobalFrame(timeline, Math.floor(frame));
  const active = items[mapping.shotIndex];
  // 与出片同口径：24fps + 量化 span 帧数（不能用 30fps/ceil 重算，见 shotCanvasContext）。
  // 仅 spec 项有画布上下文；media/missing 项各自渲染。
  const activeContext =
    active && !("kind" in active)
      ? shotCanvasContext({
          durationMs: active.spec.durationMs,
          frames: active.frames,
        })
      : null;
  // 字幕近似层：预览无字级时间戳，按 span 均匀分布（spec R3 近似路径）。
  // media 镜头也有字幕近似层（span = outMs−inMs）。
  const activeSpanMs =
    active === undefined
      ? 0
      : !("kind" in active)
        ? active.spec.durationMs
        : active.kind === "media"
          ? active.outMs - active.inMs
          : 0;
  const activeNarration =
    active === undefined || !("kind" in active)
      ? active?.narrationText
      : active.kind === "media"
        ? active.narrationText
        : undefined;
  const activeCue = useMemo(() => {
    if (!activeNarration || activeSpanMs <= 0) return undefined;
    const cues = buildSubtitleCues({
      narrationText: activeNarration,
      spanMs: activeSpanMs,
    });
    return activeSubtitleCue(cues, (mapping.localFrame / EXPORT_FPS) * 1000);
  }, [activeNarration, activeSpanMs, mapping.localFrame]);

  // P1 转场：与出片同斜率同 split（共享 helper）；无转场恒 0 不渲染。
  // span 不足/相邻合计借空等装配拒绝在此降级：无叠层 + 告警标记（spec 错误
  // 表：预览告警；CLI 出片路径仍大声失败），不炸整个工作台页面。
  const { windows: transitionWindows, warning: transitionWarning } =
    previewTransitionWindows(transitions, timeline.shots, EXPORT_FPS);
  const overlayOpacity = transitionOverlayAt(
    transitionWindows,
    Math.floor(frame),
  );

  const stage = stageDimensions(aspect);
  // 字幕近似层的比例参数与出片 TimelineScene 同口径：字号 = 画布高 ×
  // 4.5% 换算为 cqw；底距 2.5% 高（P2-2 字幕带下移，避让图表轴标签）。
  // 药丸内边距随字号等比。
  const subtitleCqw = (Math.round(stage.height * 0.045) / stage.width) * 100;
  const stageVars = {
    ...stageStyle(aspect),
    "--stage-h-ratio": `${stage.height / stage.width}`,
    "--sub-cqw": `${subtitleCqw}`,
  } as CSSProperties;

  return (
    <div className="preview-box piece-preview">
      <div className="piece-stage" style={stageVars}>
        {active ? (
          !("kind" in active) ? (
            activeContext ? (
              <SpecCanvas
                key={mapping.shotIndex}
                spec={active.spec}
                frame={mapping.localFrame}
                width={stage.width}
                height={stage.height}
                fps={activeContext.fps}
                durationFrames={activeContext.durationFrames}
              />
            ) : null
          ) : active.kind === "media" ? (
            <MediaStage
              key={mapping.shotIndex}
              asset={assetsById.get(active.assetId)}
              item={active}
              localFrame={mapping.localFrame}
              stageWidth={stage.width}
              stageHeight={stage.height}
            />
          ) : active.kind === "three" ? (
            <ThreeStage key={mapping.shotIndex} item={active} aspect={aspect} />
          ) : (
            <div
              className="media-missing"
              role="img"
              aria-label={active.reason}
            >
              {active.reason}
            </div>
          )
        ) : null}
        {overlayOpacity > 0 ? (
          <div
            className="transition-overlay"
            aria-hidden="true"
            style={{ opacity: overlayOpacity }}
          />
        ) : null}
        {activeCue ? (
          <div className="preview-subtitle" aria-hidden="true">
            <span>{activeCue.text}</span>
          </div>
        ) : null}
        {showSafeGuide ? (
          <SafeGuideOverlay width={stage.width} height={stage.height} />
        ) : null}
      </div>
      {transitionWarning ? (
        <div className="preview-transition-warning" role="alert">
          转场预览已停用：{transitionWarning}
        </div>
      ) : null}
      <div className="preview-controls">
        <button
          type="button"
          className="preview-toggle"
          onClick={() => setPlaying((value) => !value)}
        >
          {playing ? "暂停" : "播放"}
        </button>
        <input
          className="preview-slider"
          type="range"
          min={0}
          max={totalFrames - 1}
          step={1}
          value={Math.min(Math.floor(frame), totalFrames - 1)}
          onChange={(event) => {
            setPlaying(false);
            setFrame(Number(event.target.value));
          }}
        />
        <span className="preview-frame">
          第 {Math.min(Math.floor(frame), totalFrames - 1) + 1} / {totalFrames}{" "}
          帧 · 镜头 {mapping.shotIndex + 1}
        </span>
        <PreviewAspectControls
          aspect={aspect}
          onAspectChange={setAspect}
          showSafeGuide={showSafeGuide}
          onSafeGuideChange={setShowSafeGuide}
        />
        {items.some((item) =>
          !("kind" in item)
            ? item.narrationText !== undefined
            : item.kind === "media" && item.narrationText !== undefined,
        ) ? (
          <span className="preview-subtitle-note">
            预览近似，出片按字级时间戳
          </span>
        ) : null}
        {items.some((item) => "kind" in item && item.kind === "media") ? (
          <span className="preview-subtitle-note">
            媒体镜头为帧驱动预览近似
          </span>
        ) : null}
        {items.some((item) => "kind" in item && item.kind === "three") ? (
          <span className="preview-subtitle-note">
            3D 显示出片同源代表帧；动态请看最终视频
          </span>
        ) : null}
      </div>
    </div>
  );
}
