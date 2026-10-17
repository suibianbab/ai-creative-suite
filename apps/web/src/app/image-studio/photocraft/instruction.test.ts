import assert from "node:assert/strict";
import test from "node:test";
import {
  describePhotoCraftPlan,
  parsePhotoCraftModelPlan,
  planPhotoCraftInstruction,
  planPhotoCraftSequence,
  reconcilePhotoCraftModelPlan,
  validatePhotoCraftInstructionAgainstText,
} from "./instruction";
import { plannerCapabilities, plannerSchema } from "./planner-catalog";

test("capability catalog covers the PhotoCraft model planner", () => {
  const ids = plannerCapabilities.map((item) => item.operation);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(plannerSchema.properties.operation.enum.slice(0, -1), ids);
  assert.ok(
    ids.includes("image-size") &&
      ids.includes("orient") &&
      ids.includes("levels") &&
      ids.includes("text-style") &&
      ids.includes("drop-shadow"),
  );
});

test("whole-image orientation plans preserve direction and reject mismatches", () => {
  const clockwise = {
    operation: "orient" as const,
    target: "whole-image" as const,
    protectLabel: false as const,
    mode: "rotate-cw" as const,
  };
  assert.deepEqual(
    planPhotoCraftInstruction("把整张照片顺时针旋转90度"),
    clockwise,
  );
  assert.deepEqual(planPhotoCraftInstruction("将图片水平翻转"), {
    ...clockwise,
    mode: "flip-horizontal",
  });
  assert.equal(planPhotoCraftInstruction("把图片旋转37度"), null);
  assert.equal(planPhotoCraftSequence("把整张照片顺时针旋转90度"), null);
  assert.deepEqual(
    parsePhotoCraftModelPlan({ ...clockwise, unsupported: "" }),
    clockwise,
  );
  // reconcile 输出可直接进 parse：模型省略的信封字段被补上（任务②契约）。
  assert.deepEqual(
    reconcilePhotoCraftModelPlan("把整张照片顺时针旋转90度", {
      ...clockwise,
      mode: "rotate-ccw",
    }),
    { ...clockwise, unsupported: "" },
  );
  validatePhotoCraftInstructionAgainstText(
    "把整张照片顺时针旋转90度",
    clockwise,
  );
  assert.throws(
    () => validatePhotoCraftInstructionAgainstText("将图片水平翻转", clockwise),
    /方向/,
  );
  assert.throws(
    () =>
      parsePhotoCraftModelPlan({
        ...clockwise,
        mode: "rotate-37",
        unsupported: "",
      }),
    /方向/,
  );
  assert.throws(
    () =>
      planPhotoCraftSequence("把图片水平翻转然后将图片尺寸调整为800×600像素"),
    /最后一步/,
  );
});

test("current-layer plans stay bounded to one explicit action", () => {
  const duplicate = {
    operation: "layer-action" as const,
    target: "whole-image" as const,
    protectLabel: false as const,
    action: "duplicate" as const,
  };
  assert.deepEqual(planPhotoCraftInstruction("复制当前图层"), duplicate);
  assert.deepEqual(planPhotoCraftInstruction("隐藏选中的图层"), {
    ...duplicate,
    action: "hide",
  });
  assert.equal(planPhotoCraftInstruction("删除当前图层"), null);
  assert.deepEqual(
    parsePhotoCraftModelPlan({ ...duplicate, unsupported: "" }),
    duplicate,
  );
  assert.deepEqual(
    reconcilePhotoCraftModelPlan("显示当前图层", {
      ...duplicate,
      action: "hide",
    }),
    { ...duplicate, action: "show", unsupported: "" },
  );
  validatePhotoCraftInstructionAgainstText("复制当前图层", duplicate);
  assert.throws(
    () => validatePhotoCraftInstructionAgainstText("隐藏当前图层", duplicate),
    /图层操作/,
  );
  assert.throws(
    () =>
      parsePhotoCraftModelPlan({
        ...duplicate,
        action: "delete",
        unsupported: "",
      }),
    /图层操作/,
  );
  assert.throws(
    () => planPhotoCraftSequence("复制当前图层然后隐藏当前图层"),
    /单独执行/,
  );
});

test("model plans require exact numeric and textual evidence", () => {
  const plannedText = parsePhotoCraftModelPlan({
    operation: "text",
    target: "selected-area",
    protectLabel: false,
    unsupported: "",
    text: "新品上市",
    size: 60,
    textColor: "#cc2020",
  });
  assert.deepEqual(
    parsePhotoCraftModelPlan({ ...plannedText, unsupported: "" }),
    plannedText,
  );
  assert.throws(
    () =>
      reconcilePhotoCraftModelPlan("把帽沿变成白色", {
        operation: "recolor",
        target: "brim",
        protectLabel: false,
        unsupported: "",
        color: "gray",
      }),
    /目标颜色/,
  );
  assert.doesNotThrow(() =>
    reconcilePhotoCraftModelPlan("添加文字「把帽沿变成白色」", {
      operation: "text",
      target: "selected-area",
      protectLabel: false,
      unsupported: "",
    }),
  );
  assert.deepEqual(
    reconcilePhotoCraftModelPlan("请把照片缩放至800×600像素", {
      operation: "image-size",
      target: "whole-image",
      protectLabel: false,
      unsupported: "",
      width: 800,
      height: 800,
    }),
    {
      operation: "image-size",
      target: "whole-image",
      protectLabel: false,
      unsupported: "",
      width: 800,
      height: 600,
    },
  );
  assert.deepEqual(
    reconcilePhotoCraftModelPlan("把当前文字加粗并加下划线", {
      operation: "text-style",
      target: "selected-area",
      protectLabel: false,
      unsupported: "",
      weight: 700,
      underline: true,
    }),
    {
      operation: "text-style",
      target: "whole-image",
      protectLabel: false,
      unsupported: "",
      weight: 700,
      underline: true,
    },
  );
  assert.equal(
    planPhotoCraftSequence(
      "给当前图层加阴影，距离8像素、大小10像素、不透明度55%",
    ),
    null,
  );
  assert.equal(
    planPhotoCraftSequence("调整整图色阶，黑场20、白场235、伽马1.2"),
    null,
  );
  const resized = parsePhotoCraftModelPlan({
    operation: "image-size",
    target: "whole-image",
    protectLabel: false,
    unsupported: "",
    width: 800,
    height: 600,
  });
  validatePhotoCraftInstructionAgainstText("把照片缩放至800×600像素", resized);
  assert.throws(
    () =>
      validatePhotoCraftInstructionAgainstText(
        "把照片缩放至800×500像素",
        resized,
      ),
    /宽高/,
  );

  const levels = parsePhotoCraftModelPlan({
    operation: "levels",
    target: "whole-image",
    protectLabel: false,
    unsupported: "",
    inBlack: 20,
    inWhite: 235,
    gamma: 1.2,
  });
  validatePhotoCraftInstructionAgainstText(
    "调整整图色阶，黑场20，白场235，伽马1.2",
    levels,
  );
  assert.throws(
    () =>
      validatePhotoCraftInstructionAgainstText(
        "调整整图色阶，黑场20，白场230，伽马1.2",
        levels,
      ),
    /色阶参数/,
  );

  const shadow = parsePhotoCraftModelPlan({
    operation: "drop-shadow",
    target: "whole-image",
    protectLabel: false,
    unsupported: "",
    distance: 8,
    size: 10,
    opacity: 55,
  });
  validatePhotoCraftInstructionAgainstText(
    "请给当前图层加阴影，距离8像素、大小10像素、不透明度55%",
    shadow,
  );
  // M2 默认策略表（§5）：「加一点阴影」没写参数 → 表默认（8/10/55）合法，
  // 不再向用户追问数字；滑杆随后接管。
  validatePhotoCraftInstructionAgainstText("给当前图层加一点阴影", shadow);
  // 原话没写参数时，模型自报的非默认数值不作数。
  assert.throws(
    () =>
      validatePhotoCraftInstructionAgainstText(
        "给当前图层加一点阴影",
        parsePhotoCraftModelPlan({
          operation: "drop-shadow",
          target: "whole-image",
          protectLabel: false,
          unsupported: "",
          distance: 12,
          size: 10,
          opacity: 55,
        }),
      ),
    /默认值/,
  );
  // 原话写明的值必须逐一匹配。
  assert.throws(
    () =>
      validatePhotoCraftInstructionAgainstText(
        "给当前图层加阴影，距离9像素、大小10像素、不透明度55%",
        shadow,
      ),
    /投影参数/,
  );
  assert.throws(
    () =>
      validatePhotoCraftInstructionAgainstText(
        "给当前图层加阴影，距离8像素、大小10像素、不透明度55%，再把帽子改成红色",
        shadow,
      ),
    /多个效果/,
  );

  const styled = parsePhotoCraftModelPlan({
    operation: "text-style",
    target: "whole-image",
    protectLabel: false,
    unsupported: "",
    weight: 700,
    underline: true,
  });
  validatePhotoCraftInstructionAgainstText("把当前文字加粗并加下划线", styled);
  assert.throws(
    () =>
      validatePhotoCraftInstructionAgainstText(
        "把当前文字设为常规并加下划线",
        styled,
      ),
    /文字样式/,
  );
});

test("bounded direct recolor phrases preserve the stated target and label requirement", () => {
  assert.deepEqual(
    planPhotoCraftInstruction("将当前文字设为粗体并加上下划线"),
    {
      operation: "text-style",
      target: "whole-image",
      protectLabel: false,
      weight: 700,
      underline: true,
    },
  );
  assert.deepEqual(
    planPhotoCraftInstruction(
      "给当前文字图层添加投影，距离8像素，大小10像素，不透明度55%",
    ),
    {
      operation: "drop-shadow",
      target: "whole-image",
      protectLabel: false,
      distance: 8,
      size: 10,
      opacity: 55,
    },
  );
  assert.deepEqual(planPhotoCraftInstruction("将图片尺寸调整为16×16像素"), {
    operation: "image-size",
    target: "whole-image",
    protectLabel: false,
    width: 16,
    height: 16,
  });
  assert.deepEqual(
    planPhotoCraftInstruction("将整图色阶设为黑场20、白场235、伽马1.2"),
    {
      operation: "levels",
      target: "whole-image",
      protectLabel: false,
      inBlack: 20,
      inWhite: 235,
      gamma: 1.2,
    },
  );
  assert.equal(
    planPhotoCraftInstruction("将图片尺寸调整为4096×4096像素"),
    null,
  );
  assert.equal(
    planPhotoCraftInstruction("将整图色阶设为黑场250、白场20"),
    null,
  );
  assert.deepEqual(planPhotoCraftInstruction("将画布扩展为12×10像素"), {
    operation: "canvas-size",
    target: "whole-image",
    protectLabel: false,
    width: 12,
    height: 10,
  });
  assert.equal(planPhotoCraftSequence("将画布扩展为12×10像素"), null);
  assert.deepEqual(planPhotoCraftInstruction("添加文字「新品上市」"), {
    operation: "text",
    target: "selected-area",
    protectLabel: false,
    text: "新品上市",
    size: 48,
    color: "#111111",
  });
  assert.deepEqual(
    planPhotoCraftInstruction("在图片上添加文字「SALE」字号72，红色"),
    {
      operation: "text",
      target: "selected-area",
      protectLabel: false,
      text: "SALE",
      size: 72,
      color: "#cc2020",
    },
  );
  assert.equal(
    planPhotoCraftSequence("在图片上添加文字「SALE」字号72，红色"),
    null,
  );
  const grayEar = {
    operation: "recolor" as const,
    color: "gray" as const,
    target: "selected-area" as const,
    protectLabel: false,
  };
  assert.deepEqual(
    planPhotoCraftInstruction("将画面右侧耳朵的橙色毛发改成灰色"),
    grayEar,
  );
  assert.deepEqual(planPhotoCraftInstruction("把选区改成灰色"), grayEar);
  validatePhotoCraftInstructionAgainstText(
    "将画面右侧耳朵的橙色毛发改成灰色",
    grayEar,
  );
  assert.match(describePhotoCraftPlan(grayEar), /灰色/);
  assert.deepEqual(planPhotoCraftInstruction("将帽子的颜色换成黑色"), {
    operation: "recolor",
    color: "black",
    target: "hat",
    protectLabel: false,
  });
  assert.deepEqual(planPhotoCraftInstruction("把帽沿改成红色，保留标签"), {
    operation: "recolor",
    color: "red",
    target: "brim",
    protectLabel: true,
  });
  assert.equal(planPhotoCraftInstruction("把帽子改红还要去掉标签"), null);
  assert.deepEqual(planPhotoCraftInstruction("让帽沿稍微亮一点，标签不要变"), {
    operation: "adjust",
    adjustment: "brightness",
    amount: 10,
    target: "brim",
    protectLabel: true,
  });
  assert.equal(planPhotoCraftInstruction("帽身亮度提高59"), null);
  assert.deepEqual(planPhotoCraftInstruction("整张图亮度提高25"), {
    operation: "adjust",
    adjustment: "brightness",
    amount: 25,
    target: "whole-image",
    protectLabel: false,
  });
  assert.deepEqual(planPhotoCraftInstruction("帮我把整张照片稍微提亮一些"), {
    operation: "adjust",
    adjustment: "brightness",
    amount: 10,
    target: "whole-image",
    protectLabel: false,
  });
  assert.deepEqual(planPhotoCraftInstruction("我想把帽子弄得更鲜艳一点"), {
    operation: "adjust",
    adjustment: "saturation",
    amount: 10,
    target: "hat",
    protectLabel: false,
  });
  assert.deepEqual(planPhotoCraftInstruction("把图片裁剪到选区"), {
    operation: "crop",
    target: "selected-area",
    protectLabel: false,
  });
  assert.deepEqual(planPhotoCraftInstruction("去掉这个污点"), {
    operation: "heal",
    target: "selected-area",
    protectLabel: false,
  });
  assert.deepEqual(planPhotoCraftInstruction("整张图曝光提高20"), {
    operation: "adjust",
    adjustment: "exposure",
    amount: 20,
    target: "whole-image",
    protectLabel: false,
  });
  assert.deepEqual(planPhotoCraftInstruction("整张照片自然饱和度提高15"), {
    operation: "adjust",
    adjustment: "vibrance",
    amount: 15,
    target: "whole-image",
    protectLabel: false,
  });
  assert.deepEqual(planPhotoCraftInstruction("整张照片暗部提高20"), {
    operation: "adjust",
    adjustment: "shadows",
    amount: 20,
    target: "whole-image",
    protectLabel: false,
  });
  assert.deepEqual(planPhotoCraftInstruction("帽沿高光降低15"), {
    operation: "adjust",
    adjustment: "highlights",
    amount: -15,
    target: "brim",
    protectLabel: false,
  });
  assert.equal(
    planPhotoCraftInstruction("把图片裁剪到选区，还要去掉标签"),
    null,
  );
  assert.equal(planPhotoCraftInstruction("整张图亮度提高25，保留标签"), null);
});

test("compound instructions preserve every step, label protection and crop order", () => {
  assert.deepEqual(
    planPhotoCraftSequence(
      "将当前文字设为粗体，然后给当前文字图层添加投影，距离8像素，大小10像素，不透明度55%",
    ),
    [
      {
        operation: "text-style",
        target: "whole-image",
        protectLabel: false,
        weight: 700,
      },
      {
        operation: "drop-shadow",
        target: "whole-image",
        protectLabel: false,
        distance: 8,
        size: 10,
        opacity: 55,
      },
    ],
  );
  assert.deepEqual(
    planPhotoCraftSequence(
      "整体稍微提亮，然后将整图色阶设为黑场20、白场235、伽马1.2",
    ),
    [
      {
        operation: "adjust",
        adjustment: "brightness",
        amount: 10,
        target: "whole-image",
        protectLabel: false,
      },
      {
        operation: "levels",
        target: "whole-image",
        protectLabel: false,
        inBlack: 20,
        inWhite: 235,
        gamma: 1.2,
      },
    ],
  );
  const steps = planPhotoCraftSequence(
    "把帽沿改红、保留标签、整体稍微提亮并裁成方图",
  );
  assert.deepEqual(steps, [
    { operation: "recolor", color: "red", target: "brim", protectLabel: true },
    {
      operation: "adjust",
      adjustment: "brightness",
      amount: 10,
      target: "whole-image",
      protectLabel: false,
    },
    {
      operation: "crop",
      target: "selected-area",
      protectLabel: false,
      square: true,
    },
  ]);
  assert.deepEqual(planPhotoCraftInstruction("把图片裁成方图"), {
    operation: "crop",
    target: "selected-area",
    protectLabel: false,
    square: true,
  });
  assert.deepEqual(
    parsePhotoCraftModelPlan({
      operation: "crop",
      target: "selected-area",
      protectLabel: false,
      square: true,
      unsupported: "",
    }),
    {
      operation: "crop",
      target: "selected-area",
      protectLabel: false,
      square: true,
    },
  );
  assert.throws(
    () => planPhotoCraftSequence("把帽沿改红、去掉标签、整体提亮"),
    /无法完整执行/,
  );
  assert.throws(
    () => planPhotoCraftSequence("裁成方图、把帽沿改红"),
    /裁切请放在最后/,
  );
  assert.throws(
    () => planPhotoCraftSequence("把帽沿改红、把帽身改蓝"),
    /一个局部选区/,
  );
});

test("model output can only name supported PhotoCraft effects and bounded values", () => {
  const plan = parsePhotoCraftModelPlan({
    operation: "adjust",
    target: "brim",
    adjustment: "brightness",
    amount: 10,
    protectLabel: true,
    unsupported: "",
  });
  if (plan.operation !== "adjust") throw new Error("expected adjust plan");
  assert.deepEqual(
    parsePhotoCraftModelPlan({ ...plan, unsupported: "" }),
    plan,
  );
  assert.match(describePhotoCraftPlan(plan), /须画出标签保护框/);
  assert.throws(() => parsePhotoCraftModelPlan({ ...plan, amount: 150 }));
  assert.throws(() =>
    parsePhotoCraftModelPlan({ ...plan, operation: "inpaint" }),
  );
  assert.throws(() =>
    parsePhotoCraftModelPlan({ ...plan, unsupported: "还要求去掉商标" }),
  );
  assert.throws(() =>
    parsePhotoCraftModelPlan({ ...plan, unsupported: undefined }),
  );
  assert.throws(() =>
    validatePhotoCraftInstructionAgainstText("把帽沿调亮，保留标签", {
      ...plan,
      target: "hat",
    }),
  );
  assert.throws(() =>
    validatePhotoCraftInstructionAgainstText("把帽沿调亮，保留标签", {
      ...plan,
      protectLabel: false,
    }),
  );
  assert.throws(() =>
    validatePhotoCraftInstructionAgainstText("把帽沿调亮，去掉标签", plan),
  );
  const crop = parsePhotoCraftModelPlan({
    operation: "crop",
    target: "selected-area",
    protectLabel: false,
    unsupported: "",
  });
  assert.match(describePhotoCraftPlan(crop), /裁切/);
  assert.throws(() =>
    parsePhotoCraftModelPlan({ ...crop, protectLabel: true, unsupported: "" }),
  );
  assert.throws(() =>
    parsePhotoCraftModelPlan({ ...crop, color: "red", unsupported: "" }),
  );
  assert.throws(() =>
    validatePhotoCraftInstructionAgainstText("裁剪到选区", plan),
  );
  const heal = parsePhotoCraftModelPlan({
    operation: "heal",
    target: "selected-area",
    protectLabel: false,
    unsupported: "",
  });
  assert.match(describePhotoCraftPlan(heal), /污点/);
  assert.throws(() =>
    parsePhotoCraftModelPlan({ ...heal, protectLabel: true, unsupported: "" }),
  );
  assert.throws(() =>
    validatePhotoCraftInstructionAgainstText("把帽沿改红再去掉标签", plan),
  );
  assert.throws(() =>
    validatePhotoCraftInstructionAgainstText("整张图高光降低20", {
      operation: "adjust",
      adjustment: "shadows",
      amount: -20,
      target: "whole-image",
      protectLabel: false,
    }),
  );
  assert.deepEqual(planPhotoCraftInstruction("把暗部提亮20"), {
    operation: "adjust",
    adjustment: "shadows",
    amount: 20,
    target: "whole-image",
    protectLabel: false,
  });
  assert.deepEqual(planPhotoCraftInstruction("把高光降低15"), {
    operation: "adjust",
    adjustment: "highlights",
    amount: -15,
    target: "whole-image",
    protectLabel: false,
  });
  assert.throws(() =>
    validatePhotoCraftInstructionAgainstText("把高光降低15", {
      operation: "adjust",
      adjustment: "highlights",
      amount: 15,
      target: "whole-image",
      protectLabel: false,
    }),
  );
  assert.throws(() =>
    validatePhotoCraftInstructionAgainstText("先把帽子改成红色再提高亮度", {
      operation: "recolor",
      color: "red",
      target: "hat",
      protectLabel: false,
    }),
  );
  assert.throws(() =>
    validatePhotoCraftInstructionAgainstText("先把帽子改红再提高亮度", {
      operation: "recolor",
      color: "red",
      target: "hat",
      protectLabel: false,
    }),
  );
});

test("subject and background targets resolve from the provider mask on any image", () => {
  const subjectGray = {
    operation: "recolor" as const,
    color: "gray" as const,
    target: "subject" as const,
    protectLabel: false as const,
  };
  const backgroundPlan = (amount: number) => ({
    operation: "adjust" as const,
    adjustment: "brightness" as const,
    amount,
    target: "background" as const,
    protectLabel: false as const,
  });
  assert.deepEqual(planPhotoCraftInstruction("把主体换成灰色"), subjectGray);
  assert.deepEqual(planPhotoCraftInstruction("请将商品的颜色改成红色"), {
    ...subjectGray,
    color: "red",
  });
  assert.deepEqual(planPhotoCraftInstruction("把这个产品的面料涂成蓝色"), {
    ...subjectGray,
    color: "blue",
  });
  assert.deepEqual(planPhotoCraftInstruction("把前景改成黑色"), {
    ...subjectGray,
    color: "black",
  });
  assert.deepEqual(planPhotoCraftInstruction("把背景调成绿色"), {
    ...subjectGray,
    target: "background",
    color: "green",
  });
  assert.match(describePhotoCraftPlan(subjectGray), /主体蒙版自动选区/);
  assert.match(
    describePhotoCraftPlan({ ...subjectGray, target: "background" }),
    /主体以外的区域/,
  );

  assert.deepEqual(planPhotoCraftInstruction("主体亮度降低10"), {
    operation: "adjust",
    adjustment: "brightness",
    amount: -10,
    target: "subject",
    protectLabel: false,
  });
  assert.deepEqual(planPhotoCraftInstruction("背景稍微提亮一些"), {
    operation: "adjust",
    adjustment: "brightness",
    amount: 10,
    target: "background",
    protectLabel: false,
  });
  assert.deepEqual(planPhotoCraftInstruction("背景更鲜艳一点"), {
    operation: "adjust",
    adjustment: "saturation",
    amount: 10,
    target: "background",
    protectLabel: false,
  });
  assert.deepEqual(planPhotoCraftInstruction("前景对比度提高20"), {
    operation: "adjust",
    adjustment: "contrast",
    amount: 20,
    target: "subject",
    protectLabel: false,
  });
  // 整张图片/照片 as a modifier of a subject-level head noun must not
  // silently widen the edit to whole-image.
  assert.equal(planPhotoCraftInstruction("整张图片的背景提亮一些"), null);
  assert.equal(planPhotoCraftInstruction("把照片的背景亮度提高20"), null);

  assert.deepEqual(
    parsePhotoCraftModelPlan({ ...subjectGray, unsupported: "" }),
    subjectGray,
  );
  const modelBackground = parsePhotoCraftModelPlan({
    ...backgroundPlan(-10),
    unsupported: "",
  });
  validatePhotoCraftInstructionAgainstText("背景亮度降低10", modelBackground);
  validatePhotoCraftInstructionAgainstText("把主体换成灰色", subjectGray);
  validatePhotoCraftInstructionAgainstText(
    "整张图片的背景稍微提亮一些",
    backgroundPlan(10),
  );
  assert.throws(
    () =>
      validatePhotoCraftInstructionAgainstText("把背景换成灰色", subjectGray),
    /背景目标/,
  );
  assert.throws(
    () =>
      validatePhotoCraftInstructionAgainstText("把主体换成灰色", {
        ...subjectGray,
        target: "background",
      }),
    /主体目标/,
  );
  assert.throws(
    () =>
      validatePhotoCraftInstructionAgainstText("把帽子换成灰色", subjectGray),
    /帽子目标/,
  );
  assert.throws(
    () =>
      validatePhotoCraftInstructionAgainstText("整张图片的背景提亮", {
        operation: "adjust",
        adjustment: "brightness",
        amount: 10,
        target: "whole-image",
        protectLabel: false,
      }),
    /背景目标/,
  );
  assert.throws(() =>
    parsePhotoCraftModelPlan({
      operation: "recolor",
      color: "red",
      target: "whole-image",
      protectLabel: false,
      unsupported: "",
    }),
  );

  assert.deepEqual(
    planPhotoCraftSequence("把主体改成红色，然后整张图稍微提亮"),
    [
      {
        operation: "recolor",
        color: "red",
        target: "subject",
        protectLabel: false,
      },
      {
        operation: "adjust",
        adjustment: "brightness",
        amount: 10,
        target: "whole-image",
        protectLabel: false,
      },
    ],
  );
  assert.deepEqual(
    planPhotoCraftSequence("把主体改成红色、保留标签、整张图稍微提亮"),
    [
      {
        operation: "recolor",
        color: "red",
        target: "subject",
        protectLabel: true,
      },
      {
        operation: "adjust",
        adjustment: "brightness",
        amount: 10,
        target: "whole-image",
        protectLabel: false,
      },
    ],
  );
  assert.throws(
    () => planPhotoCraftSequence("把主体改成红色，再把背景调成蓝色"),
    /一个局部选区/,
  );
});

// 任务②实测（2026-10-16，qwen-plus + json_object）：云端模型返回精确计划但
// 省略信封字段 unsupported。reconcile 对「具体能力操作」补空信封放行；
// operation=unsupported 时绝不补——缺失的拒绝理由必须原样交给 parse 报错，
// 不能被静默洗成「完全支持」。
test("reconcile fills the missing envelope only for concrete capability plans", () => {
  const repaired = reconcilePhotoCraftModelPlan("make the subject brighter", {
    operation: "adjust",
    adjustment: "brightness",
    amount: 15,
    target: "subject",
  }) as { unsupported?: unknown };
  assert.equal(repaired.unsupported, "");
  // 原话无数字 → 幅度按默认策略表归一（模型自报 15 不作数）。
  const plan = parsePhotoCraftModelPlan(repaired);
  if (plan.operation !== "adjust") throw new Error("expected adjust plan");
  assert.equal(plan.amount, 10);
  // 拒绝计划缺信封：不补默认，parse 照样报「不完整」。
  assert.throws(
    () =>
      parsePhotoCraftModelPlan(
        reconcilePhotoCraftModelPlan("把背景里的杂物去掉", {
          operation: "unsupported",
        }),
      ),
    /模型未返回完整的编辑计划/,
  );
  // 已带非空拒绝理由的输出不被洗白（parse 把理由原样抛出）。
  assert.throws(
    () =>
      parsePhotoCraftModelPlan(
        reconcilePhotoCraftModelPlan("把背景里的杂物去掉", {
          operation: "unsupported",
          unsupported: "去除杂物属于生成式编辑，当前能力不支持",
        }),
      ),
    /生成式编辑/,
  );
});
