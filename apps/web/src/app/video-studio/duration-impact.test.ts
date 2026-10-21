// 改时长的影响提示：当场量化整片帧数，并检查相邻转场借帧是否仍装得下。
// 夹具按文档不变量构造完整 VideoProject（每镜头一个 working 版本）。
import assert from "node:assert/strict";
import test from "node:test";
import type { Shot, ShotTransition, VideoProject } from "@acs/video-document";
import {
  describeDurationImpact,
  durationApplyError,
} from "./duration-impact.js";

function shotWith(durationMs: number, index: number): Shot {
  const versionId = `aaaaaaaa-0000-4000-8000-${String(index).padStart(12, "0")}`;
  return {
    shotId: `bbbbbbbb-0000-4000-8000-${String(index).padStart(12, "0")}`,
    order: index,
    locked: false,
    workingVersionId: versionId,
    contentVersions: [
      {
        versionId,
        createdAt: "2026-10-21T00:00:00.000Z",
        durationMs,
        description: `镜头 ${index + 1}`,
        narrationText: "",
        sceneSource: {
          type: "spec",
          spec: {
            specVersion: 1,
            componentId: "line-drawing",
            componentVersion: 1,
            durationMs,
            seed: 1,
            background: "#ffffff",
            params: {},
          },
        },
        provenance: { engineId: "test", engineVersion: "1.0.0" },
      },
    ],
    events: [],
  };
}

function projectWith(
  durations: number[],
  transitions?: ShotTransition[],
): VideoProject {
  return {
    schemaVersion: 1,
    id: "cccccccc-1111-4111-8111-111111111111",
    title: "帧数影响测试",
    brief: { sentence: "", aspectTargets: [] },
    shots: durations.map(shotWith),
    renderRecords: [],
    deliveries: [],
    savedVersion: 0,
    ...(transitions ? { transitions } : {}),
  };
}

test("未改时长：changed=false 且前后帧数一致", () => {
  const project = projectWith([8000, 8000, 8000, 6000]);
  const impact = describeDurationImpact(project, 1, 8000);
  assert.equal(impact.changed, false);
  assert.equal(impact.beforeFrames, 720);
  assert.equal(impact.afterFrames, 720);
  assert.equal(impact.transitionIssue, null);
});

test("加长 1s：整片帧数按累计边界量化", () => {
  const impact = describeDurationImpact(
    projectWith([8000, 8000, 8000, 6000]),
    0,
    9000,
  );
  assert.equal(impact.beforeFrames, 720);
  assert.equal(impact.afterFrames, 744); // 31s @24fps
});

test("缩到零帧：frameError 指名镜头，afterFrames 为 null", () => {
  const impact = describeDurationImpact(
    projectWith([8000, 8000, 8000, 6000]),
    0,
    1,
  );
  assert.equal(impact.afterFrames, null);
  assert.match(impact.frameError ?? "", /第 1 个镜头.*为零帧/);
});

test("相邻转场借帧失效：给出可操作提示", () => {
  const project = projectWith(
    [1000, 1000],
    [{ boundary: 0, kind: "fade", durationMs: 1000 }],
  );
  const impact = describeDurationImpact(project, 0, 100);
  assert.match(impact.transitionIssue ?? "", /超出相邻 span/);
  assert.equal(impact.frameError, null);
  // 转场问题只警告不拦应用：应用闸门必须忽略 transitionIssue。
  assert.equal(durationApplyError(impact), null);
});

test("boundary 等于 shotIndex - 1 的相邻转场也要解析", () => {
  // 编辑镜头 2（shotIndex=1）时，boundary 0 = shotIndex - 1 必须进解析；
  // 只保留 boundary === shotIndex 的变异体会漏掉这条并返回 null。
  const project = projectWith(
    [1000, 1000],
    [{ boundary: 0, kind: "fade", durationMs: 2000 }],
  );
  const impact = describeDurationImpact(project, 1, 2000);
  assert.notEqual(impact.transitionIssue, null);
});

test("无转场：不报转场问题", () => {
  const impact = describeDurationImpact(projectWith([1000, 1000]), 0, 100);
  assert.equal(impact.changed, true);
  assert.equal(impact.frameError, null);
  assert.equal(impact.transitionIssue, null);
});

test("非相邻镜头变化：不误报远处转场", () => {
  // 静止状态下 boundary 0 就已非法（halfIn 12 ≥ 右 span 7 帧）：只有真正
  // 的相邻守卫在，才不会被远处这条旧问题连坐。
  const project = projectWith(
    [1000, 300, 1000],
    [{ boundary: 0, kind: "fade", durationMs: 1000 }],
  );
  const impact = describeDurationImpact(project, 2, 100);
  assert.equal(impact.changed, true);
  assert.equal(impact.frameError, null);
  assert.equal(impact.transitionIssue, null);
});

test("镜头序号越界：给出 frameError 且不量化", () => {
  const impact = describeDurationImpact(projectWith([1000, 1000]), 5, 500);
  assert.equal(impact.afterFrames, null);
  assert.match(impact.frameError ?? "", /越界/);
});

test("相邻转场装得下：不报转场问题", () => {
  // 100ms @24fps = 2 帧（文档 durationMs 下限），相邻两窗口都远大于借帧。
  const project = projectWith(
    [1000, 1000],
    [{ boundary: 0, kind: "fade", durationMs: 100 }],
  );
  const impact = describeDurationImpact(project, 1, 2000);
  assert.equal(impact.changed, true);
  assert.equal(impact.frameError, null);
  assert.equal(impact.transitionIssue, null);
});

test("只解析相邻转场：远处既有非法转场不算在本次编辑头上", () => {
  // boundary 0 的 2000ms 在静止文档里就已非法（halfOut 24 ≥ 左 span 24 帧）；
  // 编辑镜头 3 只牵动 boundary 1（合法 100ms），不得被远处旧问题连坐。
  const project = projectWith(
    [1000, 1000, 1000],
    [
      { boundary: 0, kind: "fade", durationMs: 2000 },
      { boundary: 1, kind: "fade", durationMs: 100 },
    ],
  );
  const impact = describeDurationImpact(project, 2, 2000);
  assert.equal(impact.changed, true);
  assert.equal(impact.frameError, null);
  assert.equal(impact.transitionIssue, null);
});

test("应用闸门：零帧时长在应用前拦下并带可操作原因", () => {
  const impact = describeDurationImpact(projectWith([8000, 8000]), 0, 1);
  const blocked = durationApplyError(impact);
  assert.notEqual(blocked, null);
  assert.match(blocked!, /^无法应用：/);
  assert.match(blocked!, /为零帧/);
});

test("应用闸门：正常加长放行", () => {
  const impact = describeDurationImpact(projectWith([8000, 8000]), 0, 9000);
  assert.equal(impact.frameError, null);
  assert.equal(durationApplyError(impact), null);
});

test("存量零帧项目：改成合法时长可量化并放行应用", () => {
  // 1ms @24fps 量化后是零帧（文档不变量允许正整数时长，但成片期拒绝零帧）。
  // 当前文档无法量化 → beforeFrames 为 null；改后必须照常给出 afterFrames，
  // 并且应用闸门放行——这是把存量零帧镜头改回可出片时长的唯一入口。
  const impact = describeDurationImpact(projectWith([1, 1000]), 0, 2000);
  assert.equal(impact.changed, true);
  assert.equal(impact.beforeFrames, null);
  assert.equal(impact.afterFrames, 72); // 3000ms @24fps
  assert.equal(impact.frameError, null);
  assert.equal(durationApplyError(impact), null);
});

test("存量零帧项目且时长未改：不抛错，前后帧数均为 null", () => {
  const impact = describeDurationImpact(projectWith([1, 1000]), 0, 1);
  assert.equal(impact.changed, false);
  assert.equal(impact.beforeFrames, null);
  assert.equal(impact.afterFrames, null);
  assert.equal(impact.frameError, null);
});

test("多个零帧镜头：改好本镜头、别人仍零帧时放行", () => {
  // [1,1] 改镜头 1 → 2000ms：改后镜头 2 仍零帧，但本次编辑的镜头已修好。
  // 闸门必须放行，否则两个零帧镜头永远互相锁死。
  const impact = describeDurationImpact(projectWith([1, 1]), 0, 2000);
  assert.equal(impact.changed, true);
  assert.equal(impact.shotIndex, 0);
  assert.equal(impact.beforeFrames, null);
  assert.equal(impact.afterFrames, null);
  assert.equal(impact.zeroFrameShotIndex, 1);
  assert.match(impact.frameError ?? "", /第 2 个镜头/);
  assert.equal(durationApplyError(impact), null);
});

test("多个零帧镜头：编辑镜头 2 时对称放行", () => {
  const impact = describeDurationImpact(projectWith([1, 1]), 1, 2000);
  assert.equal(impact.changed, true);
  assert.equal(impact.shotIndex, 1);
  assert.equal(impact.beforeFrames, null);
  assert.equal(impact.afterFrames, null);
  assert.equal(impact.zeroFrameShotIndex, 0);
  assert.match(impact.frameError ?? "", /第 1 个镜头/);
  assert.equal(durationApplyError(impact), null);
});

test("依次修复多个零帧镜头：第二次修复后整片恢复可量化", () => {
  const first = describeDurationImpact(projectWith([1, 1]), 0, 2000);
  assert.equal(first.zeroFrameShotIndex, 1);
  // 应用第一次修订后的文档是 [2000,1]。
  const second = describeDurationImpact(projectWith([2000, 1]), 1, 2000);
  assert.equal(second.changed, true);
  assert.equal(second.beforeFrames, null);
  assert.equal(second.afterFrames, 96); // 4000ms @24fps
  assert.equal(second.frameError, null);
  assert.equal(second.zeroFrameShotIndex, null);
  assert.equal(durationApplyError(second), null);
});

test("合法文档改出新零帧仍必须拦截", () => {
  // 存量零帧放行只针对"当前文档本来就无法量化"，合法文档改坏不能被放过。
  const impact = describeDurationImpact(projectWith([2000, 1000]), 0, 1);
  assert.equal(impact.changed, true);
  assert.equal(impact.shotIndex, 0);
  assert.equal(impact.beforeFrames, 72); // 3000ms @24fps
  assert.equal(impact.afterFrames, null);
  assert.equal(impact.zeroFrameShotIndex, 0);
  assert.notEqual(durationApplyError(impact), null);
});

test("合法文档改坏别的镜头（本次镜头自己没零帧）仍必须拦截", () => {
  // [1000,40] 合计 25 帧（镜头 2 只有 1 帧）；镜头 1 改成 980ms 后累计边界
  // 24/24，镜头 2 变零帧。报错镜头不是本次编辑的镜头，但当前文档是可量化的，
  // 闸门不能把它当成"存量零帧的局部修复"放行。
  const impact = describeDurationImpact(projectWith([1000, 40]), 0, 980);
  assert.equal(impact.changed, true);
  assert.equal(impact.shotIndex, 0);
  assert.equal(impact.beforeFrames, 25);
  assert.equal(impact.afterFrames, null);
  assert.equal(impact.zeroFrameShotIndex, 1);
  assert.notEqual(durationApplyError(impact), null);
});

test("存量零帧且本镜头改后仍零帧：拦截", () => {
  // 2ms @24fps 仍是零帧：本镜头没修好，闸门不能借"存量零帧"放行。
  const impact = describeDurationImpact(projectWith([1, 1000]), 0, 2);
  assert.equal(impact.changed, true);
  assert.equal(impact.beforeFrames, null);
  assert.equal(impact.afterFrames, null);
  assert.equal(impact.zeroFrameShotIndex, 0);
  assert.notEqual(durationApplyError(impact), null);
});

test("应用闸门：无影响对象或时长未改时放行", () => {
  assert.equal(durationApplyError(null), null);
  // 越界哨兵与时长未变都走 changed=false，不拦应用。
  assert.equal(
    durationApplyError(describeDurationImpact(projectWith([8000]), 0, 8000)),
    null,
  );
  assert.equal(
    durationApplyError(describeDurationImpact(projectWith([8000]), 5, 8000)),
    null,
  );
});
