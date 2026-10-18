import assert from "node:assert/strict";
import test from "node:test";
import type { FrameContext } from "../registry.js";
import type { SvgNode } from "../svg.js";
import { loadingProgress } from "./loading-progress.js";

function collect(node: SvgNode, tag: string, out: SvgNode[] = []): SvgNode[] {
  if (node.tag === tag) out.push(node);
  for (const child of node.children ?? []) collect(child, tag, out);
  return out;
}

const BASE = {
  title: "进度",
  label: "加载资料",
  targetPercent: 80,
  inkColor: "#2f2f2f",
  accentColor: "#e05a2b",
  progressMs: 1000,
};

function specWith(params: unknown) {
  return {
    componentId: "loading-progress",
    componentVersion: 1,
    params,
    seed: 1,
    background: "#ffffff",
    durationMs: 3000,
  };
}

function makeCtx(overrides: Partial<FrameContext> = {}): FrameContext {
  return {
    frame: 24,
    fps: 24,
    width: 1920,
    height: 1080,
    ...overrides,
  } as FrameContext;
}

test("校验表：非法 params 逐条拒绝，合法返回原引用", () => {
  const cases: Array<[unknown, string]> = [
    ["nope", "loading-progress params 必须是对象"],
    [
      { ...BASE, title: "a".repeat(41) },
      "loading-progress params.title 必须是 ≤40 个字符",
    ],
    [
      { ...BASE, label: "" },
      "loading-progress params.label 必须是 1..12 个字符",
    ],
    [
      { ...BASE, targetPercent: 0 },
      "loading-progress params.targetPercent 必须是 1..100 的整数",
    ],
    [
      { ...BASE, targetPercent: 101 },
      "loading-progress params.targetPercent 必须是 1..100 的整数",
    ],
    [
      { ...BASE, targetPercent: 72.5 },
      "loading-progress params.targetPercent 必须是 1..100 的整数",
    ],
    [
      { ...BASE, progressMs: 399 },
      "loading-progress params.progressMs 必须是 400..2000 的整数",
    ],
    [
      { ...BASE, progressMs: 2001 },
      "loading-progress params.progressMs 必须是 400..2000 的整数",
    ],
    [
      { ...BASE, inkColor: "#12345" },
      "loading-progress params.inkColor 必须是 #rrggbb",
    ],
    [
      { ...BASE, accentColor: "orange" },
      "loading-progress params.accentColor 必须是 #rrggbb",
    ],
  ];
  for (const [params, message] of cases) {
    assert.throws(() => loadingProgress.validateParams(params), { message });
  }
  const ok = { ...BASE };
  assert.equal(loadingProgress.validateParams(ok), ok);
});

test("中途弧与数字同步：tMs 250 → e=0.578125、dashoffset 0.5375、percent 46%", () => {
  // frame 6 @24fps → tMs 250；e = 1−0.75³ = 0.578125（二进制精确）；
  // frac = 0.8×0.578125 = 0.4625；percent = round(80×0.578125) = round(46.25) = 46
  const node = loadingProgress.render(
    specWith(BASE) as never,
    makeCtx({ frame: 6 }),
  );
  const circles = collect(node, "circle");
  const arc = circles.find((c) => c.attrs?.["stroke-dashoffset"] !== undefined);
  assert.equal(arc?.attrs?.["stroke-dashoffset"], 0.5375);
  const percent = collect(node, "text").find((t) => t.text?.endsWith("%"));
  assert.equal(percent?.text, "46%");
});

test("p=0：dashoffset 1、percent 0%、轨道全圆", () => {
  const node = loadingProgress.render(
    specWith(BASE) as never,
    makeCtx({ frame: 0 }),
  );
  const circles = collect(node, "circle");
  const track = circles.find((c) => c.attrs?.opacity === 0.12);
  assert.ok(track);
  const arc = circles.find((c) => c.attrs?.["stroke-dashoffset"] !== undefined);
  assert.equal(arc?.attrs?.["stroke-dashoffset"], 1);
  const percent = collect(node, "text").find((t) => t.text?.endsWith("%"));
  assert.equal(percent?.text, "0%");
});

test("p≥1 保持：tMs 2000 后弧与数字停在目标不再变", () => {
  const at = (frame: number) => {
    const node = loadingProgress.render(
      specWith(BASE) as never,
      makeCtx({ frame }),
    );
    const arc = collect(node, "circle").find(
      (c) => c.attrs?.["stroke-dashoffset"] !== undefined,
    );
    const percent = collect(node, "text").find((t) => t.text?.endsWith("%"));
    return [arc?.attrs?.["stroke-dashoffset"], percent?.text];
  };
  assert.deepEqual(at(48), [0.2, "80%"]);
  assert.deepEqual(at(60), [0.2, "80%"]);
});

test("target=100 完成态：dashoffset 0、percent 100%", () => {
  const full = { ...BASE, targetPercent: 100 };
  const node = loadingProgress.render(
    specWith(full) as never,
    makeCtx({ frame: 48 }),
  );
  const arc = collect(node, "circle").find(
    (c) => c.attrs?.["stroke-dashoffset"] !== undefined,
  );
  assert.equal(arc?.attrs?.["stroke-dashoffset"], 0);
  assert.equal(
    collect(node, "text").find((t) => t.text?.endsWith("%"))?.text,
    "100%",
  );
});

test("target=1 边界：结束 percent 1%、dashoffset 0.99", () => {
  const tiny = { ...BASE, targetPercent: 1 };
  const node = loadingProgress.render(
    specWith(tiny) as never,
    makeCtx({ frame: 48 }),
  );
  const arc = collect(node, "circle").find(
    (c) => c.attrs?.["stroke-dashoffset"] !== undefined,
  );
  assert.equal(arc?.attrs?.["stroke-dashoffset"], 0.99);
  assert.equal(
    collect(node, "text").find((t) => t.text?.endsWith("%"))?.text,
    "1%",
  );
});

test("环几何：r 180 stroke 22、rotate(-90 500 520) 自 12 点、accent 圆头", () => {
  const node = loadingProgress.render(
    specWith(BASE) as never,
    makeCtx({ frame: 6 }),
  );
  const arc = collect(node, "circle").find(
    (c) => c.attrs?.["stroke-dashoffset"] !== undefined,
  );
  assert.equal(arc?.attrs?.r, 180);
  assert.equal(arc?.attrs?.["stroke-width"], 22);
  assert.equal(arc?.attrs?.stroke, "#e05a2b");
  assert.equal(arc?.attrs?.["stroke-linecap"], "round");
  assert.equal(arc?.attrs?.pathLength, 1);
  assert.equal(arc?.attrs?.transform, "rotate(-90 500 520)");
});

test("百分比文本：环心 (500,520) 字号 96；label (500,780)", () => {
  const node = loadingProgress.render(
    specWith(BASE) as never,
    makeCtx({ frame: 6 }),
  );
  const percent = collect(node, "text").find((t) => t.text?.endsWith("%"));
  assert.equal(percent?.attrs?.x, 500);
  assert.equal(percent?.attrs?.y, 520);
  assert.equal(percent?.attrs?.["font-size"], 96);
  assert.equal(percent?.attrs?.fill, "#2f2f2f");
  const label = collect(node, "text").find((t) => t.text === "加载资料");
  assert.equal(label?.attrs?.y, 780);
});

test("帧确定性：同 spec 同帧双调 deepEqual（分数帧）", () => {
  const a = loadingProgress.render(
    specWith(BASE) as never,
    makeCtx({ frame: 17.28 }),
  );
  const b = loadingProgress.render(
    specWith(BASE) as never,
    makeCtx({ frame: 17.28 }),
  );
  assert.deepEqual(a, b);
});
