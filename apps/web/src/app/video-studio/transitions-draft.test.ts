// P1 转场（Feature ④ spec R4）：工作台转场草稿纯逻辑单测——组件只做渲染/状态
// 接线，草稿构造/校验/patch 全在本模块（沿 shot-edit.ts 模式）。
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTransitionsPatch,
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
