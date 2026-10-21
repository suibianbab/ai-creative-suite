// P3-A 交互交付（spec R1/R2/R3/R6）：把每步 SVG 拼成一个自包含 index.html。
// 零外部资源、零网络、零运行时依赖；确定性：同输入逐字节同串。
export const MAX_HTML_BYTES = 8 * 1024 * 1024;

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function assertDimension(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new Error(
      `页面${name === "width" ? "宽度" : "高度"}必须是正数（${name}=${String(value)}）`,
    );
}

// 固定播放器：解析数据块、替换舞台、维护步号与按钮禁用态、点击 + 键盘。
// 焦点在按钮上时跳过 Space/Enter，避免与按钮原生 click 重复触发。
const PLAYER_SCRIPT = [
  "(() => {",
  '  "use strict";',
  '  const data = JSON.parse(document.getElementById("steps-data").textContent);',
  "  const steps = data.steps;",
  '  const stage = document.getElementById("stage");',
  '  const indicator = document.getElementById("indicator");',
  '  const prev = document.getElementById("prev");',
  '  const next = document.getElementById("next");',
  '  const restart = document.getElementById("restart");',
  "  let index = 0;",
  "  const render = () => {",
  "    stage.innerHTML = steps[index].svg;",
  "    document.body.dataset.step = String(index + 1);",
  "    indicator.textContent = `第 ${index + 1} / ${steps.length} 步`;",
  "    prev.disabled = index === 0;",
  "    next.disabled = index === steps.length - 1;",
  "  };",
  "  const go = (target) => {",
  "    const bounded = Math.max(0, Math.min(steps.length - 1, target));",
  "    if (bounded === index) return;",
  "    index = bounded;",
  "    render();",
  "  };",
  "  // 重新开始始终重渲染第 1 步，已在第 1 步时也重启动画（不经过 go 的等值早退）。",
  "  const reset = () => {",
  "    index = 0;",
  "    render();",
  "  };",
  '  prev.addEventListener("click", () => go(index - 1));',
  '  next.addEventListener("click", () => go(index + 1));',
  '  restart.addEventListener("click", reset);',
  '  document.addEventListener("keydown", (event) => {',
  '    const onButton = event.target?.tagName === "BUTTON";',
  '    if (event.key === "ArrowRight") {',
  "      event.preventDefault();",
  "      go(index + 1);",
  '    } else if (event.key === "ArrowLeft") {',
  "      event.preventDefault();",
  "      go(index - 1);",
  '    } else if (event.key === "Home") {',
  "      event.preventDefault();",
  "      reset();",
  '    } else if (!onButton && (event.key === " " || event.key === "Enter")) {',
  "      event.preventDefault();",
  "      go(index + 1);",
  "    }",
  "  });",
  "  render();",
  "})();",
].join("\n");

function styleSheet(width) {
  return [
    "html,body{margin:0;padding:0}",
    "body{min-height:100vh;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;padding:24px;background:#0b1020;color:#e6ebff;font-family:NotoSansSC, sans-serif}",
    `.stage{width:100%;max-width:${width}px;margin:0 auto}`,
    ".stage > svg{width:100%;height:auto;display:block}",
    ".controls{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:12px}",
    ".controls button{min-width:96px;padding:10px 18px;border:1px solid #3a4a7a;border-radius:8px;background:#16203c;color:inherit;font:inherit;cursor:pointer}",
    ".controls button:disabled{opacity:.4;cursor:default}",
    "#indicator{min-width:7em;text-align:center;font-variant-numeric:tabular-nums}",
  ].join("\n");
}

export function buildPlayerHtml({ title, width, height, steps } = {}) {
  if (typeof title !== "string")
    throw new Error(`标题必须是字符串，收到 ${typeof title}`);
  assertDimension("width", width);
  assertDimension("height", height);
  if (!Array.isArray(steps))
    throw new Error("steps 必须是步骤数组（[{ svg: string }]）");
  if (steps.length === 0) throw new Error("步骤数为 0，交互页面至少需要 1 步");

  const normalizedSteps = steps.map((step, index) => {
    if (!step || typeof step.svg !== "string")
      throw new Error(`第 ${index + 1} 步缺少 svg 字符串`);
    return { svg: step.svg };
  });

  const payload = {
    title,
    width,
    height,
    steps: normalizedSteps,
  };
  // 把 < 转义为 JSON 的 Unicode 转义序列：SVG 里的 </script> 无法提前闭合数据块，
  // JSON.parse 仍取回原串。
  const payloadJson = JSON.stringify(payload).replace(/</g, "\\u003c");

  const html =
    `<!doctype html><html lang="zh-CN">\n` +
    `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${esc(title)}</title><style>\n${styleSheet(width)}\n</style></head>\n` +
    `<body data-step="1" data-total="${steps.length}">\n` +
    `<main class="stage" id="stage"></main>\n` +
    `<footer class="controls">\n` +
    `<button id="prev" type="button">上一步</button>\n` +
    `<span id="indicator" aria-live="polite">第 1 / ${steps.length} 步</span>\n` +
    `<button id="next" type="button">下一步</button>\n` +
    `<button id="restart" type="button">重新开始</button>\n` +
    `</footer>\n` +
    `<script type="application/json" id="steps-data">${payloadJson}</script>\n` +
    `<script>\n${PLAYER_SCRIPT}\n</script>\n` +
    `</body></html>\n`;

  const bytes = new TextEncoder().encode(html).length;
  if (bytes > MAX_HTML_BYTES)
    throw new Error(
      `页面体积超限（${bytes} 字节 > ${MAX_HTML_BYTES} 字节上限），请降 --fps 或拆分项目`,
    );
  return html;
}
