export type ShotStatus = "draft" | "candidate" | "approved";

export type SceneSource =
  | { type: "spec"; spec: unknown }
  | {
      type: "editor-binding";
      engineId: string;
      engineVersion: string;
      assetId: string;
    };

export type ContentVersion = {
  versionId: string; // uuid
  createdAt: string; // ISO 8601
  durationMs: number; // 正整数
  description: string; // 1..200 字符
  narrationText: string; // 0..2000 字符
  sceneSource: SceneSource;
  provenance: {
    engineId: string;
    engineVersion: string;
    parentVersionId?: string; // 重做链
    lineageParents?: string[]; // 拆分/合并父镜头
  };
};

export type ShotEvent =
  | { kind: "submitted"; versionId: string; at: string; actor: "ai" | "human" }
  | { kind: "approved"; versionId: string; at: string; actor: "human" }
  | { kind: "lock-changed"; locked: boolean; at: string; actor: "human" }
  | { kind: "audit"; note: string; at: string; actor: "human" };

export type Shot = {
  shotId: string;
  order: number;
  locked: boolean;
  workingVersionId: string; // 指针存在性由 validate 校验
  contentVersions: ContentVersion[];
  events: ShotEvent[];
};

export type RenderRecord = {
  renderId: string;
  versionId: string;
  contentDigest: string; // canonicalJson(contentVersion) 的 sha256，由渲染脚本写入
  engineId: string;
  engineVersion: string;
  rendererVersion: string;
  fps: number;
  width: number;
  height: number;
  codec: string;
  frames: number;
  fontDigests: Record<string, string>;
  outputAssetRef: string; // 本地 P0 为输出文件相对路径
  // ADR §2.5：无头浏览器是确定性输入，出片时记录实际浏览器标识与版本。
  // 可选：早期存储文档无此字段，重开仍须通过校验。
  browser?: string;
};

export type DeliveryRecord = {
  deliveryId: string;
  at: string;
  versionIds: string[];
  renderIds: string[];
  frameMap: number[];
};

export type AspectTarget = "landscape" | "portrait";

export type VideoProject = {
  schemaVersion: 1;
  id: string;
  title: string;
  brief: { sentence: string; aspectTargets: AspectTarget[] };
  shots: Shot[];
  renderRecords: RenderRecord[];
  deliveries: DeliveryRecord[];
  savedVersion: number; // 文档版本，乐观并发用
};
