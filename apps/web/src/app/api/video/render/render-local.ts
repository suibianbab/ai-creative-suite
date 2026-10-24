import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { StyleBible, VideoProject } from "@acs/video-document";

const MAX_JOBS = 30;
const RENDER_TIMEOUT_MS = 600_000;
const NARRATION_TIMEOUT_MS = 900_000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function workspaceRoot(): string {
  const cwd = process.cwd();
  for (const root of [cwd, path.resolve(cwd, "../..")]) {
    if (existsSync(path.join(root, "scripts/video/render-scene.mjs")))
      return root;
  }
  throw new Error("找不到 Video Studio 渲染脚本");
}

export function renderJobRoot(): string {
  return path.join(workspaceRoot(), ".tools", "video-workbench-renders");
}

export function renderOutputPath(jobId: string, aspect: string): string {
  if (!UUID.test(jobId) || !["landscape", "portrait"].includes(aspect))
    throw new Error("无效的导出编号或画幅");
  return path.join(renderJobRoot(), jobId, "render", `${aspect}.mp4`);
}

export function pruneOldestJobs(jobs: string): void {
  const resolvedRoot = path.resolve(jobs);
  const entries = readdirSync(resolvedRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && UUID.test(entry.name))
    .map((entry) => ({
      name: entry.name,
      mtime: statSync(path.join(resolvedRoot, entry.name)).mtimeMs,
    }))
    .sort((left, right) => left.mtime - right.mtime);
  while (entries.length >= MAX_JOBS) {
    const oldest = entries.shift();
    if (!oldest) break;
    const target = path.resolve(resolvedRoot, oldest.name);
    if (path.dirname(target) !== resolvedRoot || !UUID.test(oldest.name))
      throw new Error("导出缓存清理路径无效");
    rmSync(target, { recursive: true });
  }
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function runRender(
  args: string[],
  root: string,
  timeoutMs = RENDER_TIMEOUT_MS,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      windowsHide: true,
      shell: false,
    });
    let output = "";
    const append = (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-12_000);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timer = setTimeout(() => {
      if (process.platform === "win32" && child.pid) {
        try {
          execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
          });
        } catch {
          child.kill();
        }
      } else child.kill();
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else
        reject(new Error(`出片失败（exit ${code}）：${output.slice(-1200)}`));
    });
  });
}

function cleanupFailedJob(dir: string): void {
  try {
    rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  } catch (error) {
    // Windows 子进程可能短暂持有文件句柄；清理错误不能遮住原始失败原因。
    console.warn("视频作业目录清理失败", dir, error);
  }
}

export async function renderLocalProject(
  project: VideoProject,
  bible: StyleBible | null,
  options: { narrated?: boolean } = {},
): Promise<{
  project: VideoProject;
  alignedProject?: VideoProject;
  downloads: Array<{
    aspect: "landscape" | "portrait";
    url: string;
    digest: string;
    bytes: number;
  }>;
}> {
  const root = workspaceRoot();
  const jobs = renderJobRoot();
  mkdirSync(jobs, { recursive: true });
  pruneOldestJobs(jobs);
  const jobId = randomUUID();
  const dir = path.join(jobs, jobId);
  mkdirSync(dir);
  const projectFile = path.join(dir, "project.video-project.json");
  writeFileSync(projectFile, JSON.stringify(project, null, 2));
  let alignedProject: VideoProject | undefined;
  const args = [
    path.join(root, "scripts/video/render-scene.mjs"),
    "--project",
    projectFile,
    "--out",
    path.join(dir, "render"),
  ];
  if (bible) {
    const bibleFile = path.join(dir, "style-bible.json");
    writeFileSync(bibleFile, JSON.stringify(bible, null, 2));
    args.push("--style-bible", bibleFile);
  }
  try {
    if (options.narrated) {
      const narrationDir = path.join(dir, "narration");
      await runRender(
        [
          path.join(root, "scripts/video/tts-narration.mjs"),
          "--project",
          projectFile,
          "--out",
          narrationDir,
        ],
        root,
        NARRATION_TIMEOUT_MS,
      );
      const afterNarration = JSON.parse(
        readFileSync(projectFile, "utf8"),
      ) as VideoProject;
      if (afterNarration.savedVersion !== project.savedVersion)
        alignedProject = afterNarration;
      args.push("--narration", narrationDir);
    }
    await runRender(args, root);
  } catch (error) {
    cleanupFailedJob(dir);
    throw error;
  }
  try {
    const rendered = JSON.parse(
      readFileSync(projectFile, "utf8"),
    ) as VideoProject;
    const downloads = await Promise.all(
      (["landscape", "portrait"] as const).map(async (aspect) => {
        const file = renderOutputPath(jobId, aspect);
        const bytes = statSync(file).size;
        if (bytes < 1000) throw new Error(`${aspect} 出片为空`);
        const digest = await sha256File(file);
        return {
          aspect,
          url: `/api/video/render/${jobId}/${aspect}`,
          digest,
          bytes,
        };
      }),
    );
    return { project: rendered, alignedProject, downloads };
  } catch (error) {
    cleanupFailedJob(dir);
    throw error;
  }
}
