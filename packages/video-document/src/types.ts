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

// 分镜应用快照（P1 追加语义，2026-10-18 复核整改）：brief.sentence 只能表达
// 「最近一次要了什么」，与整片实际长度是两回事。每次分镜应用往 applications
// 追加一条——sentence/appended* 是本次的「要」，film*After 是应用后整片的
// 「是」，可直接与 shots 的 working 版本总时长对账，需求与成片不再打架。
export type BriefApplication = {
  sentence: string;
  appendedShotCount: number;
  appendedDurationMs: number;
  filmShotCountAfter: number;
  filmTotalMsAfter: number;
  appliedAt: string;
};

export type VideoProject = {
  schemaVersion: 1;
  id: string;
  title: string;
  brief: {
    sentence: string;
    aspectTargets: AspectTarget[];
    applications?: BriefApplication[];
  };
  shots: Shot[];
  renderRecords: RenderRecord[];
  deliveries: DeliveryRecord[];
  savedVersion: number; // 文档版本，乐观并发用
  // —— P1 转场（Feature ④ spec）：project 级编排元数据，可自由改写（title 同级），
  // 不进 shots/events/renderRecords/deliveries 的只追加纪律；缺省/空 = 全硬切 ——
  transitions?: ShotTransition[];
  // —— P2.5 媒体混编：素材元数据账本（二进制不入文档，只追加）——
  mediaAssets?: MediaAsset[];
};

export type TransitionKind = "fade";
export type ShotTransition = {
  boundary: number; // 0 基：shots[boundary] 出场 → shots[boundary+1] 入场
  kind: TransitionKind;
  durationMs: number; // 100..2000
};

// —— P2.5 媒体混编（T1 契约）：项目级追加账本，与 renderRecords 同纪律（只追加）——
export type MediaAsset = {
  assetId: string; // UUID，账本内唯一
  createdAt: string; // ISO 8601
  origin:
    | { kind: "local-upload"; fileName: string }
    | {
        kind: "stock-source";
        sourceId: "wikimedia"; // 首个公开来源；扩源时升格联合
        sourcePageUrl: string;
        license: { name: string; author?: string; usageNote?: string };
        retrievedAt: string;
      };
  original: {
    // ffprobe 实测，导入核验通过才落账；不可变（ADR 0001）
    sha256: string; // 64 位小写 hex
    bytes: number;
    durationMs: number; // 200..600000
    width: number;
    height: number;
    fps: number; // 正有限数（29.97 合法）
    codec: string;
    hasAudio: boolean;
    storeKey: string; // `${sha256 前 16 位}.${mp4|webm|mov}` 内容寻址
  };
  proxy?: {
    // 浏览器预览用转码代理，可再生成
    sha256: string;
    bytes: number;
    width: number;
    height: number;
    note: string; // 转码参数摘要
  };
};
