import assert from "node:assert/strict";
import test from "node:test";
import { compareSceneLightSamples, type LightSample } from "./scene-lighting";

const sample = (left: number, right: number): LightSample => ({
  left,
  right,
  leftCount: 200,
  rightCount: 200,
  highlightFraction: 0,
  shadowFraction: 0,
});

test("opposed left-right light directions request review", () => {
  const result = compareSceneLightSamples(sample(190, 220), sample(210, 185));
  assert.equal(result.status, "review");
  assert.equal(result.productDelta, 30);
  assert.equal(result.backgroundDelta, -25);
  assert.match(result.observations.join(" "), /方向相反/);
});

test("matching directions avoid a false physical-quality claim", () => {
  const result = compareSceneLightSamples(sample(230, 200), sample(215, 190));
  assert.equal(result.status, "consistent");
  assert.match(result.observations.join(" "), /仍需检查材质与色温/);
});

test("clipping and insufficient samples remain reviewable", () => {
  const clipped = compareSceneLightSamples(
    { ...sample(220, 215), highlightFraction: 0.12 },
    sample(200, 195),
  );
  assert.equal(clipped.status, "review");
  assert.match(clipped.observations.join(" "), /过曝/);
  const sparse = compareSceneLightSamples(
    { ...sample(220, 215), leftCount: 5 },
    sample(200, 195),
  );
  assert.equal(sparse.status, "insufficient");
});
