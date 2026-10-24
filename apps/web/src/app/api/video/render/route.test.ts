import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  appendStyleFrameConfirmation,
  styleVersionDigest,
  type StyleBible,
  type VideoProject,
} from "@acs/video-document";
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

// —— W2 风格代表帧门禁：风格项目出片须持有效确认 ——
const PALETTE = {
  background: "#101820",
  foreground: "#f3e6cf",
  secondary: "#e8b04b",
  accent: "#e8b04b",
  object: "#c98548",
};
const AT = "2026-10-24T00:00:00.000Z";

async function styledNarratedProject(): Promise<{
  project: VideoProject;
  bible: StyleBible;
}> {
  const versionId = "22222222-2222-4222-8222-222222222222";
  const bible: StyleBible = {
    schemaVersion: 1,
    id: "11111111-1111-4111-8111-111111111111",
    currentVersionId: versionId,
    versions: [
      {
        versionId,
        createdAt: AT,
        name: "深蓝暖金",
        palette: PALETTE,
        fontFamily: "NotoSansSC",
        lightingPreset: "orbit3d-fixed-soft-studio",
      },
    ],
  };
  const shotId = "44444444-4444-4444-8444-444444444444";
  const project: VideoProject = {
    schemaVersion: 1,
    id: "33333333-3333-4333-8333-333333333333",
    title: "gate sample",
    savedVersion: 1,
    brief: { sentence: "one", aspectTargets: ["landscape", "portrait"] },
    shots: [
      {
        shotId,
        order: 0,
        locked: false,
        workingVersionId: shotId,
        contentVersions: [
          {
            versionId: shotId,
            createdAt: AT,
            durationMs: 2000,
            description: "text",
            narrationText: "有旁白。",
            sceneSource: {
              type: "spec",
              spec: {
                specVersion: 1,
                componentId: "text-animation",
                componentVersion: 1,
                durationMs: 2000,
                seed: 3,
                background: PALETTE.background,
                params: {
                  title: "门禁",
                  titleColor: PALETTE.foreground,
                  subtitleColor: PALETTE.secondary,
                  entrance: "fade-up",
                  enterMs: 400,
                },
              },
            },
            provenance: { engineId: "planner-rules", engineVersion: "1" },
          },
        ],
        events: [],
      },
    ],
    renderRecords: [],
    deliveries: [],
    styleBibleRef: {
      bibleId: bible.id,
      versionId,
      digest: await styleVersionDigest(bible.versions[0]!),
    },
  };
  return { project, bible };
}

const KEYFRAMES = (["landscape", "portrait"] as const).map((aspect, index) => ({
  aspect,
  digest: `${index === 0 ? "a" : "b"}`.repeat(64),
  bytes: 128,
  outputRef: `style-frame/00000000-0000-4000-8000-00000000000${index}/${aspect}.png`,
}));

test("风格项目无有效确认时拒绝出片并提示重新确认", async () => {
  await withEnv("development", async () => {
    const { project, bible } = await styledNarratedProject();
    const response = await POST(
      new Request(url, {
        method: "POST",
        headers: {
          Origin: "http://localhost:3210",
          Host: "localhost:3210",
        },
        body: JSON.stringify({ project, styleBible: bible }),
      }),
    );
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.error, /确认/);
  });
});

test("持有效确认的风格项目通过门禁（进入后续出片前置检查）", async () => {
  await withEnv("development", async () => {
    const previous = process.env.DASHSCOPE_API_KEY;
    delete process.env.DASHSCOPE_API_KEY;
    try {
      const { project, bible } = await styledNarratedProject();
      const confirmed = await appendStyleFrameConfirmation(project, {
        shotId: project.shots[0]!.shotId,
        frameMs: 100,
        keyframes: KEYFRAMES,
        at: AT,
      });
      // narrated:true 且无密钥：若门禁未过会先得到 400；过门禁后到密钥检查得 503
      const response = await POST(
        new Request(url, {
          method: "POST",
          headers: {
            Origin: "http://localhost:3210",
            Host: "localhost:3210",
          },
          body: JSON.stringify({
            project: confirmed,
            styleBible: bible,
            narrated: true,
          }),
        }),
      );
      assert.equal(response.status, 503);
      assert.match((await response.json()).error, /DASHSCOPE_API_KEY/);
    } finally {
      if (previous === undefined) delete process.env.DASHSCOPE_API_KEY;
      else process.env.DASHSCOPE_API_KEY = previous;
    }
  });
});
