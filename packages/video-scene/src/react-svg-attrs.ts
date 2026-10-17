// SvgNode.attrs 用 SVG 原生 kebab-case（字符串序列化路径依赖），React
// createElement 只认驼峰。两座 SvgTree 桥（apps/web 预览、remotion-engine
// 合成）共用这一份转换，避免各平台属性名适配漂移。只转换属性名，值原样透传。
export function reactSvgAttrs(
  attrs: Record<string, string | number>,
): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(attrs)) {
    result[
      key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
    ] = value;
  }
  return result;
}
