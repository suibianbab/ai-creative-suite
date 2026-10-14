import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PhotoCraftJobValidationError,
  validatedPhotoCraftJobParams,
} from "./photocraft-edit-jobs.js";

test("adjustment jobs accept only bounded numerical parameters", () => {
  assert.deepEqual(
    validatedPhotoCraftJobParams("adjust-brightness", { amount: 15 }),
    { amount: 15 },
  );
  assert.deepEqual(
    validatedPhotoCraftJobParams("levels", {
      inBlack: 20,
      inWhite: 235,
      gamma: 1.2,
    }),
    { inBlack: 20, inWhite: 235, gamma: 1.2 },
  );
  for (const params of [
    { amount: 0 },
    { amount: 51 },
    { amount: 10, command: "paint.erase" },
    { amount: "15" },
    { amount: Number.POSITIVE_INFINITY },
  ])
    assert.throws(
      () => validatedPhotoCraftJobParams("adjust-brightness", params),
      PhotoCraftJobValidationError,
    );
  for (const params of [
    { inBlack: 235, inWhite: 20, gamma: 1.2 },
    { inBlack: 20, inWhite: 235, gamma: 0 },
    { inBlack: 20, inWhite: 235, gamma: 1.2, path: "C:\\" },
  ])
    assert.throws(
      () => validatedPhotoCraftJobParams("levels", params),
      PhotoCraftJobValidationError,
    );
  assert.throws(
    () => validatedPhotoCraftJobParams("rotate-cw", { amount: 10 }),
    PhotoCraftJobValidationError,
  );
});

test("masked adjustments accept bounded native selections and reject arbitrary command payloads", () => {
  const input = {
    amount: 18,
    selection: { kind: "rect", rect: [10, 20, 60, 70] },
  };
  assert.deepEqual(
    validatedPhotoCraftJobParams("masked-adjust-brightness", input),
    { ...input, edgeShift: 0, edgeFeather: 0, patches: [] },
  );
  assert.deepEqual(
    validatedPhotoCraftJobParams("masked-adjust-contrast", {
      amount: -12,
      selection: { kind: "existing" },
      edgeFeather: 2,
    }),
    {
      amount: -12,
      selection: { kind: "existing" },
      edgeShift: 0,
      edgeFeather: 2,
      patches: [],
    },
  );
  for (const params of [
    { ...input, command: "file.open" },
    { ...input, selection: { kind: "rect", rect: [10, 20, 0, 70] } },
    {
      ...input,
      selection: {
        kind: "lasso",
        points: [
          [1, 2],
          [3, 4],
        ],
      },
    },
    {
      ...input,
      selection: { kind: "object", rect: [1, 2, 3, 4], path: "C:\\" },
    },
    { ...input, edgeShift: 65 },
    {
      ...input,
      patches: [
        {
          mode: "replace",
          points: [
            [1, 2],
            [3, 4],
            [5, 6],
          ],
        },
      ],
    },
  ])
    assert.throws(
      () => validatedPhotoCraftJobParams("masked-adjust-brightness", params),
      PhotoCraftJobValidationError,
    );
});
