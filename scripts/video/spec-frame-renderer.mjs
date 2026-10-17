// 干跑用的 spec→帧渲染适配器：与出片路径同一注册表、同一校验、同一节点预算
// 门禁（validate → component.render → assertNodeBudget）。frame-dryrun 的 worker
// 经 moduleUrl 加载本模块逐帧调用；args = { spec, fps, durationFrames, width, height }。
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const { assertNodeBudget, defaultRegistry, seededRandom, validateSceneSpec } =
  await import(
    pathToFileURL(path.join(ROOT, "packages/video-scene/dist/index.js")).href
  );

export function renderSpecFrame(args, frame) {
  const spec = validateSceneSpec(args.spec, defaultRegistry);
  const component = defaultRegistry.get(
    spec.componentId,
    spec.componentVersion,
  );
  const node = component.render(spec, {
    frame,
    fps: args.fps,
    durationFrames: args.durationFrames,
    width: args.width,
    height: args.height,
    random: seededRandom(spec.seed),
  });
  assertNodeBudget(node); // 与出片出站同门禁（ADR 0003 §2.4）
  return node;
}
