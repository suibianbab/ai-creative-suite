#!/usr/bin/env node
// P2.5-T4（spec §1 B1）媒体镜头出片的素材托管服务。Remotion OffthreadVideo
// 的资产下载链 readFile→getClient 只认 http(s)（file:// 抛 Can only download
// URLs starting with http://，与 D2 旁白探针同结论）——原始素材必须本地 HTTP
// 托管。与 narration-server.mjs 同骨架，三处媒体特化：
//   ① 形状门 + 白名单双闸（storeKey regex + original/<storeKey> 精确串）；
//   ② Content-Type 按后缀（Remotion 下载器按 contentType 推导资产文件名后缀）；
//   ③ statSync + createReadStream 流式（original 可达数百 MB，不整读内存）。
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { parseArgs } from "node:util";

const STORE_KEY_PATTERN = /^[0-9a-f]{16}\.(mp4|webm|mov)$/;
const CONTENT_TYPES = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    files: { type: "string" }, // 逗号分隔 storeKey 白名单
  },
});
if (!values.root || !values.files) {
  console.error(
    "用法: node scripts/video/media-server.mjs --root <媒体仓根> --files <storeKey,storeKey,…>",
  );
  process.exit(1);
}
const allowed = new Set(
  values.files
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean),
);

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  // spec S2：Remotion 只发整 GET；不提供 Range 语义，也不给 POST/HEAD 返回全量。
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" }).end("405 Method Not Allowed");
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(
      new URL(req.url, "http://127.0.0.1").pathname,
    );
  } catch {
    res.writeHead(400).end("400 Bad Request"); // 畸形百分号序列，不落 fs
    return;
  }
  // 期望形状 /original/<storeKey>：先形状门再白名单再 fs，任何不匹配一律 404
  // （不区分「不存在/不合法/不在名单」，不给探测方泄露仓结构）。
  const member = pathname.replace(/^\/+/, "");
  const storeKey = member.startsWith("original/")
    ? member.slice("original/".length)
    : null;
  if (
    !storeKey ||
    !STORE_KEY_PATTERN.test(storeKey) ||
    !allowed.has(storeKey)
  ) {
    res.writeHead(404).end("404 Not Found");
    return;
  }
  const file = path.join(values.root, "original", storeKey);
  if (!existsSync(file)) {
    res.writeHead(404).end("404 Not Found");
    return;
  }
  res.writeHead(200, {
    "Content-Type":
      CONTENT_TYPES[path.extname(storeKey)] ?? "application/octet-stream",
    "Content-Length": statSync(file).size,
    "Accept-Ranges": "none",
  });
  // 中断安全（2026-10-28 渲染死因修复）：Chrome 155+ 的 compositor 取帧会
  // 中途放弃下载连接——未接 error 的读流会以未捕获事件击杀整个服务进程，
  // 之后所有帧提取 ECONNREFUSED、渲染以 delayRender 超时收场。放弃是正常
  // 客户端行为：双向 destroy，服务进程必须活着服务下一次请求。
  const stream = createReadStream(file);
  stream.on("error", () => {
    stream.destroy();
    res.destroy();
  });
  res.on("close", () => stream.destroy());
  stream.pipe(res);
});
server.listen(0, "127.0.0.1", () => {
  process.stdout.write(`${JSON.stringify({ port: server.address().port })}\n`);
});
