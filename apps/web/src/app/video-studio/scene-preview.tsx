"use client";

import {
  defaultRegistry,
  type SceneSpec,
  type SvgNode,
  seededRandom,
  validateSceneSpec,
} from "@acs/video-scene";
import { createElement, useEffect, useMemo, useRef, useState } from "react";

// SvgNode 数据树 → React 元素（自 remotion-engine 同名渲染器复制，web 不依赖
// remotion-engine；属性原样透传，text 与 children 二选一）。
export function SvgTree({ node }: { node: SvgNode }) {
  const children =
    node.text ??
    node.children?.map((child, index) => <SvgTree key={index} node={child} />);
  return createElement(node.tag, node.attrs, children);
}

const FPS = 30;
const PREVIEW_WIDTH = 640;
const PREVIEW_HEIGHT = 360;

// 帧预览：rAF 只驱动预览时钟（performance.now 算 dt → 推进帧号），
// 组件本身仍然只吃 frame——与渲染路径同一份 (spec, ctx) 契约。
export function ScenePreview({ spec }: { spec: SceneSpec }) {
  const validated = useMemo(
    () => validateSceneSpec(spec, defaultRegistry),
    [spec],
  );
  const component = defaultRegistry.get(
    validated.componentId,
    validated.componentVersion,
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
  const node = component.render(validated, {
    frame: clampedFrame,
    fps: FPS,
    durationFrames,
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    random: seededRandom(validated.seed),
  });

  return (
    <div className="preview-box">
      <svg
        className="preview-canvas"
        width={PREVIEW_WIDTH}
        height={PREVIEW_HEIGHT}
        viewBox={`0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <SvgTree node={node} />
      </svg>
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
