import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { workspaceRoot } from "../render/render-local";
import { POST } from "./route";

const url = "http://localhost:3210/api/video/portable";
const mutableEnv = process.env as {
  NODE_ENV?: string;
  ACS_MEDIA_STORE?: string;
};

function request(payload: unknown, origin = "http://localhost:3210") {
  return new Request(url, {
    method: "POST",
    headers: { Origin: origin, Host: "localhost:3210" },
    body: JSON.stringify(payload),
  });
}

test("仅本地开发同源请求可以调用项目包接口", async () => {
  const previous = mutableEnv.NODE_ENV;
  try {
    mutableEnv.NODE_ENV = "production";
    assert.equal((await POST(request({}))).status, 503);
    mutableEnv.NODE_ENV = "development";
    assert.equal(
      (await POST(request({}, "https://outside.example"))).status,
      403,
    );
    assert.equal(
      (await POST(request({ action: "import", envelope: "bad" }))).status,
      400,
    );
  } finally {
    if (previous === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previous;
  }
});

test("项目包接口实际打包和恢复媒体及 Style Bible，篡改包被拒", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "acs-portable-route-"));
  const previousEnv = {
    NODE_ENV: mutableEnv.NODE_ENV,
    ACS_MEDIA_STORE: mutableEnv.ACS_MEDIA_STORE,
  };
  try {
    mutableEnv.NODE_ENV = "development";
    const sourceStore = path.join(dir, "source-store");
    const targetStore = path.join(dir, "target-store");
    mutableEnv.ACS_MEDIA_STORE = sourceStore;
    const project = JSON.parse(
      await readFile(
        path.join(
          workspaceRoot(),
          "artifacts/video-studio-composition-templates-2026-10-23/interior.video-project.json",
        ),
        "utf8",
      ),
    );
    const styleBible = JSON.parse(
      await readFile(
        path.join(
          workspaceRoot(),
          "artifacts/video-studio-composition-templates-2026-10-23/interior.style-bible.json",
        ),
        "utf8",
      ),
    );
    const bytes = Buffer.from("route-media-fixture");
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
    await mkdir(path.join(sourceStore, "original"), { recursive: true });
    await writeFile(path.join(sourceStore, "original", storeKey), bytes);
    const exported = await POST(
      request({ action: "export", project, styleBible }),
    );
    assert.equal(exported.status, 200);
    const envelope = await exported.text();
    assert.match(
      exported.headers.get("content-disposition") ?? "",
      /attachment/,
    );
    mutableEnv.ACS_MEDIA_STORE = targetStore;
    const restored = await POST(request({ action: "import", envelope }));
    assert.equal(restored.status, 200);
    const payload = (await restored.json()) as {
      project: typeof project;
      styleBible: typeof styleBible;
      installedMedia: number;
    };
    assert.deepEqual(payload.project, project);
    assert.deepEqual(payload.styleBible, styleBible);
    assert.equal(payload.installedMedia, 1);
    assert.deepEqual(
      await readFile(path.join(targetStore, "original", storeKey)),
      bytes,
    );
    const tampered = JSON.parse(envelope);
    tampered.files.find((item: { path: string }) =>
      item.path.startsWith("media/"),
    )!.base64 = "YQ==";
    assert.equal(
      (
        await POST(
          request({ action: "import", envelope: JSON.stringify(tampered) }),
        )
      ).status,
      400,
    );
  } finally {
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined)
        delete mutableEnv[name as keyof typeof previousEnv];
      else mutableEnv[name as keyof typeof previousEnv] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
