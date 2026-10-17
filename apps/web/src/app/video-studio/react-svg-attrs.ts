// SvgNode.attrs 用 SVG 原生 kebab-case（render-scene 的字符串序列化路径
// 依赖它），React createElement 只认驼峰。这层适配只做属性名转换，
// 值与顺序原样透传。
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
