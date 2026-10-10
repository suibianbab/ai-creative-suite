import assert from "node:assert/strict";
import test from "node:test";
import {
  applyImageOperation,
  commitImageOperations,
  createImageDocument,
  createImageHistory,
  DEFAULT_CONTACT_SHADOW,
  type ImageLayer,
  routeImageCapability,
  undoImageOperation,
} from "./index.js";

const product: ImageLayer = {
  id: "masked-product",
  kind: "image",
  name: "Synthetic bottle",
  assetId: "immutable-original",
  mask: { assetId: "mask-original", strokes: [] },
  sourceWidth: 600,
  sourceHeight: 800,
  x: 200,
  y: 100,
  width: 300,
  height: 400,
  rotation: 0,
  opacity: 1,
};

test("surface alignment and shadow form one reversible document transaction", () => {
  assert.equal(routeImageCapability("basic-shadow"), "native");
  const base = applyImageOperation(createImageDocument("shadow-doc"), {
    type: "addImage",
    layer: product,
  });
  const edited = commitImageOperations(createImageHistory(base), [
    { type: "transform", layerId: product.id, patch: { y: 170 } },
    {
      type: "setContactShadow",
      layerId: product.id,
      shadow: { ...DEFAULT_CONTACT_SHADOW },
    },
  ]);
  const layer = edited.present.layers[0] as ImageLayer;
  assert.equal(layer.y, 170);
  assert.equal(layer.assetId, "immutable-original");
  assert.equal(layer.mask?.assetId, "mask-original");
  assert.deepEqual(layer.contactShadow, DEFAULT_CONTACT_SHADOW);
  assert.deepEqual(undoImageOperation(edited).present, base);
  assert.deepEqual(
    JSON.parse(JSON.stringify(edited.present)).layers[0].contactShadow,
    DEFAULT_CONTACT_SHADOW,
  );
});

test("shadow settings validate bounds and disappear when mask is removed", () => {
  const base = applyImageOperation(createImageDocument("shadow-doc-2"), {
    type: "addImage",
    layer: product,
  });
  assert.throws(() =>
    applyImageOperation(base, {
      type: "setContactShadow",
      layerId: product.id,
      shadow: { ...DEFAULT_CONTACT_SHADOW, opacity: 1 },
    }),
  );
  assert.throws(() =>
    applyImageOperation(base, {
      type: "setContactShadow",
      layerId: product.id,
      shadow: { ...DEFAULT_CONTACT_SHADOW, color: "red" },
    }),
  );
  const shadowed = applyImageOperation(base, {
    type: "setContactShadow",
    layerId: product.id,
    shadow: { ...DEFAULT_CONTACT_SHADOW },
  });
  const unmasked = applyImageOperation(shadowed, {
    type: "setMask",
    layerId: product.id,
    assetId: null,
  });
  assert.equal((unmasked.layers[0] as ImageLayer).contactShadow, undefined);
  assert.equal((unmasked.layers[0] as ImageLayer).assetId, product.assetId);
});
