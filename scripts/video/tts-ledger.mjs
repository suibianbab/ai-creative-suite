// 所有同仓 Git worktree 共用一份本地 TTS 台账与缓存；避免每个检出各算 ¥50。
import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { atomicWriteFile, parseUsageLedger } from "./tts-sse.mjs";

function gitOutput(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

export function sharedTtsRoot(root) {
  return path.join(
    path.resolve(root, gitOutput(root, ["rev-parse", "--git-common-dir"])),
    "acs-video-tts",
  );
}

export function acquireTtsLock(sharedRoot) {
  mkdirSync(sharedRoot, { recursive: true });
  const file = path.join(sharedRoot, "active.lock");
  let fd;
  try {
    fd = openSync(file, "wx");
    writeFileSync(fd, `${process.pid}\n`);
  } catch {
    throw new Error(
      `已有 TTS 计费任务或遗留锁 ${file}；请核实进程后再重试，不会发起计费请求`,
    );
  }
  const release = () => {
    try {
      closeSync(fd);
      unlinkSync(file);
    } catch {
      // 退出时只能尽力清理；残留锁让后续计费安全地停住。
    }
  };
  process.once("exit", release);
  return release;
}

export function migrateLegacyLedgers(root, sharedRoot) {
  const file = path.join(sharedRoot, "tts-usage.jsonl");
  const entries = existsSync(file)
    ? parseUsageLedger(readFileSync(file, "utf8"))
    : [];
  const initialCount = entries.length;
  const worktrees = gitOutput(root, ["worktree", "list", "--porcelain"])
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
  const seen = new Set(
    entries.map((entry) => entry.requestId || JSON.stringify(entry)),
  );
  for (const worktree of worktrees) {
    const legacy = path.join(worktree, "artifacts", "tts-usage.jsonl");
    if (!existsSync(legacy)) continue;
    for (const entry of parseUsageLedger(readFileSync(legacy, "utf8"))) {
      const key = entry.requestId || JSON.stringify(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
    }
  }
  if (!existsSync(file) || entries.length !== initialCount) {
    mkdirSync(sharedRoot, { recursive: true });
    atomicWriteFile(
      file,
      entries.map((entry) => JSON.stringify(entry)).join("\n") +
        (entries.length ? "\n" : ""),
    );
  }
  return file;
}
