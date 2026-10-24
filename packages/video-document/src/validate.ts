import type {
  AspectTarget,
  ContentVersion,
  SceneSource,
  Shot,
  ShotEvent,
  VideoProject,
} from "./types.js";
import { EXPORT_FPS } from "./aspect.js";
import { quantizeTimeline } from "./quantize.js";

export type { VideoProject } from "./types.js";

export class VideoProjectValidationError extends Error {}

export const VIDEO_PROJECT_MAX_BYTES = 2 * 1024 * 1024;
// P3-B 3D 镜头 spec 的体积上限：params 会被烘焙期注册表消费，超限说明走错了通道。
const MAX_THREE_SPEC_BYTES = 256 * 1024;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
// TextEncoder 而非 Buffer：本包同时被浏览器（工作台）与 Node（CLI）引用。
const encoder = new TextEncoder();
const MAX_ARRAY = 1000;
const MAX_DURATION_MS = 600000;
const ASPECT_TARGETS: readonly AspectTarget[] = ["landscape", "portrait"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new VideoProjectValidationError(`Invalid VideoProject: ${message}`);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isIsoTime(value: unknown): value is string {
  return typeof value === "string" && ISO_8601.test(value);
}

// —— P2.5-T1：媒体资产账本校验（spec A1-A8）。
// 返回 assetId → durationMs 映射，供 media-clip 出入点与 assetDigests 交叉校验。
function validateMediaAssets(value: unknown): Map<string, number> {
  if (value === undefined) return new Map();
  if (!Array.isArray(value) || value.length > MAX_ARRAY) {
    fail(`mediaAssets must be an array of at most ${MAX_ARRAY} entries`);
  }
  const durations = new Map<string, number>();
  for (const [index, asset] of value.entries()) {
    const field = `mediaAssets[${index}]`;
    if (!isRecord(asset)) fail(`${field} must be an object`);
    if (!isUuid(asset.assetId)) fail(`${field}.assetId must be a UUID`);
    if (durations.has(asset.assetId)) fail(`${field}.assetId is duplicated`);
    if (!isIsoTime(asset.createdAt))
      fail(`${field}.createdAt must be an ISO 8601 string`);
    const origin = asset.origin;
    if (!isRecord(origin)) fail(`${field}.origin must be an object`);
    if (origin.kind === "local-upload") {
      if (
        typeof origin.fileName !== "string" ||
        origin.fileName.length < 1 ||
        origin.fileName.length > 200
      ) {
        fail(`${field}.origin.fileName 须为 1..200 字符`);
      }
    } else if (origin.kind === "stock-source") {
      if (origin.sourceId !== "wikimedia")
        fail(`${field}.origin.sourceId 须为 "wikimedia"`);
      if (
        typeof origin.sourcePageUrl !== "string" ||
        !/^https?:\/\//.test(origin.sourcePageUrl) ||
        origin.sourcePageUrl.length > 2000
      ) {
        fail(`${field}.origin.sourcePageUrl 须为 http(s):// 开头且 ≤2000 字符`);
      }
      const license = origin.license;
      if (!isRecord(license)) fail(`${field}.origin.license must be an object`);
      if (
        typeof license.name !== "string" ||
        license.name.length < 1 ||
        license.name.length > 100
      ) {
        fail(`${field}.origin.license.name 须为 1..100 字符`);
      }
      for (const key of ["author", "usageNote"] as const) {
        const v = license[key];
        if (
          v !== undefined &&
          (typeof v !== "string" || v.length < 1 || v.length > 200)
        ) {
          fail(`${field}.origin.license.${key} 须为 1..200 字符`);
        }
      }
      if (!isIsoTime(origin.retrievedAt))
        fail(`${field}.origin.retrievedAt must be an ISO 8601 string`);
    } else {
      fail(`${field}.origin.kind must be "local-upload" or "stock-source"`);
    }
    const o = asset.original;
    if (!isRecord(o)) fail(`${field}.original must be an object`);
    if (typeof o.sha256 !== "string" || !SHA256_HEX.test(o.sha256)) {
      fail(`${field}.original.sha256 须为 64 位小写十六进制`);
    }
    if (!Number.isInteger(o.bytes) || (o.bytes as number) < 1) {
      fail(`${field}.original.bytes 须为正整数`);
    }
    if (
      !Number.isInteger(o.durationMs) ||
      (o.durationMs as number) < 200 ||
      (o.durationMs as number) > MAX_DURATION_MS
    ) {
      fail(
        `${field}.original.durationMs 须为 200..${MAX_DURATION_MS} 的整数毫秒`,
      );
    }
    if (
      !Number.isInteger(o.width) ||
      (o.width as number) < 1 ||
      !Number.isInteger(o.height) ||
      (o.height as number) < 1
    ) {
      fail(`${field}.original.width/height 须为正整数`);
    }
    if (
      typeof o.fps !== "number" ||
      !Number.isFinite(o.fps) ||
      (o.fps as number) <= 0
    ) {
      fail(`${field}.original.fps 须为正数`);
    }
    if (typeof o.codec !== "string" || o.codec.length === 0) {
      fail(`${field}.original.codec must be a non-empty string`);
    }
    if (typeof o.hasAudio !== "boolean") {
      fail(`${field}.original.hasAudio must be boolean`);
    }
    if (
      typeof o.storeKey !== "string" ||
      !/^[0-9a-f]{16}\.(mp4|webm|mov)$/.test(o.storeKey) ||
      (o.storeKey as string).slice(0, 16) !== (o.sha256 as string).slice(0, 16)
    ) {
      fail(`${field}.original.storeKey 须为 sha256 前 16 位 + .mp4/.webm/.mov`);
    }
    if (asset.proxy !== undefined) {
      const p = asset.proxy;
      if (!isRecord(p)) fail(`${field}.proxy must be an object`);
      if (typeof p.sha256 !== "string" || !SHA256_HEX.test(p.sha256)) {
        fail(`${field}.proxy.sha256 须为 64 位小写十六进制`);
      }
      if (!Number.isInteger(p.bytes) || (p.bytes as number) < 1) {
        fail(`${field}.proxy.bytes 须为正整数`);
      }
      if (
        !Number.isInteger(p.width) ||
        (p.width as number) < 1 ||
        !Number.isInteger(p.height) ||
        (p.height as number) < 1
      ) {
        fail(`${field}.proxy.width/height 须为正整数`);
      }
      if (
        typeof p.note !== "string" ||
        p.note.length < 1 ||
        p.note.length > 200
      ) {
        fail(`${field}.proxy.note 须为 1..200 字符`);
      }
    }
    durations.set(asset.assetId as string, o.durationMs as number);
  }
  return durations;
}

function validateSceneSource(
  value: unknown,
  field: string,
  mediaAssets: Map<string, number>,
): void {
  if (!isRecord(value)) fail(`${field}.sceneSource must be an object`);
  if (value.type === "spec") {
    if (value.spec === null || typeof value.spec !== "object") {
      fail(
        `${field}.sceneSource.spec must be an object (validated in depth by @acs/video-scene)`,
      );
    }
    return;
  }
  if (value.type === "editor-binding") {
    for (const key of ["engineId", "engineVersion", "assetId"] as const) {
      if (
        typeof value[key] !== "string" ||
        (value[key] as string).length === 0
      ) {
        fail(`${field}.sceneSource.${key} must be a non-empty string`);
      }
    }
    return;
  }
  if (value.type === "media-clip") {
    if (
      typeof value.mediaAssetId !== "string" ||
      !mediaAssets.has(value.mediaAssetId)
    ) {
      fail(`${field}.sceneSource.mediaAssetId 未指向 mediaAssets 账本中的资产`);
    }
    for (const key of ["inMs", "outMs"] as const) {
      if (!Number.isInteger(value[key]))
        fail(`${field}.sceneSource.${key} 须为整数毫秒`);
    }
    const assetDurationMs = mediaAssets.get(value.mediaAssetId as string);
    if (
      (value.inMs as number) < 0 ||
      (value.outMs as number) < (value.inMs as number) + 200 ||
      (value.outMs as number) > (assetDurationMs as number)
    ) {
      fail(
        `${field}.sceneSource 出入点越界（合法 inMs ≥ 0、inMs+200 ≤ outMs ≤ 素材 durationMs=${assetDurationMs}）`,
      );
    }
    if (value.fit !== "cover" && value.fit !== "contain") {
      fail(`${field}.sceneSource.fit 须为 "cover" 或 "contain"`);
    }
    if (
      typeof value.focalX !== "number" ||
      !Number.isFinite(value.focalX) ||
      (value.focalX as number) < 0 ||
      (value.focalX as number) > 1
    ) {
      fail(`${field}.sceneSource.focalX 须为 0..1 的数`);
    }
    if (value.audio !== "mute" && value.audio !== "keep") {
      fail(`${field}.sceneSource.audio 须为 "mute" 或 "keep"`);
    }
    return;
  }
  // —— P3-B 3D 镜头：平台只做形状校验、不 eval；params 深度校验交给烘焙期注册表。——
  if (value.type === "three") {
    const spec = value.spec;
    if (!isRecord(spec)) {
      fail(
        `${field}.sceneSource.spec must be an object (validated in depth by three registry)`,
      );
    }
    // 用文件顶部已有的 encoder（TextEncoder）：本包同时被浏览器工作台与 Node CLI 引用。
    if (encoder.encode(JSON.stringify(spec)).length > MAX_THREE_SPEC_BYTES) {
      fail(`${field}.sceneSource.spec 超过 256 KiB 上限`);
    }
    if (spec.specVersion !== 1)
      fail(`${field}.sceneSource.spec.specVersion 必须为 1`);
    if (
      typeof spec.componentId !== "string" ||
      !/^[a-z][a-zA-Z0-9]{0,63}$/.test(spec.componentId)
    ) {
      fail(
        `${field}.sceneSource.spec.componentId 须匹配 ^[a-z][a-zA-Z0-9]{0,63}$`,
      );
    }
    if (
      !Number.isInteger(spec.componentVersion) ||
      (spec.componentVersion as number) < 1
    ) {
      fail(`${field}.sceneSource.spec.componentVersion 须为正整数`);
    }
    if (!Number.isInteger(spec.durationMs) || (spec.durationMs as number) < 1) {
      fail(`${field}.sceneSource.spec.durationMs 须为正整数`);
    }
    if (
      !Number.isInteger(spec.seed) ||
      (spec.seed as number) < 0 ||
      (spec.seed as number) > 4294967295
    ) {
      fail(`${field}.sceneSource.spec.seed 须为 0..4294967295 的整数`);
    }
    if (
      typeof spec.background !== "string" ||
      !/^#[0-9a-fA-F]{6}$/.test(spec.background)
    ) {
      fail(`${field}.sceneSource.spec.background 须为 #RRGGBB`);
    }
    if (!isRecord(spec.params))
      fail(`${field}.sceneSource.spec.params 须为对象`);
    return;
  }
  fail(
    `${field}.sceneSource.type must be "spec" | "editor-binding" | "media-clip" | "three"`,
  );
}

function validateContentVersion(
  value: unknown,
  field: string,
  mediaAssets: Map<string, number>,
): ContentVersion {
  if (!isRecord(value)) fail(`${field} must be an object`);
  if (!isUuid(value.versionId)) fail(`${field}.versionId must be a UUID`);
  if (!isIsoTime(value.createdAt))
    fail(`${field}.createdAt must be an ISO 8601 string`);
  if (
    !Number.isInteger(value.durationMs) ||
    (value.durationMs as number) < 1 ||
    (value.durationMs as number) > MAX_DURATION_MS
  ) {
    fail(
      `${field}.durationMs must be an integer between 1 and ${MAX_DURATION_MS}`,
    );
  }
  if (
    typeof value.description !== "string" ||
    value.description.length < 1 ||
    value.description.length > 200
  ) {
    fail(`${field}.description must be a string of 1..200 characters`);
  }
  if (
    typeof value.narrationText !== "string" ||
    value.narrationText.length > 2000
  ) {
    fail(`${field}.narrationText must be a string of at most 2000 characters`);
  }
  validateSceneSource(value.sceneSource, field, mediaAssets);
  // C4 对账：媒体镜头时长恒等于片段长度（渲染量化与交付 frameMap 依赖此恒等）
  if (isRecord(value.sceneSource) && value.sceneSource.type === "media-clip") {
    if (
      value.durationMs !==
      (value.sceneSource.outMs as number) - (value.sceneSource.inMs as number)
    ) {
      fail(`${field}.durationMs 须等于 outMs−inMs（媒体镜头时长=片段长度）`);
    }
  }
  // P3-B：three 镜头的 spec.durationMs 是渲染时长，必须与版本时长一致，
  // 否则烘焙帧数与交付 frameMap 会对不上。
  if (isRecord(value.sceneSource) && value.sceneSource.type === "three") {
    const spec = value.sceneSource.spec;
    if (isRecord(spec) && spec.durationMs !== value.durationMs) {
      fail(
        `${field}.sceneSource.spec.durationMs(${spec.durationMs}) 与 ContentVersion.durationMs(${value.durationMs}) 不一致`,
      );
    }
  }
  if (!isRecord(value.provenance))
    fail(`${field}.provenance must be an object`);
  if (
    typeof value.provenance.engineId !== "string" ||
    value.provenance.engineId.length === 0
  ) {
    fail(`${field}.provenance.engineId must be a non-empty string`);
  }
  if (
    typeof value.provenance.engineVersion !== "string" ||
    value.provenance.engineVersion.length === 0
  ) {
    fail(`${field}.provenance.engineVersion must be a non-empty string`);
  }
  if (
    value.provenance.parentVersionId !== undefined &&
    !isUuid(value.provenance.parentVersionId)
  ) {
    fail(`${field}.provenance.parentVersionId must be a UUID`);
  }
  if (value.provenance.lineageParents !== undefined) {
    if (!Array.isArray(value.provenance.lineageParents)) {
      fail(`${field}.provenance.lineageParents must be an array of UUIDs`);
    }
    for (const [index, parent] of value.provenance.lineageParents.entries()) {
      if (!isUuid(parent))
        fail(`${field}.provenance.lineageParents[${index}] must be a UUID`);
    }
  }
  return value as ContentVersion;
}

function validateShotEvent(
  value: unknown,
  versionIds: Set<string>,
  field: string,
): void {
  if (!isRecord(value)) fail(`${field} must be an object`);
  if (!isIsoTime(value.at)) fail(`${field}.at must be an ISO 8601 string`);
  switch (value.kind) {
    case "submitted":
      if (!versionIds.has(value.versionId as string)) {
        fail(`${field} submitted event versionId does not exist in this shot`);
      }
      if (value.actor !== "ai" && value.actor !== "human") {
        fail(`${field} submitted event actor must be "ai" or "human"`);
      }
      return;
    case "approved":
      if (!versionIds.has(value.versionId as string)) {
        fail(`${field} approved event versionId does not exist in this shot`);
      }
      if (value.actor !== "human") {
        fail(
          `${field} approved event actor must be "human" (human-only approval, ADR 0003 §1.3)`,
        );
      }
      return;
    case "lock-changed":
      if (typeof value.locked !== "boolean")
        fail(`${field} lock-changed event locked must be boolean`);
      if (value.actor !== "human")
        fail(`${field} lock-changed event actor must be "human"`);
      return;
    case "audit":
      if (
        typeof value.note !== "string" ||
        value.note.length < 1 ||
        value.note.length > 500
      ) {
        fail(`${field} audit event note must be a string of 1..500 characters`);
      }
      if (value.actor !== "human")
        fail(`${field} audit event actor must be "human"`);
      return;
    default:
      fail(
        `${field}.kind must be "submitted" | "approved" | "lock-changed" | "audit"`,
      );
  }
}

function validateShot(
  value: unknown,
  field: string,
  mediaAssets: Map<string, number>,
): Shot {
  if (!isRecord(value)) fail(`${field} must be an object`);
  if (!isUuid(value.shotId)) fail(`${field}.shotId must be a UUID`);
  if (!Number.isInteger(value.order) || (value.order as number) < 0) {
    fail(`${field}.order must be a non-negative integer`);
  }
  if (typeof value.locked !== "boolean")
    fail(`${field}.locked must be boolean`);
  if (
    !Array.isArray(value.contentVersions) ||
    value.contentVersions.length < 1 ||
    value.contentVersions.length > MAX_ARRAY
  ) {
    fail(
      `${field}.contentVersions must be an array of 1..${MAX_ARRAY} entries`,
    );
  }
  if (!Array.isArray(value.events) || value.events.length > MAX_ARRAY) {
    fail(`${field}.events must be an array of at most ${MAX_ARRAY} entries`);
  }
  const versionIds = new Set<string>();
  for (const [index, version] of value.contentVersions.entries()) {
    const parsed = validateContentVersion(
      version,
      `${field}.contentVersions[${index}]`,
      mediaAssets,
    );
    if (versionIds.has(parsed.versionId)) {
      fail(`${field}.contentVersions[${index}].versionId is duplicated`);
    }
    versionIds.add(parsed.versionId);
  }
  for (const [index, event] of value.events.entries()) {
    validateShotEvent(event, versionIds, `${field}.events[${index}]`);
  }
  if (
    typeof value.workingVersionId !== "string" ||
    !versionIds.has(value.workingVersionId)
  ) {
    fail(`${field}.workingVersionId must point at an existing content version`);
  }
  return value as Shot;
}

export function validateVideoProject(value: unknown): VideoProject {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new VideoProjectValidationError(
      "VideoProject is not JSON serializable",
    );
  }
  if (!json || encoder.encode(json).length > VIDEO_PROJECT_MAX_BYTES) {
    throw new VideoProjectValidationError("VideoProject exceeds size limit");
  }
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed)) fail("document must be an object");
  if (parsed.schemaVersion !== 1) fail("schemaVersion must be 1");
  if (!isUuid(parsed.id)) fail("id must be a UUID");
  if (
    typeof parsed.title !== "string" ||
    parsed.title.length < 1 ||
    parsed.title.length > 200
  ) {
    fail("title must be a string of 1..200 characters");
  }
  if (
    !Number.isInteger(parsed.savedVersion) ||
    (parsed.savedVersion as number) < 1
  ) {
    fail("savedVersion must be a positive integer");
  }
  if (parsed.styleBibleRef !== undefined) {
    const ref = parsed.styleBibleRef;
    if (
      !isRecord(ref) ||
      !isUuid(ref.bibleId) ||
      !isUuid(ref.versionId) ||
      typeof ref.digest !== "string" ||
      !SHA256_HEX.test(ref.digest)
    ) {
      fail("styleBibleRef 须包含 bibleId、versionId 与 SHA-256 digest");
    }
    if (
      Object.keys(ref).some(
        (key) => !["bibleId", "versionId", "digest"].includes(key),
      )
    )
      fail("styleBibleRef 只能保存独立风格记录的引用，不得内嵌正文");
  }
  if (!isRecord(parsed.brief)) fail("brief must be an object");
  if (
    typeof parsed.brief.sentence !== "string" ||
    parsed.brief.sentence.length > 2000
  ) {
    fail("brief.sentence must be a string of at most 2000 characters");
  }
  if (
    !Array.isArray(parsed.brief.aspectTargets) ||
    parsed.brief.aspectTargets.length < 1 ||
    parsed.brief.aspectTargets.some(
      (target) => !ASPECT_TARGETS.includes(target as AspectTarget),
    )
  ) {
    fail(
      'brief.aspectTargets must be a non-empty array of "landscape" | "portrait"',
    );
  }
  if (
    new Set(parsed.brief.aspectTargets as unknown[]).size !==
    (parsed.brief.aspectTargets as unknown[]).length
  ) {
    fail("brief.aspectTargets must not contain duplicates");
  }
  // brief.applications（分镜应用快照，P1 追加语义）：可省略；一旦存在必须
  // 是形状完整的数组——导入校验在这里挡住非数组/字段错型，不能等再应用
  // 分镜时才炸运行时错（is not iterable）。film*After 是与 shots 的对账值，
  // 必须不小于本次追加的量。
  if (parsed.brief.applications !== undefined) {
    if (!Array.isArray(parsed.brief.applications)) {
      fail("brief.applications must be an array when present");
    }
    for (const [index, entry] of (
      parsed.brief.applications as unknown[]
    ).entries()) {
      const field = `brief.applications[${index}]`;
      if (!isRecord(entry)) fail(`${field} must be an object`);
      if (typeof entry.sentence !== "string" || entry.sentence.length > 2000) {
        fail(`${field}.sentence must be a string of at most 2000 characters`);
      }
      if (
        !Number.isInteger(entry.appendedShotCount) ||
        (entry.appendedShotCount as number) < 1
      ) {
        fail(`${field}.appendedShotCount must be an integer of at least 1`);
      }
      if (
        !Number.isInteger(entry.appendedDurationMs) ||
        (entry.appendedDurationMs as number) < 1
      ) {
        fail(`${field}.appendedDurationMs must be a positive integer`);
      }
      if (
        !Number.isInteger(entry.filmShotCountAfter) ||
        (entry.filmShotCountAfter as number) <
          (entry.appendedShotCount as number)
      ) {
        fail(
          `${field}.filmShotCountAfter must be an integer of at least appendedShotCount`,
        );
      }
      if (
        !Number.isInteger(entry.filmTotalMsAfter) ||
        (entry.filmTotalMsAfter as number) <
          (entry.appendedDurationMs as number)
      ) {
        fail(
          `${field}.filmTotalMsAfter must be an integer of at least appendedDurationMs`,
        );
      }
      if (!isIsoTime(entry.appliedAt)) {
        fail(`${field}.appliedAt must be an ISO 8601 string`);
      }
    }
  }
  // —— P2.5-T1：媒体资产账本先于镜头校验（media-clip 交叉校验需要资产时长）——
  const mediaAssetDurations = validateMediaAssets(parsed.mediaAssets);
  if (!Array.isArray(parsed.shots) || parsed.shots.length > MAX_ARRAY) {
    fail(`shots must be an array of at most ${MAX_ARRAY} entries`);
  }
  // 项目层全局唯一（P2-C）：shotId、内容 versionId、order 跨镜头也不得重复——
  // 否则 RenderRecord.versionId / 导出顺序会产生歧义。镜头内查重见 validateShot。
  const knownVersionIds = new Set<string>();
  // P3-B（Codex 复核 E）：3D 渲染证据要与版本对账，先按 versionId 索引版本。
  const versionsById = new Map<string, ContentVersion>();
  const knownShotIds = new Set<string>();
  // W2 风格代表帧确认：versionId 必须属于其声明的 shotId。
  const versionsByShotId = new Map<string, Set<string>>();
  const knownOrders = new Set<number>();
  // 全管线顺序契约（P3-A 修复 I-1）：MP4/TTS/转场边界按数组序消费，交互页按
  // order 排序。要求数组本身严格升序，两边叙事顺序天然一致；允许跳号。
  let previousOrder: number | undefined;
  for (const [index, shot] of parsed.shots.entries()) {
    const parsedShot = validateShot(
      shot,
      `shots[${index}]`,
      mediaAssetDurations,
    );
    if (knownShotIds.has(parsedShot.shotId)) {
      fail(`shots[${index}].shotId is duplicated across shots`);
    }
    knownShotIds.add(parsedShot.shotId);
    if (knownOrders.has(parsedShot.order)) {
      fail(
        `shots[${index}].order ${parsedShot.order} conflicts with another shot`,
      );
    }
    knownOrders.add(parsedShot.order);
    if (previousOrder !== undefined && parsedShot.order <= previousOrder) {
      fail(
        `shots[${index}].order(${parsedShot.order}) must be > shots[${index - 1}].order(${previousOrder})`,
      );
    }
    previousOrder = parsedShot.order;
    for (const version of parsedShot.contentVersions) {
      if (knownVersionIds.has(version.versionId)) {
        fail(
          `shots[${index}] content version ${version.versionId} is duplicated across shots`,
        );
      }
      knownVersionIds.add(version.versionId);
      versionsById.set(version.versionId, version);
      const shotVersions = versionsByShotId.get(parsedShot.shotId);
      if (shotVersions) shotVersions.add(version.versionId);
      else
        versionsByShotId.set(parsedShot.shotId, new Set([version.versionId]));
    }
  }
  if (
    !Array.isArray(parsed.renderRecords) ||
    parsed.renderRecords.length > MAX_ARRAY
  ) {
    fail(`renderRecords must be an array of at most ${MAX_ARRAY} entries`);
  }
  const knownRenderIds = new Set<string>();
  for (const [index, record] of parsed.renderRecords.entries()) {
    const field = `renderRecords[${index}]`;
    if (!isRecord(record)) fail(`${field} must be an object`);
    if (record.styleBibleRef !== undefined) {
      const ref = record.styleBibleRef;
      if (
        !isRecord(ref) ||
        !isUuid(ref.bibleId) ||
        !isUuid(ref.versionId) ||
        typeof ref.digest !== "string" ||
        !SHA256_HEX.test(ref.digest)
      )
        fail(`${field}.styleBibleRef 无效`);
    }
    if (!isUuid(record.renderId)) fail(`${field}.renderId must be a UUID`);
    if (knownRenderIds.has(record.renderId))
      fail(`${field}.renderId is duplicated`);
    knownRenderIds.add(record.renderId);
    if (
      typeof record.versionId !== "string" ||
      !knownVersionIds.has(record.versionId)
    ) {
      fail(`${field}.versionId must point at an existing content version`);
    }
    if (
      typeof record.contentDigest !== "string" ||
      record.contentDigest.length < 8 ||
      record.contentDigest.length > 128
    ) {
      fail(`${field}.contentDigest must be a string of 8..128 characters`);
    }
    for (const key of [
      "engineId",
      "engineVersion",
      "rendererVersion",
      "codec",
      "outputAssetRef",
    ] as const) {
      if (
        typeof record[key] !== "string" ||
        (record[key] as string).length === 0
      ) {
        fail(`${field}.${key} must be a non-empty string`);
      }
    }
    for (const key of ["fps", "width", "height"] as const) {
      if (
        typeof record[key] !== "number" ||
        !Number.isFinite(record[key] as number) ||
        (record[key] as number) <= 0
      ) {
        fail(`${field}.${key} must be a positive number`);
      }
    }
    if (!Number.isInteger(record.frames) || (record.frames as number) < 1) {
      fail(`${field}.frames must be a positive integer`);
    }
    if (!isRecord(record.fontDigests))
      fail(`${field}.fontDigests must be an object`);
    for (const [font, digest] of Object.entries(record.fontDigests)) {
      if (typeof digest !== "string" || digest.length === 0)
        fail(`${field}.fontDigests[${font}] must be a non-empty string`);
    }
    if (
      record.browser !== undefined &&
      (typeof record.browser !== "string" ||
        record.browser.trim().length === 0 ||
        record.browser.length > 128)
    ) {
      fail(
        `${field}.browser must be a trimmed non-empty string of at most 128 characters`,
      );
    }
    // —— P2.5-T1：渲染钉住素材摘要（R1-R2）——
    if (record.assetDigests !== undefined) {
      if (!isRecord(record.assetDigests))
        fail(`${field}.assetDigests must be an object`);
      for (const [assetId, digest] of Object.entries(record.assetDigests)) {
        if (!mediaAssetDurations.has(assetId)) {
          fail(
            `${field}.assetDigests 的键 ${assetId} 未指向 mediaAssets 账本中的资产`,
          );
        }
        if (typeof digest !== "string" || !SHA256_HEX.test(digest)) {
          fail(`${field}.assetDigests[${assetId}] 须为 64 位小写十六进制`);
        }
      }
    }
    // —— P3-B Task 1：three 镜头出片的确定性证据（可选，非 3D 渲染不写）——
    if (record.three !== undefined) {
      const three = record.three;
      if (!isRecord(three)) fail(`${field}.three must be an object`);
      if (
        typeof three.componentId !== "string" ||
        three.componentId.length === 0 ||
        three.componentId.length > 64
      ) {
        fail(
          `${field}.three.componentId must be a non-empty string of at most 64 characters`,
        );
      }
      if (
        !Number.isInteger(three.componentVersion) ||
        (three.componentVersion as number) < 1
      ) {
        fail(`${field}.three.componentVersion must be a positive integer`);
      }
      for (const key of ["threeVersion", "chromiumVersion"] as const) {
        if (
          typeof three[key] !== "string" ||
          (three[key] as string).length === 0 ||
          (three[key] as string).length > 64
        ) {
          fail(
            `${field}.three.${key} must be a non-empty string of at most 64 characters`,
          );
        }
      }
      if (
        typeof three.glRenderer !== "string" ||
        three.glRenderer.length === 0 ||
        three.glRenderer.length > 256
      ) {
        fail(
          `${field}.three.glRenderer must be a non-empty string of at most 256 characters`,
        );
      }
      for (const key of ["framesDigest", "clipSha256"] as const) {
        if (typeof three[key] !== "string" || !SHA256_HEX.test(three[key])) {
          fail(`${field}.three.${key} 须为 64 位小写十六进制`);
        }
      }
      // —— Codex 复核 E：证据必须与所引用版本对账（形状合法 ≠ 语义正确）——
      // record.versionId 的存在性上文已查，故这里必有值。
      const version = versionsById.get(record.versionId as string)!;
      const sceneSource = version.sceneSource;
      if (sceneSource.type !== "three") {
        fail(
          `${field}.three 只能挂在 three 版本的渲染记录上（versionId 指向 ${sceneSource.type} 版本）`,
        );
      }
      if (three.componentId !== sceneSource.spec.componentId) {
        fail(
          `${field}.three.componentId(${three.componentId}) 与版本 spec.componentId(${sceneSource.spec.componentId}) 不一致`,
        );
      }
      if (three.componentVersion !== sceneSource.spec.componentVersion) {
        fail(
          `${field}.three.componentVersion(${three.componentVersion}) 与版本 spec.componentVersion(${sceneSource.spec.componentVersion}) 不一致`,
        );
      }
    } else {
      // 反向对账：three 版本的出片记录不能没有 3D 证据。
      const version = versionsById.get(record.versionId as string)!;
      if (version.sceneSource.type === "three") {
        fail(`${field} 指向 three 版本，缺少 three 渲染证据`);
      }
    }
  }
  if (
    !Array.isArray(parsed.deliveries) ||
    parsed.deliveries.length > MAX_ARRAY
  ) {
    fail(`deliveries must be an array of at most ${MAX_ARRAY} entries`);
  }
  for (const [index, delivery] of parsed.deliveries.entries()) {
    const field = `deliveries[${index}]`;
    if (!isRecord(delivery)) fail(`${field} must be an object`);
    if (!isUuid(delivery.deliveryId))
      fail(`${field}.deliveryId must be a UUID`);
    if (!isIsoTime(delivery.at)) fail(`${field}.at must be an ISO 8601 string`);
    if (
      !Array.isArray(delivery.versionIds) ||
      delivery.versionIds.length < 1 ||
      delivery.versionIds.some(
        (versionId) => !knownVersionIds.has(versionId as string),
      )
    ) {
      fail(
        `${field}.versionIds must be a non-empty array of existing content version ids`,
      );
    }
    if (
      !Array.isArray(delivery.renderIds) ||
      delivery.renderIds.some(
        (renderId) => !knownRenderIds.has(renderId as string),
      )
    ) {
      fail(`${field}.renderIds must be an array of existing render record ids`);
    }
    if (
      !Array.isArray(delivery.frameMap) ||
      delivery.frameMap.some(
        (frames) => !Number.isInteger(frames) || frames < 1,
      )
    ) {
      fail(`${field}.frameMap must be an array of positive integers`);
    }
    // 已知交付类型都须指向具体产物；旧五键记录仍按原形状读取。
    if (
      delivery.kind !== undefined &&
      delivery.kind !== "interactive-html" &&
      delivery.kind !== "gif" &&
      delivery.kind !== "shot-svg"
    ) {
      fail(`${field}.kind 须为 interactive-html、gif 或 shot-svg`);
    }
    // kind 一出现就要求「产物名 + 摘要」齐全：只写 kind 的记录无法定位具体
    // 产物，等于伪完整交付（P3-A 修复 Minor 1）。旧五键记录仍合法。
    if (delivery.kind !== undefined) {
      if (delivery.outputRef === undefined) {
        fail(`${field}.outputRef is required when kind is present`);
      }
      if (delivery.digest === undefined) {
        fail(`${field}.digest is required when kind is present`);
      }
    }
    if (delivery.outputRef !== undefined) {
      if (
        typeof delivery.outputRef !== "string" ||
        delivery.outputRef.trim().length === 0 ||
        delivery.outputRef.includes("..") ||
        delivery.outputRef.includes("/") ||
        delivery.outputRef.includes("\\")
      ) {
        fail(`${field}.outputRef 须为非空字符串且不含 .. 与路径分隔符`);
      }
    }
    if (
      delivery.digest !== undefined &&
      (typeof delivery.digest !== "string" || !SHA256_HEX.test(delivery.digest))
    ) {
      fail(`${field}.digest 须为 64 位小写十六进制`);
    }
  }
  // —— P1 转场（Feature ④ spec R1）：可变编排元数据，查形状/枚举/范围/重复；
  // 缺省字段与现状行为完全一致（不加键）——
  if (parsed.transitions !== undefined) {
    if (
      !Array.isArray(parsed.transitions) ||
      parsed.transitions.length > MAX_ARRAY
    ) {
      fail(`transitions must be an array of at most ${MAX_ARRAY} entries`);
    }
    const seen = new Set<number>();
    const maxBoundary = parsed.shots.length - 2;
    for (const [index, transition] of parsed.transitions.entries()) {
      const field = `transitions[${index}]`;
      if (!isRecord(transition)) fail(`${field} must be an object`);
      const boundary = transition.boundary as number;
      const durationMs = transition.durationMs as number;
      if (
        !Number.isInteger(boundary) ||
        boundary < 0 ||
        boundary > maxBoundary
      ) {
        fail(
          `${field}.boundary 越界（合法 0..${maxBoundary}，镜头增删后需同步清理）`,
        );
      }
      if (transition.kind !== "fade") fail(`${field}.kind 须为 fade`);
      if (
        !Number.isInteger(durationMs) ||
        durationMs < 100 ||
        durationMs > 2000
      ) {
        fail(`${field}.durationMs 须为 100..2000 的整数毫秒`);
      }
      if (seen.has(boundary)) {
        fail(`${field}.boundary 与前条重复（同一边界至多一条转场）`);
      }
      seen.add(boundary);
    }
  }
  // —— W2 风格代表帧确认账本：可省略；存在时逐条查形状并与镜头/版本对账 ——
  if (parsed.styleFrameConfirmations !== undefined) {
    if (
      !Array.isArray(parsed.styleFrameConfirmations) ||
      parsed.styleFrameConfirmations.length > 100
    ) {
      fail("styleFrameConfirmations 须为至多 100 条的数组");
    }
    const knownConfirmationIds = new Set<string>();
    for (const [index, confirmation] of parsed.styleFrameConfirmations.entries()) {
      const field = `styleFrameConfirmations[${index}]`;
      if (!isRecord(confirmation)) fail(`${field} must be an object`);
      if (!isUuid(confirmation.confirmationId))
        fail(`${field}.confirmationId must be a UUID`);
      if (knownConfirmationIds.has(confirmation.confirmationId))
        fail(`${field}.confirmationId is duplicated`);
      knownConfirmationIds.add(confirmation.confirmationId as string);
      if (typeof confirmation.shotId !== "string" || !knownShotIds.has(confirmation.shotId)) {
        fail(`${field}.shotId 未指向项目中的镜头`);
      }
      const shotVersions = versionsByShotId.get(confirmation.shotId as string);
      if (
        typeof confirmation.versionId !== "string" ||
        !shotVersions?.has(confirmation.versionId)
      ) {
        fail(`${field}.versionId 未指向该镜头的内容版本`);
      }
      for (const key of ["contentDigest", "workingSetDigest"] as const) {
        if (
          typeof confirmation[key] !== "string" ||
          !SHA256_HEX.test(confirmation[key] as string)
        ) {
          fail(`${field}.${key} 须为 64 位小写十六进制`);
        }
      }
      const version = versionsById.get(confirmation.versionId as string)!;
      if (
        !Number.isInteger(confirmation.frameMs) ||
        (confirmation.frameMs as number) < 0 ||
        (confirmation.frameMs as number) >= version.durationMs
      ) {
        fail(
          `${field}.frameMs 须为 0..${version.durationMs - 1} 的整数毫秒`,
        );
      }
      const frames = quantizeTimeline([version.durationMs], EXPORT_FPS)
        .shots[0]!.frames;
      if (
        !Number.isInteger(confirmation.frameIndex) ||
        (confirmation.frameIndex as number) < 0 ||
        (confirmation.frameIndex as number) >= frames
      ) {
        fail(`${field}.frameIndex 须为 0..${frames - 1} 的整数帧`);
      }
      const ref = confirmation.styleBibleRef;
      if (
        !isRecord(ref) ||
        !isUuid(ref.bibleId) ||
        !isUuid(ref.versionId) ||
        typeof ref.digest !== "string" ||
        !SHA256_HEX.test(ref.digest)
      ) {
        fail(`${field}.styleBibleRef 须包含 bibleId、versionId 与 SHA-256 digest`);
      }
      const keyframes = confirmation.keyframes;
      if (
        !Array.isArray(keyframes) ||
        keyframes.length !== 2 ||
        !keyframes.some((frame) => frame?.aspect === "landscape") ||
        !keyframes.some((frame) => frame?.aspect === "portrait")
      ) {
        fail(`${field}.keyframes 须恰好横竖各一条`);
      }
      for (const [frameIndex, frame] of keyframes.entries()) {
        const frameField = `${field}.keyframes[${frameIndex}]`;
        if (!isRecord(frame)) fail(`${frameField} must be an object`);
        if (frame.aspect !== "landscape" && frame.aspect !== "portrait") {
          fail(`${frameField}.aspect 须为 landscape 或 portrait`);
        }
        if (typeof frame.digest !== "string" || !SHA256_HEX.test(frame.digest)) {
          fail(`${frameField}.digest 须为 64 位小写十六进制`);
        }
        if (!Number.isInteger(frame.bytes) || (frame.bytes as number) < 1) {
          fail(`${frameField}.bytes 须为正整数`);
        }
        if (
          typeof frame.outputRef !== "string" ||
          frame.outputRef.length < 1 ||
          frame.outputRef.length > 200 ||
          frame.outputRef.includes("..")
        ) {
          fail(`${frameField}.outputRef 须为 1..200 字符且不含 ..`);
        }
      }
      if (
        confirmation.note !== undefined &&
        (typeof confirmation.note !== "string" ||
          confirmation.note.length < 1 ||
          confirmation.note.length > 200)
      ) {
        fail(`${field}.note 须为 1..200 字符`);
      }
      if (!isIsoTime(confirmation.confirmedAt))
        fail(`${field}.confirmedAt must be an ISO 8601 string`);
      if (confirmation.actor !== "human") {
        fail(`${field}.actor must be "human"（人工显式确认）`);
      }
    }
  }
  return parsed as VideoProject;
}
