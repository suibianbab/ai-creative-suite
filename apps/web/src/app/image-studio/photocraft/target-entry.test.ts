// D 项（第七轮整改）单测：入口辅助纯函数。页面交互与测试共用同一判定——
// 方位/多实例词典识别、画框归一化（太小提前拦）、selected-area 计划的
// 「智能找目标/点击画框」入口条件、多候选分布信号。这些判定决定什么
// 时候不替用户猜位置（codex §D），错一个就是静默走错通路。
import assert from "node:assert/strict";
import test from "node:test";
import {
  canOfferExcludeRefine,
  classifyTargetPhrase,
  EXCLUDE_POINT_LIMIT,
  normalizeExcludePoint,
  normalizePromptBox,
  parseStatusMessage,
  shouldOfferSelectionEntry,
  topCandidatesSpread,
} from "./target-entry";

test("classifyTargetPhrase: 方位词/数量词识别（含单字词与否定例）", () => {
  assert.deepEqual(classifyTargetPhrase("左耳"), {
    directional: true,
    multiInstance: false,
  });
  assert.deepEqual(classifyTargetPhrase("右边的窗户"), {
    directional: true,
    multiInstance: false,
  });
  assert.deepEqual(classifyTargetPhrase("两扇窗"), {
    directional: false,
    multiInstance: true,
  });
  assert.deepEqual(classifyTargetPhrase("耳朵"), {
    directional: false,
    multiInstance: false,
  });
  assert.deepEqual(classifyTargetPhrase("屋顶"), {
    directional: false,
    multiInstance: false,
  });
  // 单字「上」不成词（长度 <2 不提示，避免误报）
  assert.equal(classifyTargetPhrase("上").directional, false);
});

test("normalizePromptBox: 像素框 → 归一化 [x1,y1,x2,y2]，保留 4 位小数", () => {
  assert.deepEqual(
    normalizePromptBox([100, 200, 300, 400], [1000, 1000]),
    [0.1, 0.2, 0.4, 0.6],
  );
  // 越界钳到 [0,1]
  assert.deepEqual(
    normalizePromptBox([-50, 900, 200, 200], [1000, 1000]),
    [0, 0.9, 0.15, 1],
  );
});

test("normalizePromptBox: 任一边不足画面 2% 或尺寸非法 → null（提前拦，不与服务端往返）", () => {
  assert.equal(normalizePromptBox([10, 10, 15, 15], [1000, 1000]), null);
  assert.equal(normalizePromptBox([0, 0, 300, 10], [1000, 1000]), null);
  assert.equal(normalizePromptBox([0, 0, 100, 100], [0, 1000]), null);
});

test("shouldOfferSelectionEntry: selected-area + 无任何已定范围 + 具体名词 → 开入口", () => {
  assert.equal(
    shouldOfferSelectionEntry(
      { target: "selected-area", operation: "recolor" },
      {
        hasNativeSelection: false,
        outlineLength: 0,
        hasScopeRect: false,
        pointsLength: 0,
      },
      "左耳",
    ),
    true,
  );
  assert.equal(
    shouldOfferSelectionEntry(
      { target: "selected-area", operation: "adjust" },
      {
        hasNativeSelection: false,
        outlineLength: 0,
        hasScopeRect: false,
        pointsLength: 0,
      },
      "屋顶",
    ),
    true,
  );
});

test("shouldOfferSelectionEntry: 已有任一范围/原生选区时不再打扰入口", () => {
  const base = {
    hasNativeSelection: false,
    outlineLength: 0,
    hasScopeRect: false,
    pointsLength: 0,
  } as const;
  assert.equal(
    shouldOfferSelectionEntry(
      { target: "selected-area", operation: "recolor" },
      { ...base, hasNativeSelection: true },
      "左耳",
    ),
    false,
  );
  assert.equal(
    shouldOfferSelectionEntry(
      { target: "selected-area", operation: "recolor" },
      { ...base, outlineLength: 5 },
      "左耳",
    ),
    false,
  );
  assert.equal(
    shouldOfferSelectionEntry(
      { target: "selected-area", operation: "recolor" },
      { ...base, hasScopeRect: true },
      "左耳",
    ),
    false,
  );
  assert.equal(
    shouldOfferSelectionEntry(
      { target: "selected-area", operation: "recolor" },
      { ...base, pointsLength: 2 },
      "左耳",
    ),
    false,
  );
});

test("shouldOfferSelectionEntry: 非选区目标/非换色调整操作/泛指词/无名词 → 不开", () => {
  const none = {
    hasNativeSelection: false,
    outlineLength: 0,
    hasScopeRect: false,
    pointsLength: 0,
  } as const;
  assert.equal(
    shouldOfferSelectionEntry(
      { target: "subject", operation: "recolor" },
      none,
      "主体",
    ),
    false,
  );
  assert.equal(
    shouldOfferSelectionEntry(
      { target: "selected-area", operation: "crop" },
      none,
      "选区",
    ),
    false,
  );
  assert.equal(
    shouldOfferSelectionEntry(
      { target: "selected-area", operation: "recolor" },
      none,
      "选区",
    ),
    false,
  );
  assert.equal(
    shouldOfferSelectionEntry(
      { target: "selected-area", operation: "recolor" },
      none,
      "  ",
    ),
    false,
  );
  assert.equal(
    shouldOfferSelectionEntry(
      { target: "selected-area", operation: "recolor" },
      none,
      undefined,
    ),
    false,
  );
});

test("topCandidatesSpread: 前两名不重叠（IoU<0.1）→ 多实例信号", () => {
  assert.equal(
    topCandidatesSpread([
      { bounds: [10, 10, 100, 100] },
      { bounds: [500, 500, 100, 100] },
    ]),
    true,
  );
  // 基本同位（IoU 高）→ 不是多实例证据
  assert.equal(
    topCandidatesSpread([
      { bounds: [10, 10, 100, 100] },
      { bounds: [12, 12, 100, 100] },
    ]),
    false,
  );
  assert.equal(topCandidatesSpread([{ bounds: [10, 10, 100, 100] }]), false);
  assert.equal(topCandidatesSpread([]), false);
});

// E-1 真实浏览器 c3 实测回归：目标缺口提示曾被同一次解析的兜底计划描述
// 覆盖，用户从未见过「不替你猜」引导。钉住取舍顺序。
test("parseStatusMessage: 目标缺口提示优先，不被计划描述覆盖", () => {
  const message = parseStatusMessage({
    planDescription: "画定区域改为蓝色；请检查预览中的边缘、纹理和背景。",
    targetGapPhrase: "左耳",
    protectPhrase: null,
  });
  assert.ok(message.includes("「左耳」的目标位置不替你猜"));
  assert.ok(message.includes("智能找目标：左耳"));
  assert.ok(message.includes("点击/画框限定"));
  assert.notEqual(
    message,
    "画定区域改为蓝色；请检查预览中的边缘、纹理和背景。",
  );
});

test("parseStatusMessage: 无缺口 → 原样返回计划描述", () => {
  const planDescription = "帽沿亮度提高10；请检查预览中的边缘、纹理和背景。";
  assert.equal(
    parseStatusMessage({
      planDescription,
      targetGapPhrase: null,
      protectPhrase: null,
    }),
    planDescription,
  );
});

test("parseStatusMessage: 仅保护缺口 → 兼容旧文案（计划描述 + 待圈定）", () => {
  assert.equal(
    parseStatusMessage({
      planDescription: "帽子面料改为蓝色；请检查预览中的边缘、纹理和背景。",
      targetGapPhrase: null,
      protectPhrase: "标签",
    }),
    "帽子面料改为蓝色；请检查预览中的边缘、纹理和背景。 保护范围「标签」待圈定：点下方「智能找保护框」，或用蒙版笔刷手画。",
  );
});

test("parseStatusMessage: 目标缺口 + 保护缺口 → 两条引导都在", () => {
  const message = parseStatusMessage({
    planDescription: "画定区域改为蓝色；请检查预览中的边缘、纹理和背景。",
    targetGapPhrase: "左耳",
    protectPhrase: "标签",
  });
  assert.ok(message.includes("目标「左耳」的位置不替你猜"));
  assert.ok(message.includes("保护范围「标签」待圈定"));
});

test("normalizeExcludePoint: 像素点 → 归一化 [x,y]，越界钳到边界而非拒绝", () => {
  assert.deepEqual(normalizeExcludePoint([512, 256], [1024, 512]), [0.5, 0.5]);
  // 点在候选边缘附近是常态：钳制优于让用户重试。
  assert.deepEqual(normalizeExcludePoint([-30, 9999], [1000, 1000]), [0, 1]);
  // 尺寸非法 / 坐标非有限数 → null（不产生误导性剔除点）。
  assert.equal(normalizeExcludePoint([10, 10], [0, 100]), null);
  assert.equal(normalizeExcludePoint([Number.NaN, 10], [100, 100]), null);
});

test("normalizeExcludePoint: 与服务端口径一致（4 位小数、clamp01）", () => {
  const point = normalizeExcludePoint([333, 77], [1000, 500]);
  assert.ok(point);
  assert.equal(point[0], 0.333);
  assert.equal(point[1], 0.154);
});

test("canOfferExcludeRefine: 仅画框限定后的目标环且未确认时提供", () => {
  const base = {
    mode: "target" as const,
    hasPromptBox: true,
    chosen: false,
    candidateCount: 2,
  };
  assert.equal(canOfferExcludeRefine(base), true);
  // 网格模式（无框）不提供：剔除点对未限定候选语义不成立。
  assert.equal(canOfferExcludeRefine({ ...base, hasPromptBox: false }), false);
  // protect 环 / 已确认 / 空候选不提供。
  assert.equal(
    canOfferExcludeRefine({ ...base, mode: "protect" as const }),
    false,
  );
  assert.equal(canOfferExcludeRefine({ ...base, chosen: true }), false);
  assert.equal(canOfferExcludeRefine({ ...base, candidateCount: 0 }), false);
});

test("EXCLUDE_POINT_LIMIT: 与服务端 parse_exclude_points 上限一致（4）", () => {
  assert.equal(EXCLUDE_POINT_LIMIT, 4);
});
