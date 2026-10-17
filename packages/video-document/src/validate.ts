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
  if (!Array.isArray(parsed.shots) || parsed.shots.length > MAX_ARRAY) {
    fail(`shots must be an array of at most ${MAX_ARRAY} entries`);
  }
  const knownVersionIds = new Set<string>();
  for (const [index, shot] of parsed.shots.entries()) {
    const parsedShot = validateShot(shot, `shots[${index}]`);
    for (const version of parsedShot.contentVersions)
      knownVersionIds.add(version.versionId);
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
  return parsed as VideoProject;
}
