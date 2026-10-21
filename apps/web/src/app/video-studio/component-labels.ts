// 组件 id → 用户可读文案（镜头说明/落库描述共用）。
// 未知 id 原样返回：宁可露出 id，也不编一个不存在的组件名。
const COMPONENT_LABEL: Record<string, string> = {
  "text-animation": "文字",
  "line-drawing": "线描",
  "basic-shapes": "图形",
};

export function componentLabel(componentId: string): string {
  return COMPONENT_LABEL[componentId] ?? componentId;
}
