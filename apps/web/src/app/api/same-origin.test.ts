// P2.6-T5 终评同源闸单测：request.url 固定为 next dev --hostname 0.0.0.0 下的
// http://0.0.0.0:3100，验证判定只看 Origin 与 Host 头（回归 #2）。
import assert from "node:assert/strict";
import test from "node:test";
import { isSameOriginRequest } from "./same-origin";

const REQUEST_URL = "http://0.0.0.0:3100/api/media/stock/import";

function request(headers: Record<string, string>): Request {
  return new Request(REQUEST_URL, { headers });
}

test("无 Origin 头：非浏览器调用方放行", () => {
  assert.equal(isSameOriginRequest(request({})), true);
});

test("回归：Origin/Host 为 localhost，request.url 为 0.0.0.0 仍判同源", () => {
  assert.equal(
    isSameOriginRequest(
      request({ origin: "http://localhost:3100", host: "localhost:3100" }),
    ),
    true,
  );
});

test("Origin/Host 为 127.0.0.1：同源", () => {
  assert.equal(
    isSameOriginRequest(
      request({ origin: "http://127.0.0.1:3100", host: "127.0.0.1:3100" }),
    ),
    true,
  );
});

test("Origin host 与 Host 头不一致：跨站拒绝", () => {
  assert.equal(
    isSameOriginRequest(
      request({ origin: "http://evil.example", host: "localhost:3100" }),
    ),
    false,
  );
});

test("端口不一致：跨站拒绝", () => {
  assert.equal(
    isSameOriginRequest(
      request({ origin: "http://localhost:3101", host: "localhost:3100" }),
    ),
    false,
  );
});

test("协议不一致（请求 http、Origin https）：跨站拒绝", () => {
  assert.equal(
    isSameOriginRequest(
      request({ origin: "https://localhost:3100", host: "localhost:3100" }),
    ),
    false,
  );
});

test("Origin 不可解析：拒绝", () => {
  assert.equal(isSameOriginRequest(request({ origin: "not a url" })), false);
});

test("x-forwarded-proto 首个 token 为 https：判定同源", () => {
  assert.equal(
    isSameOriginRequest(
      request({
        origin: "https://localhost:3100",
        host: "localhost:3100",
        "x-forwarded-proto": "https",
      }),
    ),
    true,
  );
});
