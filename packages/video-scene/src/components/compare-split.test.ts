import assert from "node:assert/strict";
import test from "node:test";
import {
  compareSplitV1,
  compareSplitV2,
  validateParams,
} from "./compare-split.js";

const validate = validateParams as (v: unknown) => {
  enterMs: number;
  sequence: string;
};
const base: Record<string, unknown> = {
  title: "对比",
  metricLabel: "指标",
  beforeLabel: "前",
  beforeValue: "1",
  beforeNote: "旧",
  afterLabel: "后",
  afterValue: "2",
  afterNote: "新",
  deltaText: "1→2",
  deltaPositive: true,
};

// —— Codex P1-2 / P2-3 / P2-5 回归 ——
test("Codex P1-2：显式越界 enterMs 拒绝，undefined 用缺省", () => {
  assert.equal(validate(base).enterMs, 1200);
  assert.equal(validate({ ...base, enterMs: 3000 }).enterMs, 3000);
  assert.throws(() => validate({ ...base, enterMs: 0 }), /enterMs/);
  assert.throws(() => validate({ ...base, enterMs: 6000 }), /enterMs/);
  assert.throws(() => validate({ ...base, enterMs: Number.NaN }), /enterMs/);
});

test("Codex P2-3：sequence 缺省 stagger、合法 sync，非法拒绝", () => {
  assert.equal(validate(base).sequence, "stagger");
  assert.equal(validate({ ...base, sequence: "sync" }).sequence, "sync");
  assert.throws(() => validate({ ...base, sequence: "random" }), /sequence/);
});

test("旧 @1 继续接受 enterMs，短镜头保持固定徽章时序", () => {
  assert.doesNotThrow(() =>
    compareSplitV1.validateParams({ ...base, enterMs: 1200 }),
  );
  assert.throws(
    () => compareSplitV1.validateParams({ ...base, sequence: "sync" }),
    /sequence/,
  );
  const tree = compareSplitV1.render(
    {
      componentId: "compare-split",
      componentVersion: 1,
      durationMs: 1000,
      seed: 1,
      background: "#ffffff",
      params: { ...base, enterMs: 1200 },
    },
    {
      frame: 23,
      fps: 24,
      durationFrames: 24,
      width: 1280,
      height: 720,
      random: () => 0.5,
    },
  );
  assert.equal(tree.children?.[12]?.attrs?.opacity, 0);
});

test("@2 合法极值在最后实际帧完成全部入场，横竖画幅均无非有限透明度", () => {
  for (const durationMs of [42, 200, 1000, 2000, 4000]) {
    for (const enterMs of [200, 1200, 5000]) {
      for (const sequence of ["sync", "stagger"] as const) {
        for (const portrait of [false, true]) {
          const durationFrames = Math.round((durationMs * 24) / 1000);
          const tree = compareSplitV2.render(
            {
              componentId: "compare-split",
              componentVersion: 2,
              durationMs,
              seed: 1,
              background: "#ffffff",
              params: { ...base, enterMs, sequence },
            },
            {
              frame: durationFrames - 1,
              fps: 24,
              durationFrames,
              width: portrait ? 720 : 1280,
              height: portrait ? 1280 : 720,
              random: () => 0.5,
            },
          );
          const opacities = tree.children
            ?.map((node) => node.attrs?.opacity)
            .filter((value): value is number => typeof value === "number");
          assert.ok(opacities && opacities.length > 0);
          const keyOpacities = [1, 3, 7, 11, 12].map(
            (index) => tree.children?.[index]?.attrs?.opacity,
          );
          assert.ok(
            opacities.every(Number.isFinite) &&
              keyOpacities.every(
                (value) => typeof value === "number" && value >= 0.999,
              ),
            `${durationMs}ms/${enterMs}ms/${sequence}/${portrait ? "竖版" : "横版"}: ${keyOpacities}`,
          );
        }
      }
    }
  }
});
