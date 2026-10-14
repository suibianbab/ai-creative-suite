import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const base = "http://127.0.0.1:4112";
let source = await readFile(resolve("qa/fixtures/photocraft-hat-teal.png"));
let contentType = "image/png";
const steps = [
  {
    plan: {
      operation: "recolor",
      color: "red",
      target: "brim",
      protectLabel: true,
    },
    outline: [
      [270, 790],
      [990, 714],
      [1180, 935],
      [870, 1000],
      [520, 1060],
    ],
    protectRect: [620, 490, 250, 160],
  },
  {
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: 10,
      target: "whole-image",
      protectLabel: false,
    },
  },
  {
    plan: {
      operation: "crop",
      target: "selected-area",
      protectLabel: false,
      square: true,
    },
    rect: [27, 27, 1200, 1200],
  },
];
let last;
let previousPreviewHash;
for (const [index, step] of steps.entries()) {
  const response = await fetch(`${base}/v1/instruction`, {
    method: "POST",
    headers: {
      "content-type": contentType,
      "x-acs-plan": JSON.stringify(step.plan),
      "x-acs-points": "[]",
      "x-acs-rect": JSON.stringify(step.rect ?? null),
      "x-acs-outline": JSON.stringify(step.outline ?? []),
      "x-acs-patches": "[]",
      "x-acs-edge-shift": "0",
      "x-acs-edge-feather": String(index === 0 ? 2 : 0),
      "x-acs-protect-rect": JSON.stringify(step.protectRect ?? null),
      "x-acs-selection-method": "manual",
      "x-acs-heal-size": "55",
      "x-acs-provider-scope-feather": "80",
    },
    body: source,
  });
  const data = await response.json();
  assert.equal(response.status, 200, `step ${index + 1}: ${data.error}`);
  assert.ok(data.layers >= Math.min(index + 2, 3));
  if (index === 0)
    assert.ok(data.selectionBounds, "local edit should retain its selection");
  if (index === 1)
    assert.equal(
      data.selectionBounds,
      null,
      "whole-image adjustment must clear the prior local selection",
    );
  last = data;
  const previewResponse = await fetch(`${base}${data.previewUrl}`);
  assert.equal(previewResponse.status, 200);
  const previewHash = createHash("sha256")
    .update(Buffer.from(await previewResponse.arrayBuffer()))
    .digest("hex");
  if (previousPreviewHash)
    assert.notEqual(
      previewHash,
      previousPreviewHash,
      `step ${index + 1} did not change the preview`,
    );
  previousPreviewHash = previewHash;
  const native = await fetch(`${base}${data.sourceUrl}`);
  assert.equal(native.status, 200);
  source = Buffer.from(await native.arrayBuffer());
  contentType = "application/x-photocraft";
}
assert.equal(last.width, 1200);
assert.equal(last.height, 1200);
const preview = await fetch(`${base}${last.previewUrl}`);
assert.equal(preview.status, 200);
assert.match(preview.headers.get("content-type") ?? "", /image\/png/);
assert.ok((await preview.arrayBuffer()).byteLength > 100_000);
console.log(
  "PhotoCraft sequence passed: recolor, brightness, square crop, editable source and PNG preview",
);
