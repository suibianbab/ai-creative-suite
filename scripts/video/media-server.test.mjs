// P2.5-T4 B1：媒体仓 http 托管服务单测。真起子进程 + 127.0.0.1 fetch（本地
// 回环零外网）；白名单/形状门/穿越/畸形编码四路。Content-Type 必须按后缀——
// Remotion 下载器用 contentType 推导资产文件名后缀（B1 注记）。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = mkdirSync(path.join(tmpdir(), "acs-media-server-"), {
  recursive: true,
});
test.after(() => rmSync(WORK, { recursive: true, force: true }));

const KEY_A = "0123456789abcdef.mp4";
const KEY_B = "fedcba9876543210.webm";
const BODY = {
  [KEY_A]: Buffer.from("mp4-bytes-假"),
  [KEY_B]: Buffer.from("webm-bytes"),
};

async function startServer(files) {
  mkdirSync(path.join(WORK, "original"), { recursive: true });
  for (const [key, bytes] of Object.entries(BODY))
    writeFileSync(path.join(WORK, "original", key), bytes);
  const child = spawn(
    process.execPath,
    [path.join(HERE, "media-server.mjs"), "--root", WORK, "--files", files],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const port = await new Promise((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
      const m = /"port":(\d+)/.exec(out);
      if (m) resolve(Number(m[1]));
    });
    child.on("exit", () => reject(new Error(`服务提前退出: ${out}`)));
    setTimeout(() => reject(new Error("端口上报超时")), 10_000).unref?.();
  });
  return { child, base: `http://127.0.0.1:${port}` };
}

test("白名单命中：200 + 后缀 Content-Type + 字节相等（mp4/webm 各一）", async () => {
  const { child, base } = await startServer(`${KEY_A},${KEY_B}`);
  try {
    const mp4 = await fetch(`${base}/original/${KEY_A}`);
    assert.equal(mp4.status, 200);
    assert.equal(mp4.headers.get("content-type"), "video/mp4");
    assert.equal(mp4.headers.get("content-length"), String(BODY[KEY_A].length));
    assert.equal(mp4.headers.get("accept-ranges"), "none"); // spec S2 明文
    assert.deepEqual(Buffer.from(await mp4.arrayBuffer()), BODY[KEY_A]);
    const webm = await fetch(`${base}/original/${KEY_B}`);
    assert.equal(webm.headers.get("content-type"), "video/webm");
    assert.deepEqual(Buffer.from(await webm.arrayBuffer()), BODY[KEY_B]);
  } finally {
    child.kill();
  }
});

test("白名单外同仓文件：404（白名单是精确串，目录里有什么不重要）", async () => {
  const { child, base } = await startServer(KEY_A);
  try {
    const res = await fetch(`${base}/original/${KEY_B}`); // 在仓里、不在白名单
    assert.equal(res.status, 404);
    const miss = await fetch(`${base}/original/deadbeefdeadbeef.mov`); // 不在仓
    assert.equal(miss.status, 404);
  } finally {
    child.kill();
  }
});

test("编码穿越：逃逸变体全 404；dot-segment 被 URL 规范化后只会命中白名单原文件", async () => {
  const { child, base } = await startServer(KEY_A);
  try {
    for (const p of [
      `/original/..%2fproxy%2fx.mp4`, // 解码后 ../proxy/x.mp4 → 形状门拒
      `/foo/original/${KEY_A}`, // 前缀不符
      `/original/subdir/${KEY_A}`, // 子路径 → 形状门拒（含斜杠）
      `/original/${KEY_A}.exe`, // 后缀不符
      `/original/`, // 空 storeKey
      `/`, // 裸根
    ]) {
      assert.equal((await fetch(base + p)).status, 404, p);
    }
    // %2e%2e 的 dot-segment 在 new URL() 解析期即被 WHATWG 规范化（handler 收到的
    // 已是 /original/<key>），服务端永远看不到逃逸路径——命中的是白名单原文件本身
    // （字节相等为证），不存在穿越读取。此路 200 是规范化语义，不是门被绕开。
    const norm = await fetch(`${base}/original/%2e%2e/original/${KEY_A}`);
    assert.equal(norm.status, 200);
    assert.deepEqual(Buffer.from(await norm.arrayBuffer()), BODY[KEY_A]);
  } finally {
    child.kill();
  }
});

test("非 GET 方法：405（Remotion 只发整 GET；不给 POST/HEAD 返回全量）", async () => {
  const { child, base } = await startServer(KEY_A);
  try {
    const post = await fetch(`${base}/original/${KEY_A}`, { method: "POST" });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET");
    const head = await fetch(`${base}/original/${KEY_A}`, { method: "HEAD" });
    assert.equal(head.status, 405);
  } finally {
    child.kill();
  }
});

test("畸形百分号序列：400（decode 失败不落 fs）", async () => {
  const { child, base } = await startServer(KEY_A);
  try {
    const res = await fetch(`${base}/original/%zz`);
    assert.equal(res.status, 400);
  } finally {
    child.kill();
  }
});
