import {
  activeSubtitleCue,
  resolveTransitionWindows,
  type ShotTransition,
  type SubtitleCue,
  transitionOverlayAt,
} from "@acs/video-document";
import {
  assertNodeBudget,
  defaultRegistry,
  mediaClipCss,
  mediaMotionTransform,
  reactSvgAttrs,
  type SceneSpec,
  type SvgNode,
  seededRandom,
  validateSceneSpec,
} from "@acs/video-scene";
import { createElement, type FC, type JSX } from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import "./assets/fonts/font.css";

// SvgNode 数据树 → React 元素。组件输出的是纯数据（@acs/video-scene 不依赖 React），
// 这里做一次性桥接：属性名经 reactSvgAttrs 转 React 驼峰（与 web 预览桥共用同一份
// 转换），text 与 children 二选一。
export function SvgTree({ node }: { node: SvgNode }): JSX.Element {
  const children =
    node.text ??
    node.children?.map((child, index) => <SvgTree key={index} node={child} />);
  return createElement(node.tag, reactSvgAttrs(node.attrs), children);
}

export type SceneSpecProps = { spec?: SceneSpec };

// 单镜头渲染核心（SceneSpecScene 与 TimelineScene 共用）：validate → render →
// 节点预算门禁 → SVG 画布层。帧上下文完全由调用方给定（ADR 0003 §2），
// 随机只来自 seededRandom(spec.seed)，组件保持纯函数。
export function renderSpecLayer(
  spec: SceneSpec,
  context: {
    frame: number;
    fps: number;
    durationFrames: number;
    width: number;
    height: number;
  },
): JSX.Element {
  const validated = validateSceneSpec(spec, defaultRegistry);
  const component = defaultRegistry.get(
    validated.componentId,
    validated.componentVersion,
  );
  const node = component.render(validated, {
    frame: context.frame,
    fps: context.fps,
    durationFrames: context.durationFrames,
    width: context.width,
    height: context.height,
    random: seededRandom(validated.seed),
  });
  assertNodeBudget(node); // ADR 0003 §2.4：出站元素数上限，超限拒绝渲染
  return (
    <AbsoluteFill
      style={{
        backgroundColor: validated.background,
        fontFamily: '"NotoSansSC", sans-serif',
      }}
    >
      {/* SvgNode 根是 <g>，必须是 <svg> 的子元素才合法，这里补画布层 */}
      <svg
        width={context.width}
        height={context.height}
        viewBox={`0 0 ${context.width} ${context.height}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <SvgTree node={node} />
      </svg>
    </AbsoluteFill>
  );
}

// 通用 SceneSpec 合成（ADR 0003 §2）：单镜头整段合成。
export const SceneSpecScene: FC<SceneSpecProps> = ({ spec }) => {
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();
  if (!spec) return null; // Studio 空预览；出片总经 --props 注入
  return renderSpecLayer(spec, {
    frame,
    fps,
    durationFrames: durationInFrames,
    width,
    height,
  });
};

// —— P1 Timeline 多镜头合成：全局帧 → (镜头, 本地帧) → 复用单镜头渲染核心 ——
// spans 必须连续无缝（quantizeTimeline 产物天然如此）：有缝/重叠/悬空帧都是
// 编排错误，当场抛错拒绝渲染，不产静默空帧的整片（评审关注 #5）。
// P2.5-T4（spec §2 E1）：媒体镜头通道。spec 与 media 互斥（C4：media-clip 版本
// 不带 spec params）——spec-only 项目 props 逐字节不变（X1），媒体镜头才出现
// media 键。trimBefore = B5 半进位取整后的源内起始帧（装配层算好）。
export type TimelineMediaProps = {
  src: string; // http://127.0.0.1:<port>/original/<storeKey>（媒体仓托管，B1）
  assetWidth: number; // 素材原始尺寸——裁切用 useVideoConfig 合成宽高现算，
  assetHeight: number; // props 不含画幅参数，两画幅逐字节一致（G2）
  inMs: number;
  outMs: number;
  fit: "cover" | "contain";
  focalX: number;
  audio: "mute" | "keep"; // keep = 原声与旁白轨由 Remotion 音频管线自动混音（B4）
  trimBefore: number;
  /** 任务 2（2026-10-28）：受控基础运动（缺省静止；视频镜头缺省不变）。 */
  motion?: "still" | "zoom-in" | "zoom-out" | "pan-left" | "pan-right";
  /** 任务 1：图片资产——<Img> 渲染（无 trimBefore/音轨语义）。 */
  isImage?: boolean;
  /** 任务 3：图片镜受控文字叠加（标题/卖点；缺省无）。 */
  overlay?: {
    title: string;
    position: "top" | "center" | "bottom";
    enterMs: number;
  };
};

export type TimelineShotProps = {
  spec?: SceneSpec;
  media?: TimelineMediaProps;
  startFrame: number;
  frames: number;
  // D2：镜头旁白音轨。audioSrc 由装配方给绝对路径（CLI 渲染）；
  // 无 narration 的镜头不出 Sequence，画面与既有渲染逐字节一致。
  narration?: { audioSrc: string };
  // P1 字幕轨（spec R3）：cues 为镜头本地时间（音频从镜头起点播，同口径）。
  // 缺省不渲染字幕分支——输出与 D2 现状逐字节一致（帧确定性纪律）。
  subtitles?: { cues: SubtitleCue[] };
};

// P1 转场（Feature ④ spec R3）：project 级编排元数据透传。缺省/空 → 叠层
// 恒 opacity 0 → 不进 DOM → 渲染树与现状逐字节一致（A1 金标准）。
export type TimelineProps = {
  shots?: TimelineShotProps[];
  transitions?: ShotTransition[];
};

// P2.5-T4（E2/E3）：媒体镜头渲染层。Sequence 包裹让 OffthreadVideo 内部的
// useCurrentFrame 取到镜头本地帧（与旁白轨同款定位），trimBefore 定源内起始帧，
// span 的 durationInFrames 天然界定播出帧数（无 trimAfter——播满即止）。
// muted 吃 audio 通道（B4：keep 时原声与旁白 Sequence 由 Remotion 自动混音）。
// 裁切对象（objectFit/objectPosition）来自 video-scene 单源 mediaClipCss，
// 画幅宽高 useVideoConfig 现算——两画幅共用同一份 props。
const MediaClipLayer: FC<{ shot: TimelineShotProps }> = ({ shot }) => {
  const media = shot.media!;
  const { width, height, fps: FPS } = useVideoConfig();
  // 任务 2：Sequence 内取本地帧 → 运动进度（0..1，末帧=1）。变换来自
  // video-scene 单源 mediaMotionTransform，预览与出片同一份。
  const localFrame = useCurrentFrame();
  const progress = shot.frames > 1 ? localFrame / (shot.frames - 1) : 1;
  const transform = mediaMotionTransform(media.motion, progress);
  const crop = mediaClipCss(
    media.assetWidth,
    media.assetHeight,
    width,
    height,
    media.fit,
    media.focalX,
  );
  const stageStyle = {
    width: "100%",
    height: "100%",
    objectFit: crop.objectFit,
    objectPosition: crop.objectPosition,
  } as const;
  return (
    <Sequence from={shot.startFrame} durationInFrames={shot.frames}>
      <div
        style={{
          width: "100%",
          height: "100%",
          overflow: "hidden",
          transform,
          transformOrigin: "center",
        }}
      >
        {media.isImage ? (
          <Img src={media.src} style={stageStyle} />
        ) : (
          <OffthreadVideo
            src={media.src}
            muted={media.audio === "mute"}
            trimBefore={media.trimBefore}
            style={stageStyle}
          />
        )}
        {media.overlay ? (
          <MediaOverlay
            title={media.overlay.title}
            position={media.overlay.position}
            // 本地帧毫秒 → 淡入进度（enterMs 后恒 1）。
            opacity={Math.min(
              1,
              localFrame / FPS / Math.max(media.overlay.enterMs, 1),
            )}
            width={width}
            height={height}
          />
        ) : null}
      </div>
    </Sequence>
  );
};

// 任务 3：图片镜文字叠加——位置三档（顶部/居中/底部），药丸底衬保证
// 任意图片上的可读性；字号随画幅等比。位置避开运动变换（叠加在运动
// 容器之上、不随 scale/translate 抖动——文字是编排层不是画面内容）。
const MediaOverlay: FC<{
  title: string;
  position: "top" | "center" | "bottom";
  opacity: number;
  width: number;
  height: number;
}> = ({ title, position, opacity, width, height }) => {
  const fontSize = Math.round(height * (width > height ? 0.055 : 0.05));
  const bandHeight = Math.round(fontSize * 2.6);
  const placement =
    position === "top"
      ? { top: Math.round(height * 0.06) }
      : position === "center"
        ? { top: "50%", transform: "translateY(-50%)" }
        : { bottom: Math.round(height * 0.075) };
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        opacity,
        ...placement,
      }}
    >
      <span
        style={{
          background: "rgba(27,25,23,0.55)",
          borderRadius: Math.round(height * 0.018),
          padding: `${Math.round(height * 0.008)}px ${Math.round(height * 0.022)}px`,
          color: "#ffffff",
          fontWeight: 600,
          fontSize,
          lineHeight: 1.35,
          whiteSpace: "nowrap",
          minHeight: bandHeight * 0,
        }}
      >
        {title}
      </span>
    </div>
  );
};

export const TimelineScene: FC<TimelineProps> = ({ shots, transitions }) => {
  const { fps, width, height } = useVideoConfig();
  const frame = useCurrentFrame();
  if (!shots || shots.length === 0) return null; // Studio 空预览
  // 旁白音轨独立于当前帧的镜头归属渲染：Sequence 自己按 from/durationInFrames
  // 定位与截断（音频长于镜头 span 时只播到 span 末——Task4 装配时对超长告警）。
  const narrationTracks = shots
    .filter((shot) => shot.narration)
    .map((shot, index) => (
      <Sequence
        key={`narration-${index}`}
        from={shot.startFrame}
        durationInFrames={shot.frames}
      >
        <Audio src={shot.narration!.audioSrc} />
      </Sequence>
    ));
  for (let index = 1; index < shots.length; index += 1) {
    const prev = shots[index - 1]!;
    const cur = shots[index]!;
    if (cur.startFrame !== prev.startFrame + prev.frames) {
      throw new Error(
        `Timeline 第 ${index + 1} 个镜头 startFrame=${cur.startFrame} 与前镜头末帧 ${prev.startFrame + prev.frames} 不衔接：spans 必须连续无缝`,
      );
    }
  }
  const active = shots.find(
    (shot) => frame >= shot.startFrame && frame < shot.startFrame + shot.frames,
  );
  if (!active) {
    throw new Error(`Timeline 第 ${frame} 帧不属任何镜头（总帧数之外？）`);
  }
  // 字幕层（spec R3）：全局帧 → 活跃镜头本地毫秒 → 活跃 cue。白底场景
  // 用半透明深色药丸衬白字（Review Focus #1），横竖按画幅高度定字号。
  const subtitleCue = active.subtitles
    ? activeSubtitleCue(
        active.subtitles.cues,
        ((frame - active.startFrame) / fps) * 1000,
      )
    : undefined;
  // P1 转场：与 web 预览同一 resolve/overlay helper（同斜率同 split，A3 双端一致）。
  // span 不足在此大声抛错（错误消息指路缩短 durationMs/加长镜头）。
  const transitionWindows =
    transitions && transitions.length > 0
      ? resolveTransitionWindows(
          transitions,
          shots.map((shot) => ({
            startFrame: shot.startFrame,
            frames: shot.frames,
          })),
          fps,
        )
      : [];
  const overlayOpacity = transitionOverlayAt(transitionWindows, frame);
  return (
    <>
      {narrationTracks}
      {active.media ? (
        <MediaClipLayer shot={active} />
      ) : (
        renderSpecLayer(active.spec!, {
          frame: frame - active.startFrame,
          fps,
          durationFrames: active.frames,
          width,
          height,
        })
      )}
      {overlayOpacity > 0 ? (
        <AbsoluteFill
          style={{ backgroundColor: "#000", opacity: overlayOpacity }}
        />
      ) : null}
      {subtitleCue ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            // 字幕带下移（P2-2，Codex 复核 2026-10-28）：8% 带与图表轴标签
            // （设计 y≈875..885）重叠；2.5% 带让出组件内容区（最深 ~90%）。
            bottom: "2.5%",
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              background: "rgba(27,25,23,0.55)",
              borderRadius: Math.round(height * 0.018),
              padding: `${Math.round(height * 0.008)}px ${Math.round(height * 0.022)}px`,
              color: "#ffffff",
              fontWeight: 600,
              fontSize: Math.round(height * 0.045),
              lineHeight: 1.35,
              whiteSpace: "nowrap",
            }}
          >
            {subtitleCue.text}
          </span>
        </div>
      ) : null}
    </>
  );
};
