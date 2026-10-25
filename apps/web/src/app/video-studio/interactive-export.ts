import type { ThreeSceneSpec } from "@acs/video-document";

const COLOR = /^#[0-9a-fA-F]{6}$/;
const SHAPES = ["box", "sphere", "torus", "icosahedron"] as const;
const DEFAULTS = {
  shape: "box",
  color: "#4f9dff",
  accent: "#e8b04b",
  spinPerFrame: 0.02,
  tilt: 0.35,
  zoom: 1,
} as const;

export type InteractiveOptions = {
  background: string;
  shape: (typeof SHAPES)[number];
  color: string;
  accent: string;
  spinPerFrame: number;
  tilt: number;
  zoom: number;
};

function boundedNumber(
  value: unknown,
  key: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error(`3D 参数 ${key} 须为 ${min} 到 ${max}`);
  return value;
}

// Browser adapter for the closed orbit3d@1/@2 registry. The document schema
// deliberately leaves params shallow; exporting HTML must enforce the same
// key/type/range boundary as orbit3d.validateParams before script insertion.
export function interactiveOptions(spec: ThreeSceneSpec): InteractiveOptions {
  if (spec.componentId !== "orbit3d" || ![1, 2].includes(spec.componentVersion))
    throw new Error(
      `交互页不支持 3D 组件 ${spec.componentId}@${spec.componentVersion}`,
    );
  if (!COLOR.test(spec.background)) throw new Error("3D 背景颜色无效");
  const params = spec.params;
  if (!params || typeof params !== "object" || Array.isArray(params))
    throw new Error("3D 参数必须是对象");
  for (const key of Object.keys(params)) {
    if (!Object.hasOwn(DEFAULTS, key)) throw new Error(`3D 参数不支持 ${key}`);
  }
  const read = (key: keyof typeof DEFAULTS): unknown =>
    Object.hasOwn(params, key) ? params[key] : DEFAULTS[key];
  const shape = read("shape");
  if (!SHAPES.includes(shape as (typeof SHAPES)[number]))
    throw new Error("3D 主体形状不受支持");
  const color = read("color");
  const accent = read("accent");
  if (typeof color !== "string" || !COLOR.test(color))
    throw new Error("3D 主体颜色无效");
  if (typeof accent !== "string" || !COLOR.test(accent))
    throw new Error("3D 强调颜色无效");
  const spinPerFrame = boundedNumber(
    read("spinPerFrame"),
    "spinPerFrame",
    0,
    0.5,
  );
  const tilt = boundedNumber(read("tilt"), "tilt", 0, 1.5);
  const zoom = boundedNumber(read("zoom"), "zoom", 0.5, 2);
  return {
    background: spec.background,
    shape: shape as InteractiveOptions["shape"],
    color,
    accent,
    spinPerFrame,
    tilt,
    zoom,
  };
}

export function escapeInteractiveHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function inlineScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function buildInteractiveHtml(
  bundle: string,
  title: string,
  options: InteractiveOptions,
): string {
  const safeTitle = escapeInteractiveHtml(title);
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>交互预览 · ${safeTitle}</title>
<style>body{margin:0;background:${options.background};color:#eef3f8;font-family:sans-serif}#stage{width:100vw;height:88vh;touch-action:none;cursor:grab}#hint{padding:12px 16px;font-size:14px;color:#9fb2c4}#state{color:${options.accent};font-weight:700}.w4-status{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}</style>
</head><body>
<div id="stage" data-exploded="false" data-rotated="false" tabindex="0" role="group" aria-label="拖转 ${options.shape} 主体，双击或回车拆解"></div>
<p id="hint">拖拽转动；双击/回车切换 <span id="state">合拢</span>/拆解。源项目：${safeTitle}。衍生交互演示。</p>
<script>${bundle}</script>
<script>const app=W4App.createApp(document.getElementById("stage"),${inlineScriptJson(options)});const sl=document.getElementById("state");document.getElementById("stage").addEventListener("w4:state",()=>{sl.textContent=app.state.exploded?"拆解":"合拢"});</script>
</body></html>`;
}
