import { layoutFor } from "../aspect-layout.js";
import { clamp01, easeOutCubic } from "../easing.js";
import type {
  FrameContext,
  SceneComponent,
  SceneSpecLike,
} from "../registry.js";
import { fitWrappedText, isPortrait, safeFrame } from "../safe-layout.js";
import type { SvgNode } from "../svg.js";
import { emUnits, fitFontSize } from "../text-width.js";

// 文字动画组件 v1：标题 + 可选副标题，fade-up / scale-in 两种入场。
// 组件契约：render(spec, ctx) 纯函数；时间 tMs = frame/fps*1000；禁墙钟/未播种随机/网络。

type TextAnimationParams = {
  title: string;
  subtitle?: string;
  titleColor: string;
  subtitleColor: string;
  entrance: "fade-up" | "scale-in";
  enterMs: number; // 200..3000
};

// 每画幅版式覆写（2026-10-23 brief §三B）：titleLines 显式换行（拼接与标题
// 一致，空白不敏感——换行是排版决定，不是改文案）、titleScale 0.5..1.3、
// verticalOffset -0.25..0.25（块中心相对画布中心的平移比例，正 = 下移）。
type TextLayoutOverride = {
  titleLines?: string[];
  titleScale?: number;
  verticalOffset?: number;
};

const TEXT_LAYOUT_KEYS = [
  "titleLines",
  "titleScale",
  "verticalOffset",
] as const;

function stripWhitespace(text: string): string {
  return text.replace(/\s+/g, "");
}

function validateLayout(aspectValue: unknown, params: unknown): void {
  if (!isRecord(aspectValue))
    throw new Error("text-animation layout 覆写必须是对象");
  for (const key of Object.keys(aspectValue)) {
    if (!(TEXT_LAYOUT_KEYS as readonly string[]).includes(key)) {
      throw new Error(
        `text-animation layout 不支持 ${key}（允许 ${TEXT_LAYOUT_KEYS.join("/")}）`,
      );
    }
  }
  if (aspectValue.titleLines !== undefined) {
    const lines = aspectValue.titleLines;
    if (!Array.isArray(lines) || lines.length < 1 || lines.length > 4) {
      throw new Error("text-animation layout.titleLines 必须是 1..4 行");
    }
    lines.forEach((line, index) => {
      if (
        typeof line !== "string" ||
        line.trim().length === 0 ||
        line.trim().length > 80
      ) {
        throw new Error(
          `text-animation layout.titleLines[${index}] 必须是 1..80 个非空白字符`,
        );
      }
    });
    const title =
      isRecord(params) && typeof params.title === "string" ? params.title : "";
    if (
      lines.map((line) => stripWhitespace(String(line))).join("") !==
      stripWhitespace(title)
    ) {
      throw new Error(
        "text-animation layout.titleLines 拼接须与标题一致（空白不敏感）",
      );
    }
  }
  if (aspectValue.titleScale !== undefined) {
    const scale = aspectValue.titleScale;
    if (
      typeof scale !== "number" ||
      !Number.isFinite(scale) ||
      scale < 0.5 ||
      scale > 1.3
    ) {
      throw new Error("text-animation layout.titleScale 必须是 0.5..1.3 的数");
    }
  }
  if (aspectValue.verticalOffset !== undefined) {
    const offset = aspectValue.verticalOffset;
    if (
      typeof offset !== "number" ||
      !Number.isFinite(offset) ||
      offset < -0.25 ||
      offset > 0.25
    ) {
      throw new Error(
        "text-animation layout.verticalOffset 必须是 -0.25..0.25 的数",
      );
    }
  }
}

// 标题行 + 字号：无覆写 = 既有自动口径逐字节不变；有覆写时 titleLines
// 替换行表、titleScale 缩放，最后统一按最宽行钳到 maxWidth——缩放永不
// 撑破安全文字宽（brief §三B「受控范围内调整字号」）。
function resolveTitle(
  title: string,
  preferredSize: number,
  maxWidth: number,
  maxLines: number,
  override: TextLayoutOverride | undefined,
): { lines: string[]; fontSize: number } {
  const auto = fitWrappedText(title, preferredSize, maxWidth, maxLines);
  if (!override) return auto;
  const lines = override.titleLines ?? auto.lines;
  const widest = Math.max(...lines.map((line) => emUnits(line) || 1));
  const fit = maxWidth / widest;
  let fontSize = Math.min(
    override.titleLines ? preferredSize : auto.fontSize,
    fit,
  );
  if (override.titleScale)
    fontSize = Math.min(fontSize * override.titleScale, fit);
  return { lines, fontSize };
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const SUBTITLE_DELAY_MS = 400;
// 文本行两侧留白：字号钳制后行宽 ≤ 画布宽 × 该系数。
const TEXT_SAFE_WIDTH = 0.78;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function validateParams(value: unknown): TextAnimationParams {
  if (!isRecord(value)) throw new Error("text-animation params 必须是对象");
  if (
    typeof value.title !== "string" ||
    value.title.length < 1 ||
    value.title.length > 80
  ) {
    throw new Error("text-animation params.title 必须是 1..80 字符");
  }
  if (
    value.subtitle !== undefined &&
    (typeof value.subtitle !== "string" || value.subtitle.length > 80)
  ) {
    throw new Error("text-animation params.subtitle 必须是至多 80 字符");
  }
  if (!isHexColor(value.titleColor))
    throw new Error("text-animation params.titleColor 必须是 #rrggbb");
  if (!isHexColor(value.subtitleColor))
    throw new Error("text-animation params.subtitleColor 必须是 #rrggbb");
  if (value.entrance !== "fade-up" && value.entrance !== "scale-in") {
    throw new Error(
      'text-animation params.entrance 必须是 "fade-up" | "scale-in"',
    );
  }
  if (
    !Number.isInteger(value.enterMs) ||
    (value.enterMs as number) < 200 ||
    (value.enterMs as number) > 3000
  ) {
    throw new Error("text-animation params.enterMs 必须是 200..3000 的整数");
  }
  return value as TextAnimationParams;
}

function entranceTransform(
  entrance: TextAnimationParams["entrance"],
  progress: number,
  height: number,
  cx: number,
  cy: number,
): string {
  if (entrance === "fade-up") {
    // translateY 40→0px，按 height/720 等比缩放
    const offsetPx = 40 * (1 - progress) * (height / 720);
    return `translate(0 ${offsetPx.toFixed(3)})`;
  }
  // scale-in：绕文本中心 0.8→1
  const s = 0.8 + 0.2 * progress;
  return `translate(${cx} ${cy}) scale(${s.toFixed(4)}) translate(${-cx} ${-cy})`;
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const params = spec.params as TextAnimationParams;
  const tMs = (ctx.frame / ctx.fps) * 1000;
  const titleProgress = easeOutCubic(clamp01(tMs / params.enterMs));
  const subtitleProgress = easeOutCubic(
    clamp01((tMs - SUBTITLE_DELAY_MS) / params.enterMs),
  );
  if (isPortrait(ctx)) {
    const override = layoutFor(spec, ctx) as TextLayoutOverride | undefined;
    const safe = safeFrame(ctx);
    const title = resolveTitle(
      params.title,
      Math.min(ctx.width * 0.1, ctx.height / 12),
      safe.textWidth,
      2,
      override,
    );
    const subtitle = params.subtitle
      ? fitWrappedText(
          params.subtitle,
          Math.min(ctx.width * 0.055, ctx.height / 20),
          safe.textWidth,
          3,
        )
      : null;
    const titleStep = title.fontSize * 1.2;
    const subtitleStep = subtitle ? subtitle.fontSize * 1.3 : 0;
    const gap = subtitle ? Math.max(32, title.fontSize * 0.55) : 0;
    const blockHeight =
      title.lines.length * titleStep +
      gap +
      (subtitle?.lines.length ?? 0) * subtitleStep;
    const top =
      ctx.height / 2 -
      blockHeight / 2 +
      (override?.verticalOffset ?? 0) * ctx.height;
    const texts: SvgNode[] = [
      ...title.lines.map((line, index): SvgNode => {
        const y = top + titleStep * (index + 0.5);
        return {
          tag: "text",
          attrs: {
            x: ctx.width / 2,
            y,
            "font-size": title.fontSize,
            fill: params.titleColor,
            "text-anchor": "middle",
            "dominant-baseline": "middle",
            opacity: titleProgress,
            transform: entranceTransform(
              params.entrance,
              titleProgress,
              ctx.height,
              ctx.width / 2,
              y,
            ),
          },
          text: line,
        };
      }),
      ...(subtitle?.lines ?? []).map((line, index): SvgNode => {
        const y =
          top +
          title.lines.length * titleStep +
          gap +
          subtitleStep * (index + 0.5);
        return {
          tag: "text",
          attrs: {
            x: ctx.width / 2,
            y,
            "font-size": subtitle!.fontSize,
            fill: params.subtitleColor,
            "text-anchor": "middle",
            "dominant-baseline": "middle",
            opacity: subtitleProgress,
            transform: entranceTransform(
              params.entrance,
              subtitleProgress,
              ctx.height,
              ctx.width / 2,
              y,
            ),
          },
          text: line,
        };
      }),
    ];
    return {
      tag: "g",
      attrs: {},
      children: [
        {
          tag: "rect",
          attrs: {
            x: 0,
            y: 0,
            width: ctx.width,
            height: ctx.height,
            fill: spec.background,
          },
        },
        ...texts,
      ],
    };
  }
  // —— 横版：无覆写 = 既有单行口径逐字节不变；有覆写 = 多行块组装 ——
  const override = layoutFor(spec, ctx) as TextLayoutOverride | undefined;
  const texts: SvgNode[] = [];
  if (!override) {
    // 字号按高度推，再按文本行宽钳制（竖版画布 height 大 width 小，长标题会横向溢出裁切）
    const titleSize = fitFontSize(
      ctx.height / 8,
      params.title,
      ctx.width * TEXT_SAFE_WIDTH,
    );
    const subtitleSize = fitFontSize(
      ctx.height / 14,
      params.subtitle ?? "",
      ctx.width * TEXT_SAFE_WIDTH,
    );
    // Both lines use middle baselines. Their center distance is half the sum of
    // font sizes plus a gap, so portrait widths can shrink either font without
    // making the two lines collide.
    const gap = params.subtitle ? Math.max(20, titleSize * 0.18) : 0;
    const titleY =
      ctx.height / 2 - (params.subtitle ? (subtitleSize + gap) / 2 : 0);
    const subtitleY = ctx.height / 2 + (titleSize + gap) / 2;

    texts.push({
      tag: "text",
      attrs: {
        x: ctx.width / 2,
        y: titleY,
        "font-size": titleSize,
        fill: params.titleColor,
        "text-anchor": "middle",
        "dominant-baseline": "middle",
        opacity: titleProgress,
        transform: entranceTransform(
          params.entrance,
          titleProgress,
          ctx.height,
          ctx.width / 2,
          titleY,
        ),
      },
      text: params.title,
    });
    if (params.subtitle) {
      texts.push({
        tag: "text",
        attrs: {
          x: ctx.width / 2,
          y: subtitleY,
          "font-size": subtitleSize,
          fill: params.subtitleColor,
          "text-anchor": "middle",
          "dominant-baseline": "middle",
          opacity: subtitleProgress,
          transform: entranceTransform(
            params.entrance,
            subtitleProgress,
            ctx.height,
            ctx.width / 2,
            subtitleY,
          ),
        },
        text: params.subtitle,
      });
    }
  } else {
    // 覆写块：行表（titleLines 或自动单行）、字号（含 scale + 宽钳）、
    // 块中心 = 画布中心 + verticalOffset×height；副标题挂在块下方。
    const baseSize = fitFontSize(
      ctx.height / 8,
      params.title,
      ctx.width * TEXT_SAFE_WIDTH,
    );
    const lines = override.titleLines ?? [params.title];
    const widest = Math.max(...lines.map((line) => emUnits(line) || 1));
    const fit = (ctx.width * TEXT_SAFE_WIDTH) / widest;
    let titleSize = Math.min(
      override.titleLines ? ctx.height / 8 : baseSize,
      fit,
    );
    if (override.titleScale)
      titleSize = Math.min(titleSize * override.titleScale, fit);
    const subtitleSize = fitFontSize(
      ctx.height / 14,
      params.subtitle ?? "",
      ctx.width * TEXT_SAFE_WIDTH,
    );
    const titleStep = titleSize * 1.2;
    const gap = params.subtitle ? Math.max(20, titleSize * 0.18) : 0;
    const blockHeight =
      lines.length * titleStep + gap + (params.subtitle ? subtitleSize : 0);
    const centerY =
      ctx.height / 2 + (override.verticalOffset ?? 0) * ctx.height;
    lines.forEach((line, index) => {
      const y = centerY - blockHeight / 2 + titleStep * (index + 0.5);
      texts.push({
        tag: "text",
        attrs: {
          x: ctx.width / 2,
          y,
          "font-size": titleSize,
          fill: params.titleColor,
          "text-anchor": "middle",
          "dominant-baseline": "middle",
          opacity: titleProgress,
          transform: entranceTransform(
            params.entrance,
            titleProgress,
            ctx.height,
            ctx.width / 2,
            y,
          ),
        },
        text: line,
      });
    });
    if (params.subtitle) {
      const y =
        centerY -
        blockHeight / 2 +
        lines.length * titleStep +
        gap +
        subtitleSize / 2;
      texts.push({
        tag: "text",
        attrs: {
          x: ctx.width / 2,
          y,
          "font-size": subtitleSize,
          fill: params.subtitleColor,
          "text-anchor": "middle",
          "dominant-baseline": "middle",
          opacity: subtitleProgress,
          transform: entranceTransform(
            params.entrance,
            subtitleProgress,
            ctx.height,
            ctx.width / 2,
            y,
          ),
        },
        text: params.subtitle,
      });
    }
  }

  return {
    tag: "g",
    attrs: {},
    children: [
      {
        tag: "rect",
        attrs: {
          x: 0,
          y: 0,
          width: ctx.width,
          height: ctx.height,
          fill: spec.background,
        },
      },
      ...texts,
    ],
  };
}

export const textAnimation: SceneComponent = {
  componentId: "text-animation",
  version: 1,
  validateParams,
  validateLayout,
  render,
};
