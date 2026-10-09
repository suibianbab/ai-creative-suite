import { Audio } from "@remotion/media";
import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

type Aspect = "landscape" | "portrait";
type Props = { aspect: Aspect };

const ivory = "#f3e9d0";
const gold = "#ceac71";

const fade = (
  frame: number,
  start: number,
  full: number,
  hold: number,
  end: number,
) =>
  interpolate(frame, [start, full, hold, end], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

const landscapeText = (frame: number) => {
  if (frame < 48) {
    return (
      <div
        style={{
          position: "absolute",
          left: 78,
          top: 84,
          opacity: fade(frame, 0, 12, 39, 47),
          color: ivory,
        }}
      >
        <div style={{ fontFamily: "Georgia, serif", fontSize: 42 }}>
          FORM 01
        </div>
        <div
          style={{ width: 156, height: 2, background: gold, marginTop: 10 }}
        />
        <div
          style={{
            fontFamily: "Arial, sans-serif",
            fontSize: 20,
            marginTop: 18,
          }}
        >
          A QUIETER PRESENCE
        </div>
      </div>
    );
  }
  if (frame < 72) {
    return (
      <div
        style={{
          position: "absolute",
          left: 78,
          top: 96,
          opacity: fade(frame, 48, 53, 63, 71),
          color: ivory,
          fontFamily: "Arial, sans-serif",
          fontSize: 25,
        }}
      >
        <div>DETAIL IN</div>
        <div style={{ marginTop: 6 }}>EVERY SURFACE</div>
        <div
          style={{ width: 208, height: 2, background: gold, marginTop: 16 }}
        />
      </div>
    );
  }
  return (
    <div
      style={{
        position: "absolute",
        left: 80,
        top: 174,
        opacity: interpolate(frame, [72, 86], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
        color: ivory,
      }}
    >
      <div
        style={{ fontFamily: "Arial, sans-serif", fontSize: 22, color: gold }}
      >
        A DESIGN STUDY
      </div>
      <div
        style={{ fontFamily: "Georgia, serif", fontSize: 82, marginTop: 36 }}
      >
        FORM 01
      </div>
      <div style={{ width: 308, height: 2, background: gold, marginTop: 14 }} />
      <div
        style={{ fontFamily: "Arial, sans-serif", fontSize: 29, marginTop: 29 }}
      >
        BOTANICAL PERFUME
      </div>
      <div
        style={{ fontFamily: "Arial, sans-serif", fontSize: 22, marginTop: 26 }}
      >
        A QUIETER PRESENCE
      </div>
      <div
        style={{
          fontFamily: "Arial, sans-serif",
          fontSize: 20,
          color: gold,
          marginTop: 139,
        }}
      >
        DESIGN STUDY&nbsp;&nbsp;/&nbsp;&nbsp;50 ML
      </div>
    </div>
  );
};

const portraitText = (frame: number) => {
  if (frame < 48) {
    return (
      <div
        style={{
          position: "absolute",
          left: 64,
          right: 64,
          top: 146,
          textAlign: "center",
          opacity: fade(frame, 0, 12, 39, 47),
          color: ivory,
        }}
      >
        <div style={{ fontFamily: "Georgia, serif", fontSize: 64 }}>
          FORM 01
        </div>
        <div
          style={{
            height: 2,
            width: 250,
            background: gold,
            margin: "18px auto",
          }}
        />
        <div style={{ fontFamily: "Arial, sans-serif", fontSize: 28 }}>
          A QUIETER PRESENCE
        </div>
      </div>
    );
  }
  if (frame < 72) {
    return (
      <div
        style={{
          position: "absolute",
          left: 72,
          right: 72,
          top: 135,
          textAlign: "center",
          opacity: fade(frame, 48, 53, 63, 71),
          color: ivory,
          fontFamily: "Arial, sans-serif",
          fontSize: 32,
        }}
      >
        <div>DETAIL IN</div>
        <div style={{ marginTop: 5 }}>EVERY SURFACE</div>
        <div
          style={{
            height: 2,
            width: 230,
            background: gold,
            margin: "21px auto",
          }}
        />
      </div>
    );
  }
  return (
    <div
      style={{
        position: "absolute",
        left: 48,
        right: 48,
        top: 111,
        textAlign: "center",
        opacity: interpolate(frame, [72, 86], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
        color: ivory,
      }}
    >
      <div
        style={{ fontFamily: "Arial, sans-serif", fontSize: 25, color: gold }}
      >
        A DESIGN STUDY
      </div>
      <div
        style={{ fontFamily: "Georgia, serif", fontSize: 76, marginTop: 35 }}
      >
        FORM 01
      </div>
      <div
        style={{
          height: 2,
          width: 280,
          background: gold,
          margin: "17px auto 0",
        }}
      />
      <div
        style={{ fontFamily: "Arial, sans-serif", fontSize: 29, marginTop: 23 }}
      >
        BOTANICAL PERFUME
      </div>
      <div
        style={{
          fontFamily: "Arial, sans-serif",
          fontSize: 23,
          color: gold,
          marginTop: 810,
        }}
      >
        DESIGN STUDY&nbsp;&nbsp;/&nbsp;&nbsp;50 ML
      </div>
    </div>
  );
};

export const Form01 = ({ aspect }: Props) => {
  const frame = useCurrentFrame();
  const frameNumber = String(Math.min(frame + 1, 72)).padStart(4, "0");
  const src =
    frame < 72
      ? staticFile(`form01/${aspect}/frames/frame_${frameNumber}.png`)
      : staticFile(`form01/${aspect}/endcard_product.png`);
  const exitOpacity = interpolate(frame, [132, 143], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <AbsoluteFill style={{ opacity: exitOpacity }}>
        <Img
          src={src}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
        {aspect === "landscape" ? landscapeText(frame) : portraitText(frame)}
      </AbsoluteFill>
      <Audio
        src={staticFile("form01/original_audio.wav")}
        durationInFrames={144}
      />
    </AbsoluteFill>
  );
};
