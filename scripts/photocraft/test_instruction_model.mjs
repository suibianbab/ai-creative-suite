import assert from "node:assert/strict";

const endpoint = "http://localhost:3000/api/photocraft-instruction";
const cases = [
  {
    instruction: "请把帽沿涂成蓝色，保留标签",
    status: 200,
    provider: "rules",
    plan: {
      operation: "recolor",
      color: "blue",
      target: "brim",
      protectLabel: true,
    },
  },
  {
    instruction: "我想把帽子弄得更鲜艳一点",
    status: 200,
    provider: "rules",
    plan: {
      operation: "adjust",
      adjustment: "saturation",
      amount: 10,
      target: "hat",
      protectLabel: false,
    },
  },
  {
    instruction: "请只保留画框里的内容，把外面裁掉",
    status: 200,
    plan: {
      operation: "crop",
      target: "selected-area",
      protectLabel: false,
    },
  },
  {
    instruction: "把帽沿变成白色",
    status: 422,
  },
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
    assert.equal(data.provider, item.provider ?? "llama.cpp");
    assert.deepEqual(data.plan, item.plan);
  } else {
    assert.ok(typeof data.error === "string" && data.error.length > 0);
  }
}

console.log(
  "PASS: local PhotoCraft planner handles model and direct phrases and rejects unsupported white recolor",
);
