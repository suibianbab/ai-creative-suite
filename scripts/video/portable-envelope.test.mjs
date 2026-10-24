import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createPortableEnvelope,
  restorePortableEnvelope,
} from "./portable-envelope.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const projectFixture = path.join(
  root,
  "artifacts/video-studio-composition-templates-2026-10-23/interior.video-project.json",
);
const bibleFixture = path.join(
  root,
  "artifacts/video-studio-composition-templates-2026-10-23/interior.style-bible.json",
);

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "acs-envelope-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const project = JSON.parse(await readFile(projectFixture, "utf8"));
  const styleBible = JSON.parse(await readFile(bibleFixture, "utf8"));
  const bytes = Buffer.from("portable-envelope-fixture");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const storeKey = `${sha256.slice(0, 16)}.mp4`;
  project.mediaAssets = [
    {
      assetId: randomUUID(),
      createdAt: new Date().toISOString(),
      origin: { kind: "local-upload", fileName: "fixture.mp4" },
      original: {
        sha256,
        bytes: bytes.length,
        durationMs: 2000,
        width: 640,
        height: 360,
        fps: 24,
        codec: "h264",
        hasAudio: false,
        storeKey,
      },
    },
  ];
  const sourceStore = path.join(dir, "source-store");
  await mkdir(path.join(sourceStore, "original"), { recursive: true });
  await writeFile(path.join(sourceStore, "original", storeKey), bytes);
  return { dir, project, styleBible, bytes, sourceStore, storeKey };
}

test("单文件包复用目录包校验并在新媒体仓恢复项目与 Style Bible", async (t) => {
  const input = await fixture(t);
  const text = await createPortableEnvelope({
    project: input.project,
    styleBible: input.styleBible,
    storeRoot: input.sourceStore,
  });
  const targetStore = path.join(input.dir, "target-store");
  const restored = await restorePortableEnvelope({
    text,
    storeRoot: targetStore,
  });
  assert.deepEqual(restored.project, input.project);
  assert.deepEqual(restored.styleBible, input.styleBible);
  assert.equal(restored.installedMedia, 1);
  assert.deepEqual(
    await readFile(path.join(targetStore, "original", input.storeKey)),
    input.bytes,
  );
});

test("篡改内容、漏文件、重复路径、路径穿越均在发布项目之前拒绝", async (t) => {
  const input = await fixture(t);
  const text = await createPortableEnvelope({
    project: input.project,
    styleBible: input.styleBible,
    storeRoot: input.sourceStore,
  });
  const base = JSON.parse(text);
  const targetStore = path.join(input.dir, "target-store");
  const variants = [
    (() => {
      const value = structuredClone(base);
      const media = value.files.find((item) => item.path.startsWith("media/"));
      media.base64 = Buffer.from("tampered").toString("base64");
      return value;
    })(),
    {
      ...base,
      files: base.files.filter((item) => item.path !== "style-bible.json"),
    },
    { ...base, files: [...base.files, base.files[0]] },
    {
      ...base,
      files: [
        ...base.files.slice(0, -1),
        { path: "../escape", base64: "YQ==" },
      ],
    },
  ];
  for (const value of variants) {
    await assert.rejects(
      restorePortableEnvelope({
        text: JSON.stringify(value),
        storeRoot: targetStore,
      }),
      /项目包|浏览器项目包/,
    );
  }
  await assert.rejects(
    readFile(path.join(targetStore, "original", input.storeKey)),
  );
});
