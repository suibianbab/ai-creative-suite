// P2.5-T5 复核：在线素材源开关只认 development；其余（含未设置）一律关闭。
import assert from "node:assert/strict";
import test from "node:test";
import { isStockSourceEnabled } from "./stock-capability";

test("isStockSourceEnabled：development 开放", () => {
  assert.equal(isStockSourceEnabled("development"), true);
});

test("isStockSourceEnabled：production 关闭", () => {
  assert.equal(isStockSourceEnabled("production"), false);
});

test("isStockSourceEnabled：未设置 NODE_ENV 关闭", () => {
  assert.equal(isStockSourceEnabled(undefined), false);
});
