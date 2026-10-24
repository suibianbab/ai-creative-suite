import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  type ContentVersion,
  type StyleBible,
  type StyleBibleVersion,
  type StyleFrameApproval,
  styleVersionDigest,
  type VideoProject,
} from "@acs/video-document";
import type { SceneSpec } from "@acs/video-scene";
import { renderApprovalFrames } from "../../../video-studio/frame-approval";
import { renderJobRoot, workspaceRoot } from "./render-local";
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
    const previousKey = process.env.DASHSCOPE_API_KEY;
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
      if (previousKey === undefined) delete process.env.DASHSCOPE_API_KEY;
      else process.env.DASHSCOPE_API_KEY = previousKey;
    }
  });
});

// —— C1：代表帧确认的服务端闸门（直接 HTTP 绕过客户端检查也应被拦） ——
// 夹具规则：spec 颜色必须与 Bible 调色板逐字一致（workingStyleIssues 会比对
// styleSceneSpec 的重着色结果），确认帧摘要由 renderApprovalFrames 真实渲染取得。
const C1_PALETTE = {
  background: "#101f34",
  foreground: "#f3f5f7",
  secondary: "#b4d8e4",
  accent: "#f5b652",
  object: "#42a5a0",
};

const jobDirCount = () => {
  try {
    return readdirSync(renderJobRoot()).filter((name) =>
      /^[0-9a-f-]{36}$/.test(name),
    ).length;
  } catch {
    return 0;
  }
};

async function approvalFixture() {
  const workingVersionId = crypto.randomUUID();
  const olderVersionId = crypto.randomUUID();
  const shotId = crypto.randomUUID();
  const spec: SceneSpec = {
    specVersion: 1,
    componentId: "text-animation",
    componentVersion: 1,
    durationMs: 3000,
    seed: 4601,
    background: C1_PALETTE.background,
    params: {
      title: "C1 服务端闸门",
      subtitle: "直接 HTTP 也拦",
      titleColor: C1_PALETTE.foreground,
      subtitleColor: C1_PALETTE.secondary,
      entrance: "fade-up",
      enterMs: 450,
    },
  };
  const contentVersion = (versionId: string): ContentVersion => ({
    versionId,
    createdAt: "2026-10-25T00:00:00.000Z",
    durationMs: 3000,
    description: "d",
    narrationText: "旁白占位",
    sceneSource: { type: "spec", spec },
    provenance: { engineId: "t", engineVersion: "1" },
  });
  const bibleVersion = (
    versionId: string,
    name: string,
  ): StyleBibleVersion => ({
    versionId,
    createdAt: "2026-10-25T00:00:00.000Z",
    name,
    palette: C1_PALETTE,
    fontFamily: "NotoSansSC",
    lightingPreset: "orbit3d-fixed-soft-studio",
  });
  const v1 = bibleVersion(crypto.randomUUID(), "C1 基线风格");
  // v2 与 v1 调色板相同（工作画面不必改），但 canonicalJson 不同 → 摘要不同。
  const v2 = bibleVersion(crypto.randomUUID(), "C1 派生风格");
  const bible: StyleBible = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    currentVersionId: v1.versionId,
    versions: [v1, v2],
  };
  const ref = {
    bibleId: bible.id,
    versionId: v1.versionId,
    digest: await styleVersionDigest(v1),
  };
  const project: VideoProject = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: "C1",
    brief: { sentence: "s", aspectTargets: ["landscape", "portrait"] },
    shots: [
      {
        shotId,
        order: 0,
        locked: false,
        workingVersionId,
        contentVersions: [contentVersion(workingVersionId)],
        events: [],
      },
    ],
    renderRecords: [],
    deliveries: [],
    savedVersion: 1,
    styleBibleRef: ref,
  };
  const frames = await renderApprovalFrames(spec);
  const approvals: StyleFrameApproval[] = [
    {
      shotId,
      contentVersionId: workingVersionId,
      styleBibleRef: ref,
      frames: frames.map(({ aspect, sha256 }) => ({
        aspect,
        svgSha256: sha256,
      })),
      confirmedAt: "2026-10-25T00:00:00.000Z",
    },
  ];
  return {
    project,
    bible,
    approvals,
    olderVersionId,
    contentVersion,
    v2Ref: { bibleId: bible.id, versionId: v2.versionId },
    v2Digest: await styleVersionDigest(v2),
  };
}

const sameOrigin = {
  Origin: "http://localhost:3210",
  Host: "localhost:3210",
};

const postRender = (body: unknown) =>
  POST(
    new Request(url, {
      method: "POST",
      headers: sameOrigin,
      body: JSON.stringify(body),
    }),
  );

test("C1：确认后重开旧内容版本，直接 POST 被拒且不留导出痕迹", async () => {
  await withEnv("development", async () => {
    const fixture = await approvalFixture();
    // 旧版本重开：追加旧内容版本并切回，确认仍绑定新版本 → 三重绑定失效。
    fixture.project.shots[0]!.contentVersions.push(
      fixture.contentVersion(fixture.olderVersionId),
    );
    fixture.project.shots[0]!.workingVersionId = fixture.olderVersionId;
    fixture.project.styleFrameApprovals = fixture.approvals;
    const jobsBefore = jobDirCount();
    const response = await postRender({
      project: fixture.project,
      styleBible: fixture.bible,
    });
    assert.equal(response.status, 400);
    const payload = (await response.json()) as {
      error: string;
      downloads?: unknown;
      project?: unknown;
    };
    assert.match(payload.error, /代表帧确认已失效/);
    assert.match(payload.error, /内容版本/);
    assert.equal(payload.downloads, undefined);
    assert.equal(payload.project, undefined);
    assert.equal(
      jobDirCount(),
      jobsBefore,
      "被闸门拒绝的请求不得创建导出作业目录",
    );
  });
});

test("C1：确认后画面改动（帧摘要不一致）与风格版本切换，直接 POST 被拒", async () => {
  await withEnv("development", async () => {
    const previousKey = process.env.DASHSCOPE_API_KEY;
    delete process.env.DASHSCOPE_API_KEY;
    try {
      const frameDrift = await approvalFixture();
      const driftSpec = frameDrift.project.shots[0]!.contentVersions[0]!
        .sceneSource as { type: "spec"; spec: { params: { title: string } } };
      driftSpec.spec.params.title = "确认后被改过的标题";
      frameDrift.project.styleFrameApprovals = frameDrift.approvals;
      const frameResponse = await postRender({
        project: frameDrift.project,
        styleBible: frameDrift.bible,
        narrated: true,
      });
      assert.equal(frameResponse.status, 400);
      const framePayload = (await frameResponse.json()) as {
        error: string;
      };
      assert.match(framePayload.error, /代表帧确认已失效/);
      assert.match(framePayload.error, /画面/);

      const styleDrift = await approvalFixture();
      // 确认绑定 v1，项目已切到 v2（派生版本）→ 风格版本变化失效。
      styleDrift.project.styleBibleRef = {
        ...styleDrift.approvals[0]!.styleBibleRef,
        versionId: styleDrift.v2Ref.versionId,
        digest: styleDrift.v2Digest,
      };
      styleDrift.project.styleFrameApprovals = styleDrift.approvals;
      const styleResponse = await postRender({
        project: styleDrift.project,
        styleBible: styleDrift.bible,
        narrated: true,
      });
      assert.equal(styleResponse.status, 400);
      const stylePayload = (await styleResponse.json()) as {
        error: string;
      };
      assert.match(stylePayload.error, /代表帧确认已失效/);
      assert.match(stylePayload.error, /风格版本/);
    } finally {
      if (previousKey === undefined) delete process.env.DASHSCOPE_API_KEY;
      else process.env.DASHSCOPE_API_KEY = previousKey;
    }
  });
});

test("C1：确认有效的项目与无确认的旧项目都通过闸门（有声无密钥 503 探针）", async () => {
  await withEnv("development", async () => {
    const previousKey = process.env.DASHSCOPE_API_KEY;
    delete process.env.DASHSCOPE_API_KEY;
    try {
      const valid = await approvalFixture();
      valid.project.styleFrameApprovals = valid.approvals;
      const approved = await postRender({
        project: valid.project,
        styleBible: valid.bible,
        narrated: true,
      });
      assert.equal(
        approved.status,
        503,
        "合法确认应通过闸门并停在密钥检查，而非确认错误",
      );

      const legacy = await postRender({
        project: narratedProject,
        narrated: true,
      });
      assert.equal(
        legacy.status,
        503,
        "无确认的旧项目不受新闸门影响（兼容契约）",
      );
    } finally {
      if (previousKey === undefined) delete process.env.DASHSCOPE_API_KEY;
      else process.env.DASHSCOPE_API_KEY = previousKey;
    }
  });
});

test("C1：出片中途失败时不留成功交付记录（500、无下载、作业目录已清）", async () => {
  await withEnv("development", async () => {
    const broken = await approvalFixture();
    const spec = broken.project.shots[0]!.contentVersions[0]!
      .sceneSource as { type: "spec"; spec: { componentId: string } };
    spec.spec.componentId = "no-such-component";
    const jobsBefore = jobDirCount();
    const response = await postRender({
      project: broken.project,
      styleBible: broken.bible,
    });
    assert.equal(response.status, 500);
    const payload = (await response.json()) as {
      error: string;
      downloads?: unknown;
      project?: unknown;
    };
    assert.equal(typeof payload.error, "string");
    assert.equal(payload.downloads, undefined);
    assert.equal(payload.project, undefined);
    assert.equal(
      jobDirCount(),
      jobsBefore,
      "失败作业目录应被清理，不得残留交付痕迹",
    );
  });
});
