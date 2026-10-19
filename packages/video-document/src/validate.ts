import type {
  AspectTarget,
  ContentVersion,
  SceneSource,
  Shot,
  ShotEvent,
  VideoProject,
} from "./types.js";

export type { VideoProject } from "./types.js";

export class VideoProjectValidationError extends Error {}

export const VIDEO_PROJECT_MAX_BYTES = 2 * 1024 * 1024;

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

function validateSceneSource(value: unknown, field: string): void {
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
  fail(`${field}.sceneSource.type must be "spec" or "editor-binding"`);
}

function validateContentVersion(value: unknown, field: string): ContentVersion {
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
  validateSceneSource(value.sceneSource, field);
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

function validateShot(value: unknown, field: string): Shot {
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
  const knownShotIds = new Set<string>();
  const knownOrders = new Set<number>();
  for (const [index, shot] of parsed.shots.entries()) {
    const parsedShot = validateShot(shot, `shots[${index}]`);
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
    for (const version of parsedShot.contentVersions) {
      if (knownVersionIds.has(version.versionId)) {
        fail(
          `shots[${index}] content version ${version.versionId} is duplicated across shots`,
        );
      }
      knownVersionIds.add(version.versionId);
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
  return parsed as VideoProject;
}
