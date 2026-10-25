import assert from "node:assert/strict";
import test from "node:test";
import { timelineMilestones, validateParams } from "./timeline-milestones.js";

const validate = validateParams as (v: unknown) => {
  enterMs: number;
  sequence: string;
};
const base: Record<string, unknown> = {
  title: "时间轴",
  milestones: [
    { date: "Q1", label: "一", status: "done" },
    { date: "Q2", label: "二", status: "pending" },
  ],
};

// —— Codex P1-1 / P1-2 / P2-5 回归 ——
test("Codex P1-2：显式越界 enterMs 拒绝，undefined 用缺省 1400", () => {
  assert.equal(validate(base).enterMs, 1400);
  assert.equal(validate({ ...base, enterMs: 3000 }).enterMs, 3000);
  assert.throws(() => validate({ ...base, enterMs: 0 }), /enterMs/);
  assert.throws(() => validate({ ...base, enterMs: 9999 }), /enterMs/);
});

test("Codex P2-5：sequence 缺省 stagger、合法 sync", () => {
  assert.equal(validate(base).sequence, "stagger");
  assert.equal(validate({ ...base, sequence: "sync" }).sequence, "sync");
});

test("Codex P1-1：不同 enterMs 产生不同渲染输出", () => {
  const spec = (enterMs: number) => ({
    specVersion: 1 as const,
    componentId: "timeline-milestones",
    componentVersion: 1,
    durationMs: 4000,
    seed: 1,
    background: "#ffffff",
    params: { ...base, enterMs },
  });
  const ctx = {
    frame: 12,
    fps: 24,
    durationFrames: 96,
    width: 1280,
    height: 720,
    random: () => 0.5,
  };
  // tMs = 12/24*1000 = 500ms：enterMs=1400 时标题仅部分入场；enterMs=300 时应已完全入场。
  const slow = timelineMilestones.render(spec(1400), ctx);
  const fast = timelineMilestones.render(spec(300), ctx);
  const slowOpacity = JSON.stringify(slow).match(/"opacity":([\d.]+)/)?.[1];
  const fastOpacity = JSON.stringify(fast).match(/"opacity":([\d.]+)/)?.[1];
  assert.ok(
    Number(fastOpacity) > Number(slowOpacity),
    `快入场透明度应更高（fast=${fastOpacity} > slow=${slowOpacity}）`,
  );
});
