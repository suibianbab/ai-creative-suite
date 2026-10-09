import { Composition } from "remotion";
import { Form01 } from "./form01";

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
  </>
);
