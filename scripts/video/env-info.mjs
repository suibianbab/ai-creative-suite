// 渲染环境探测：ADR §2.5 把无头浏览器版本列为确定性输入，出片与确定性
// 校验都要把「实际用的浏览器」记进 manifest / RenderRecord。
import { spawnSync } from "node:child_process";

// 返回可执行文件的版本标识（如 "Google Chrome 131.0.6778.86"）。
// 探测失败不抛异常：渲染不该因为版本探测挂掉，但要诚实标记 unavailable。
export function browserLabel(executablePath) {
  if (!executablePath) return "unavailable (no explicit executable)";
  // chrome.exe --version 在 Windows 不出版本号：转入既有会话输出本地化提示，
  // 还可能弹出窗口。改为读可执行文件的版本资源，不启动目标进程。
  if (process.platform === "win32") return windowsFileVersion(executablePath);
  const probe = spawnSync(executablePath, ["--version"], {
    encoding: "utf8",
    timeout: 15_000,
  });
  const output = `${probe.stdout ?? ""}`.trim();
  if (probe.status !== 0 || output.length === 0)
    return "unavailable (probe failed)";
  return output.length > 128 ? output.slice(0, 128) : output;
}

function windowsFileVersion(executablePath) {
  const escaped = executablePath.replace(/'/g, "''");
  const script =
    `$v = (Get-Item -LiteralPath '${escaped}').VersionInfo; ` +
    `if ($v.ProductVersion) { "$($v.ProductName) $($v.ProductVersion)".Trim() }`;
  const probe = spawnSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    timeout: 15_000,
  });
  const output = `${probe.stdout ?? ""}`.trim();
  if (probe.status !== 0 || output.length === 0)
    return "unavailable (probe failed)";
  return output.length > 128 ? output.slice(0, 128) : output;
}
