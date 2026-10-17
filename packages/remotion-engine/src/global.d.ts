// webpack 侧（Remotion）支持 css/字体资源导入；这里只补 TS 侧的模块声明。
declare module "*.css" {
  const content: string;
  export default content;
}

declare module "*.woff" {
  const url: string;
  export default url;
}

declare module "*.woff2" {
  const url: string;
  export default url;
}
