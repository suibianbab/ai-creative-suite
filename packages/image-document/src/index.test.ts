import assert from "node:assert/strict";
import test from "node:test";
import {
  applyImageOperation,
  commitImageOperation,
  commitImageOperations,
  createImageDocument,
  createImageHistory,
  frameFromSubjectBounds,
  type ImageLayer,
  planImageInstruction,
  redoImageOperation,
  undoImageOperation,
} from "./index.js";

const product: ImageLayer = {
  id: "layer-product",
  kind: "image",
  name: "Product original",
  assetId: "asset-original",
  sourceWidth: 600,
  sourceHeight: 600,
  x: 100,
  y: 100,
  width: 600,
  height: 600,
  rotation: 0,
  opacity: 1,
};

test("composition edits retain the original asset reference and undo/redo accurately", () => {
  const original = createImageDocument("doc-1");
  let history = createImageHistory(original);
  history = commitImageOperation(history, { type: "addImage", layer: product });
  history = commitImageOperation(history, {
    type: "transform",
    layerId: product.id,
    patch: { x: 240, width: 500 },
  });

  assert.equal(history.present.layers[0]!.kind, "image");
  assert.equal(
    (history.present.layers[0] as ImageLayer).assetId,
    "asset-original",
  );
  assert.equal(history.present.layers[0]!.x, 240);
  assert.equal(original.layers.length, 0);

  history = undoImageOperation(history);
  assert.equal(history.present.layers[0]!.x, 100);
  history = redoImageOperation(history);
  assert.equal(history.present.layers[0]!.x, 240);
});

test("a text instruction previews safe document edits and commits as one undo step", () => {
  const original = applyImageOperation(createImageDocument("prompt-doc"), {
    type: "addImage",
    layer: product,
  });
  const plan = planImageInstruction(
    original,
    product.id,
    "改成竖图；背景改成浅灰色；把商品移到右边；添加标题：新品上市",
    () => "title-1",
  );
  assert.equal(plan.operations.length, 4);
  assert.equal(original.canvas.width, 1080);
  const history = commitImageOperations(
    createImageHistory(original),
    plan.operations,
  );
  assert.equal(history.past.length, 1);
  assert.equal(history.present.canvas.height, 1350);
  assert.equal(history.present.canvas.background, "#f2f2f2");
  assert.equal(history.present.layers[1]?.kind, "text");
  assert.equal(
    (history.present.layers[0] as ImageLayer).assetId,
    product.assetId,
  );
  assert.deepEqual(undoImageOperation(history).present, original);
});

test("unsupported or invalid instructions never partially change the document", () => {
  const original = applyImageOperation(createImageDocument("prompt-reject"), {
    type: "addImage",
    layer: product,
  });
  assert.throws(() =>
    planImageInstruction(
      original,
      product.id,
      "改成竖图；把商品换成另一款",
      () => "unused",
    ),
  );
  assert.equal(original.canvas.height, 1080);
  const history = createImageHistory(original);
  assert.throws(() =>
    commitImageOperations(history, [
      { type: "resizeCanvas", width: 1080, height: 1350 },
      { type: "transform", layerId: product.id, patch: { opacity: 2 } },
    ]),
  );
  assert.equal(history.present.canvas.height, 1080);
  assert.equal(history.past.length, 0);
});

test("invalid transforms and duplicate layer IDs are rejected", () => {
  const document = applyImageOperation(createImageDocument("doc-2"), {
    type: "addImage",
    layer: product,
  });
  assert.throws(() =>
    applyImageOperation(document, { type: "addImage", layer: product }),
  );
  assert.throws(() =>
    applyImageOperation(document, {
      type: "transform",
      layerId: product.id,
      patch: { width: -1 },
    }),
  );
  assert.throws(() =>
    applyImageOperation(document, {
      type: "transform",
      layerId: product.id,
      patch: { opacity: 2 },
    }),
  );
  assert.throws(() =>
    applyImageOperation(document, {
      type: "transform",
      layerId: product.id,
      patch: { assetId: "different-asset" } as never,
    }),
  );
});

test("a new operation after undo clears the redo branch", () => {
  let history = createImageHistory(createImageDocument("doc-3"));
  history = commitImageOperation(history, { type: "addImage", layer: product });
  history = undoImageOperation(history);
  history = commitImageOperation(history, {
    type: "setCanvas",
    patch: { background: "#eeeeee" },
  });
  assert.equal(history.future.length, 0);
  assert.equal(history.present.layers.length, 0);
});

test("canvas preset change recenters the image without altering its source", () => {
  const withProduct = applyImageOperation(createImageDocument("doc-4"), {
    type: "addImage",
    layer: product,
  });
  const resized = applyImageOperation(withProduct, {
    type: "resizeCanvas",
    width: 1080,
    height: 1350,
  });
  assert.equal(resized.canvas.height, 1350);
  assert.equal(resized.layers[0]!.y, 235);
  assert.equal((resized.layers[0] as ImageLayer).assetId, "asset-original");
  assert.equal(withProduct.layers[0]!.y, 100);
});

test("product image resizing preserves its source aspect ratio", () => {
  const withProduct = applyImageOperation(createImageDocument("doc-5"), {
    type: "addImage",
    layer: product,
  });
  const resized = applyImageOperation(withProduct, {
    type: "transform",
    layerId: product.id,
    patch: { width: 300 },
  });
  assert.equal(resized.layers[0]!.width, 300);
  assert.equal(resized.layers[0]!.height, 300);
  assert.throws(() =>
    applyImageOperation(withProduct, {
      type: "transform",
      layerId: product.id,
      patch: { width: 300, height: 450 },
    }),
  );
});

test("crop keeps original pixels referenced and survives undo and redo", () => {
  const original = applyImageOperation(createImageDocument("crop-doc"), {
    type: "addImage",
    layer: product,
  });
  let history = createImageHistory(original);
  history = commitImageOperation(history, {
    type: "setCrop",
    layerId: product.id,
    crop: { x: 150, y: 150, width: 300, height: 300 },
  });
  const cropped = history.present.layers[0] as ImageLayer;
  assert.equal(cropped.assetId, "asset-original");
  assert.equal(cropped.sourceWidth, 600);
  assert.deepEqual(cropped.crop, { x: 150, y: 150, width: 300, height: 300 });
  assert.equal(cropped.width, 300);
  assert.equal(cropped.x, 250);
  assert.equal((original.layers[0] as ImageLayer).crop, undefined);
  history = undoImageOperation(history);
  assert.equal((history.present.layers[0] as ImageLayer).crop, undefined);
  history = redoImageOperation(history);
  assert.deepEqual(
    (history.present.layers[0] as ImageLayer).crop,
    cropped.crop,
  );
});

test("crop bounds and subsequent transforms preserve the visible ratio", () => {
  const original = applyImageOperation(createImageDocument("crop-bounds"), {
    type: "addImage",
    layer: product,
  });
  for (const crop of [
    { x: -1, y: 0, width: 300, height: 600 },
    { x: 500, y: 0, width: 200, height: 600 },
    { x: 0.5, y: 0, width: 300, height: 600 },
  ]) {
    assert.throws(() =>
      applyImageOperation(original, {
        type: "setCrop",
        layerId: product.id,
        crop,
      }),
    );
  }
  const cropped = applyImageOperation(original, {
    type: "setCrop",
    layerId: product.id,
    crop: { x: 0, y: 0, width: 300, height: 600 },
  });
  const resized = applyImageOperation(cropped, {
    type: "transform",
    layerId: product.id,
    patch: { width: 150 },
  });
  assert.equal((resized.layers[0] as ImageLayer).height, 300);
});

test("mask strokes preserve the original and can be undone and redone", () => {
  let history = createImageHistory(createImageDocument("mask-doc"));
  history = commitImageOperation(history, { type: "addImage", layer: product });
  history = commitImageOperation(history, {
    type: "setMask",
    layerId: product.id,
    assetId: "mask-source",
  });
  history = commitImageOperation(history, {
    type: "paintMask",
    layerId: product.id,
    stroke: {
      mode: "erase",
      radius: 12,
      points: [
        { x: 100, y: 120 },
        { x: 130, y: 145 },
      ],
    },
  });
  const masked = history.present.layers[0] as ImageLayer;
  assert.equal(masked.assetId, "asset-original");
  assert.equal(masked.mask?.assetId, "mask-source");
  assert.equal(masked.mask?.strokes.length, 1);
  history = undoImageOperation(history);
  assert.equal(
    (history.present.layers[0] as ImageLayer).mask?.strokes.length,
    0,
  );
  history = redoImageOperation(history);
  assert.equal(
    (history.present.layers[0] as ImageLayer).mask?.strokes.length,
    1,
  );
  assert.throws(() =>
    applyImageOperation(history.present, {
      type: "paintMask",
      layerId: product.id,
      stroke: { mode: "restore", radius: 10, points: [{ x: -1, y: 10 }] },
    }),
  );
});

test("mask framing keeps the original and is one undoable action", () => {
  const frame = frameFromSubjectBounds(
    { width: 600, height: 600 },
    { width: 1080, height: 1080 },
    { x: 100, y: 100, width: 200, height: 400 },
  );
  assert.ok(frame);
  assert.deepEqual(frame.crop, { x: 90, y: 80, width: 220, height: 440 });
  let history = createImageHistory(createImageDocument("frame-doc"));
  history = commitImageOperation(history, { type: "addImage", layer: product });
  history = commitImageOperation(history, {
    type: "setMask",
    layerId: product.id,
    assetId: "mask-source",
    frame,
  });
  const framed = history.present.layers[0] as ImageLayer;
  assert.equal(framed.assetId, "asset-original");
  assert.equal(framed.mask?.assetId, "mask-source");
  assert.deepEqual(framed.crop, frame.crop);
  assert.equal(framed.width, frame.width);
  history = undoImageOperation(history);
  assert.equal((history.present.layers[0] as ImageLayer).mask, undefined);
  assert.equal((history.present.layers[0] as ImageLayer).crop, undefined);
  history = redoImageOperation(history);
  assert.deepEqual((history.present.layers[0] as ImageLayer).crop, frame.crop);
});

test("automatic framing rejects invalid bounds and invalid frames", () => {
  assert.equal(
    frameFromSubjectBounds(
      { width: 600, height: 600 },
      { width: 1080, height: 1080 },
      { x: 590, y: 0, width: 20, height: 100 },
    ),
    null,
  );
  const original = applyImageOperation(createImageDocument("invalid-frame"), {
    type: "addImage",
    layer: product,
  });
  assert.throws(() =>
    applyImageOperation(original, {
      type: "setMask",
      layerId: product.id,
      assetId: "mask",
      frame: {
        crop: { x: 500, y: 0, width: 200, height: 600 },
        x: 0,
        y: 0,
        width: 200,
        height: 600,
      },
    }),
  );
});
