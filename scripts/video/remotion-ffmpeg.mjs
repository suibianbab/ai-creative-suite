// 直接调用 Remotion 随包提供的 ffmpeg，避免 shell 改写路径或在超时后留下子进程。
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const engineRequire = createRequire(
  path.join(ROOT, "packages/remotion-engine/package.json"),
);
// renderer 是 @remotion/cli 的依赖；从 cli 的真实安装位置解析，兼容 pnpm 链接。
const cliRequire = createRequire(
  realpathSync(engineRequire.resolve("@remotion/cli/package.json")),
);
const { RenderInternals } = cliRequire("@remotion/renderer");

export function runRemotionFfmpeg(args, options = {}, spawn = spawnSync) {
  const binary = RenderInternals.getExecutablePath({
    type: "ffmpeg",
    indent: false,
    logLevel: "error",
  });
  RenderInternals.makeFileExecutableIfItIsNot(binary);
  const lib = path.dirname(binary);
  const env = { ...process.env, RUST_BACKTRACE: "full", ...options.env };
  if (process.platform === "win32") env.PATH = `${lib};${env.PATH ?? ""}`;
  else if (process.platform === "darwin") env.DYLD_LIBRARY_PATH = lib;
  else env.LD_LIBRARY_PATH = lib;

  return spawn(binary, args, {
    ...options,
    cwd: options.cwd ?? ROOT,
    env,
    shell: false,
    windowsHide: true,
  });
}
