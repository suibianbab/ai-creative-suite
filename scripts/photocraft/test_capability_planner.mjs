import assert from "node:assert/strict";

const endpoint = "http://127.0.0.1:3000/api/photocraft-instruction";
const cases = [
  {
    instruction: "给帽沿上蓝色，Logo保持不变",
    status: 200,
    plan: {
      operation: "recolor",
      color: "blue",
      target: "brim",
      protectLabel: true,
    },
  },
  {
    instruction: "请在图上写「新品上市」，用红色，字号60",
    status: 200,
    plan: {
      operation: "text",
      target: "selected-area",
      protectLabel: false,
      text: "新品上市",
      size: 60,
      color: "#cc2020",
    },
  },
  {
    instruction: "请把照片缩放至800×600像素",
    status: 200,
    plan: {
      operation: "image-size",
      target: "whole-image",
      protectLabel: false,
      width: 800,
      height: 600,
    },
  },
  {
    instruction: "将图像尺寸变更为800×600像素",
    status: 200,
    plan: {
      operation: "image-size",
      target: "whole-image",
      protectLabel: false,
      width: 800,
      height: 600,
    },
  },
  {
    instruction: "调整整图色阶，黑场20、白场235、伽马1.2",
    status: 200,
    plan: {
      operation: "levels",
      target: "whole-image",
      protectLabel: false,
      inBlack: 20,
      inWhite: 235,
      gamma: 1.2,
    },
  },
  {
    instruction: "给当前图层加阴影，距离8像素、大小10像素、不透明度55%",
    status: 200,
    plan: {
      operation: "drop-shadow",
      target: "whole-image",
      protectLabel: false,
      distance: 8,
      size: 10,
      opacity: 55,
    },
  },
  {
    instruction: "把当前文字加粗并加下划线",
    status: 200,
    plan: {
      operation: "text-style",
      target: "whole-image",
      protectLabel: false,
      weight: 700,
      underline: true,
    },
  },
  { instruction: "给当前图层加一点阴影", status: 422 },
  { instruction: "把帽沿变成白色", status: 422 },
  { instruction: "将图片尺寸改成800×600像素并加投影", status: 422 },
  { instruction: "将当前文字加粗后删除标签", status: 422 },
];

for (const item of cases) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ instruction: item.instruction }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await response.json();
  assert.equal(
    response.status,
    item.status,
    `${item.instruction}: ${JSON.stringify(data)}`,
  );
  if (item.plan) {
    assert.equal(data.provider, "llama.cpp");
    assert.deepEqual(data.plan, item.plan);
  } else assert.ok(typeof data.error === "string" && data.error.length > 0);
}
console.log("PASS: capability-aware PhotoCraft planner and rejection gates");
