import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";

const mutableEnv = process.env as { NODE_ENV?: string };
const url = "http://localhost:3210/api/video/render";

async function withEnv(value: string, run: () => Promise<void>) {
  const previous = mutableEnv.NODE_ENV;
  mutableEnv.NODE_ENV = value;
  try {
    await run();
  } finally {
    if (previous === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previous;
  }
}

test("正式环境不开放本机视频渲染", async () => {
  await withEnv("production", async () => {
    const response = await POST(
      new Request(url, { method: "POST", body: "{}" }),
    );
    assert.equal(response.status, 503);
  });
});

test("跨站请求在项目读取和渲染前拒绝", async () => {
  await withEnv("development", async () => {
    const response = await POST(
      new Request(url, {
        method: "POST",
        headers: { Origin: "https://another.example" },
        body: "{}",
      }),
    );
    assert.equal(response.status, 403);
  });
});

test("错误项目不触发出片且不返回成功记录", async () => {
  await withEnv("development", async () => {
    const response = await POST(
      new Request(url, {
        method: "POST",
        headers: { Origin: "http://localhost:3210", Host: "localhost:3210" },
        body: JSON.stringify({ project: { schemaVersion: 1, shots: [] } }),
      }),
    );
    assert.equal(response.status, 400);
    const payload = (await response.json()) as Record<string, unknown>;
    assert.equal(typeof payload.error, "string");
    assert.equal(payload.project, undefined);
    assert.equal(payload.downloads, undefined);
  });
});
