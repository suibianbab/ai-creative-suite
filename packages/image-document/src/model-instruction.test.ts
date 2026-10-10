import assert from "node:assert/strict";
import test from "node:test";
import {
  applyImageOperation,
  commitImageOperations,
  createImageDocument,
  createImageHistory,
  type ImageLayer,
  planModelImageInstruction,
  undoImageOperation,
} from "./index.js";

const image: ImageLayer = {
  id: "product",
  kind: "image",
  name: "商品",
  assetId: "original",
  sourceWidth: 100,
  sourceHeight: 100,
  x: 100,
  y: 100,
  width: 300,
  height: 300,
  rotation: 0,
  opacity: 1,
};

test("model translation produces validated atomic edits with the original asset retained", () => {
  const original = applyImageOperation(createImageDocument("ai"), {
    type: "addImage",
    layer: image,
  });
  const plan = planModelImageInstruction(
    original,
    image.id,
    { clauses: ["背景改成浅灰色", "亮度提高 10"], unsupported: "" },
    () => "unused",
  );
  const history = commitImageOperations(
    createImageHistory(original),
    plan.operations,
  );
  assert.equal(history.past.length, 1);
  assert.equal(history.present.canvas.background, "#f2f2f2");
  assert.equal((history.present.layers[0] as ImageLayer).assetId, "original");
  assert.equal(
    (history.present.layers[0] as ImageLayer).adjustments?.brightness,
    10,
  );
  assert.deepEqual(undoImageOperation(history).present, original);
});

test("model output cannot bypass grammar or cause a partial edit", () => {
  const original = applyImageOperation(createImageDocument("ai"), {
    type: "addImage",
    layer: image,
  });
  for (const response of [
    { clauses: ["背景改成黑色"], unsupported: "重绘商品" },
    { clauses: ["removeLayer product"], unsupported: "" },
    { clauses: ["亮度调到 200"], unsupported: "" },
    { clauses: [], unsupported: "" },
    { clauses: ["背景改成白色", 1], unsupported: "" },
  ]) {
    assert.throws(() =>
      planModelImageInstruction(original, image.id, response, () => "unused"),
    );
    assert.equal(original.canvas.background, "#ffffff");
    assert.equal((original.layers[0] as ImageLayer).assetId, "original");
  }
});
