// VID-023 导出资产断言的反例单测：夹具是实测通过的 stock 资产形状
// （Thomas Bresson / CC BY 2.0、854×480、28600ms、无音轨、内容寻址 storeKey）。
// 逐项破坏一个字段，确认 stockAssetViolations 在对应 step 报错；尤其确认
// proxy 检查的是契约里的顶层 asset.proxy（original.proxy 不是契约字段）。
import assert from "node:assert/strict";
import test from "node:test";
import { stockAssetViolations } from "./stock-asset-assertions.mjs";

function validAsset() {
  return {
    assetId: "79fd8bd2-3ab8-47ba-bd4c-e7895446e7b0",
    createdAt: "2026-10-20T12:49:43.656Z",
    origin: {
      kind: "stock-source",
      sourceId: "wikimedia",
      sourcePageUrl:
        "https://commons.wikimedia.org/wiki/File:Clouds-seloncourt.ogv",
      license: {
        name: "CC BY 2.0",
        author: "Thomas Bresson",
        usageNote: "须署名",
      },
      retrievedAt: "2026-10-20T12:49:43.656Z",
    },
    original: {
      sha256:
        "cd65ef1336fc1bbc5569949d2a758c60585398151bb2976c0d29e0b65676c5e8",
      bytes: 869851,
      durationMs: 28600,
      width: 854,
      height: 480,
      fps: 25,
      codec: "vp9",
      hasAudio: false,
      storeKey: "cd65ef1336fc1bbc.webm",
    },
  };
}

function steps(asset) {
  return stockAssetViolations(asset).map((violation) => violation.step);
}

test("valid stock asset has no violations", () => {
  assert.deepEqual(stockAssetViolations(validAsset()), []);
});

test("absent top-level proxy is valid", () => {
  const asset = validAsset();
  assert.equal("proxy" in asset, false);
  assert.deepEqual(steps(asset), []);
});

test("top-level proxy yields a proxy violation", () => {
  const asset = validAsset();
  asset.proxy = {
    sha256: "f".repeat(64),
    bytes: 1024,
    width: 854,
    height: 480,
    note: "test proxy",
  };
  assert.deepEqual(stockAssetViolations(asset), [
    { step: "proxy", detail: "不应生成 proxy" },
  ]);
});

test("wrong author yields an author violation", () => {
  const asset = validAsset();
  asset.origin.license.author = "Someone Else";
  assert.deepEqual(stockAssetViolations(asset), [
    { step: "author", detail: "Someone Else" },
  ]);
});

test("wrong sha256 yields a sha256 violation", () => {
  const asset = validAsset();
  // 63 位（非 64 位小写 hex），但前 16 位不变，storeKey 仍成立。
  asset.original.sha256 = asset.original.sha256.slice(0, 63);
  assert.deepEqual(steps(asset), ["sha256"]);
});

test("wrong storeKey yields a storeKey violation", () => {
  const asset = validAsset();
  asset.original.storeKey = "deadbeefdeadbeef.webm";
  assert.deepEqual(stockAssetViolations(asset), [
    { step: "storeKey", detail: "deadbeefdeadbeef.webm" },
  ]);
});

test("wrong duration yields a 时长 violation", () => {
  const asset = validAsset();
  asset.original.durationMs = 28000;
  assert.deepEqual(stockAssetViolations(asset), [
    { step: "时长", detail: "28000" },
  ]);
});

test("wrong hasAudio yields a hasAudio violation", () => {
  const asset = validAsset();
  asset.original.hasAudio = true;
  assert.deepEqual(stockAssetViolations(asset), [
    { step: "hasAudio", detail: "true" },
  ]);
});
