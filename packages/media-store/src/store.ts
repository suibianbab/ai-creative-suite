// P2.5-T2 内容寻址媒体仓布局与原子落盘（spec S 表）。storeKey 形状门是
// 防目录穿越的唯一闸门——originalPath/proxyPath 是路由直接消费的入口。
import {
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

// 任务 1（2026-10-28）：图片键位（png/jpg/webp）与视频键位并存。
export const STORE_KEY_PATTERN =
  /^[0-9a-f]{16}\.(mp4|webm|mov|png|jpg|webp)$/;

export function storeKeyFor(
  sha256: string,
  ext: "mp4" | "webm" | "mov" | "png" | "jpg" | "webp",
): string {
  return `${sha256.slice(0, 16)}.${ext}`;
}

export function resolveStoreRoot(): string {
  const configured = process.env.ACS_MEDIA_STORE;
  if (configured !== undefined) {
    if (!path.isAbsolute(configured)) {
      throw new Error(`ACS_MEDIA_STORE 须为绝对路径（当前：${configured}）`);
    }
    return configured;
  }
  return path.join(homedir(), ".acs", "media-store");
}

function requireValidStoreKey(storeKey: string): void {
  if (!STORE_KEY_PATTERN.test(storeKey)) {
    throw new Error(`storeKey 形状非法：${storeKey}`);
  }
}

export function originalPath(root: string, storeKey: string): string {
  requireValidStoreKey(storeKey);
  return path.join(root, "original", storeKey);
}

export function proxyPath(root: string, storeKey: string): string {
  requireValidStoreKey(storeKey);
  return path.join(root, "proxy", `${storeKey.slice(0, 16)}.proxy.mp4`);
}

// 内容寻址幂等：同 storeKey 同大小复用（S3）；异大小 = 内容寻址被破坏，
// 大声失败不覆盖。写入走同目录临时文件 + rename（原子替换），并发同内容
// 双写至多一次 rename 生效，无残片。
export function writeAtomically(
  dest: string,
  bytes: Uint8Array,
): "written" | "reused" {
  mkdirSync(path.dirname(dest), { recursive: true });
  if (existsSync(dest)) {
    if (statSync(dest).size === bytes.byteLength) return "reused";
    throw new Error(`仓内同 storeKey 文件大小不符（内容寻址冲突）：${dest}`);
  }
  const temp = path.join(
    path.dirname(dest),
    `.${path.basename(dest)}.${process.pid}.${Date.now()}.tmp`,
  );
  writeFileSync(temp, bytes);
  try {
    renameSync(temp, dest);
  } catch (error) {
    unlinkSync(temp);
    throw error;
  }
  return "written";
}
