"use client";

import {
  activeSubtitleCue,
  buildSubtitleCues,
  mapGlobalFrame,
  type QuantizedTimeline,
} from "@acs/video-document";
import {
  assertNodeBudget,
  defaultRegistry,
  reactSvgAttrs,
  type SceneSpec,
  type SvgNode,
  seededRandom,
  validateSceneSpec,
} from "@acs/video-scene";
import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { advanceGlobalFrame, shotCanvasContext } from "./piece-preview";

// SvgNode 数据树 → React 元素（自 remotion-engine 同名渲染器复制，web 不依赖
// remotion-engine；属性名经 reactSvgAttrs 转 React 驏峰，text 与 children 二选一）。
export function SvgTree({ node }: { node: SvgNode }) {
  const children =
    node.text ??
    node.children?.map((child, index) => <SvgTree key={index} node={child} />);
  return createElement(node.tag, reactSvgAttrs(node.attrs), children);
}

const FPS = 30;
const PIECE_FPS = 24; // 整片预览与出片同帧率（量化 spans 即 24fps 帧图）
const PREVIEW_WIDTH = 640;
const PREVIEW_HEIGHT = 360;

// 静态帧画布：validate → render → 节点预算 → SVG。单镜头预览与整片预览共用。
// fps/durationFrames 可覆盖：整片预览必须传 24fps + 量化 span 帧数（与出片一致），
// 单镜头预览沿用 P0 默认 30fps（另行收口）。
export function SpecCanvas({
  spec,
  frame,
  width = PREVIEW_WIDTH,
  height = PREVIEW_HEIGHT,
  fps = FPS,
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

// 帧预览：rAF 只驱动预览时钟（performance.now 算 dt → 推进帧号），
// 组件本身仍然只吃 frame——与渲染路径同一份 (spec, ctx) 契约。
export function ScenePreview({ spec }: { spec: SceneSpec }) {
  const validated = useMemo(
    () => validateSceneSpec(spec, defaultRegistry),
    [spec],
  );
  const durationFrames = Math.ceil((validated.durationMs / 1000) * FPS);
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
        const next = current + (deltaMs / 1000) * FPS;
        return next >= durationFrames ? 0 : next; // 预览循环播放
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, durationFrames]);

  const clampedFrame = Math.min(frame, durationFrames - 1);

  return (
    <div className="preview-box">
      <SpecCanvas spec={spec} frame={clampedFrame} />
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
      </div>
    </div>
  );
}

// —— P1 整片预览：rAF 驱动全局帧（24fps 帧图）→ mapGlobalFrame → 镜头本地帧 ——
export type TimelinePreviewItem = {
  spec: SceneSpec;
  startFrame: number;
  frames: number;
  // 字幕近似层（spec R3 预览侧）：无字级时间戳，均匀分布；出片走精确时间戳。
  narrationText?: string;
};

export function TimelinePreview({
  items,
  timeline,
}: {
  items: TimelinePreviewItem[];
  timeline: QuantizedTimeline;
}) {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);
  const totalFrames = timeline.totalFrames;

  useEffect(() => {
    if (!playing) return;
    lastTsRef.current = performance.now();
    const tick = (timestamp: number) => {
      const deltaMs = timestamp - lastTsRef.current;
      lastTsRef.current = timestamp;
      setFrame((current) =>
        advanceGlobalFrame(current, (deltaMs / 1000) * PIECE_FPS, totalFrames),
      );
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, totalFrames]);

  const mapping = mapGlobalFrame(timeline, Math.floor(frame));
  const active = items[mapping.shotIndex];
  // 与出片同口径：24fps + 量化 span 帧数（不能用 30fps/ceil 重算，见 shotCanvasContext）
  const activeContext = active
    ? shotCanvasContext({
        durationMs: active.spec.durationMs,
        frames: active.frames,
      })
    : null;
  // 字幕近似层：预览无字级时间戳，按 span 均匀分布（spec R3 近似路径）。
  const activeCue = useMemo(() => {
    if (!active?.narrationText) return undefined;
    const cues = buildSubtitleCues({
      narrationText: active.narrationText,
      spanMs: active.spec.durationMs,
    });
    return activeSubtitleCue(cues, (mapping.localFrame / PIECE_FPS) * 1000);
  }, [active, mapping.localFrame]);

  return (
    <div className="preview-box piece-preview">
      <div className="piece-stage">
        {active && activeContext ? (
          <SpecCanvas
            key={mapping.shotIndex}
            spec={active.spec}
            frame={mapping.localFrame}
            fps={activeContext.fps}
            durationFrames={activeContext.durationFrames}
          />
        ) : null}
        {activeCue ? (
          <div className="preview-subtitle" aria-hidden="true">
            <span>{activeCue.text}</span>
          </div>
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
        {items.some((item) => item.narrationText) ? (
          <span className="preview-subtitle-note">
            预览近似，出片按字级时间戳
          </span>
        ) : null}
      </div>
    </div>
  );
}
