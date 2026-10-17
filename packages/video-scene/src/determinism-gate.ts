// ADR 0003 §2.3 确定性契约的静态门禁：可信渲染组件（src/components）禁止
// 墙钟、未播种随机、网络与存储。这是源码级巡检（determinism-gate.test.ts
// 执行），不是运行时沙箱——运行时逐帧超时/隔离按 P2-A 决定延期到渲染 CLI
// 的 worker 隔离，见 docs/VIDEO_STUDIO_P0_CODE_REVIEW 整改记录。
export const FORBIDDEN_SOURCE_PATTERNS: Array<{
  label: string;
  pattern: RegExp;
}> = [
  { label: "墙钟 Date.now", pattern: /\bDate\.now\b/ },
  { label: "墙钟 new Date", pattern: /\bnew\s+Date\b/ },
  { label: "墙钟 performance.now", pattern: /\bperformance\.now\b/ },
  { label: "未播种随机 Math.random", pattern: /\bMath\.random\b/ },
  {
    label: "未播种随机 crypto.getRandomValues",
    pattern: /\bcrypto\.getRandomValues\b/,
  },
  { label: "网络 fetch", pattern: /\bfetch\s*\(/ },
  { label: "网络 XMLHttpRequest", pattern: /\bXMLHttpRequest\b/ },
  { label: "网络 WebSocket", pattern: /\bWebSocket\b/ },
  { label: "网络 EventSource", pattern: /\bEventSource\b/ },
  { label: "网络 sendBeacon", pattern: /\bsendBeacon\b/ },
  { label: "存储 localStorage", pattern: /\blocalStorage\b/ },
  { label: "存储 sessionStorage", pattern: /\bsessionStorage\b/ },
  { label: "存储 indexedDB", pattern: /\bindexedDB\b/ },
];

// 返回命中的违禁标签列表；空数组 = 通过。只做词法匹配，不带数据流分析：
// 误报（如注释）由测试用例约束；漏报风险接受——门禁与评审共同兜底。
export function scanForbiddenSource(code: string): string[] {
  const hits: string[] = [];
  for (const { label, pattern } of FORBIDDEN_SOURCE_PATTERNS) {
    if (pattern.test(code)) hits.push(label);
  }
  return hits;
}
