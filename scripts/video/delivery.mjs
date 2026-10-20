// 交付记录（ADR 0003 deliveries 字段）首次落档的共享追加器：GIF/SVG 导出共用。
// 追加后立即重校验（沿 render-scene 回写口径），versionIds/renderIds 脏引用在此拦截。
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const { validateVideoProject } = await import(
  pathToFileURL(path.join(ROOT, "packages/video-document/dist/index.js")).href
);

// 共享再导出：两个导出 CLI 的回读校验走同一份动态导入，避免各自推导 ROOT。
export { validateVideoProject };

export function appendDelivery(
  project,
  { versionIds, renderIds, frameMap, kind, outputRef, digest },
) {
  // 可选三键只在传入时落键：旧导出（GIF/SVG）的记录字节形状保持不变。
  const delivery = {
    deliveryId: randomUUID(),
    at: new Date().toISOString(),
    versionIds,
    renderIds,
    frameMap,
    ...(kind === undefined ? {} : { kind }),
    ...(outputRef === undefined ? {} : { outputRef }),
    ...(digest === undefined ? {} : { digest }),
  };
  const next = {
    ...project,
    deliveries: [...project.deliveries, delivery],
    savedVersion: project.savedVersion + 1,
  };
  validateVideoProject(next);
  return { project: next, delivery };
}
