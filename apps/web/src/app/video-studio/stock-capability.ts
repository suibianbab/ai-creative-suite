// P2.5-T5 复核：在线素材源只在本地开发环境开放。UI 与两条 stock 路由共用这一
// 个开关，避免正式环境渲染出点了只会 503 的死入口。纯函数，可被客户端组件导入。
export function isStockSourceEnabled(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  return nodeEnv === "development";
}
