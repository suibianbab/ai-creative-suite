// QA 回归器的端口预检（自 run-regression.mjs 抽出，便于单测）：
//   - 5432 走 PostgreSQL SSLRequest 探针（沿用原行为）；
//   - 固定 HTTP 健康/端点探针沿用原 URL 与 3s 超时；
//   - 3211 是 Video Studio 的同源代理（无固定健康路径），用 TCP 连通性判断。
import { createConnection } from "node:net";

const HTTP_PROBE_URLS = new Map([
  [9000, "http://127.0.0.1:9000/health"],
  [
    8180,
    "http://127.0.0.1:8180/realms/acs-dev/.well-known/openid-configuration",
  ],
  [4112, "http://127.0.0.1:4112/health"],
  [3000, "http://localhost:3000/image-studio/photocraft"],
  [3100, "http://127.0.0.1:3100/image-studio/photocraft"],
  [3210, "http://localhost:3210/video-studio"],
  // 本机掩码服务（scripts/image_quality/local_mask_provider.py）的既有 GET /health。
  [4101, "http://127.0.0.1:4101/health"],
  [4104, "http://127.0.0.1:4104/health"],
  [11435, "http://127.0.0.1:11435/health"],
]);

async function checkPostgres() {
  return await new Promise((resolvePort) => {
    const socket = createConnection({ host: "127.0.0.1", port: 5432 });
    socket.setTimeout(3000);
    socket.once("connect", () => {
      const sslRequest = Buffer.alloc(8);
      sslRequest.writeInt32BE(8, 0);
      sslRequest.writeInt32BE(80877103, 4);
      socket.write(sslRequest);
    });
    socket.once("data", (data) => {
      socket.destroy();
      resolvePort(data[0] === 0x4e || data[0] === 0x53);
    });
    for (const event of ["error", "timeout", "end"]) {
      socket.once(event, () => {
        socket.destroy();
        resolvePort(false);
      });
    }
  });
}

async function checkHttp(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}

// TCP 连通探针：connect → true；error / timeout / end → false。
export function probeTcp(port) {
  return new Promise((resolveProbe) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(3000);
    let settled = false;
    const settle = (reachable) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveProbe(reachable);
    };
    socket.once("connect", () => settle(true));
    for (const event of ["error", "timeout", "end"]) {
      socket.once(event, () => settle(false));
    }
  });
}

// 返回某端口的探针函数；未登记的端口返回 null（调用方按不可用处理）。
export function probeFor(port) {
  if (port === 5432) return checkPostgres;
  if (port === 3211) return () => probeTcp(3211);
  const url = HTTP_PROBE_URLS.get(port);
  if (url) return () => checkHttp(url);
  return null;
}

export async function checkPort(port) {
  const probe = probeFor(port);
  return probe ? await probe() : false;
}
