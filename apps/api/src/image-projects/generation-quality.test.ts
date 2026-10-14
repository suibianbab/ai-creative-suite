import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { inspectGeneratedComposite } from "./generation-quality.js";

test("rectangular pasted patch is rejected, soft local change passes", async () => {
  const base = await sharp({
    create: { width: 180, height: 160, channels: 3, background: "#778899" },
  })
    .png()
    .toBuffer();
  const patch = await sharp({
    create: { width: 80, height: 70, channels: 3, background: "#132b60" },
  })
    .png()
    .toBuffer();
  const hard = await sharp(base)
    .composite([{ input: patch, left: 50, top: 40 }])
    .png()
    .toBuffer();
  const bad = await inspectGeneratedComposite(base, hard, [50, 40, 80, 70]);
  assert.ok(bad.changedInside > 20);
  assert.equal(bad.changedOutside, 0);
  assert.equal(bad.rectangularSeam, true);
  const ellipse = Buffer.from(
    `<svg width="180" height="160"><ellipse cx="90" cy="75" rx="28" ry="25" fill="#132b60"/></svg>`,
  );
  const soft = await sharp(base)
    .composite([{ input: ellipse, left: 0, top: 0 }])
    .png()
    .toBuffer();
  const good = await inspectGeneratedComposite(base, soft, [50, 40, 80, 70]);
  assert.ok(good.changedInside > 20);
  assert.equal(good.changedOutside, 0);
  assert.equal(good.rectangularSeam, false);
});
