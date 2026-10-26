import type { VideoProject } from "@acs/video-document";
import type { SceneSpec } from "@acs/video-scene";
import { componentLabel } from "./component-labels";
import type { StoryboardResult } from "./planner";

// P2-B：确认应用不得静默更换项目身份。两种模式：
//  - first-shot：编辑中的项目还没有镜头 → 在当前文档上落首个镜头（id 不变）；
//  - save-as-new：项目已有镜头（P0 单镜头，不支持换镜头）→ 明示另存为新项目，
//    原项目与输入文档原封不动。
export type ApplyPlanResult = {
  mode: "first-shot" | "save-as-new";
  notice: string;
  document: VideoProject;
};

export type PlanPayload = { spec: SceneSpec; title: string };

export type PlanIds = { project: string; shot: string; version: string };

// 首镜头 = 初始内容版本 + submitted(human) 事件，workingVersionId 指向它。
function firstShotDocument(
  base: Pick<
    VideoProject,
    "brief" | "renderRecords" | "deliveries" | "savedVersion" | "styleBibleRef"
  >,
  id: string,
  title: string,
  sentence: string,
  plan: PlanPayload,
  ids: PlanIds,
): VideoProject {
  const now = new Date().toISOString();
  const label = componentLabel(plan.spec.componentId);
  return {
    schemaVersion: 1,
    id,
    title,
    brief: { sentence, aspectTargets: base.brief.aspectTargets },
    shots: [
      {
        shotId: ids.shot,
        order: 0,
        locked: false,
        workingVersionId: ids.version,
        contentVersions: [
          {
            versionId: ids.version,
            createdAt: now,
            durationMs: plan.spec.durationMs,
            description: `${label}动画：${plan.title}`,
            narrationText: "",
            sceneSource: { type: "spec", spec: plan.spec },
            provenance: { engineId: "planner-rules", engineVersion: "1" },
          },
        ],
        events: [
          {
            kind: "submitted",
            versionId: ids.version,
            at: now,
            actor: "human",
          },
        ],
      },
    ],
    renderRecords: base.renderRecords,
    deliveries: base.deliveries,
    ...(base.styleBibleRef ? { styleBibleRef: base.styleBibleRef } : {}),
    savedVersion: base.savedVersion,
  };
}

export function applyPlan(
  document: VideoProject,
  sentence: string,
  plan: PlanPayload,
  ids: PlanIds,
): ApplyPlanResult {
  if (document.shots.length === 0) {
    return {
      mode: "first-shot",
      notice: "已应用规划到当前项目，确认无误后点「保存」",
      document: firstShotDocument(
        document,
        document.id,
        plan.title,
        sentence,
        plan,
        ids,
      ),
    };
  }
  return {
    mode: "save-as-new",
    notice:
      "当前项目已有镜头：P0 不修改已保存镜头，已另存为新项目（原项目不受影响）",
    document: firstShotDocument(
      document,
      ids.project,
      plan.title,
      sentence,
      plan,
      ids,
    ),
  };
}

// —— P1 applyStoryboard：分镜应用 = 在当前项目上「只追加」N 个镜头 ——
//
// 与 P2-B 单镜头的 save-as-new 不同：分镜是对整片的编排，语义就是往当前
// 项目追加镜头（evolve.ts 允许 shots 增长）。已有镜头逐字段不动，
// order 接续现有最大 +1；每镜头落初始内容版本 + submitted(human) 事件。
//
// 追加语义（2026-10-18 Codex 复核整改）：句子用规划期快照（storyboard.
// sentence），不收调用方当下输入；brief.applications 追加一条应用快照，
// film*After 与 shots 对账——「8s 项目再应用 8s 分镜」时数据明说整片变 16s，
// 需求句与成片长度不再各说各话。
export type StoryboardApplyResult = {
  mode: "storyboard-append";
  notice: string;
  document: VideoProject;
};

function filmWorkingDurationMs(document: VideoProject): number {
  return document.shots.reduce((total, shot) => {
    const working = shot.contentVersions.find(
      (version) => version.versionId === shot.workingVersionId,
    );
    return total + (working?.durationMs ?? 0);
  }, 0);
}

function secondsLabel(ms: number): string {
  return `${Math.round(ms / 100) / 10}s`;
}

// 确认卡/预告用：应用前把追加算术说清楚（追加 N 个镜头后整片变多少）。
export function describeStoryboardAppend(
  document: VideoProject,
  storyboard: StoryboardResult & { ok: true },
): string {
  if (document.shots.length === 0) {
    return `整片将从本分镜开始：${storyboard.shots.length} 个镜头 / ${secondsLabel(storyboard.totalMs)}`;
  }
  const shotCountAfter = document.shots.length + storyboard.shots.length;
  const totalAfter = filmWorkingDurationMs(document) + storyboard.totalMs;
  return `当前整片 ${document.shots.length} 个镜头 / ${secondsLabel(filmWorkingDurationMs(document))}，应用后 ${shotCountAfter} 个镜头 / ${secondsLabel(totalAfter)}（追加 ${storyboard.shots.length} 个镜头，+${secondsLabel(storyboard.totalMs)}）`;
}

export function applyStoryboard(
  document: VideoProject,
  storyboard: StoryboardResult & { ok: true },
  ids: { shot: () => string; version: () => string },
  // 语义分镜（2026-10-26）：AI 路径传自己的引擎标识与版本串
  // （如 "planner-semantic" / "qwen-plus/prompt1/compiler1"）；
  // 不传保持 planner-rules/1，旧路径与旧测试行为不变。
  provenance: { engineId: string; engineVersion: string } = {
    engineId: "planner-rules",
    engineVersion: "1",
  },
): StoryboardApplyResult {
  const now = new Date().toISOString();
  const nextOrder =
    document.shots.reduce((max, shot) => Math.max(max, shot.order), -1) + 1;
  const newShots = storyboard.shots.map((shot, index) => {
    const versionId = ids.version();
    return {
      shotId: ids.shot(),
      order: nextOrder + index,
      locked: false,
      workingVersionId: versionId,
      contentVersions: [
        {
          versionId,
          createdAt: now,
          durationMs: shot.plan.spec.durationMs,
          // 说明是规划产物（意图文案），应用层原样落库，不再二次拼接。
          description: shot.description,
          narrationText: shot.narrationText,
          sceneSource: { type: "spec" as const, spec: shot.plan.spec },
          provenance: { ...provenance },
        },
      ],
      events: [
        {
          kind: "submitted" as const,
          versionId,
          at: now,
          actor: "human" as const,
        },
      ],
    };
  });
  const filmShotCountAfter = document.shots.length + newShots.length;
  const filmTotalMsAfter = filmWorkingDurationMs(document) + storyboard.totalMs;
  const isFirst = document.shots.length === 0;
  const notice = isFirst
    ? `已应用分镜（首个 ${newShots.length} 个镜头 / ${secondsLabel(storyboard.totalMs)}）到当前项目，确认无误后点「保存」`
    : `已追加 ${newShots.length} 个镜头（+${secondsLabel(storyboard.totalMs)}）到当前项目，整片现为 ${filmShotCountAfter} 个镜头 / ${secondsLabel(filmTotalMsAfter)}，确认无误后点「保存」`;
  return {
    mode: "storyboard-append",
    notice,
    document: {
      ...document,
      title: isFirst ? storyboard.title : document.title,
      brief: {
        ...document.brief,
        sentence: storyboard.sentence,
        applications: [
          ...(document.brief.applications ?? []),
          {
            sentence: storyboard.sentence,
            appendedShotCount: newShots.length,
            appendedDurationMs: storyboard.totalMs,
            filmShotCountAfter,
            filmTotalMsAfter,
            appliedAt: now,
          },
        ],
      },
      shots: [...document.shots, ...newShots],
    },
  };
}

export type StoryboardConfirmLine = {
  index: number; // 1-based，渲染用
  label: string;
  durationSeconds: number;
  renderHint: string;
  narrationText: string;
};

// 确认卡与「确认后落库」共用同一规划快照：旁白就在 storyboard.shots 里，
// 不在 UI 层另拼一份——两处各拼一次就是漂移的入口。
export function storyboardConfirmLines(
  storyboard: StoryboardResult & { ok: true },
): StoryboardConfirmLine[] {
  return storyboard.shots.map((shot, index) => ({
    index: index + 1,
    label: shot.label,
    durationSeconds: shot.plan.spec.durationMs / 1000,
    renderHint: shot.plan.renderHint,
    narrationText: shot.narrationText,
  }));
}
