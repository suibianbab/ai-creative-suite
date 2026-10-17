// 评测集（通用语言指令方案 M1 起，M4 扩成 ≥200 条金标准集）：每条真实
// 中文修图要求走一遍快车道，记录它应该命中哪条通道（数据模块，供评测测试与
// scripts/photocraft/live-eval.mjs 真引擎执行共用）。express = 快车道精确
// 解析；sequence = 复合步骤；sequence-reject = 约束表拒绝路径；model = 快
// 车道未命中、但兜底模型计划能通过独立校验；model-reject = 快车道未命中、
// 且任何貌似合理的模型计划都必须被法官否决；gap = 连模型也无法补全，只能
// 按 L2 缺口分拣引导用户改写。新增能力时先在此补用例，再改解析器；M4 附录
// 条目全部经 .tools/photocraft-serve-qa/eval-dump.mjs 跑真实解析器核对。
export type EvalCase =
  | { kind: "express"; instruction: string; plan: object }
  | { kind: "sequence"; instruction: string; count: number }
  // M4：复合序列的约束表拒绝路径（standalone / 顺序 / 步数 / 双局部）
  | { kind: "sequence-reject"; instruction: string; message: string }
  | { kind: "model"; instruction: string; plan: object }
  | { kind: "model-reject"; instruction: string; plan: object }
  | { kind: "gap"; instruction: string; kinds: string[] };

// 导出给 scripts/photocraft/live-eval.mjs（评测接真引擎）：同一份金标准
// 集既钉解析器行为，也驱动真引擎端到端执行。

export const cases: EvalCase[] = [
  // ── express：主体/前景/商品/产品/背景目标 ──
  {
    kind: "express",
    instruction: "把主体换成灰色",
    plan: {
      operation: "recolor",
      color: "gray",
      target: "subject",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "请将商品的颜色改成红色",
    plan: {
      operation: "recolor",
      color: "red",
      target: "subject",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把这个产品的面料涂成蓝色",
    plan: {
      operation: "recolor",
      color: "blue",
      target: "subject",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把前景改成黑色",
    plan: {
      operation: "recolor",
      color: "black",
      target: "subject",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把背景调成绿色",
    plan: {
      operation: "recolor",
      color: "green",
      target: "background",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "主体亮度降低10",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: -10,
      target: "subject",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "背景稍微提亮一些",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: 10,
      target: "background",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "背景更鲜艳一点",
    plan: {
      operation: "adjust",
      adjustment: "saturation",
      amount: 10,
      target: "background",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "前景对比度提高20",
    plan: {
      operation: "adjust",
      adjustment: "contrast",
      amount: 20,
      target: "subject",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "商品曝光降低15",
    plan: {
      operation: "adjust",
      adjustment: "exposure",
      amount: -15,
      target: "subject",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "背景暗部提高20",
    plan: {
      operation: "adjust",
      adjustment: "shadows",
      amount: 20,
      target: "background",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "产品高光降低15",
    plan: {
      operation: "adjust",
      adjustment: "highlights",
      amount: -15,
      target: "subject",
      protectLabel: false,
    },
  },
  // ── express：既有目标的回归 ──
  {
    kind: "express",
    instruction: "把帽子换成黑色",
    plan: {
      operation: "recolor",
      color: "black",
      target: "hat",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把帽沿改成红色，保留标签",
    plan: {
      operation: "recolor",
      color: "red",
      target: "brim",
      protectLabel: true,
    },
  },
  {
    kind: "express",
    instruction: "整张图亮度提高25",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: 25,
      target: "whole-image",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "帽沿高光降低15",
    plan: {
      operation: "adjust",
      adjustment: "highlights",
      amount: -15,
      target: "brim",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把选区改成灰色",
    plan: {
      operation: "recolor",
      color: "gray",
      target: "selected-area",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "让帽沿稍微亮一点，标签不要变",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: 10,
      target: "brim",
      protectLabel: true,
    },
  },
  // ── sequence：复合编辑 ──
  {
    kind: "sequence",
    instruction: "把主体改成红色，然后整张图稍微提亮",
    count: 2,
  },
  {
    kind: "sequence",
    instruction: "把背景调成蓝色，然后把整张照片稍微调暗一些",
    count: 2,
  },
  {
    kind: "sequence",
    instruction: "把主体改成红色、保留标签、整张图稍微提亮",
    count: 2,
  },
  {
    kind: "sequence",
    instruction: "整体稍微提亮，然后将整图色阶设为黑场20、白场235、伽马1.2",
    count: 2,
  },
  {
    kind: "sequence",
    instruction: "把帽沿改红、保留标签、整体稍微提亮并裁成方图",
    count: 3,
  },
  {
    kind: "sequence",
    instruction: "帽沿高光降低15，然后整张照片稍微提亮一些",
    count: 2,
  },
  {
    kind: "sequence",
    instruction: "把背景改成灰色，然后裁成方图",
    count: 2,
  },
  {
    kind: "sequence",
    instruction: "把主体换成红色再把整张图提亮一点",
    count: 2,
  },
  // ── gap：模型也无法补全，按 L2 缺口引导改写 ──
  { kind: "gap", instruction: "把杯子换成紫色", kinds: ["param", "target"] },
  { kind: "gap", instruction: "把背景换成紫色", kinds: ["param"] },
  { kind: "gap", instruction: "帮我换个颜色", kinds: ["param", "target"] },
  // M4：「亮起来」程度Suffix 进快车道默认策略（+10），从 gap 迁到 express。
  {
    kind: "express",
    instruction: "让背景亮起来",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: 10,
      target: "background",
      protectLabel: false,
    },
  },
  { kind: "gap", instruction: "背景提亮80", kinds: ["param"] },
  { kind: "gap", instruction: "把背景的饱和度提高到很高", kinds: ["param"] },
  { kind: "gap", instruction: "把这张照片弄得好看一点", kinds: ["capability"] },
  { kind: "gap", instruction: "去掉路人", kinds: ["capability"] },
  { kind: "gap", instruction: "把图片修得更有质感", kinds: ["capability"] },
  {
    kind: "gap",
    instruction: "把杯子的颜色调成深蓝色",
    kinds: ["param", "target"],
  },
  { kind: "gap", instruction: "背景换成红色主体换成蓝色", kinds: ["param"] },
  { kind: "gap", instruction: "把背景裁剪", kinds: ["param"] },
  { kind: "gap", instruction: "给背景添加文字", kinds: ["param"] },
  // 已知 v0 缺口：整张图片的背景 / 照片的背景 复合名词快车道不猜，落到句式引导
  { kind: "gap", instruction: "整张图片的背景提亮一些", kinds: ["param"] },
  { kind: "gap", instruction: "把照片的背景亮度提高20", kinds: ["param"] },
  // ── model：快车道未命中，但兜底模型计划能通过独立法官 ──
  {
    kind: "model",
    instruction: "把背景的暗部提亮20",
    plan: {
      operation: "adjust",
      adjustment: "shadows",
      amount: 20,
      target: "background",
      protectLabel: false,
    },
  },
  {
    kind: "model",
    instruction: "整张图片的背景稍微提亮一些",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: 10,
      target: "background",
      protectLabel: false,
    },
  },
  {
    kind: "model",
    instruction: "把照片的背景亮度提高20",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: 20,
      target: "background",
      protectLabel: false,
    },
  },
  {
    kind: "model",
    instruction: "希望主体变成灰色",
    plan: {
      operation: "recolor",
      color: "gray",
      target: "subject",
      protectLabel: false,
    },
  },
  // ── model-reject：貌似合理的模型计划必须被法官否决 ──
  {
    kind: "model-reject",
    instruction: "把背景变成白色",
    plan: {
      operation: "recolor",
      color: "white",
      target: "background",
      protectLabel: false,
    },
  },
  {
    kind: "model-reject",
    instruction: "整张图片换成灰色",
    plan: {
      operation: "recolor",
      color: "gray",
      target: "whole-image",
      protectLabel: false,
    },
  },
  {
    kind: "model-reject",
    instruction: "把帽子去掉",
    plan: {
      operation: "recolor",
      color: "red",
      target: "hat",
      protectLabel: false,
    },
  },
  {
    kind: "model-reject",
    instruction: "把背景亮度提高80",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: 80,
      target: "background",
      protectLabel: false,
    },
  },
  {
    kind: "model-reject",
    instruction: "背景对比度提高200",
    plan: {
      operation: "adjust",
      adjustment: "contrast",
      amount: 200,
      target: "background",
      protectLabel: false,
    },
  },
  {
    kind: "model-reject",
    instruction: "把整张图的主体亮度提高20",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: 20,
      target: "whole-image",
      protectLabel: false,
    },
  },
  {
    kind: "model-reject",
    instruction: "帮背景加上文字",
    plan: {
      operation: "text",
      target: "selected-area",
      protectLabel: false,
      text: "你好",
      size: 48,
      color: "#111111",
    },
  },
  {
    kind: "model-reject",
    instruction: "把背景旋转90度",
    plan: {
      operation: "orient",
      target: "whole-image",
      protectLabel: false,
      mode: "rotate-cw",
    },
  },
  // ── M2 默认策略表：裸动词/缺参数不再追问，直接按表补默认 ──
  {
    kind: "express",
    instruction: "把主体提亮",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: 10,
      target: "subject",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "背景调暗",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: -10,
      target: "background",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "整张照片明显调暗",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: -25,
      target: "whole-image",
      protectLabel: false,
    },
  },
  {
    kind: "model",
    instruction: "给当前图层加一点阴影",
    plan: {
      operation: "drop-shadow",
      target: "whole-image",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "旋转一下",
    plan: {
      operation: "orient",
      target: "whole-image",
      protectLabel: false,
      mode: "rotate-cw",
    },
  },
  {
    kind: "model-reject",
    instruction: "给当前图层加一点阴影",
    plan: {
      operation: "drop-shadow",
      target: "whole-image",
      protectLabel: false,
      distance: 12,
      size: 10,
      opacity: 55,
    },
  },

  // ── M4 金标准集扩容（通用语言指令方案 §7）：以下条目全部经
  // .tools/photocraft-serve-qa/eval-dump.mjs 跑真实解析器逐条核对后钉死，
  // 覆盖 paraphrase / 口语 / 英文 / 模糊 / 越界 / 多步 / 保护清单 / 非商品域。──
  // ── M4 express：换色动词×目标×颜色 paraphrase ──
  {
    kind: "express",
    instruction: "把帽子涂成黑色",
    plan: {
      operation: "recolor",
      color: "black",
      target: "hat",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把帽子改为绿色",
    plan: {
      operation: "recolor",
      color: "green",
      target: "hat",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "将帽子调整为灰色",
    plan: {
      operation: "recolor",
      color: "gray",
      target: "hat",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把帽子变成蓝色",
    plan: {
      operation: "recolor",
      color: "blue",
      target: "hat",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "请把帽沿换成红色",
    plan: {
      operation: "recolor",
      color: "red",
      target: "brim",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "帮我将帽沿改成蓝色",
    plan: {
      operation: "recolor",
      color: "blue",
      target: "brim",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把主体涂成红色",
    plan: {
      operation: "recolor",
      color: "red",
      target: "subject",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "将前景改为黑色",
    plan: {
      operation: "recolor",
      color: "black",
      target: "subject",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把商品变成绿色",
    plan: {
      operation: "recolor",
      color: "green",
      target: "subject",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把产品改成灰色",
    plan: {
      operation: "recolor",
      color: "gray",
      target: "subject",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把背景换成蓝色",
    plan: {
      operation: "recolor",
      color: "blue",
      target: "background",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把选区涂成黑色",
    plan: {
      operation: "recolor",
      color: "black",
      target: "selected-area",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把区域改成红色",
    plan: {
      operation: "recolor",
      color: "red",
      target: "selected-area",
      protectLabel: false,
    },
  },
  // ── M4 express：调色槽位×方向×幅度 ──
  {
    kind: "express",
    instruction: "把帽子亮度提高20",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: 20,
      target: "hat",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "将帽沿对比度降低15",
    plan: {
      operation: "adjust",
      adjustment: "contrast",
      amount: -15,
      target: "brim",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把主体饱和度增加10",
    plan: {
      operation: "adjust",
      adjustment: "saturation",
      amount: 10,
      target: "subject",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把背景曝光减少5",
    plan: {
      operation: "adjust",
      adjustment: "exposure",
      amount: -5,
      target: "background",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把选区自然饱和度提高30",
    plan: {
      operation: "adjust",
      adjustment: "vibrance",
      amount: 30,
      target: "selected-area",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把图片暗部提高12",
    plan: {
      operation: "adjust",
      adjustment: "shadows",
      amount: 12,
      target: "whole-image",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把照片高光降低18",
    plan: {
      operation: "adjust",
      adjustment: "highlights",
      amount: -18,
      target: "whole-image",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把画面亮度降低50",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: -50,
      target: "whole-image",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把整体对比度提高1",
    plan: {
      operation: "adjust",
      adjustment: "contrast",
      amount: 1,
      target: "whole-image",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "整张图饱和度增加45",
    plan: {
      operation: "adjust",
      adjustment: "saturation",
      amount: 45,
      target: "whole-image",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "帽沿亮度提高5",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: 5,
      target: "brim",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "主体曝光提高20",
    plan: {
      operation: "adjust",
      adjustment: "exposure",
      amount: 20,
      target: "subject",
      protectLabel: false,
    },
  },
  // ── M4 express：程度词默认（§5 默认策略表，绝不追问数字） ──
  {
    kind: "express",
    instruction: "把帽子稍微提亮",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: 10,
      target: "hat",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把帽子明显调暗",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: -25,
      target: "hat",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把选区亮一些",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: 10,
      target: "selected-area",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把主体暗一点",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: -10,
      target: "subject",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "帽沿变亮一点",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: 10,
      target: "brim",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "背景调暗一些",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: -10,
      target: "background",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把选区弄得更鲜艳",
    plan: {
      operation: "adjust",
      adjustment: "saturation",
      amount: 10,
      target: "selected-area",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把主体变得更鲜艳一些",
    plan: {
      operation: "adjust",
      adjustment: "saturation",
      amount: 10,
      target: "subject",
      protectLabel: false,
    },
  },
  // ── M4 express：整图措辞（整张/整幅/全图/整个画面 + 起来/下去） ──
  {
    kind: "express",
    instruction: "把整张图片提亮一点",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: 10,
      target: "whole-image",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "整幅画面调暗一点",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: -10,
      target: "whole-image",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "全图亮起来",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: 10,
      target: "whole-image",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把整个画面弄得更鲜艳",
    plan: {
      operation: "adjust",
      adjustment: "saturation",
      amount: 10,
      target: "whole-image",
      protectLabel: false,
    },
  },
  // ── M4 express：裁切 ──
  {
    kind: "express",
    instruction: "裁成方图",
    plan: {
      operation: "crop",
      target: "selected-area",
      protectLabel: false,
      square: true,
    },
  },
  {
    kind: "express",
    instruction: "把图片裁剪为正方形",
    plan: {
      operation: "crop",
      target: "selected-area",
      protectLabel: false,
      square: true,
    },
  },
  {
    kind: "express",
    instruction: "裁剪到选区",
    plan: { operation: "crop", target: "selected-area", protectLabel: false },
  },
  {
    kind: "express",
    instruction: "把照片裁剪到画框",
    plan: { operation: "crop", target: "selected-area", protectLabel: false },
  },
  // ── M4 express：方向（裸方向词省略主语） ──
  {
    kind: "express",
    instruction: "顺时针旋转",
    plan: {
      operation: "orient",
      target: "whole-image",
      protectLabel: false,
      mode: "rotate-cw",
    },
  },
  {
    kind: "express",
    instruction: "逆时针旋转90度",
    plan: {
      operation: "orient",
      target: "whole-image",
      protectLabel: false,
      mode: "rotate-ccw",
    },
  },
  {
    kind: "express",
    instruction: "旋转180度",
    plan: {
      operation: "orient",
      target: "whole-image",
      protectLabel: false,
      mode: "rotate-180",
    },
  },
  {
    kind: "express",
    instruction: "水平翻转",
    plan: {
      operation: "orient",
      target: "whole-image",
      protectLabel: false,
      mode: "flip-horizontal",
    },
  },
  {
    kind: "express",
    instruction: "垂直翻转",
    plan: {
      operation: "orient",
      target: "whole-image",
      protectLabel: false,
      mode: "flip-vertical",
    },
  },
  {
    kind: "express",
    instruction: "把图片顺时针旋转一下",
    plan: {
      operation: "orient",
      target: "whole-image",
      protectLabel: false,
      mode: "rotate-cw",
    },
  },
  // ── M4 express：文字（引号 + 无引号短内容） ──
  {
    kind: "express",
    instruction: "加上文字HELLO",
    plan: {
      operation: "text",
      target: "selected-area",
      protectLabel: false,
      text: "HELLO",
      size: 48,
      color: "#111111",
    },
  },
  {
    kind: "express",
    instruction: "写上文字“促销”",
    plan: {
      operation: "text",
      target: "selected-area",
      protectLabel: false,
      text: "促销",
      size: 48,
      color: "#111111",
    },
  },
  {
    kind: "express",
    instruction: "添加文字SALE",
    plan: {
      operation: "text",
      target: "selected-area",
      protectLabel: false,
      text: "SALE",
      size: 48,
      color: "#111111",
    },
  },
  // ── M4 express：尺寸 / 色阶（重采样 / 无主语色阶） ──
  {
    kind: "express",
    instruction: "把画布尺寸调整为1200x800",
    plan: {
      operation: "canvas-size",
      target: "whole-image",
      protectLabel: false,
      width: 1200,
      height: 800,
    },
  },
  {
    kind: "express",
    instruction: "把图片大小重采样为800x600",
    plan: {
      operation: "image-size",
      target: "whole-image",
      protectLabel: false,
      width: 800,
      height: 600,
    },
  },
  {
    kind: "express",
    instruction: "把色阶调整为黑场20白场235伽马1.2",
    plan: {
      operation: "levels",
      target: "whole-image",
      protectLabel: false,
      inBlack: 20,
      inWhite: 235,
      gamma: 1.2,
    },
  },
  // ── M4 express：图层操作 ──
  {
    kind: "express",
    instruction: "复制当前图层",
    plan: {
      operation: "layer-action",
      target: "whole-image",
      protectLabel: false,
      action: "duplicate",
    },
  },
  {
    kind: "express",
    instruction: "隐藏当前图层",
    plan: {
      operation: "layer-action",
      target: "whole-image",
      protectLabel: false,
      action: "hide",
    },
  },
  {
    kind: "express",
    instruction: "显示当前图层",
    plan: {
      operation: "layer-action",
      target: "whole-image",
      protectLabel: false,
      action: "show",
    },
  },
  // ── M4 express：文字样式（动词式）/ 投影 ──
  {
    kind: "express",
    instruction: "把当前文字图层加粗",
    plan: {
      operation: "text-style",
      target: "whole-image",
      protectLabel: false,
      weight: 700,
    },
  },
  {
    kind: "express",
    instruction: "给当前文字图层加下划线",
    plan: {
      operation: "text-style",
      target: "whole-image",
      protectLabel: false,
      underline: true,
    },
  },
  {
    kind: "express",
    instruction: "给当前图层添加投影距离6像素大小8像素不透明度60%",
    plan: {
      operation: "drop-shadow",
      target: "whole-image",
      protectLabel: false,
      distance: 6,
      size: 8,
      opacity: 60,
    },
  },
  // ── M4 express：污点修复 ──
  {
    kind: "express",
    instruction: "把这个污点去掉",
    plan: { operation: "heal", target: "selected-area", protectLabel: false },
  },
  {
    kind: "express",
    instruction: "去除瑕疵",
    plan: { operation: "heal", target: "selected-area", protectLabel: false },
  },
  {
    kind: "express",
    instruction: "修复痘印",
    plan: { operation: "heal", target: "selected-area", protectLabel: false },
  },
  // ── M4 express：保护清单（短语式 / 标签式 / 动词变体 / 无逗号并保留） ──
  {
    kind: "express",
    instruction: "把主体换成红色，保护天空",
    plan: {
      operation: "recolor",
      color: "red",
      target: "subject",
      protectLabel: true,
      protectPhrase: "天空",
    },
  },
  {
    kind: "express",
    instruction: "把帽子换成蓝色，天空不要动",
    plan: {
      operation: "recolor",
      color: "blue",
      target: "hat",
      protectLabel: true,
      protectPhrase: "天空",
    },
  },
  {
    kind: "express",
    instruction: "把选区提亮一点，保护水面",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: 10,
      target: "selected-area",
      protectLabel: true,
      protectPhrase: "水面",
    },
  },
  {
    kind: "express",
    instruction: "把主体换成红色并保留标签",
    plan: {
      operation: "recolor",
      color: "red",
      target: "subject",
      protectLabel: true,
    },
  },
  {
    kind: "express",
    instruction: "把帽沿改成绿色，保留商标",
    plan: {
      operation: "recolor",
      color: "green",
      target: "brim",
      protectLabel: true,
    },
  },
  {
    kind: "express",
    instruction: "把选区换成灰色，背景不要变",
    plan: {
      operation: "recolor",
      color: "gray",
      target: "selected-area",
      protectLabel: true,
      protectPhrase: "背景",
    },
  },
  {
    kind: "express",
    instruction: "把帽子换成红色，保护标签",
    plan: {
      operation: "recolor",
      color: "red",
      target: "hat",
      protectLabel: true,
    },
  },
  {
    kind: "express",
    instruction: "把背景调成绿色，别动商标",
    plan: {
      operation: "recolor",
      color: "green",
      target: "background",
      protectLabel: true,
    },
  },
  {
    kind: "express",
    instruction: "把帽子换成黑色，保留Logo",
    plan: {
      operation: "recolor",
      color: "black",
      target: "hat",
      protectLabel: true,
    },
  },
  {
    kind: "express",
    instruction: "把主体提亮一点，保护草地",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: 10,
      target: "subject",
      protectLabel: true,
      protectPhrase: "草地",
    },
  },
  {
    kind: "express",
    instruction: "把选区换成蓝色，云朵不要动",
    plan: {
      operation: "recolor",
      color: "blue",
      target: "selected-area",
      protectLabel: true,
      protectPhrase: "云朵",
    },
  },
  {
    kind: "express",
    instruction: "把帽沿改成红色，花瓣保持不变",
    plan: {
      operation: "recolor",
      color: "red",
      target: "brim",
      protectLabel: true,
      protectPhrase: "花瓣",
    },
  },
  {
    kind: "express",
    instruction: "把商品涂成黑色，人物不要变",
    plan: {
      operation: "recolor",
      color: "black",
      target: "subject",
      protectLabel: true,
      protectPhrase: "人物",
    },
  },
  {
    kind: "express",
    instruction: "希望整张图更鲜艳一点",
    plan: {
      operation: "adjust",
      adjustment: "saturation",
      amount: 10,
      target: "whole-image",
      protectLabel: false,
    },
  },
  // ── M4 express：换色矩阵补格（无把字句 / 耳朵类 / 帮我 / 调成） ──
  {
    kind: "express",
    instruction: "帽身换成黑色",
    plan: {
      operation: "recolor",
      color: "black",
      target: "hat",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "主体换成蓝色",
    plan: {
      operation: "recolor",
      color: "blue",
      target: "subject",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把左耳涂成灰色",
    plan: {
      operation: "recolor",
      color: "gray",
      target: "selected-area",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把右耳改成黑色",
    plan: {
      operation: "recolor",
      color: "black",
      target: "selected-area",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "请帮我把商品变成红色",
    plan: {
      operation: "recolor",
      color: "red",
      target: "subject",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把帽子调成绿色",
    plan: {
      operation: "recolor",
      color: "green",
      target: "hat",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "将选区变成灰色",
    plan: {
      operation: "recolor",
      color: "gray",
      target: "selected-area",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把耳朵改成绿色",
    plan: {
      operation: "recolor",
      color: "green",
      target: "selected-area",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把产品涂成红色",
    plan: {
      operation: "recolor",
      color: "red",
      target: "subject",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "把帽子换成红色，不要动白云",
    plan: {
      operation: "recolor",
      color: "red",
      target: "hat",
      protectLabel: true,
      protectPhrase: "白云",
    },
  },
  {
    kind: "express",
    instruction: "把选区调成蓝色，并保护人物",
    plan: {
      operation: "recolor",
      color: "blue",
      target: "selected-area",
      protectLabel: true,
      protectPhrase: "人物",
    },
  },
  // ── M4 express：调色矩阵补格 ──
  {
    kind: "express",
    instruction: "选区对比度提高35",
    plan: {
      operation: "adjust",
      adjustment: "contrast",
      amount: 35,
      target: "selected-area",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "整幅图片亮度降低25",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: -25,
      target: "whole-image",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "商品饱和度减少20",
    plan: {
      operation: "adjust",
      adjustment: "saturation",
      amount: -20,
      target: "subject",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "背景自然饱和度提高15",
    plan: {
      operation: "adjust",
      adjustment: "vibrance",
      amount: 15,
      target: "background",
      protectLabel: false,
    },
  },
  {
    kind: "express",
    instruction: "全图高光降低40",
    plan: {
      operation: "adjust",
      adjustment: "highlights",
      amount: -40,
      target: "whole-image",
      protectLabel: false,
    },
  },
  // ── M4 sequence：合法复合（局部+整图 / 单步+保护 / 三步链） ──
  { kind: "sequence", instruction: "把帽子换成红色，然后裁成正方形", count: 2 },
  { kind: "sequence", instruction: "把主体提亮一点，接着裁剪到选区", count: 2 },
  {
    kind: "sequence",
    instruction: "把帽沿改成蓝色，再把整体调暗一点",
    count: 2,
  },
  { kind: "sequence", instruction: "把帽子亮度提高20，然后旋转", count: 2 },
  { kind: "sequence", instruction: "把选区换成蓝色，然后保护天空", count: 1 },
  { kind: "sequence", instruction: "把主体提亮一点，随后保护天空", count: 1 },
  {
    kind: "sequence",
    instruction: "把帽子换成红色，然后整张图对比度提高10",
    count: 2,
  },
  {
    kind: "sequence",
    instruction: "把帽子换成红色，保留标签，整张图提亮一点，然后裁成方图",
    count: 3,
  },
  {
    kind: "sequence",
    instruction: "把主体改成蓝色，接着整张图稍微调暗一些，然后裁剪到选区",
    count: 3,
  },
  // ── M4 sequence-reject：约束表拒绝路径（standalone / 顺序 / 步数 / 双局部） ──
  {
    kind: "sequence-reject",
    instruction: "复制当前图层，然后隐藏当前图层",
    message: "图层复制或显隐请单独执行并检查当前图层",
  },
  {
    kind: "sequence-reject",
    instruction: "把帽子换成红色，然后裁成正方形，并保留标签",
    message: "标签保护要求必须紧跟局部编辑步骤",
  },
  {
    kind: "sequence-reject",
    instruction: "把主体提亮一点，然后把背景调成蓝色",
    message: "一次复合编辑只能包含一个局部选区步骤；其他局部编辑请另起一轮",
  },
  {
    kind: "sequence-reject",
    instruction: "旋转90度，然后裁成正方形",
    message: "画布、图片尺寸或方向变更请放在最后一步",
  },
  {
    kind: "sequence-reject",
    instruction: "把选区换成红色，然后修复污点",
    message: "当前操作请单独执行并检查结果",
  },
  {
    kind: "sequence-reject",
    instruction: "写上文字“你好”，然后裁成正方形",
    message: "当前操作请单独执行并检查结果",
  },
  {
    kind: "sequence-reject",
    instruction:
      "把帽子换成红色，整张图提亮一点，整张图对比度提高5，整张图饱和度提高5，然后裁成方图",
    message: "一次请指定 2 至 4 个明确编辑步骤",
  },
  // ── M4 gap：非商品域目标 → 智能找目标环；越界/超出色板 → 滑杆/换色引导 ──
  { kind: "gap", instruction: "把屋顶提亮一点", kinds: ["target"] },
  { kind: "gap", instruction: "把屋顶换成蓝色", kinds: ["target"] },
  { kind: "gap", instruction: "将花瓣调成红色", kinds: ["target"] },
  { kind: "gap", instruction: "把沙发提亮", kinds: ["param", "target"] },
  { kind: "gap", instruction: "把桌椅换成绿色", kinds: ["target"] },
  { kind: "gap", instruction: "把房子的门改成红色", kinds: ["target"] },
  { kind: "gap", instruction: "帮我把天空换成灰色", kinds: ["target"] },
  { kind: "gap", instruction: "把树枝弄得更鲜艳", kinds: ["target"] },
  { kind: "gap", instruction: "把窗户提亮一点", kinds: ["target"] },
  { kind: "gap", instruction: "把地毯换成红色", kinds: ["target"] },
  { kind: "gap", instruction: "把山调成蓝色", kinds: ["target"] },
  { kind: "gap", instruction: "把云朵弄得更鲜艳", kinds: ["target"] },
  { kind: "gap", instruction: "把主体提亮80", kinds: ["param"] },
  { kind: "gap", instruction: "把帽子提亮100", kinds: ["param"] },
  { kind: "gap", instruction: "整张图对比度降低99", kinds: ["param"] },
  { kind: "gap", instruction: "把帽子换成橙色", kinds: ["param"] },
  { kind: "gap", instruction: "把主体改成青色", kinds: ["param"] },
  { kind: "gap", instruction: "把主体换成白色", kinds: ["param"] },
  { kind: "gap", instruction: "把背景改成紫色", kinds: ["param"] },
  { kind: "gap", instruction: "去掉屋顶", kinds: ["capability"] },
  { kind: "gap", instruction: "擦除背景里的路人", kinds: ["capability"] },
  { kind: "gap", instruction: "把主体抠图出来", kinds: ["capability"] },
  { kind: "gap", instruction: "重绘背景", kinds: ["capability"] },
  { kind: "gap", instruction: "生成一张新背景", kinds: ["capability"] },
  { kind: "gap", instruction: "把帽子换材质", kinds: ["capability"] },
  { kind: "gap", instruction: "把整张图弄得好看起来", kinds: ["capability"] },
  { kind: "gap", instruction: "给画面增加高级感", kinds: ["capability"] },
  { kind: "gap", instruction: "make it look better", kinds: ["capability"] },
  { kind: "gap", instruction: "add a subtle warm tone", kinds: ["capability"] },
  { kind: "gap", instruction: "颜色调好看一点", kinds: ["capability"] },
  { kind: "gap", instruction: "你好", kinds: ["capability"] },
  { kind: "gap", instruction: "随便处理一下", kinds: ["capability"] },
  {
    kind: "gap",
    instruction: "把帽子提亮一点然后裁成正方形再旋转",
    kinds: ["ambiguity"],
  },
  {
    kind: "gap",
    instruction: "把选区换成红色，再提亮一点，然后裁成方图",
    kinds: ["ambiguity"],
  },
  { kind: "gap", instruction: "把主体换成红色 make it blue", kinds: ["param"] },
  { kind: "gap", instruction: "把帽子提亮一点，再暗一点", kinds: ["param"] },
  // ── M4 model：口语 paraphrase / 英文 / 半档 / 复合名词 / 保护清单走模型兜底 ──
  {
    kind: "model",
    instruction: "稍微增加一点图片的对比度",
    plan: {
      operation: "adjust",
      adjustment: "contrast",
      amount: 10,
      target: "whole-image",
      protectLabel: false,
    },
  },
  {
    kind: "model",
    instruction: "降低整张图的曝光半档",
    plan: {
      operation: "adjust",
      adjustment: "exposure",
      amount: -10,
      target: "whole-image",
      protectLabel: false,
    },
  },
  {
    kind: "model",
    instruction: "brighten the whole image a bit",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: 10,
      target: "whole-image",
      protectLabel: false,
    },
  },
  {
    kind: "model",
    instruction: "make the subject brighter",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: 10,
      target: "subject",
      protectLabel: false,
    },
  },
  {
    kind: "model",
    instruction: "能不能把背景稍微提亮一点",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: 10,
      target: "background",
      protectLabel: false,
    },
  },
  {
    kind: "model",
    instruction: "希望把主体换成红色，保护天空",
    plan: {
      operation: "recolor",
      color: "red",
      target: "subject",
      protectLabel: true,
    },
  },
  {
    kind: "model",
    instruction: "把商品照片变为黑白色调",
    plan: {
      operation: "recolor",
      color: "black",
      target: "subject",
      protectLabel: false,
    },
  },
  {
    kind: "model",
    instruction: "把整张图的主体提亮一点，保护天空",
    plan: {
      operation: "adjust",
      adjustment: "brightness",
      amount: 10,
      target: "subject",
      protectLabel: false,
    },
  },
  // ── M4 model-reject：方向不明的貌似合理计划必须被法官否决 ──
  {
    kind: "model-reject",
    instruction: "把图片顺时针转个方向",
    plan: {
      operation: "orient",
      mode: "rotate-cw",
      target: "whole-image",
      protectLabel: false,
    },
  },
];
