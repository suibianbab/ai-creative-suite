import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasUnsyncedPhotoCraftDraft,
  type PhotoCraftLocalProject,
  planPhotoCraftCloudCache,
  sortValidPhotoCraftProjects,
} from "./local-projects";

const draftBytes = new Uint8Array([1, 2, 3]).buffer;
const cloudBytes = new Uint8Array([4, 5, 6]).buffer;
const previous: PhotoCraftLocalProject = {
  id: "cloud-id",
  title: "帽图",
  version: 3,
  cloudVersion: 2,
  syncedLocalVersion: 2,
  createdAt: 100,
  updatedAt: 200,
  bytes: draftBytes,
  qualityReview: {
    grade: "manual",
    note: "边缘待修",
    checks: [true, true, false, false],
    criteria: ["主体", "背景", "标签", "边缘"],
    reviewedAt: 200,
    sourceVersion: 3,
  },
};

test("opening cloud version preserves unsynced native source and quality record", () => {
  assert.equal(hasUnsyncedPhotoCraftDraft(previous), true);
  const result = planPhotoCraftCloudCache(
    previous,
    {
      id: previous.id,
      title: previous.title,
      version: 2,
      bytes: cloudBytes,
    },
    300,
    "preserved-id",
  );
  assert.equal(result.preservedDraft?.id, "preserved-id");
  assert.equal(result.preservedDraft?.version, 3);
  assert.deepEqual(
    new Uint8Array(result.preservedDraft!.bytes),
    new Uint8Array(draftBytes),
  );
  assert.equal(result.preservedDraft?.qualityReview?.note, "边缘待修");
  assert.equal(result.preservedDraft?.cloudVersion, undefined);
  assert.equal(result.project.id, previous.id);
  assert.equal(result.project.version, 2);
  assert.equal(result.project.syncedLocalVersion, 2);
  assert.deepEqual(result.project.qualityHistory, []);
  assert.deepEqual(
    new Uint8Array(result.project.bytes),
    new Uint8Array(cloudBytes),
  );
});

test("clean local source can be replaced by newer cloud version without a draft fork", () => {
  const clean = {
    ...previous,
    version: 7,
    cloudVersion: 3,
    syncedLocalVersion: 7,
  };
  assert.equal(hasUnsyncedPhotoCraftDraft(clean), false);
  const result = planPhotoCraftCloudCache(
    clean,
    {
      id: clean.id,
      title: clean.title,
      version: 4,
      bytes: cloudBytes,
    },
    300,
    "unused-id",
  );
  assert.equal(result.preservedDraft, null);
  assert.equal(result.project.version, 4);
  assert.equal(result.project.cloudVersion, 4);
  assert.equal(result.project.syncedLocalVersion, 4);
});

test("legacy mismatch and never-synced local projects are conservatively preserved", () => {
  assert.equal(
    hasUnsyncedPhotoCraftDraft({ ...previous, syncedLocalVersion: undefined }),
    true,
  );
  assert.equal(
    hasUnsyncedPhotoCraftDraft({
      ...previous,
      cloudVersion: undefined,
      syncedLocalVersion: undefined,
    }),
    true,
  );
  assert.equal(
    hasUnsyncedPhotoCraftDraft({
      ...previous,
      version: 2,
      syncedLocalVersion: undefined,
    }),
    false,
  );
});

test("project list tolerates an invalid browser cache record without hiding valid drafts", () => {
  const projects = sortValidPhotoCraftProjects([
    null,
    { ...previous, updatedAt: 100 },
    { ...previous, id: "preserved-id", updatedAt: 300 },
  ]);
  assert.deepEqual(
    projects.map((project) => project.id),
    ["preserved-id", "cloud-id"],
  );
});
