import { quantizeTimeline } from "@acs/video-document";
import { Composition } from "remotion";
import { Form01 } from "./form01";
import { type SceneSpecProps, SceneSpecScene } from "./scene-spec-composition";

export const SCENE_FPS = 24;

// 帧数由 spec 算出（累计边界量化，ADR 0003 §3.5）；Studio 无 props 时给 6s 占位。
const sceneCalculateMetadata = ({ props }: { props: SceneSpecProps }) => ({
  durationInFrames: props.spec
    ? quantizeTimeline([props.spec.durationMs], SCENE_FPS).totalFrames
    : 144,
});

export const Root = () => (
  <>
    <Composition
      id="Form01-Landscape"
      component={Form01}
      durationInFrames={144}
      fps={24}
      width={1280}
      height={720}
      defaultProps={{ aspect: "landscape" as const }}
    />
    <Composition
      id="Form01-Portrait"
      component={Form01}
      durationInFrames={144}
      fps={24}
      width={720}
      height={1280}
      defaultProps={{ aspect: "portrait" as const }}
    />
    <Composition
      id="SceneSpec-Landscape"
      component={SceneSpecScene}
      calculateMetadata={sceneCalculateMetadata}
      fps={SCENE_FPS}
      width={1280}
      height={720}
      defaultProps={{ spec: undefined }}
    />
    <Composition
      id="SceneSpec-Portrait"
      component={SceneSpecScene}
      calculateMetadata={sceneCalculateMetadata}
      fps={SCENE_FPS}
      width={720}
      height={1280}
      defaultProps={{ spec: undefined }}
    />
  </>
);
