// P3-B Task 4：出片 props 组装的纯函数模块（从 render-scene.mjs 抽出，Ruling 3）。
// 编排（读文件、起服务、字幕副作用）留在 render-scene.mjs；这里只做数据拼装，
// 因此可单测、可对拍「无 three 项目 props 逐字节不变」的金标准。
// 键序纪律：镜头块 = spec|media, startFrame, frames, narration?, subtitles?；
// 顶层 = shots, transitions?（改键序即破坏 props 文件的字节恒等）。
import { buildTimelineShotMedia } from "./render-scene.media.mjs";

// 出片帧率与画幅尺寸：与 render-scene.mjs 同一口径（三处使用方共享一份映射）。
export const PROPS_FPS = 24;
export const DIMENSIONS = { landscape: [1280, 720], portrait: [720, 1280] };

// three 镜头 props：与 media-clip 同形（TimelineMediaProps），喂既有 OffthreadVideo。
// 烘焙片段本就是该画幅的成片（assetWidth/Height = 画幅尺寸），整段播出：
// inMs/trimBefore 归零，outMs 由镜头 span 帧数换算（与 media 的毫秒口径对齐）。
export function buildTimelineShotThree(entry, src, fps = PROPS_FPS) {
  const dimension = DIMENSIONS[entry.aspect];
  if (!dimension) {
    throw new Error(
      `3D 镜头画幅 ${entry.aspect} 未知（仅支持 landscape | portrait），无法组装 props`,
    );
  }
  const [assetWidth, assetHeight] = dimension;
  return {
    media: {
      src,
      assetWidth,
      assetHeight,
      inMs: 0,
      outMs: Math.round((entry.frames / fps) * 1000),
      fit: "contain",
      focalX: 0.5,
      audio: "mute",
      trimBefore: 0,
    },
  };
}

// timelineProps 组装（单参对象，Ruling 5）。threeByShot 是「本画幅」的烘焙结果
// （entry 已带 span 的 frames）；无 three 镜头时该分支不执行，输出与抽取前一致。
export function buildTimelineProps({
  timeline,
  shotEntries,
  mediaByShot = new Map(),
  threeByShot = new Map(),
  mediaUrlBase,
  threeUrlBase,
  narrationByShot = new Map(),
  subtitlesByShot = new Map(),
  transitions,
  fps = PROPS_FPS,
}) {
  const props = {
    shots: timeline.shots.map((span) => {
      const shotIndex = span.shotIndex;
      let source;
      if (mediaByShot.has(shotIndex)) {
        const media = mediaByShot.get(shotIndex);
        source = buildTimelineShotMedia(
          media,
          `${mediaUrlBase}/original/${media.asset.storeKey}`,
          fps,
        );
      } else if (threeByShot.has(shotIndex)) {
        const three = threeByShot.get(shotIndex);
        source = buildTimelineShotThree(
          three,
          `${threeUrlBase}/original/${three.storeKey}`,
          fps,
        );
      } else {
        source = { spec: shotEntries[shotIndex].spec };
      }
      return {
        ...source,
        startFrame: span.startFrame,
        frames: span.frames,
        ...(narrationByShot.has(shotIndex)
          ? {
              narration: {
                audioSrc: narrationByShot.get(shotIndex).propsSrc,
              },
            }
          : {}),
        ...(subtitlesByShot.has(shotIndex)
          ? { subtitles: subtitlesByShot.get(shotIndex) }
          : {}),
      };
    }),
  };
  // 缺省/空不加键：props 文件与无转场现状逐字节一致（A1 金标准）。
  if (Array.isArray(transitions) && transitions.length > 0) {
    props.transitions = transitions;
  }
  return props;
}
