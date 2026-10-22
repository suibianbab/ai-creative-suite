// 交付记录（ADR 0003 deliveries 字段）首次落档的共享追加器：GIF/SVG 导出共用。
// 追加后立即重校验（沿 render-scene 回写口径），versionIds/renderIds 脏引用在此拦截。
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
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
  // 可选三键只在传入时落键：旧项目中无这些字段的记录仍可按原形状读取。
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

// 两个导出 CLI 的写盘边界：产物先在输出目录暂存，账本先通过 appendDelivery
// 校验；只有两个文件都可提交才报成功。项目提交失败时恢复原产物（若原本
// 不存在则删除新产物），项目旧字节因临时文件 + rename 从未被截断。
export function commitDeliveryFiles(
  { stagedOutputPath, outputPath, projectPath, nextProject },
  { renameFile = renameSync } = {},
) {
  const target = path.resolve(outputPath);
  const source = path.resolve(projectPath);
  const comparable = (value) =>
    process.platform === "win32" ? value.toLowerCase() : value;
  if (comparable(target) === comparable(source)) {
    throw new Error("项目文件与交付产物不能是同一路径");
  }
  try {
    const left = statSync(target, { bigint: true });
    const right = statSync(source, { bigint: true });
    if (left.dev === right.dev && left.ino === right.ino && left.ino !== 0n) {
      throw new Error("项目文件与交付产物不能是同一文件");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const projectTmp = `${source}.${randomUUID()}.tmp`;
  const backupPath = `${target}.${randomUUID()}.backup`;
  let backupExists = false;
  let preserveBackup = false;
  try {
    writeFileSync(projectTmp, `${JSON.stringify(nextProject, null, 2)}\n`);
    if (existsSync(target)) {
      copyFileSync(target, backupPath);
      backupExists = true;
    }
    renameFile(stagedOutputPath, target);
    try {
      renameFile(projectTmp, source);
    } catch (projectError) {
      try {
        if (backupExists) {
          renameFile(backupPath, target);
          backupExists = false;
        } else {
          rmSync(target, { force: true });
        }
      } catch (restoreError) {
        preserveBackup = backupExists;
        throw new Error(
          `项目回写失败（${projectError.message}），恢复原产物也失败（${restoreError.message}）；备份：${backupPath}`,
        );
      }
      throw projectError;
    }
  } finally {
    // 清理失败不应把已成功落账的交付误报成失败；恢复失败时留下备份供人工处理。
    for (const file of [projectTmp, stagedOutputPath]) {
      try {
        rmSync(file, { force: true });
      } catch {
        // 临时文件清理由后续运维处理。
      }
    }
    if (backupExists && !preserveBackup) {
      try {
        rmSync(backupPath, { force: true });
      } catch {
        // 成功交付不依赖备份清理。
      }
    }
  }
}
