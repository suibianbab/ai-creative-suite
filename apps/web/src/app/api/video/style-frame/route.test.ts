import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";
import { buildBibleForTest, styledProject } from "./style-frame-local.test";

const mutableEnv = process.env as { NODE_ENV?: string };
const url = "http://localhost:3210/api/video/style-frame";
const HEADERS = {
  Origin: "http://localhost:3210",
  Host: "localhost:3210",
};

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

function body(project: unknown, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    project,
    styleBible: null,
    shotId: null,
    frameMs: 0,
    ...extra,
  });
}

test("正式环境不开放风格关键帧渲染", async () => {
  await withEnv("production", async () => {
    const response = await POST(
      new Request(url, { method: "POST", body: "{}" }),
    );
    assert.equal(response.status, 503);
  });
});

test("跨站请求拒绝", async () => {
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

test("无效项目、缺风格引用、缺 Bible 均在渲染前拒绝", async () => {
  await withEnv("development", async () => {
    const badProject = await POST(
      new Request(url, {
        method: "POST",
        headers: HEADERS,
        body: body({ schemaVersion: 1, shots: [] }, { shotId: "anything" }),
      }),
    );
    assert.equal(badProject.status, 400);

    const project = await styledProject();
    const noRef = await POST(
      new Request(url, {
        method: "POST",
        headers: HEADERS,
        body: body(
          { ...project, styleBibleRef: undefined },
          {
            shotId: project.shots[0]!.shotId,
            frameMs: 10,
          },
        ),
      }),
    );
    assert.equal(noRef.status, 400);
    assert.match((await noRef.json()).error, /Style Bible/);

    const noBible = await POST(
      new Request(url, {
        method: "POST",
        headers: HEADERS,
        body: body(project, { shotId: project.shots[0]!.shotId, frameMs: 10 }),
      }),
    );
    assert.equal(noBible.status, 400);
    assert.match((await noBible.json()).error, /StyleBible|风格/);
  });
});

test("未知镜头、越界时间与风格漂移给出可操作错误", async () => {
  await withEnv("development", async () => {
    const project = await styledProject();
    const styleBible = await buildBibleForTest();
    const shotId = project.shots[0]!.shotId;

    const unknownShot = await POST(
      new Request(url, {
        method: "POST",
        headers: HEADERS,
        body: body(project, {
          styleBible,
          shotId: "99999999-9999-4999-8999-999999999999",
          frameMs: 0,
        }),
      }),
    );
    assert.equal(unknownShot.status, 400);
    assert.match((await unknownShot.json()).error, /镜头/);

    const outOfRange = await POST(
      new Request(url, {
        method: "POST",
        headers: HEADERS,
        body: body(project, { styleBible, shotId, frameMs: 5000 }),
      }),
    );
    assert.equal(outOfRange.status, 400);
    assert.match((await outOfRange.json()).error, /frameMs/);

    const drifted = structuredClone(project);
    const driftedSource = drifted.shots[0]!.contentVersions[0]!.sceneSource as {
      type: "spec";
      spec: { params: Record<string, unknown> };
    };
    driftedSource.spec.params.titleColor = "#123456";
    const drift = await POST(
      new Request(url, {
        method: "POST",
        headers: HEADERS,
        body: body(drifted, { styleBible, shotId, frameMs: 0 }),
      }),
    );
    assert.equal(drift.status, 400);
    assert.match((await drift.json()).error, /风格|调色板/);
  });
});
