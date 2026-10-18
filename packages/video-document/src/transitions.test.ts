// P1 转场（Feature ④ spec R2）：dip-to-black 帧数学纯函数单测——对半 split、
// 线性斜率边界精确值、奇数 T 的 ceil/floor、span 不足大声拒绝。
import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveTransitionWindows,
  transitionOverlayAt,
} from "./transitions.js";

// spans：3 镜头 [48, 74, 48] → startFrame [0, 48, 122]，total 170。
const SPANS = [
  { startFrame: 0, frames: 48 },
  { startFrame: 48, frames: 74 },
  { startFrame: 122, frames: 48 },
];

// 右窗斜率 1 - k/halfIn 与左窗 (i+1)/halfOut 是同一有理数的不同浮点路径
// （1-5/6 ≠ 1/6 末位），精确相等断言会误报——统一 1e-9 容差。
function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≉ ${expected}`);
}

test("resolveTransitionWindows 对半 split 且窗口完全在 span 内", () => {
  // 500ms @24fps → T=12 → halfOut=6（左尾 6 帧）、halfIn=6（右头 6 帧）
  const windows = resolveTransitionWindows(
    [{ boundary: 0, kind: "fade", durationMs: 500 }],
    SPANS,
    24,
  );
  const w = windows[0]!;
  assert.equal(w.startFrame, 42); // 48 - 6
  assert.equal(w.frames, 12);
  assert.deepEqual([w.halfOut, w.halfIn], [6, 6]);
});

test("transitionOverlayAt 线性斜率与边界精确值", () => {
  const ws = resolveTransitionWindows(
    [{ boundary: 0, kind: "fade", durationMs: 500 }],
    SPANS,
    24,
  );
  assert.equal(transitionOverlayAt(ws, 41), 0); // 窗外
  near(transitionOverlayAt(ws, 42), 1 / 6); // 左窗首帧
  assert.equal(transitionOverlayAt(ws, 47), 1); // 左尾帧 = 全黑
  assert.equal(transitionOverlayAt(ws, 48), 1); // 右首帧 = 全黑
  near(transitionOverlayAt(ws, 53), 1 / 6); // 右窗末帧
  assert.equal(transitionOverlayAt(ws, 54), 0); // 窗外
});

test("transitionOverlayAt 奇数 T 时 halfOut=ceil/halfIn=floor", () => {
  // 300ms @24fps → T=round(7.2)=7 → halfOut=4, halfIn=3
  const ws = resolveTransitionWindows(
    [{ boundary: 1, kind: "fade", durationMs: 300 }],
    SPANS,
    24,
  );
  assert.deepEqual([ws[0]!.halfOut, ws[0]!.halfIn], [4, 3]);
  assert.equal(transitionOverlayAt(ws, 121), 1); // 左尾（122-1）
  assert.equal(transitionOverlayAt(ws, 122), 1); // 右首
  near(transitionOverlayAt(ws, 124), 1 / 3); // 右窗末（125 起为 0）
  assert.equal(transitionOverlayAt(ws, 125), 0);
});

test("resolveTransitionWindows span 不足大声拒绝并指路", () => {
  // 极端：两镜头各 3 帧 + 500ms → T=12, halfOut=6 ≥ 3 → 抛错
  const tiny = [
    { startFrame: 0, frames: 3 },
    { startFrame: 3, frames: 3 },
  ];
  assert.throws(
    () =>
      resolveTransitionWindows(
        [{ boundary: 0, kind: "fade", durationMs: 500 }],
        tiny,
        24,
      ),
    /缩短|durationMs/,
  );
});

test("resolveTransitionWindows 相邻边界合计借空共享中 span → 大声拒绝", () => {
  // [48, 11, 48] 两条 500ms：逐边界 6+6 各自合法，但中 span 合计 12 ≥ 11
  // → 窗口重叠且中镜头无可见帧（spec：无重叠、每 span 至少 1 帧可见）
  const shared = [
    { startFrame: 0, frames: 48 },
    { startFrame: 48, frames: 11 },
    { startFrame: 59, frames: 48 },
  ];
  assert.throws(
    () =>
      resolveTransitionWindows(
        [
          { boundary: 0, kind: "fade", durationMs: 500 },
          { boundary: 1, kind: "fade", durationMs: 500 },
        ],
        shared,
        24,
      ),
    /合计|缩短/,
  );
});

test("resolveTransitionWindows 相邻边界合计留有余量 → 窗口不重叠（钉住现状）", () => {
  // [48, 13, 48]：窗口 [42,54) 与 [55,67)，中镜头帧 54 可见——钉住合计校验
  // 不误伤有余量的相邻配置
  const shared = [
    { startFrame: 0, frames: 48 },
    { startFrame: 48, frames: 13 },
    { startFrame: 61, frames: 48 },
  ];
  const ws = resolveTransitionWindows(
    [
      { boundary: 0, kind: "fade", durationMs: 500 },
      { boundary: 1, kind: "fade", durationMs: 500 },
    ],
    shared,
    24,
  );
  assert.equal(ws.length, 2);
  assert.ok(ws[1]!.startFrame >= ws[0]!.startFrame + ws[0]!.frames);
});
