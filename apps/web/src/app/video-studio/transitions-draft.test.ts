// P1 转场（Feature ④ spec R4）：工作台转场草稿纯逻辑单测——组件只做渲染/状态
// 接线，草稿构造/校验/patch 全在本模块（沿 shot-edit.ts 模式）。
import assert from "node:assert/strict";
import test from "node:test";
import type { ShotTransition } from "@acs/video-document";
import {
  buildTransitionsPatch,
  previewTransitionWindows,
  transitionsAfterEdit,
  transitionsDraftFromProject,
} from "./transitions-draft.js";

test("transitionsDraftFromProject：每边界一行，缺省无转场，已有条目回填", () => {
  // 3 镜头 → 2 个边界（0..shots.length-2 = 0..1）
  const rows = transitionsDraftFromProject(3, [
    { boundary: 1, kind: "fade", durationMs: 500 },
  ]);
  assert.deepEqual(rows, [
    { boundary: 0, kind: "none", durationMs: 500 },
    { boundary: 1, kind: "fade", durationMs: 500 },
  ]);
});

test("transitionsDraftFromProject：镜头增删后越界条目丢弃（不抛错）", () => {
  const rows = transitionsDraftFromProject(2, [
    { boundary: 1, kind: "fade", durationMs: 500 },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.kind, "none");
});

test("buildTransitionsPatch：全无 → undefined（文档不加键）", () => {
  const rows = transitionsDraftFromProject(3, []);
  assert.equal(buildTransitionsPatch(rows).patch, undefined);
  assert.equal(buildTransitionsPatch(rows).error, null);
});

test("buildTransitionsPatch：合法 fade 行入 patch，越界时长行内拒绝", () => {
  const rows = transitionsDraftFromProject(2, [
    { boundary: 0, kind: "fade", durationMs: 500 },
  ]);
  const ok = buildTransitionsPatch(rows);
  assert.deepEqual(ok.patch, [{ boundary: 0, kind: "fade", durationMs: 500 }]);
  assert.equal(ok.error, null);
  const bad = buildTransitionsPatch([
    { boundary: 0, kind: "fade", durationMs: 99 },
  ]);
  assert.equal(bad.patch, undefined);
  assert.match(bad.error!, /100..2000/);
});

test("transitionsAfterEdit：非法时长保持文档上一合法转场（同引用）", () => {
  // 键盘编辑的中间态（如选中 500 改打 1500 的首键 1）不得清除已配置转场：
  // 返回 previous 同引用 → 文档内容不动、草稿重建 effect 不触发（行不被重置）
  const previous: ShotTransition[] = [
    { boundary: 0, kind: "fade", durationMs: 500 },
  ];
  const { transitions, error } = transitionsAfterEdit(
    [
      { boundary: 0, kind: "fade", durationMs: 1 },
      { boundary: 1, kind: "none", durationMs: 500 },
    ],
    previous,
  );
  assert.match(error!, /100..2000/);
  assert.equal(transitions, previous);
});

test("transitionsAfterEdit：非法且文档本无转场 → 仍无键", () => {
  const { transitions, error } = transitionsAfterEdit(
    [{ boundary: 0, kind: "fade", durationMs: 2001 }],
    undefined,
  );
  assert.match(error!, /100..2000/);
  assert.equal(transitions, undefined);
});

test("transitionsAfterEdit：全无 → undefined（删键）；合法 → patch", () => {
  assert.equal(
    transitionsAfterEdit(
      [
        { boundary: 0, kind: "none", durationMs: 500 },
        { boundary: 1, kind: "none", durationMs: 500 },
      ],
      [{ boundary: 0, kind: "fade", durationMs: 500 }],
    ).transitions,
    undefined,
  );
  assert.deepEqual(
    transitionsAfterEdit(
      [{ boundary: 0, kind: "fade", durationMs: 1500 }],
      undefined,
    ).transitions,
    [{ boundary: 0, kind: "fade", durationMs: 1500 }],
  );
});

test("previewTransitionWindows：span 不足降级为告警而不是抛错", () => {
  // 2000ms @24fps → T=48, halfOut=24 ≥ 左 span 10 帧：预览不炸整页
  const { windows, warning } = previewTransitionWindows(
    [{ boundary: 0, kind: "fade", durationMs: 2000 }],
    [
      { startFrame: 0, frames: 10 },
      { startFrame: 10, frames: 48 },
    ],
    24,
  );
  assert.deepEqual(windows, []);
  assert.match(warning!, /缩短|durationMs/);
});

test("previewTransitionWindows：相邻边界合计借空中 span → 告警", () => {
  const { windows, warning } = previewTransitionWindows(
    [
      { boundary: 0, kind: "fade", durationMs: 500 },
      { boundary: 1, kind: "fade", durationMs: 500 },
    ],
    [
      { startFrame: 0, frames: 48 },
      { startFrame: 48, frames: 11 },
      { startFrame: 59, frames: 48 },
    ],
    24,
  );
  assert.deepEqual(windows, []);
  assert.match(warning!, /合计|缩短/);
});

test("previewTransitionWindows：正常配置原样返回窗口且无告警", () => {
  const { windows, warning } = previewTransitionWindows(
    [{ boundary: 0, kind: "fade", durationMs: 500 }],
    [
      { startFrame: 0, frames: 48 },
      { startFrame: 48, frames: 48 },
    ],
    24,
  );
  assert.equal(windows.length, 1);
  assert.equal(windows[0]!.startFrame, 42);
  assert.equal(warning, null);
});

test("previewTransitionWindows：无转场 → 空窗口无告警（A1 字节不变口径）", () => {
  const spans = [{ startFrame: 0, frames: 48 }];
  assert.deepEqual(previewTransitionWindows(undefined, spans, 24), {
    windows: [],
    warning: null,
  });
  assert.deepEqual(previewTransitionWindows([], spans, 24), {
    windows: [],
    warning: null,
  });
});
