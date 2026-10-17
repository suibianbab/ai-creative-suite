import {
  assertNodeBudget,
  defaultRegistry,
  reactSvgAttrs,
  type SceneSpec,
  type SvgNode,
  seededRandom,
  validateSceneSpec,
} from "@acs/video-scene";
import { createElement, type FC, type JSX } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import "./assets/fonts/font.css";

// SvgNode 数据树 → React 元素。组件输出的是纯数据（@acs/video-scene 不依赖 React），
// 这里做一次性桥接：属性名经 reactSvgAttrs 转 React 驼峰（与 web 预览桥共用同一份
// 转换），text 与 children 二选一。
export function SvgTree({ node }: { node: SvgNode }): JSX.Element {
  const children =
    node.text ??
    node.children?.map((child, index) => <SvgTree key={index} node={child} />);
  return createElement(node.tag, reactSvgAttrs(node.attrs), children);
}

export type SceneSpecProps = { spec?: SceneSpec };

// 单镜头渲染核心（SceneSpecScene 与 TimelineScene 共用）：validate → render →
// 节点预算门禁 → SVG 画布层。帧上下文完全由调用方给定（ADR 0003 §2），
// 随机只来自 seededRandom(spec.seed)，组件保持纯函数。
export function renderSpecLayer(
  spec: SceneSpec,
  context: {
    frame: number;
    fps: number;
    durationFrames: number;
    width: number;
    height: number;
  },
): JSX.Element {
  const validated = validateSceneSpec(spec, defaultRegistry);
  const component = defaultRegistry.get(
    validated.componentId,
    validated.componentVersion,
  );
  const node = component.render(validated, {
    frame: context.frame,
    fps: context.fps,
    durationFrames: context.durationFrames,
    width: context.width,
    height: context.height,
    random: seededRandom(validated.seed),
  });
  assertNodeBudget(node); // ADR 0003 §2.4：出站元素数上限，超限拒绝渲染
  return (
    <AbsoluteFill
      style={{
        backgroundColor: validated.background,
        fontFamily: '"NotoSansSC", sans-serif',
      }}
    >
      {/* SvgNode 根是 <g>，必须是 <svg> 的子元素才合法，这里补画布层 */}
      <svg
        width={context.width}
        height={context.height}
        viewBox={`0 0 ${context.width} ${context.height}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <SvgTree node={node} />
      </svg>
    </AbsoluteFill>
  );
}

// 通用 SceneSpec 合成（ADR 0003 §2）：单镜头整段合成。
export const SceneSpecScene: FC<SceneSpecProps> = ({ spec }) => {
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();
  if (!spec) return null; // Studio 空预览；出片总经 --props 注入
  return renderSpecLayer(spec, {
    frame,
    fps,
    durationFrames: durationInFrames,
    width,
    height,
  });
};

// —— P1 Timeline 多镜头合成：全局帧 → (镜头, 本地帧) → 复用单镜头渲染核心 ——
// spans 必须连续无缝（quantizeTimeline 产物天然如此）：有缝/重叠/悬空帧都是
// 编排错误，当场抛错拒绝渲染，不产静默空帧的整片（评审关注 #5）。
export type TimelineShotProps = {
  spec: SceneSpec;
  startFrame: number;
  frames: number;
};

export type TimelineProps = { shots?: TimelineShotProps[] };

export const TimelineScene: FC<TimelineProps> = ({ shots }) => {
  const { fps, width, height } = useVideoConfig();
  const frame = useCurrentFrame();
  if (!shots || shots.length === 0) return null; // Studio 空预览
  for (let index = 1; index < shots.length; index += 1) {
    const prev = shots[index - 1]!;
    const cur = shots[index]!;
    if (cur.startFrame !== prev.startFrame + prev.frames) {
      throw new Error(
        `Timeline 第 ${index + 1} 个镜头 startFrame=${cur.startFrame} 与前镜头末帧 ${prev.startFrame + prev.frames} 不衔接：spans 必须连续无缝`,
      );
    }
  }
  const active = shots.find(
    (shot) => frame >= shot.startFrame && frame < shot.startFrame + shot.frames,
  );
  if (!active) {
    throw new Error(`Timeline 第 ${frame} 帧不属任何镜头（总帧数之外？）`);
  }
  return renderSpecLayer(active.spec, {
    frame: frame - active.startFrame,
    fps,
    durationFrames: active.frames,
    width,
    height,
  });
};
