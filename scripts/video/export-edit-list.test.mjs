import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildEditList, validateEditList } from "./export-edit-list.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const project = JSON.parse(
  readFileSync(
    path.join(
      ROOT,
      "artifacts/video-studio-stem-sample-final-2026-10-23/stem.video-project.json",
    ),
    "utf8",
  ),
);

test("edit-list v1：七镜头无缝时间线、旁白文本、素材账本、双画幅", () => {
  const list = buildEditList(project);
  validateEditList(list);
  assert.equal(list.format, "acs-edit-list");
  assert.equal(list.formatVersion, 2);
  assert.equal(list.timeline.length, 7);
  assert.equal(list.timeline[0].startFrame, 0);
  // 无缝衔接：上一镜 endFrame == 下一镜 startFrame（权威时间线约束）。
  for (let i = 1; i < list.timeline.length; i++)
    assert.equal(list.timeline[i].startFrame, list.timeline[i - 1].endFrame);
  assert.ok(list.timeline.every((entry) => entry.narrationText.length > 0));
  assert.deepEqual(list.aspects, ["landscape", "portrait"]);
  assert.equal(list.fps, 24);
  // 确定性：同项目两次导出逐字段一致（除 exportedAt）。
  const again = buildEditList(project);
  list.exportedAt = again.exportedAt = "fixed";
  assert.deepEqual(list, again);
});

test("edit-list 校验：断裂时间线 / 空时间线 / 坏格式拒绝", () => {
  const list = buildEditList(project);
  const broken = structuredClone(list);
  broken.timeline[3].startFrame += 10;
  assert.throws(() => validateEditList(broken), /startFrame/);
  assert.throws(() => validateEditList({ ...list, timeline: [] }), /形状无效/);
  assert.throws(
    () => validateEditList({ ...list, formatVersion: 3 }),
    /形状无效/,
  );
});

test("CLI 导出：原子写、旧项目可读、失败不留半成品", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "w5-edit-list-"));
  try {
    execFileSync(
      process.execPath,
      [
        "scripts/video/export-edit-list.mjs",
        "--project",
        path.join(
          ROOT,
          "artifacts/video-studio-stem-sample-final-2026-10-23/stem.video-project.json",
        ),
        "--out",
        dir,
      ],
      { cwd: ROOT, encoding: "utf8" },
    );
    const written = JSON.parse(
      readFileSync(path.join(dir, "edit-list.v2.json"), "utf8"),
    );
    validateEditList(written);
    assert.ok(!existsSync(path.join(dir, ".edit-list.tmp.json")));
    // 失败路径：坏项目 → 非零退出、无输出文件。
    const bad = path.join(dir, "bad.json");
    writeFileSync(bad, '{"schemaVersion": 9}');
    let failed = false;
    try {
      execFileSync(
        process.execPath,
        ["scripts/video/export-edit-list.mjs", "--project", bad, "--out", dir],
        { cwd: ROOT, encoding: "utf8" },
      );
    } catch {
      failed = true;
    }
    assert.ok(failed, "坏项目必须非零退出");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// —— C2：edit-list v2（转场合成时间线 + 可用媒体切片方案 + 素材核验） ——
const STEM_NARRATION = path.join(
  ROOT,
  "artifacts/video-studio-stem-sample-final-2026-10-23/narration",
);
const V1_ARTIFACT = path.join(
  ROOT,
  "artifacts/video-studio-w5-2026-10-24/edit-list.v1.json",
);

const withTransition = () => {
  const copy = structuredClone(project);
  copy.transitions = [{ boundary: 0, kind: "fade", durationMs: 500 }];
  return copy;
};

test("edit-list v2：v1 工件仍可读、未知版本拒绝", () => {
  const v1 = JSON.parse(readFileSync(V1_ARTIFACT, "utf8"));
  assert.equal(validateEditList(v1), true);
  const v2 = buildEditList(project);
  assert.equal(validateEditList(v2), true);
  assert.throws(
    () => validateEditList({ ...v2, formatVersion: 3 }),
    /形状无效/,
  );
});

test("edit-list v2：旧项目（无转场）时间线与留存 v1 工件逐字段一致", () => {
  const v2 = buildEditList(project, { narrationDir: STEM_NARRATION });
  validateEditList(v2);
  assert.deepEqual(v2.transitions, []);
  const v1 = JSON.parse(readFileSync(V1_ARTIFACT, "utf8"));
  assert.deepEqual(v2.timeline, v1.timeline);
});

test("edit-list v2：转场表示合成后时间线（借帧窗、区间不变、无缝保持）", () => {
  const list = buildEditList(withTransition());
  validateEditList(list);
  assert.equal(list.transitions.length, 1);
  const [transition] = list.transitions;
  assert.equal(transition.boundary, 0);
  assert.equal(transition.kind, "fade");
  // 500ms @24fps = 12 帧：左尾借 6（ceil）、右头借 6；左镜 3000ms = 72 帧。
  assert.equal(transition.frames, 12);
  assert.equal(transition.halfOut, 6);
  assert.equal(transition.halfIn, 6);
  assert.equal(transition.startFrame, 72 - 6);
  assert.equal(transition.baked, true);
  // 合成时间线：转场不改镜头区间与总时长（叠加而非缩短）。
  const plain = buildEditList(project);
  assert.deepEqual(list.timeline, plain.timeline);
  // 编辑器侧可编辑性限制必须有明确说明。
  assert.ok(
    list.compositionNotes.some((note) => note.includes("合成")),
    "须说明转场已合成进帧",
  );
});

test("edit-list v2 校验：转场窗损坏（错位/借帧越界/窗口重叠）拒绝", () => {
  const list = buildEditList(withTransition());
  const shifted = structuredClone(list);
  shifted.transitions[0].startFrame += 4;
  assert.throws(() => validateEditList(shifted), /startFrame/);

  const overflow = structuredClone(list);
  overflow.transitions[0].halfOut = 80; // 左镜只有 72 帧
  overflow.transitions[0].frames = 86;
  assert.throws(() => validateEditList(overflow), /借帧/);

  const both = structuredClone(project);
  both.transitions = [
    { boundary: 0, kind: "fade", durationMs: 1500 },
    { boundary: 1, kind: "fade", durationMs: 1500 },
  ];
  const overlapList = buildEditList(both);
  // 中镜 4010ms≈96 帧：左窗 halfIn 18 + 右窗 halfOut 18 = 36 < 96 → 合法；
  // 人为把右窗 halfOut 抬到吃满中镜（>96-18）→ 相邻窗口借帧合计越界。
  overlapList.transitions[1].halfOut = 90;
  overlapList.transitions[1].startFrame = overlapList.timeline[1].endFrame - 90;
  overlapList.transitions[1].frames = 108;
  assert.throws(() => validateEditList(overlapList), /重叠|借帧/);
});

test("edit-list v2：render 源摘要 + 逐镜切片方案（可用媒体）", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "c2-render-"));
  try {
    writeFileSync(path.join(dir, "landscape.mp4"), "fake-landscape-bytes");
    writeFileSync(path.join(dir, "portrait.mp4"), "fake-portrait-bytes");
    const list = buildEditList(project, { renderDir: dir });
    validateEditList(list);
    for (const aspect of ["landscape", "portrait"]) {
      assert.equal(list.renderSources[aspect].file, `${aspect}.mp4`);
      assert.match(list.renderSources[aspect].sha256, /^[0-9a-f]{64}$/);
      assert.ok(list.renderSources[aspect].bytes > 0);
    }
    assert.equal(list.renderSources.landscape.totalFrames, 624);
    for (const entry of list.timeline) {
      assert.deepEqual(entry.sourceSpans.map((span) => span.aspect).sort(), [
        "landscape",
        "portrait",
      ]);
      for (const span of entry.sourceSpans) {
        assert.equal(span.file, `${span.aspect}.mp4`);
        assert.equal(span.startFrame, entry.startFrame);
        assert.equal(span.endFrame, entry.endFrame);
      }
    }
    assert.ok(list.slicePlan.commandTemplate.includes("ffmpeg"));
    assert.ok(
      list.slicePlan.notes.some((note) => note.includes("重编码")),
      "切片方案须说明重编码保帧精度",
    );
    // 校验器：span 与条目不符 / 引用未知文件 → 拒绝。
    const broken = structuredClone(list);
    broken.timeline[2].sourceSpans[0].endFrame += 3;
    assert.throws(() => validateEditList(broken), /sourceSpans/);
    const unknown = structuredClone(list);
    unknown.timeline[0].sourceSpans[0].file = "ghost.mp4";
    assert.throws(() => validateEditList(unknown), /renderSources/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("edit-list v2：媒体仓素材核验（可读 + 摘要一致，坏账本大声拒绝）", () => {
  const store = mkdtempSync(path.join(tmpdir(), "c2-store-"));
  try {
    mkdirSync(path.join(store, "original"), { recursive: true });
    const bytes = Buffer.from("c2-media-original-content");
    const sha = createHash("sha256").update(bytes).digest("hex");
    const storeKey = `${sha.slice(0, 16)}.mp4`;
    writeFileSync(path.join(store, "original", storeKey), bytes);
    const asset = {
      assetId: crypto.randomUUID(),
      createdAt: "2026-10-25T00:00:00.000Z",
      origin: { kind: "local-upload", fileName: "clip.mp4" },
      original: {
        sha256: sha,
        bytes: bytes.length,
        durationMs: 4000,
        width: 1920,
        height: 1080,
        fps: 30,
        codec: "h264",
        hasAudio: false,
        storeKey,
      },
    };
    const withAsset = structuredClone(project);
    withAsset.mediaAssets = [asset];
    const list = buildEditList(withAsset, { mediaStore: store });
    validateEditList(list);
    assert.equal(list.mediaAssets[0].verified.file, `original/${storeKey}`);
    assert.equal(list.mediaAssets[0].verified.sha256, sha);

    // 摘要不符（账本被改 / 文件被换）→ 拒绝导出。
    const tampered = structuredClone(withAsset);
    tampered.mediaAssets[0].original.sha256 = "0".repeat(64);
    assert.throws(
      () => buildEditList(tampered, { mediaStore: store }),
      /摘要不符/,
    );
    // 文件不可读 → 拒绝导出。
    const missing = structuredClone(withAsset);
    missing.mediaAssets[0].original.storeKey = "deadbeefdeadbeef.mp4";
    assert.throws(
      () => buildEditList(missing, { mediaStore: store }),
      /不可读/,
    );
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test("edit-list v2 CLI：输出 v2 文件、out 落在源目录内拒绝且源文件分毫不动", () => {
  const renderDir = mkdtempSync(path.join(tmpdir(), "c2-cli-render-"));
  const out = mkdtempSync(path.join(tmpdir(), "c2-cli-out-"));
  const STEM_PROJECT = path.join(
    ROOT,
    "artifacts/video-studio-stem-sample-final-2026-10-23/stem.video-project.json",
  );
  try {
    writeFileSync(path.join(renderDir, "landscape.mp4"), "keep-me-landscape");
    writeFileSync(path.join(renderDir, "portrait.mp4"), "keep-me-portrait");
    execFileSync(
      process.execPath,
      [
        "scripts/video/export-edit-list.mjs",
        "--project",
        STEM_PROJECT,
        "--out",
        out,
        "--render",
        renderDir,
        "--narration",
        STEM_NARRATION,
      ],
      { cwd: ROOT, encoding: "utf8" },
    );
    const written = JSON.parse(
      readFileSync(path.join(out, "edit-list.v2.json"), "utf8"),
    );
    validateEditList(written);
    assert.ok(!existsSync(path.join(out, ".edit-list.tmp.json")));

    // out === renderDir：必须拒绝，且渲染产物未被触碰。
    let refused = false;
    try {
      execFileSync(
        process.execPath,
        [
          "scripts/video/export-edit-list.mjs",
          "--project",
          STEM_PROJECT,
          "--out",
          renderDir,
          "--render",
          renderDir,
        ],
        { cwd: ROOT, encoding: "utf8" },
      );
    } catch {
      refused = true;
    }
    assert.ok(refused, "out 目录与源目录重叠必须拒绝");
    assert.equal(
      readFileSync(path.join(renderDir, "landscape.mp4"), "utf8"),
      "keep-me-landscape",
    );
    assert.equal(
      readFileSync(path.join(renderDir, "portrait.mp4"), "utf8"),
      "keep-me-portrait",
    );
    // out 落在 narration 目录内同样拒绝。
    let narrationRefused = false;
    try {
      execFileSync(
        process.execPath,
        [
          "scripts/video/export-edit-list.mjs",
          "--project",
          STEM_PROJECT,
          "--out",
          STEM_NARRATION,
          "--narration",
          STEM_NARRATION,
        ],
        { cwd: ROOT, encoding: "utf8" },
      );
    } catch {
      narrationRefused = true;
    }
    assert.ok(narrationRefused, "out 目录落在旁白源目录必须拒绝");
  } finally {
    rmSync(renderDir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});
