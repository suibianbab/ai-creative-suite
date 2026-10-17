import type { VideoProject } from "@acs/video-document";
import type { SceneSpec } from "@acs/video-scene";

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

const COMPONENT_LABEL: Record<string, string> = {
  "text-animation": "文字",
  "line-drawing": "线描",
  "basic-shapes": "图形",
};

// 首镜头 = 初始内容版本 + submitted(human) 事件，workingVersionId 指向它。
function firstShotDocument(
  base: Pick<
    VideoProject,
    "brief" | "renderRecords" | "deliveries" | "savedVersion"
  >,
  id: string,
  title: string,
  sentence: string,
  plan: PlanPayload,
  ids: PlanIds,
): VideoProject {
  const now = new Date().toISOString();
  const label = COMPONENT_LABEL[plan.spec.componentId] ?? plan.spec.componentId;
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
