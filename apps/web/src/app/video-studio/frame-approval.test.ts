import assert from "node:assert/strict";
import { test } from "node:test";
import type { VideoProject } from "@acs/video-document";
import { defaultRegistry } from "@acs/video-scene";
import {
  approvalStatus,
  renderApprovalFrames,
} from "./frame-approval";

const SPEC = {
  specVersion: 1 as const,
  componentId: "text-animation",
  componentVersion: 1,
  durationMs: 3000,
  seed: 4601,
  background: "#ffffff",
  params: {
    title: "确认帧样例",
    subtitle: "风格代表帧",
    titleColor: "#1b2c29",
    subtitleColor: "#5d7469",
    entrance: "fade-up",
    enterMs: 450,
  },
};

const project = (): VideoProject => {
  const shot = {
    shotId: "11111111-2222-4333-8444-555555555555",
    order: 0,
    locked: false,
    workingVersionId: "aaaaaaaa-1111-4222-8333-444455556666",
    contentVersions: [
      {
        versionId: "aaaaaaaa-1111-4222-8333-444455556666",
        createdAt: "2026-10-24T00:00:00.000Z",
        durationMs: 3000,
        description: "d",
        narrationText: "n",
        sceneSource: { type: "spec" as const, spec: SPEC },
        provenance: { engineId: "t", engineVersion: "1" },
      },
    ],
    events: [],
  };
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: "t",
    brief: { sentence: "s", aspectTargets: ["landscape", "portrait"] },
    shots: [shot],
    renderRecords: [],
    deliveries: [],
    savedVersion: 1,
    styleBibleRef: {
      bibleId: "5f0a2b6c-1111-4222-8333-444455556666",
      versionId: "6a1b3c7d-2222-4333-8444-555566667777",
      digest: "c".repeat(64),
    },
  };
};

const confirm = async (p: VideoProject) => {
  const frames = await renderApprovalFrames(SPEC);
  p.styleFrameApprovals = [
    {
      shotId: p.shots[0]!.shotId,
      contentVersionId: p.shots[0]!.workingVersionId,
      styleBibleRef: p.styleBibleRef!,
      frames: frames.map(({ aspect, sha256 }) => ({
        aspect,
        svgSha256: sha256,
      })),
      confirmedAt: "2026-10-24T00:00:00.000Z",
    },
  ];
};

test("renderApprovalFrames 产出双画幅中段帧 SVG（可被注册表再渲染）", async () => {
  const frames = await renderApprovalFrames(SPEC);
  assert.deepEqual(
    frames.map((frame) => frame.aspect),
    ["landscape", "portrait"],
  );
  for (const frame of frames) {
    assert.ok(frame.svg.startsWith("<svg"));
    assert.ok(frame.svg.includes("确认帧样例"));
    assert.match(frame.sha256, /^[0-9a-f]{64}$/);
  }
  // 确定性：同 spec 两次渲染逐字节一致。
  const again = await renderApprovalFrames(SPEC);
  assert.deepEqual(again, frames);
});

test("approvalStatus：无确认不拦截；确认后三重绑定任一变化即失效", async () => {
  const clean = project();
  assert.deepEqual(await approvalStatus(clean), { valid: true, reasons: [] });

  const ok = project();
  await confirm(ok);
  assert.deepEqual(await approvalStatus(ok), { valid: true, reasons: [] });

  const contentChanged = project();
  await confirm(contentChanged);
  contentChanged.shots[0]!.contentVersions.push({
    ...contentChanged.shots[0]!.contentVersions[0]!,
    versionId: "bbbbbbbb-2222-4333-8444-555566667777",
  });
  contentChanged.shots[0]!.workingVersionId =
    "bbbbbbbb-2222-4333-8444-555566667777";
  const stale = await approvalStatus(contentChanged);
  assert.equal(stale.valid, false);
  assert.match(stale.reasons.join(""), /内容版本/);

  const styleChanged = project();
  await confirm(styleChanged);
  styleChanged.styleBibleRef = {
    bibleId: "5f0a2b6c-1111-4222-8333-444455556666",
    versionId: "7c2c4d8e-3333-4444-8555-666677778888",
    digest: "f".repeat(64),
  };
  const styleStale = await approvalStatus(styleChanged);
  assert.equal(styleStale.valid, false);
  assert.match(styleStale.reasons.join(""), /风格版本/);

  const frameChanged = project();
  await confirm(frameChanged);
  frameChanged.styleFrameApprovals![0]!.frames[0]!.svgSha256 = "0".repeat(64);
  const frameStale = await approvalStatus(frameChanged);
  assert.equal(frameStale.valid, false);
  assert.match(frameStale.reasons.join(""), /画面/);
});

test("approvalStatus：镜头被删或确认为旧 spec 参数时失效；spec 必须仍过注册表", async () => {
  const deleted = project();
  await confirm(deleted);
  deleted.shots = [];
  const gone = await approvalStatus(deleted);
  assert.equal(gone.valid, false);
  assert.match(gone.reasons.join(""), /镜头/);

  const mutated = project();
  await confirm(mutated);
  mutated.shots[0]!.contentVersions[0]!.sceneSource.spec.params.title =
    "改过的标题";
  const drift = await approvalStatus(mutated);
  assert.equal(drift.valid, false);
  assert.match(drift.reasons.join(""), /画面/);
  // 即便 spec 已不可渲染，status 也以原因返回而非抛错。
  mutated.shots[0]!.contentVersions[0]!.sceneSource.spec.componentId =
    "no-such-component";
  const broken = await approvalStatus(mutated);
  assert.equal(broken.valid, false);
  assert.ok(broken.reasons.length > 0);
  assert.throws(() =>
    defaultRegistry.get("no-such-component", 1),
  );
});
