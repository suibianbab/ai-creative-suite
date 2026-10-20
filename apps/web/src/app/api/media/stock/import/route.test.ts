// P2.5-T5 复核：导入路由的 dev 门、同源闸与坏 JSON 收口（直接调 POST handler）。
// NODE_ENV 只读绕行沿 ingest 路由测试先例。
import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";

const mutableEnv = process.env as { NODE_ENV?: string };
const ENDPOINT = "http://localhost:3000/api/media/stock/import";
const SAME_ORIGIN = { origin: "http://localhost:3000", host: "localhost:3000" };

test("NODE_ENV 门：production → 503，保留既有错误文案", async () => {
  const previous = mutableEnv.NODE_ENV;
  mutableEnv.NODE_ENV = "production";
  try {
    const response = await POST(
      new Request(ENDPOINT, {
        method: "POST",
        body: "{}",
        headers: { ...SAME_ORIGIN, "content-type": "application/json" },
      }),
    );
    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: string };
    assert.equal(body.error, "在线搜索仅在本地开发环境开放。");
  } finally {
    if (previous === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previous;
  }
});

test("development + 异源 Origin → 403", async () => {
  const previous = mutableEnv.NODE_ENV;
  mutableEnv.NODE_ENV = "development";
  try {
    const response = await POST(
      new Request(ENDPOINT, {
        method: "POST",
        body: "{}",
        headers: {
          origin: "http://evil.example",
          host: "localhost:3000",
          "content-type": "application/json",
        },
      }),
    );
    assert.equal(response.status, 403);
  } finally {
    if (previous === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previous;
  }
});

test("development + 同源但坏 JSON → 400", async () => {
  const previous = mutableEnv.NODE_ENV;
  mutableEnv.NODE_ENV = "development";
  try {
    const response = await POST(
      new Request(ENDPOINT, {
        method: "POST",
        body: "not-json",
        headers: { ...SAME_ORIGIN, "content-type": "application/json" },
      }),
    );
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.equal(body.error, "请求须为 JSON 且含 pageTitle 与 derivativeUrl。");
  } finally {
    if (previous === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previous;
  }
});
