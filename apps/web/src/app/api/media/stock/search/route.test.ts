// P2.5-T5 复核：搜索路由的 dev 门与入参校验（直接调 GET handler，绕过服务器）。
// NODE_ENV 只读绕行沿 ingest 路由测试先例。
import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "./route";

const mutableEnv = process.env as { NODE_ENV?: string };

function searchUrl(q: string): string {
  return `http://localhost:3000/api/media/stock/search?q=${encodeURIComponent(q)}`;
}

test("NODE_ENV 门：production → 503，保留既有错误文案", async () => {
  const previous = mutableEnv.NODE_ENV;
  mutableEnv.NODE_ENV = "production";
  try {
    const response = await GET(new Request(searchUrl("clouds")));
    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: string };
    assert.equal(body.error, "在线搜索仅在本地开发环境开放。");
  } finally {
    if (previous === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previous;
  }
});

test("development + 空关键词 → 400", async () => {
  const previous = mutableEnv.NODE_ENV;
  mutableEnv.NODE_ENV = "development";
  try {
    const response = await GET(new Request(searchUrl("")));
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.equal(body.error, "搜索关键词不能为空。");
  } finally {
    if (previous === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previous;
  }
});

test("development + 关键词超 80 字符 → 400（不触上游）", async () => {
  const previous = mutableEnv.NODE_ENV;
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("超长关键词不应触上游");
  }) as typeof fetch;
  mutableEnv.NODE_ENV = "development";
  try {
    const response = await GET(new Request(searchUrl("a".repeat(81))));
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.equal(body.error, "搜索关键词过长（上限 80 字符）。");
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previous;
  }
});
