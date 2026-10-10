import assert from "node:assert/strict";
import test from "node:test";
import {
  applyImageOperation,
  commitImageOperations,
  createImageDocument,
  createImageHistory,
  type ImageLayer,
  planBackgroundPlate,
  undoImageOperation,
} from "./index.js";

const product: ImageLayer = {
  id: "product",
  kind: "image",
  name: "测试商品",
  assetId: "original-product",
  sourceWidth: 600,
  sourceHeight: 600,
  mask: { assetId: "original-mask", strokes: [] },
  x: 190,
  y: 190,
  width: 700,
  height: 700,
  rotation: 0,
  opacity: 1,
};

test("generated plate sits below the masked original and undoes in one step", () => {
  const before = applyImageOperation(createImageDocument("plate"), {
    type: "addImage",
    layer: product,
  });
  const operations = planBackgroundPlate(
    before,
    product.id,
    "generated-plate",
    1254,
    1254,
    () => "background-layer",
  );
  const after = commitImageOperations(createImageHistory(before), operations);
  assert.equal(after.past.length, 1);
  assert.equal(
    (after.present.layers[0] as ImageLayer).assetId,
    "generated-plate",
  );
  assert.equal(
    (after.present.layers[1] as ImageLayer).assetId,
    "original-product",
  );
  assert.equal(
    (after.present.layers[1] as ImageLayer).mask?.assetId,
    "original-mask",
  );
  assert.deepEqual(undoImageOperation(after).present, before);
});

test("replacement removes the previous plate and maintains a cover crop", () => {
  const original = applyImageOperation(createImageDocument("plate"), {
    type: "addImage",
    layer: product,
  });
  const first = planBackgroundPlate(
    original,
    product.id,
    "first",
    1254,
    1254,
    () => "bg-1",
  ).reduce(applyImageOperation, original);
  const portrait = applyImageOperation(first, {
    type: "resizeCanvas",
    width: 1080,
    height: 1350,
  });
  const second = planBackgroundPlate(
    portrait,
    product.id,
    "second",
    1254,
    1254,
    () => "bg-2",
  ).reduce(applyImageOperation, portrait);
  assert.equal(second.layers.length, 2);
  assert.equal((second.layers[0] as ImageLayer).assetId, "second");
  assert.equal((second.layers[0] as ImageLayer).width, 1080);
  assert.equal((second.layers[0] as ImageLayer).height, 1350);
  assert.ok((second.layers[0] as ImageLayer).crop!.width < 1254);
});

test("plate planning rejects an unmasked product and invalid generated image", () => {
  const unmasked = applyImageOperation(createImageDocument("plate"), {
    type: "addImage",
    layer: { ...product, mask: undefined },
  });
  assert.throws(() =>
    planBackgroundPlate(unmasked, product.id, "new", 1024, 1024, () => "bg"),
  );
  const masked = applyImageOperation(createImageDocument("plate"), {
    type: "addImage",
    layer: product,
  });
  assert.throws(() =>
    planBackgroundPlate(masked, product.id, "new", 0, 1024, () => "bg"),
  );
});
