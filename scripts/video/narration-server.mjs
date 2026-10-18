#!/usr/bin/env node
// D2 Task4：一次性旁白文件服务（独立进程）。
// render-scene.mjs 的渲染是 spawnSync 同步阻塞——同进程的 http server 事件循环
// 会被冻住（探针实测：TCP 建连但请求永不响应）。所以服务必须活在独立进程里：
//   node narration-server.mjs --dir <narrationDir> --files <a.wav,b.wav>
//   → stdout 一行 {"port":12345}，进程常驻；父进程结束时 kill。
// 纪律：只服务 --files 白名单（防止把目录外文件读出去）；带 CORS 头（渲染页面
// 源是 localhost:3001，本服务是 127.0.0.1:<随机端口>，跨源）。
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { parseArgs } from "node:util";
import { decodePathName } from "./tts-sse.mjs";

const { values } = parseArgs({
  options: {
    dir: { type: "string" },
    files: { type: "string" },
  },
});
if (!values.dir || !values.files) {
  console.error(
    "用法: node narration-server.mjs --dir <dir> --files <a.wav,b.wav>",
  );
  process.exit(1);
}
const allowed = new Set(values.files.split(",").filter(Boolean));
const dir = path.resolve(values.dir);

const server = http.createServer((req, res) => {
  // 畸形 percent-encoding（/%zz）会让 decode 抛 URIError 崩掉整个服务进程
  // （终评 minor#1）——decodePathName 返回 null，回 400 拒掉这次请求。
  const name = decodePathName(new URL(req.url ?? "/", "http://x").pathname);
  if (name === null) {
    res.statusCode = 400;
    res.end("bad request");
    return;
  }
  const member = name.slice(1); // 去掉前导 /
  if (!allowed.has(member)) {
    res.statusCode = 404;
    res.end("not found");
    return;
  }
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Content-Type", "audio/wav");
  res.setHeader("Accept-Ranges", "none");
  const body = readFileSync(path.join(dir, member)); // wav 几十 KB，整读 + Content-Length
  res.setHeader("Content-Length", body.byteLength);
  res.end(body);
});

server.listen(0, "127.0.0.1", () => {
  process.stdout.write(`${JSON.stringify({ port: server.address().port })}\n`);
});
