import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { workspaceRoot } from "./render-local";
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

const narratedProject = JSON.parse(
  readFileSync(
    path.join(
      workspaceRoot(),
      "scripts/video/fixtures/interactive-sample.video-project.json",
    ),
    "utf8",
  ),
);

test("有声选项拒绝错型和没有旁白的项目", async () => {
  await withEnv("development", async () => {
    const headers = {
      Origin: "http://localhost:3210",
      Host: "localhost:3210",
    };
    const wrongType = await POST(
      new Request(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ project: narratedProject, narrated: "yes" }),
      }),
    );
    assert.equal(wrongType.status, 400);
    assert.match((await wrongType.json()).error, /布尔值/);

    const silent = structuredClone(narratedProject);
    for (const shot of silent.shots)
      for (const version of shot.contentVersions) version.narrationText = "";
    const noNarration = await POST(
      new Request(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ project: silent, narrated: true }),
      }),
    );
    assert.equal(noNarration.status, 400);
    assert.match((await noNarration.json()).error, /没有旁白文本/);
  });
});

test("缺服务端 TTS 密钥时不启动有声出片", async () => {
  await withEnv("development", async () => {
    const previous = process.env.DASHSCOPE_API_KEY;
    delete process.env.DASHSCOPE_API_KEY;
    try {
      const response = await POST(
        new Request(url, {
          method: "POST",
          headers: {
            Origin: "http://localhost:3210",
            Host: "localhost:3210",
          },
          body: JSON.stringify({ project: narratedProject, narrated: true }),
        }),
      );
      assert.equal(response.status, 503);
      const payload = await response.json();
      assert.match(payload.error, /DASHSCOPE_API_KEY/);
      assert.equal(payload.project, undefined);
      assert.equal(payload.downloads, undefined);
    } finally {
      if (previous === undefined) delete process.env.DASHSCOPE_API_KEY;
      else process.env.DASHSCOPE_API_KEY = previous;
    }
  });
});
