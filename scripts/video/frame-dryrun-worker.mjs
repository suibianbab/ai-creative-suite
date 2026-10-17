// 干跑 worker：逐 (镜头×帧) 执行 moduleUrl 导出的 render(args, frame)。
// 每帧先报 frame-start 再渲染、成后报 frame-done——父线程据此做单帧预算
// 计时，卡死帧由父线程 terminate 本 worker（同步死循环只能靠隔离进程杀）。
import { parentPort, workerData } from "node:worker_threads";

const { jobs } = workerData;
const moduleCache = new Map();

for (const job of jobs) {
  if (!moduleCache.has(job.moduleUrl)) {
    try {
      moduleCache.set(job.moduleUrl, await import(job.moduleUrl));
    } catch (error) {
      parentPort.postMessage({
        type: "frame-error",
        label: job.label,
        frame: 0,
        message: `模块加载失败: ${error.message}`,
      });
      continue;
    }
  }
  const module = moduleCache.get(job.moduleUrl);
  const render = module[job.fn];
  if (typeof render !== "function") {
    parentPort.postMessage({
      type: "frame-error",
      label: job.label,
      frame: 0,
      message: `模块未导出函数 ${job.fn}`,
    });
    continue;
  }
  for (let frame = 0; frame < job.frames; frame += 1) {
    parentPort.postMessage({ type: "frame-start", label: job.label, frame });
    try {
      render(job.args, frame);
      parentPort.postMessage({ type: "frame-done", label: job.label, frame });
    } catch (error) {
      parentPort.postMessage({
        type: "frame-error",
        label: job.label,
        frame,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
parentPort.postMessage({ type: "all-done" });
