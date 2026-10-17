// 组件输出纯数据 SVG 树（无 React 依赖）：预览（web）与渲染（remotion）各自把它转成真实 DOM/JSX。
export type SvgNode = {
  tag: string;
  attrs: Record<string, string | number>;
  children?: SvgNode[];
  text?: string;
};
