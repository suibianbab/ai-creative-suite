import assert from "node:assert/strict";
import test from "node:test";
import { approvedVersionId, deriveStatus } from "./events.js";
import type { ShotEvent } from "./types.js";

const A = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b1001";
const B = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b1002";
const at = "2026-10-17T00:00:00.000Z";

test("未 submitted 为 draft；submitted 为 candidate；approved 后为 approved", () => {
  assert.equal(deriveStatus([], A), "draft");
  assert.equal(
    deriveStatus([{ kind: "submitted", versionId: A, at, actor: "ai" }], A),
    "candidate",
  );
  const ev: ShotEvent[] = [
    { kind: "submitted", versionId: A, at, actor: "ai" },
    { kind: "approved", versionId: A, at, actor: "human" },
  ];
  assert.equal(deriveStatus(ev, A), "approved");
});

test("重做后旧版本仍是 approved，新版本是 candidate", () => {
  const ev: ShotEvent[] = [
    { kind: "submitted", versionId: A, at, actor: "ai" },
    { kind: "approved", versionId: A, at, actor: "human" },
    { kind: "submitted", versionId: B, at, actor: "ai" },
  ];
  assert.equal(deriveStatus(ev, A), "approved");
  assert.equal(deriveStatus(ev, B), "candidate");
  assert.equal(approvedVersionId(ev), A);
});
