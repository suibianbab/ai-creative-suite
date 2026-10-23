import { canonicalJson } from "./canonical-json.js";
import { reviseWorkingVersion } from "./operations.js";
import type {
  StyleBible,
  StyleBibleRef,
  StyleBibleVersion,
  VideoProject,
} from "./types.js";
import { validateVideoProject } from "./validate.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const SHA = /^[0-9a-f]{64}$/;
const COLOR_ROLE: Record<string, keyof StyleBibleVersion["palette"]> = {
  accent: "accent",
  titleColor: "foreground",
  textColor: "foreground",
  inkColor: "foreground",
  numberColor: "foreground",
  subtitleColor: "secondary",
  boxColor: "secondary",
  groundColor: "secondary",
  accentColor: "accent",
  arrowColor: "accent",
  highlightColor: "accent",
  markerColor: "accent",
  pinColor: "accent",
  routeColor: "accent",
  color: "object",
  barColor: "object",
  baseColor: "object",
  lineColor: "object",
  strokeColor: "object",
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateStyleBible(value: unknown): StyleBible {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
  if (
    bytes > 128 * 1024 ||
    !record(value) ||
    value.schemaVersion !== 1 ||
    typeof value.id !== "string" ||
    !UUID.test(value.id)
  ) {
    throw new Error(
      "StyleBible 须为 schemaVersion=1、有效 UUID 且不超过 128 KiB",
    );
  }
  if (
    !Array.isArray(value.versions) ||
    value.versions.length < 1 ||
    value.versions.length > 64
  )
    throw new Error("StyleBible.versions 须为 1..64 条独立版本");
  const ids = new Set<string>();
  for (const [index, version] of value.versions.entries()) {
    const field = `StyleBible.versions[${index}]`;
    if (
      !record(version) ||
      typeof version.versionId !== "string" ||
      !UUID.test(version.versionId) ||
      ids.has(version.versionId)
    )
      throw new Error(`${field}.versionId 无效或重复`);
    ids.add(version.versionId);
    if (
      typeof version.createdAt !== "string" ||
      !ISO.test(version.createdAt) ||
      typeof version.name !== "string" ||
      version.name.trim().length < 1 ||
      version.name.length > 100
    )
      throw new Error(`${field} 创建时间或名称无效`);
    const palette = version.palette;
    if (
      !record(palette) ||
      (
        ["background", "foreground", "secondary", "accent", "object"] as const
      ).some(
        (key) =>
          typeof palette[key] !== "string" || !HEX.test(palette[key] as string),
      )
    )
      throw new Error(`${field}.palette 须包含五个 #RRGGBB 颜色`);
    if (
      version.fontFamily !== "NotoSansSC" ||
      version.lightingPreset !== "orbit3d-fixed-soft-studio"
    )
      throw new Error(`${field} 字体或灯光预设尚未被当前渲染器支持`);
  }
  if (
    typeof value.currentVersionId !== "string" ||
    !ids.has(value.currentVersionId)
  )
    throw new Error("StyleBible.currentVersionId 须指向已有版本");
  return value as StyleBible;
}

export function assertStyleBibleEvolution(
  previous: StyleBible,
  next: StyleBible,
): void {
  validateStyleBible(previous);
  validateStyleBible(next);
  if (
    previous.id !== next.id ||
    next.versions.length < previous.versions.length
  )
    throw new Error("StyleBible 身份与旧版本序列不可删除");
  for (const [index, version] of previous.versions.entries()) {
    if (canonicalJson(version) !== canonicalJson(next.versions[index]))
      throw new Error(`StyleBible 旧版本 ${index + 1} 不可改写或重排`);
  }
}

export async function styleVersionDigest(
  version: StyleBibleVersion,
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(version));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export async function resolveStyleBibleRef(
  ref: StyleBibleRef,
  bible: StyleBible,
): Promise<StyleBibleVersion> {
  validateStyleBible(bible);
  if (ref.bibleId !== bible.id || !SHA.test(ref.digest))
    throw new Error("项目 Style Bible 引用与独立记录不匹配");
  const version = bible.versions.find(
    (entry) => entry.versionId === ref.versionId,
  );
  if (!version || (await styleVersionDigest(version)) !== ref.digest)
    throw new Error("项目 Style Bible 版本不存在或摘要不匹配");
  return version;
}

function recolor(
  value: unknown,
  palette: StyleBibleVersion["palette"],
): unknown {
  if (Array.isArray(value)) return value.map((part) => recolor(part, palette));
  if (!record(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, part]) => {
      const role = COLOR_ROLE[key];
      return [
        key,
        role && typeof part === "string" && HEX.test(part)
          ? palette[role]
          : recolor(part, palette),
      ];
    }),
  );
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

function contrastRatio(textColor: string, boxColor: string): number {
  const text = luminance(textColor);
  const box = luminance(boxColor);
  return (Math.max(text, box) + 0.05) / (Math.min(text, box) + 0.05);
}

function readableNodeText(
  candidate: string,
  foreground: string,
  boxColor: string,
): string {
  if (contrastRatio(candidate, boxColor) >= 4.5) return candidate;
  if (contrastRatio(foreground, boxColor) >= 4.5) return foreground;
  const box = luminance(boxColor);
  return box > 0.179 ? "#000000" : "#ffffff";
}

export function styleSceneSpec(
  spec: Record<string, unknown>,
  version: StyleBibleVersion,
): Record<string, unknown> {
  const params = recolor(spec.params, version.palette);
  if (
    spec.componentId === "flow-diagram" &&
    record(params) &&
    typeof params.boxColor === "string" &&
    HEX.test(params.boxColor)
  ) {
    const existing = params.nodeTextColor;
    if (typeof existing === "string" && HEX.test(existing)) {
      params.nodeTextColor = readableNodeText(
        existing,
        version.palette.foreground,
        params.boxColor,
      );
    } else if (
      contrastRatio(version.palette.foreground, params.boxColor) < 4.5
    ) {
      params.nodeTextColor = readableNodeText(
        version.palette.foreground,
        version.palette.foreground,
        params.boxColor,
      );
    }
  }
  return {
    ...spec,
    background: version.palette.background,
    params,
  };
}

export function workingStyleIssues(
  project: VideoProject,
  version: StyleBibleVersion,
): string[] {
  const issues: string[] = [];
  for (const [index, shot] of project.shots.entries()) {
    const working = shot.contentVersions.find(
      (item) => item.versionId === shot.workingVersionId,
    );
    if (!working) {
      issues.push(`镜头 ${index + 1} 工作版本缺失`);
      continue;
    }
    if (
      working.sceneSource.type === "media-clip" ||
      working.sceneSource.type === "editor-binding"
    ) {
      issues.push(
        `镜头 ${index + 1} 是外部/媒体画面，无法由当前 Style Bible 保证颜色与光照`,
      );
      continue;
    }
    const spec = working.sceneSource.spec as Record<string, unknown>;
    if (canonicalJson(spec) !== canonicalJson(styleSceneSpec(spec, version)))
      issues.push(`镜头 ${index + 1} 工作画面偏离 Style Bible 调色板`);
  }
  return issues;
}

// 人工应用风格：每个受影响镜头追加内容版本，旧源与旧版本原封不动；项目只记引用。
export async function applyStyleBible(
  project: VideoProject,
  bible: StyleBible,
  versionId: string,
  newVersionId: () => string = () => crypto.randomUUID(),
  at = new Date().toISOString(),
): Promise<VideoProject> {
  validateStyleBible(bible);
  const version = bible.versions.find((entry) => entry.versionId === versionId);
  if (!version) throw new Error("选定的 Style Bible 版本不存在");
  if (
    project.shots.some((shot) => {
      const working = shot.contentVersions.find(
        (item) => item.versionId === shot.workingVersionId,
      );
      return (
        working?.sceneSource.type === "media-clip" ||
        working?.sceneSource.type === "editor-binding"
      );
    })
  )
    throw new Error(
      "项目含媒体或外部编辑器镜头，当前 Style Bible 无法保证其画面风格；请先人工处理这些镜头",
    );
  let next = project;
  for (const shot of project.shots) {
    const working = shot.contentVersions.find(
      (item) => item.versionId === shot.workingVersionId,
    )!;
    if (
      working.sceneSource.type !== "spec" &&
      working.sceneSource.type !== "three"
    )
      throw new Error("Style Bible 仅可自动应用于受支持的程序化镜头");
    const spec = working.sceneSource.spec as Record<string, unknown>;
    const painted = styleSceneSpec(spec, version);
    if (canonicalJson(spec) === canonicalJson(painted)) continue;
    next = reviseWorkingVersion(
      next,
      shot.shotId,
      working.sceneSource.type === "three"
        ? {
            threeScene:
              painted as unknown as import("./types.js").ThreeSceneSpec,
          }
        : { spec: painted },
      newVersionId(),
      at,
    );
  }
  const ref: StyleBibleRef = {
    bibleId: bible.id,
    versionId,
    digest: await styleVersionDigest(version),
  };
  next = validateVideoProject({ ...next, styleBibleRef: ref });
  const issues = workingStyleIssues(next, version);
  if (issues.length) throw new Error(issues.join("；"));
  return next;
}
