import assert from "node:assert/strict";
import test from "node:test";
import { missingComparisonArms } from "./generation-ab-status.mjs";

const models = ["baseline", "challenger"];
const cases = ["remove", "background"];
const complete = models.flatMap((model) =>
  cases.map((caseName) => ({ model, case: caseName, ok: true })),
);

test("all four planned arms are required; optional probe is ignored", () => {
  assert.deepEqual(
    missingComparisonArms(models, cases, [
      ...complete,
      { model: "mask-probe", case: "remove", ok: false },
    ]),
    [],
  );
});

test("one successful arm cannot make the A/B pass", () => {
  assert.deepEqual(missingComparisonArms(models, cases, [complete[0]]), [
    "baseline/background",
    "challenger/remove",
    "challenger/background",
  ]);
});

test("failed or duplicated arms are incomplete", () => {
  assert.deepEqual(
    missingComparisonArms(models, cases, [
      ...complete,
      { model: "baseline", case: "remove", ok: true },
    ]),
    ["baseline/remove"],
  );
  assert.deepEqual(
    missingComparisonArms(
      models,
      cases,
      complete.map((row) =>
        row.model === "challenger" && row.case === "remove"
          ? { ...row, ok: false }
          : row,
      ),
    ),
    ["challenger/remove"],
  );
});
