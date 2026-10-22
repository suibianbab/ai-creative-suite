import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pruneOldestJobs, renderOutputPath } from "./render-local";

test("缓存留出新任务位置时按时间淘汰最旧目录且不触碰其他目录", () => {
  const parent = path.resolve(os.tmpdir());
  const jobs = mkdtempSync(path.join(parent, "video-p4-prune-"));
  assert.equal(path.dirname(path.resolve(jobs)), parent);
  try {
    const ids = Array.from({ length: 31 }, () => randomUUID());
    ids.forEach((id, index) => {
      const dir = path.join(jobs, id);
      mkdirSync(dir);
      const date = new Date(1_700_000_000_000 + index * 1000);
      utimesSync(dir, date, date);
    });
    mkdirSync(path.join(jobs, "do-not-touch"));
    pruneOldestJobs(jobs);
    assert.equal(existsSync(path.join(jobs, ids[0]!)), false);
    assert.equal(existsSync(path.join(jobs, ids[1]!)), false);
    assert.equal(existsSync(path.join(jobs, ids[2]!)), true);
    assert.equal(existsSync(path.join(jobs, "do-not-touch")), true);
    assert.equal(readdirSync(jobs).length, 30);
  } finally {
    assert.equal(path.dirname(path.resolve(jobs)), parent);
    rmSync(jobs, { recursive: true, force: true });
  }
});

test("下载路径只接受完整 UUID 和两种画幅", () => {
  assert.throws(() => renderOutputPath("../escape", "landscape"));
  assert.throws(() => renderOutputPath(randomUUID(), "square"));
  assert.match(renderOutputPath(randomUUID(), "portrait"), /portrait\.mp4$/);
});
