// P2.6-T5 终评：同源闸改比 Host 头。dev 脚本以 `--hostname 0.0.0.0` 启动，
// Next 会把 request.url 建成 http://0.0.0.0:<port>，而浏览器从 localhost 发起、
// Origin 为 http://localhost:<port>——拿 request.url 的 origin 去比会把文档化的
// 开发流程全部 403。Host 头与 Origin.host 才是同源判定的正确依据。
export function isSameOriginRequest(request: Request): boolean {
  const originHeader = request.headers.get("origin");
  // 非浏览器调用方（curl、服务端脚本）不带 Origin：维持既有放行行为。
  if (originHeader === null) return true;

  let origin: URL;
  try {
    origin = new URL(originHeader);
  } catch {
    return false;
  }
  // 只接受 http/https：`file:`、`null`（沙箱 iframe）等一律视为跨站。
  if (origin.protocol !== "http:" && origin.protocol !== "https:") return false;

  const host = request.headers.get("host");
  if (host === null || origin.host !== host) return false;

  // 反向代理场景以 x-forwarded-proto 的首个 token 为准，否则回落到请求 URL。
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const expectedProtocol =
    forwardedProto !== null
      ? `${forwardedProto.split(",")[0]?.trim()}:`
      : new URL(request.url).protocol;
  return origin.protocol === expectedProtocol;
}
