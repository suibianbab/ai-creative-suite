// R2（codex 第二轮复审 2026-10-16）：live-eval 覆盖统计的可单测汇总模块。
// 背景：live-eval.mjs 把各 lane 计数存进 Map，但旧汇总代码写的是
// Object.entries(lanes)——对 Map 恒返回 []，于是 coverage 文案里的分母归零，
// 而报告 lanes 明细（Object.fromEntries(lanes)）却是对的：统计口径与明细
// 脱节且无人发现。本模块把「按 Map 条目汇总」收进纯函数并内置自检：
//   1. 每条 lane 必须带 engine:/parser: 前缀（未分类 lane 不得被静默丢出
//      分母）；
//   2. 计数必须是非负整数且 pass ≤ total；
//   3. 层级合计必须等于逐 lane total 之和，且从对象形式（报告 lanes 字段
//      的形状）重算得到相同合计——防止「汇总走一条路、报告走另一条路」
//      再次分叉。
// 自检失败直接抛错：live-eval 捕获不到就非零退出，绝不带病生成报告。

export const ENGINE_LANE_PREFIX = "engine:";
export const PARSER_LANE_PREFIX = "parser:";

export function summarizeCoverage(lanes) {
  if (!(lanes instanceof Map))
    throw new Error(
      `覆盖统计自检失败：lanes 必须是 Map，收到 ${lanes === null ? "null" : typeof lanes}`,
    );
  const laneEntries = [...lanes.entries()];
  for (const [lane, { total, pass }] of laneEntries) {
    if (
      !Number.isInteger(total) ||
      !Number.isInteger(pass) ||
      total < 0 ||
      pass < 0 ||
      pass > total
    )
      throw new Error(
        `覆盖统计自检失败：lane「${lane}」计数非法（total=${total}, pass=${pass}）`,
      );
  }
  const unclassified = laneEntries.filter(
    ([lane]) =>
      !lane.startsWith(ENGINE_LANE_PREFIX) &&
      !lane.startsWith(PARSER_LANE_PREFIX),
  );
  if (unclassified.length > 0)
    throw new Error(
      `覆盖统计自检失败：出现未分类 lane「${unclassified[0][0]}」（应为 ${ENGINE_LANE_PREFIX}* / ${PARSER_LANE_PREFIX}* 前缀）`,
    );
  const sumBy = (prefix) =>
    laneEntries
      .filter(([lane]) => lane.startsWith(prefix))
      .reduce((sum, [, { total }]) => sum + total, 0);
  const summary = {
    lanes: Object.fromEntries(laneEntries),
    engineTotal: sumBy(ENGINE_LANE_PREFIX),
    parserTotal: sumBy(PARSER_LANE_PREFIX),
  };
  // 自检 3：报告 lanes 字段的对象形状重算合计必须与 Map 路径一致。
  for (const [prefix, total] of [
    [ENGINE_LANE_PREFIX, summary.engineTotal],
    [PARSER_LANE_PREFIX, summary.parserTotal],
  ]) {
    const fromObject = Object.entries(summary.lanes)
      .filter(([lane]) => lane.startsWith(prefix))
      .reduce((sum, [, { total: laneTotal }]) => sum + laneTotal, 0);
    if (fromObject !== total)
      throw new Error(
        `覆盖统计自检失败：${prefix} 合计两条路径不一致（Map 路径 ${total} ≠ 对象路径 ${fromObject}）`,
      );
  }
  return summary;
}

// 分母对账：脚本实际计数（note() 调用）的层级合计 vs 过滤后评测集应执行
// 条数。期望值由调用方从与主循环同谓词过滤的 case 清单推导——不允许硬编码
// 历史数字（145/67 只是当前 212 条集合的巧合，评测集增删后必须跟着变）。
// 返回不一致清单（空数组 = 对账通过）。
export function coverageMismatches(summary, expected) {
  const mismatches = [];
  if (summary.engineTotal !== expected.engine)
    mismatches.push(
      `engine 层计数 ${summary.engineTotal} ≠ 过滤后评测集应执行 ${expected.engine} 条`,
    );
  if (summary.parserTotal !== expected.parser)
    mismatches.push(
      `parser 层计数 ${summary.parserTotal} ≠ 过滤后评测集应执行 ${expected.parser} 条`,
    );
  return mismatches;
}
