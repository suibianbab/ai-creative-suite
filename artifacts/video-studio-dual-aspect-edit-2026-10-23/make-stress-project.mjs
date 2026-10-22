#!/usr/bin/env node
// 由 e2e 导出的项目（长标题 + 12 点长标签折线 + 竖版覆写）派生出片用的
// 两个变体：before = 剥离 layout（自动布局对照），after = 保留覆写。
// 两者同 id 同镜头，仅工作版本 spec.layout 有无之分；剥离 styleBibleRef
// （渲染机无浏览器侧 Style Bible 存储，前后同口径渲染，色板已烘进 spec）。
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = JSON.parse(
  readFileSync(path.join(here, "export.video-project.json"), "utf8"),
);

const stripLayout = (project) => ({
  ...project,
  styleBibleRef: undefined,
  shots: project.shots.map((shot) => ({
    ...shot,
    contentVersions: shot.contentVersions.map((version) =>
      version.sceneSource.type === "spec" && version.sceneSource.spec.layout
        ? (() => {
            const { layout: _drop, ...spec } = version.sceneSource.spec;
            return { ...version, sceneSource: { ...version.sceneSource, spec } };
          })()
        : version,
    ),
  })),
});

const withLayout = { ...source, styleBibleRef: undefined };
const before = stripLayout(source);
writeFileSync(
  path.join(here, "stress-before.video-project.json"),
  `${JSON.stringify(before, null, 2)}\n`,
);
writeFileSync(
  path.join(here, "stress-after.video-project.json"),
  `${JSON.stringify(withLayout, null, 2)}\n`,
);
console.log(
  `变体已生成：before（无覆写）/ after（竖版覆写）· 项目 ${source.id} · ${source.shots.length} 镜头`,
);
