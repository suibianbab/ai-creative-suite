import {
  defaultRegistry,
  type SceneSpec,
  type SvgNode,
  seededRandom,
  validateSceneSpec,
} from "@acs/video-scene";
import { createElement, type FC, type JSX } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import "./assets/fonts/font.css";

// SvgNode 数据树 → React 元素。组件输出的是纯数据（@acs/video-scene 不依赖 React），
// 这里做一次性桥接：属性原样透传，text 与 children 二选一。
export function SvgTree({ node }: { node: SvgNode }): JSX.Element {
  const children =
    node.text ??
    node.children?.map((child, index) => <SvgTree key={index} node={child} />);
  return createElement(node.tag, node.attrs, children);
}

export type SceneSpecProps = { spec?: SceneSpec };

// 通用 SceneSpec 合成（ADR 0003 §2）：帧上下文完全来自 Remotion + spec，
// 随机只来自 seededRandom(spec.seed)，组件保持纯函数。
export const SceneSpecScene: FC<SceneSpecProps> = ({ spec }) => {
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();
  if (!spec) return null; // Studio 空预览；出片总经 --props 注入
  const validated = validateSceneSpec(spec, defaultRegistry);
  const component = defaultRegistry.get(
    validated.componentId,
    validated.componentVersion,
  );
  const node = component.render(validated, {
    frame,
    fps,
    durationFrames: durationInFrames,
    width,
    height,
    random: seededRandom(validated.seed),
  });
  return (
    <AbsoluteFill
      style={{
        backgroundColor: validated.background,
        fontFamily: '"NotoSansSC", sans-serif',
      }}
    >
      {/* SvgNode 根是 <g>，必须是 <svg> 的子元素才合法，这里补画布层 */}
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <SvgTree node={node} />
      </svg>
    </AbsoluteFill>
  );
};
