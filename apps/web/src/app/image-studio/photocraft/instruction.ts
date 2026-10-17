/** Subject-level targets work on any image: the provider subject mask selects them. */
import {
  adjustDirectionFromText,
  degreeAmountFromText,
  degreeAmounts,
  strategyFor,
} from "./default-strategy";
import {
  stepAcceptsProtect,
  validateOperationSequence,
} from "./operation-constraints";

export type PhotoCraftSubjectTarget = "subject" | "background";

export type PhotoCraftInstructionPlan = (
  | {
      operation: "recolor";
      color: "black" | "red" | "blue" | "green" | "gray";
      target: "hat" | "brim" | "selected-area" | PhotoCraftSubjectTarget;
      protectLabel: boolean;
      // M3 protect 清单 grounding：原话里的保护名词（天空/水面…），交给
      // 提议-确认环圈出保护框；标签/商标仍走手画保护框（无 phrase）。
      protectPhrase?: string;
    }
  | {
      operation: "adjust";
      adjustment:
        | "brightness"
        | "contrast"
        | "saturation"
        | "exposure"
        | "vibrance"
        | "shadows"
        | "highlights";
      amount: number;
      target:
        | "hat"
        | "brim"
        | "selected-area"
        | "whole-image"
        | PhotoCraftSubjectTarget;
      protectLabel: boolean;
      protectPhrase?: string;
    }
  | {
      operation: "crop";
      target: "selected-area";
      protectLabel: false;
      square?: boolean;
    }
  | {
      operation: "heal";
      target: "selected-area";
      protectLabel: false;
    }
  | {
      operation: "text";
      target: "selected-area";
      protectLabel: false;
      text: string;
      size: number;
      color: string;
    }
  | {
      operation: "canvas-size";
      target: "whole-image";
      protectLabel: false;
      width: number;
      height: number;
    }
  | {
      operation: "image-size";
      target: "whole-image";
      protectLabel: false;
      width: number;
      height: number;
    }
  | {
      operation: "orient";
      target: "whole-image";
      protectLabel: false;
      mode:
        | "rotate-cw"
        | "rotate-ccw"
        | "rotate-180"
        | "flip-horizontal"
        | "flip-vertical";
    }
  | {
      operation: "layer-action";
      target: "whole-image";
      protectLabel: false;
      action: "duplicate" | "hide" | "show";
    }
  | {
      operation: "levels";
      target: "whole-image";
      protectLabel: false;
      inBlack: number;
      inWhite: number;
      gamma: number;
    }
  | {
      operation: "text-style";
      target: "whole-image";
      protectLabel: false;
      weight?: 400 | 700;
      underline?: boolean;
    }
  | {
      operation: "drop-shadow";
      target: "whole-image";
      protectLabel: false;
      distance: number;
      size: number;
      opacity: number;
    }
) & { expectedLayerId?: number };

const colors = {
  黑色: "black",
  红色: "red",
  蓝色: "blue",
  绿色: "green",
  灰色: "gray",
} as const;
const targets = {
  帽子: "hat",
  帽身: "hat",
  帽沿: "brim",
  选区: "selected-area",
  区域: "selected-area",
  耳朵: "selected-area",
  猫耳: "selected-area",
  左耳: "selected-area",
  右耳: "selected-area",
  主体: "subject",
  前景: "subject",
  商品: "subject",
  产品: "subject",
  背景: "background",
  图片: "whole-image",
  照片: "whole-image",
  画面: "whole-image",
  图像: "whole-image",
  全图: "whole-image",
  整体: "whole-image",
  整张图: "whole-image",
  整张照片: "whole-image",
  整张图片: "whole-image",
  整个画面: "whole-image",
  // M4 口语扩容：整幅× 措辞与整张× 同义，快车道不再因措辞差异落到句式引导。
  整幅图片: "whole-image",
  整幅画面: "whole-image",
  整幅图: "whole-image",
} as const;

function orientationFromText(
  text: string,
): Extract<PhotoCraftInstructionPlan, { operation: "orient" }>["mode"] | null {
  const clean = text.replace(/\s+/g, "").replace(/[。！!]$/u, "");
  // M4 口语扩容：方向词自带整图语义，允许省略「图片/照片」主语
  // （顺时针旋转 / 旋转180度 / 水平翻转）；局部目标（背景/帽子…）仍拒绝。
  const match = clean.match(
    /^(?:请)?(?:把|将|让)?(?:这|这一?个|这张)?(?:整张|整个|整幅|全图)?(?:图片|照片|图像|画面)?(?:整体)?(顺时针(?:旋转|转)(?:90度|九十度|一下)?|逆时针(?:旋转|转)(?:90度|九十度|一下)?|(?:旋转|转)180度|水平翻转|垂直翻转)$/u,
  );
  if (match) {
    const word = match[1] ?? "";
    if (word.startsWith("顺")) return "rotate-cw";
    if (word.startsWith("逆")) return "rotate-ccw";
    if (word.includes("180")) return "rotate-180";
    if (word.startsWith("水平")) return "flip-horizontal";
    return "flip-vertical";
  }
  // M2 默认策略表：「旋转一下/转一下」没说明方向 → 顺时针 90 度（默认可
  // 一步撤销）；「旋转90度」同样未说明方向，按表默认顺时针。只接受整图
  // 措辞；带局部目标（背景/帽子…）的旋转依然拒绝。
  if (
    /^(?:请)?(?:把|将|让)?(?:这|这一?个|这张)?(?:整张|整个|整幅|全图)?(?:图片|照片|图像|画面|整张图?)?(?:旋转|转)(?:一下|90度)?$/.test(
      clean,
    )
  )
    return "rotate-cw";
  return null;
}

function layerActionFromText(
  text: string,
): "duplicate" | "hide" | "show" | null {
  const verb = text
    .replace(/\s+/g, "")
    .match(/^(?:请)?(复制|隐藏|显示)(?:当前|选中的)?图层[。！!]?$/u)?.[1];
  return verb
    ? ({ 复制: "duplicate", 隐藏: "hide", 显示: "show" } as const)[
        verb as "复制"
      ]
    : null;
}

/**
 * M4：保护要求的唯一截尾解析点。快车道、模型对账（reconcile）与独立法官
 * （validate）共用，杜绝三处正则漂移导致的静默丢保护——此前「并保留标签」
 * （无逗号）、「保护标签」「保持Logo」等措辞在部分通道被剥离却未被识别。
 * 标签/商标/Logo/文字 归手画保护框（label），其余名词交提议-确认环（phrase）。
 */
export function protectTailOf(clean: string): {
  label: boolean;
  phrase?: string;
} | null {
  const match = clean.match(
    /，?(?:并|再)?(?:保留|不要改变|保护|不要动|别动|保持)([一-鿿]{1,8}|Logo|LOGO)$|，?([一-鿿]{1,8}|Logo|LOGO)(?:不要变|保持不变|不要动)$/u,
  );
  const noun = match ? (match[1] ?? match[2]) : undefined;
  if (!noun) return null;
  if (/^(?:标签|商标|Logo|LOGO|文字)$/.test(noun)) return { label: true };
  return { label: false, phrase: noun };
}

/** 模型通道的 protectPhrase 归一化：1-8 个汉字名词；标签/商标归标签流程。 */
function normalizeModelProtectPhrase(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^[一-鿿]{1,8}$/u.test(trimmed) || /^(?:标签|商标)$/.test(trimmed))
    throw new Error("模型返回的保护范围无效");
  return trimmed;
}

export function planPhotoCraftInstruction(
  instruction: string,
): PhotoCraftInstructionPlan | null {
  const clean = instruction.trim().replace(/[。！!\s]+$/g, "");
  // M3 protect 清单 + M4 统一截尾解析（protectTailOf）：保护名词（保护
  // 天空/水面不要动）随计划下发，由提议-确认环圈出保护框；标签/商标/Logo
  // 保持手画流程。解析、剥离、对账、法官共用一处，杜绝通道间正则漂移。
  const protectTail = protectTailOf(clean);
  const protectedLabel = protectTail?.label === true;
  const protectPhrase = protectTail?.phrase;
  // 带保护要求的指令只有能挂保护框的局部步骤可承接；其余操作照旧不解析。
  const hasProtect = protectTail !== null;
  // 先剥带连接词的清单式（并保留天空/，标签不要变），再剥标签式——顺序
  // 反了会把「并保留标签」剥成残留的「并」，让核心句解析失败。
  const core = clean.replace(
    /，?(?:并|再)?(?:保留|不要改变|保护|不要动|别动|保持)(?:[一-鿿]{1,8}|Logo|LOGO)$|，?(?:[一-鿿]{1,8}|Logo|LOGO)(?:不要变|保持不变|不要动)$/u,
    "",
  );
  const orientation = orientationFromText(core);
  if (orientation && !hasProtect)
    return {
      operation: "orient",
      target: "whole-image",
      protectLabel: false,
      mode: orientation,
    };
  const layerAction = layerActionFromText(core);
  if (layerAction && !hasProtect)
    return {
      operation: "layer-action",
      target: "whole-image",
      protectLabel: false,
      action: layerAction,
    };
  const shadowMatch = core.match(
    /^(?:请)?(?:给|为)(?:当前|选中(?:的)?)(?:文字|商品|图层)(?:图层)?添加投影[，,]?距离(\d{1,3})像素[，,]?大小(\d{1,3})像素[，,]?不透明度(\d{1,3})%$/u,
  );
  if (shadowMatch && !hasProtect) {
    const distance = Number(shadowMatch[1]);
    const size = Number(shadowMatch[2]);
    const opacity = Number(shadowMatch[3]);
    if (distance > 100 || size > 100 || opacity < 1 || opacity > 100)
      return null;
    return {
      operation: "drop-shadow",
      target: "whole-image",
      protectLabel: false,
      distance,
      size,
      opacity,
    };
  }
  const styleSetMatch = core.match(
    /^(?:请)?(?:把|将)?当前文字(?:图层)?(?:设为|改为)(粗体|常规)(?:并(加上|去掉)下划线)?$/u,
  );
  // M4 口语扩容：动词式文字样式（把当前文字图层加粗/加下划线）与「设为
  // 粗体」同义；只改用户点名的属性，未提及的字样不下发。
  const styleVerbMatch = core.match(
    /^(?:请)?(?:把|将|给)?当前文字图层?(加粗|取消加粗|设为常规|改为常规|加上下划线|加下划线|添加下划线|去掉下划线|取消下划线|移除下划线)$/u,
  );
  if ((styleSetMatch || styleVerbMatch) && !hasProtect) {
    const verb = styleVerbMatch?.[1] ?? "";
    const weight = styleSetMatch
      ? styleSetMatch[1] === "粗体"
        ? 700
        : 400
      : verb === "加粗"
        ? 700
        : /^(?:取消加粗|设为常规|改为常规)$/.test(verb)
          ? 400
          : undefined;
    const underline = styleSetMatch
      ? styleSetMatch[2]
        ? styleSetMatch[2] === "加上"
        : undefined
      : /^(?:加上?|添加)下划线$/.test(verb)
        ? true
        : /^(?:去掉|取消|移除)下划线$/.test(verb)
          ? false
          : undefined;
    return {
      operation: "text-style",
      target: "whole-image",
      protectLabel: false,
      ...(weight !== undefined ? { weight } : {}),
      ...(underline !== undefined ? { underline } : {}),
    };
  }
  const imageSizeMatch = core.match(
    /^(?:请)?(?:把|将)?(?:图片|照片|图像)(?:的)?(?:尺寸|大小)?(?:调整为|改成|改为|设为|设置为|重采样为|重采样到|缩放为|缩放到)(\d{1,4})\s*[×xX*＊]\s*(\d{1,4})(?:像素)?$/u,
  );
  if (imageSizeMatch && !hasProtect) {
    const width = Number(imageSizeMatch[1]);
    const height = Number(imageSizeMatch[2]);
    if (
      width < 1 ||
      height < 1 ||
      width > 4096 ||
      height > 4096 ||
      width * height > 16_000_000
    )
      return null;
    return {
      operation: "image-size",
      target: "whole-image",
      protectLabel: false,
      width,
      height,
    };
  }
  const levelsMatch = core.match(
    /^(?:请)?(?:把|将)?(?:整图|全图|整张图|整幅图|图片|照片)?(?:的)?色阶(?:设为|调整为|改为)黑场(\d{1,3})\s*[,，、]?\s*白场(\d{1,3})(?:\s*[,，、]?\s*伽马(\d(?:\.\d{1,2})?))?$/u,
  );
  if (levelsMatch && !hasProtect) {
    const inBlack = Number(levelsMatch[1]);
    const inWhite = Number(levelsMatch[2]);
    const gamma = levelsMatch[3] ? Number(levelsMatch[3]) : 1;
    if (
      inBlack < 0 ||
      inWhite > 255 ||
      inBlack >= inWhite ||
      gamma < 0.1 ||
      gamma > 5
    )
      return null;
    return {
      operation: "levels",
      target: "whole-image",
      protectLabel: false,
      inBlack,
      inWhite,
      gamma,
    };
  }
  const canvasMatch = core.match(
    /^(?:请)?(?:把|将)?(?:图片|照片|画面|图像)?(?:的)?画布(?:尺寸)?(?:扩展(?:为|到)?|改成|改为|调整为|设为|设置为)(\d{1,4})\s*[×xX*＊]\s*(\d{1,4})(?:像素)?$/u,
  );
  if (canvasMatch && !hasProtect) {
    const width = Number(canvasMatch[1]);
    const height = Number(canvasMatch[2]);
    if (width < 1 || height < 1 || width > 8192 || height > 8192) return null;
    return {
      operation: "canvas-size",
      target: "whole-image",
      protectLabel: false,
      width,
      height,
    };
  }
  // M4 口语扩容：未加引号的「加上文字HELLO/添加文字SALE」也解析——仅限
  // 「文字/文本」标记后紧跟的短内容（≤20 字符），引号形式保持原快照。
  const textMatch =
    core.match(
      /^(?:请)?(?:在(?:图片|照片|画面)上)?(?:添加|加上|写上|加入)(?:文字|文本)?[「“"](.{1,80})[」”"](?:(?:，|,)?(?:字号|大小)(\d{1,3}))?(?:(?:，|,)?(黑色|白色|红色))?$/u,
    ) ??
    core.match(
      /^(?:请)?(?:在(?:图片|照片|画面)上)?(?:添加|加上|写上|加入)文字([A-Za-z0-9一-鿿][A-Za-z0-9一-鿿 ]{0,19})$/u,
    );
  if (textMatch?.[1] && !hasProtect) {
    const size = textMatch[2] ? Number(textMatch[2]) : 48;
    if (size < 8 || size > 160) return null;
    return {
      operation: "text",
      target: "selected-area",
      protectLabel: false,
      text: textMatch[1],
      size,
      color:
        (
          { 黑色: "#111111", 白色: "#ffffff", 红色: "#cc2020" } as Record<
            string,
            string
          >
        )[textMatch[3] ?? "黑色"] ?? "#111111",
    };
  }
  if (
    !hasProtect &&
    /^(?:(?:把|将)?(?:图片|照片|画面|图像)?)(?:裁成|裁为|裁剪成|裁剪为)(?:正方形|方图|1:1)$/u.test(
      core,
    )
  )
    return {
      operation: "crop",
      target: "selected-area",
      protectLabel: false,
      square: true,
    };
  if (
    !hasProtect &&
    /^(?:请帮我|帮我|请)?(?:把|将)?(?:这张)?(?:图片|照片|画面|图像)?(?:裁剪|剪裁|裁切)(?:到|为)?(?:选区|画框|框选区域|所选区域)$/u.test(
      core,
    )
  )
    return { operation: "crop", target: "selected-area", protectLabel: false };
  if (
    !hasProtect &&
    (/^(?:请帮我|帮我|请)?(?:把|将)?(?:这个|这处|选中的|点击的)?(?:污点|瑕疵|小斑点|痘印)(?:去掉|去除|清除|修复)$/u.test(
      core,
    ) ||
      /^(?:请帮我|帮我|请)?(?:去掉|去除|清除|修复)(?:这个|这处|选中的|点击的)?(?:污点|瑕疵|小斑点|痘印)$/u.test(
        core,
      ))
  )
    return { operation: "heal", target: "selected-area", protectLabel: false };
  const match = core.match(
    /^(?:请帮我|帮我|请)?(?:把|将)?(?:这顶|这个|这张)?(帽子|帽身|帽沿|选区|区域|耳朵|猫耳|左耳|右耳|主体|前景|商品|产品|背景)(?:的)?(?:面料|毛发|颜色|色彩)?(?:(?:换成|改成|改为|调成|调整为|变成|涂成)|(?:换个?颜色|换个?色|变个?颜色|换色)[，,。]?(?:再|然后)?(?:换成|改成|改为|调成|变成|涂成))(黑色|红色|蓝色|绿色|灰色)$/,
  );
  if (match)
    return {
      operation: "recolor",
      color: colors[match[2] as keyof typeof colors],
      target: targets[match[1] as keyof typeof targets] as
        | "hat"
        | "brim"
        | "selected-area"
        | "subject"
        | "background",
      protectLabel: protectedLabel || Boolean(protectPhrase),
      ...(protectPhrase ? { protectPhrase } : {}),
    };
  if (
    /^(?:请)?(?:只)?(?:把|将)(?:画面|图片|照片)?(?:右侧|左侧|右边|左边)?(?:的)?(?:猫的)?(?:左耳|右耳|耳朵|猫耳)(?:的)?(?:橙色)?(?:毛发|颜色)?(?:换成|改成|改为|调成|变成)灰色$/.test(
      core,
    )
  )
    return {
      operation: "recolor",
      color: "gray",
      target: "selected-area",
      protectLabel: protectedLabel || Boolean(protectPhrase),
      ...(protectPhrase ? { protectPhrase } : {}),
    };
  const numeric = core.match(
    /^(?:请帮我|帮我|请)?(?:把|将|让)?(?:这顶|这个|这张)?(帽子|帽身|帽沿|选区|区域|整张图片|整张照片|整个画面|整幅图片|整幅画面|整幅图|图片|照片|画面|图像|全图|整体|整张图|主体|前景|商品|产品|背景)(?!的?(?:主体|前景|商品|产品|背景))(?:的)?(亮度|对比度|饱和度|曝光|自然饱和度|暗部|高光)(提高|降低|增加|减少)([1-5]?\d)$/,
  );
  if (
    numeric &&
    Number(numeric[4]) >= 1 &&
    Number(numeric[4]) <= 50 &&
    !(
      targets[numeric[1] as keyof typeof targets] === "whole-image" &&
      hasProtect
    )
  )
    return {
      operation: "adjust",
      adjustment: (
        {
          亮度: "brightness",
          对比度: "contrast",
          饱和度: "saturation",
          曝光: "exposure",
          自然饱和度: "vibrance",
          暗部: "shadows",
          高光: "highlights",
        } as const
      )[
        numeric[2] as
          | "亮度"
          | "对比度"
          | "饱和度"
          | "曝光"
          | "自然饱和度"
          | "暗部"
          | "高光"
      ],
      amount:
        Number(numeric[4]) *
        (["提高", "增加"].includes(numeric[3] ?? "") ? 1 : -1),
      target: targets[numeric[1] as keyof typeof targets],
      protectLabel: protectedLabel || Boolean(protectPhrase),
      ...(protectPhrase ? { protectPhrase } : {}),
    };
  const tonal = core.match(
    /^(?:请帮我|帮我|请)?(?:把|将)?(?:整张图|整幅图|整幅画面|图片|照片|画面|图像|全图)?(?:的)?(暗部|高光)(提高|降低|增加|减少|提亮|调亮|压低|调低)([1-5]?\d)$/,
  );
  if (tonal && Number(tonal[3]) >= 1 && Number(tonal[3]) <= 50)
    return {
      operation: "adjust",
      adjustment: tonal[1] === "暗部" ? "shadows" : "highlights",
      amount:
        Number(tonal[3]) *
        (["提高", "增加", "提亮", "调亮"].includes(tonal[2] ?? "") ? 1 : -1),
      target: "whole-image",
      protectLabel: false,
    };
  const light = core.match(
    /^(?:请帮我|帮我|请)?(?:把|将|让)?(?:这顶|这个|这张)?(帽子|帽身|帽沿|选区|区域|整张图片|整张照片|整个画面|整幅图片|整幅画面|整幅图|图片|照片|画面|图像|全图|整体|整张图|主体|前景|商品|产品|背景)(?!的?(?:主体|前景|商品|产品|背景))(?:的)?(稍微|明显)?(提亮|调亮|变亮|亮|调暗|变暗|暗)(一点|一些|起来|下去)?$/,
  );
  if (
    light &&
    // M2 默认策略表：未说明幅度不再要求程度词，直接按「一点=10、明显=25」
    // 补默认值出预览（§5 绝不向用户追问数字）。
    !(targets[light[1] as keyof typeof targets] === "whole-image" && hasProtect)
  )
    return {
      operation: "adjust",
      adjustment: "brightness",
      amount:
        (light[2] === "明显" ? degreeAmounts.obvious : degreeAmounts.slight) *
        (["调暗", "变暗", "暗"].includes(light[3] ?? "") ? -1 : 1),
      target: targets[light[1] as keyof typeof targets],
      protectLabel: protectedLabel || Boolean(protectPhrase),
      ...(protectPhrase ? { protectPhrase } : {}),
    };
  const vivid = core.match(
    /^(?:我想|我希望|希望)?(?:请帮我|帮我|请)?(?:把|将|让)?(?:这顶|这个|这张)?(帽子|帽身|帽沿|选区|区域|整张图片|整张照片|整个画面|整幅图片|整幅画面|整幅图|图片|照片|画面|图像|全图|整体|整张图|主体|前景|商品|产品|背景)(?:弄得|变得|调得)?更鲜艳(一点|一些)?$/,
  );
  if (
    vivid &&
    !(targets[vivid[1] as keyof typeof targets] === "whole-image" && hasProtect)
  )
    return {
      operation: "adjust",
      adjustment: "saturation",
      amount: degreeAmounts.slight,
      target: targets[vivid[1] as keyof typeof targets],
      protectLabel: protectedLabel || Boolean(protectPhrase),
      ...(protectPhrase ? { protectPhrase } : {}),
    };
  return null;
}

/** 读取计划上的保护名词（仅 recolor/adjust 携带；其余操作 undefined）。 */
export function protectPhraseOf(
  plan: PhotoCraftInstructionPlan,
): string | undefined {
  return (plan as { protectPhrase?: string }).protectPhrase;
}

/**
 * M3 protect 清单：识别一条独立的保护子句，返回标签（手画保护框）或
 * 任意名词（提议-确认环圈出）。非保护子句返回 null。
 */
function protectClauseNoun(
  raw: string,
): { label: boolean; phrase?: string } | null {
  const match =
    raw.match(/^(?:并|再)?(?:保留|不要改变|保护|不要动|别动)(.+)$/u) ??
    raw.match(/^(.+?)(?:不要变|保持不变|不要动)$/u);
  if (!match) return null;
  const noun = (match[1] ?? "").trim();
  if (!noun || noun.length > 8 || !/^[一-鿿]+$/u.test(noun)) return null;
  if (/^(?:标签|商标)$/.test(noun)) return { label: true };
  return { label: false, phrase: noun };
}

/** A sequence is accepted only when every requested action maps to a bounded PhotoCraft command. */
export function planPhotoCraftSequence(
  instruction: string,
): PhotoCraftInstructionPlan[] | null {
  const hasSequenceJoiner =
    /(?:然后|接着|随后|并且|再把|再将|并把|并将|并(?=裁))/u.test(instruction);
  if (
    !hasSequenceJoiner &&
    [
      "text",
      "canvas-size",
      "image-size",
      "orient",
      "layer-action",
      "levels",
      "text-style",
      "drop-shadow",
    ].includes(planPhotoCraftInstruction(instruction)?.operation ?? "")
  )
    return null;
  if (
    /(?:色阶|投影|阴影|画布|缩放|重采样|旋转|翻转|图层|字号|文字|图片尺寸|照片尺寸)/u.test(
      instruction,
    ) &&
    !hasSequenceJoiner
  )
    return null;
  const joined = instruction
    .trim()
    .replace(/[。！!]+$/g, "")
    .split(/(?:然后|接着|随后|并且|再把|再将|并把|并将|并(?=裁))/u);
  const clauses = joined
    .flatMap((part) =>
      planPhotoCraftInstruction(part.trim())
        ? [part]
        : part.split(/[,，、；;]/u),
    )
    .map((part) => part.trim().replace(/^[,，、；;]+|[,，、；;]+$/gu, ""))
    .filter(Boolean);
  if (clauses.length < 2) return null;
  if (
    clauses.length === 2 &&
    protectClauseNoun(clauses[1] ?? "") !== null &&
    !planPhotoCraftInstruction(clauses[0] ?? "")
  )
    return null;
  const steps: PhotoCraftInstructionPlan[] = [];
  let protectClauses = 0;
  for (const raw of clauses) {
    const protect = protectClauseNoun(raw);
    if (protect !== null) {
      const last = steps.at(-1);
      // protect 清单走约束表：只有仍持有局部选区语义的步骤能挂保护框。
      if (!last || !stepAcceptsProtect(last))
        throw new Error("标签保护要求必须紧跟局部编辑步骤");
      protectClauses += 1;
      steps[steps.length - 1] = {
        ...last,
        protectLabel: true,
        ...(protect.phrase ? { protectPhrase: protect.phrase } : {}),
      } as PhotoCraftInstructionPlan;
      continue;
    }
    const clause = raw
      .replace(/^(?:并|再)/u, "")
      .replace(/改(黑|红|蓝|绿|灰)(?!色)/u, "改成$1色");
    const step = planPhotoCraftInstruction(clause);
    if (!step) {
      if (/(?:去掉|删除|移除|擦除|抠图|重绘|生成|换材质)/u.test(raw))
        throw new Error(`无法完整执行「${raw}」；当前 PhotoCraft 工作流不支持`);
      return null;
    }
    steps.push(step);
  }
  // 单独一条编辑（无 protect 子句）不算复合序列；「编辑 + 保护」两条子句
  // 落成一个带保护框的步骤，是合法序列（单步无顺序约束可查）。
  if (steps.length === 1) {
    if (protectClauses === 0) return null;
    return steps;
  }
  // M3 约束表重构：步骤顺序与组合规则全部来自操作元数据表
  // （operation-constraints.ts），错误文案与旧手写约束逐字一致。
  validateOperationSequence(steps);
  return steps;
}

export function parsePhotoCraftModelPlan(
  value: unknown,
): PhotoCraftInstructionPlan {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("模型未返回有效的编辑计划");
  const raw = value as Record<string, unknown>;
  if (typeof raw.unsupported !== "string")
    throw new Error("模型未返回完整的编辑计划");
  if (
    typeof raw.unsupported === "string" &&
    raw.unsupported.trim() &&
    !["none", "无", "n/a"].includes(raw.unsupported.trim().toLowerCase())
  )
    throw new Error(raw.unsupported.slice(0, 180));
  if (
    ![
      "hat",
      "brim",
      "selected-area",
      "whole-image",
      "subject",
      "background",
    ].includes(String(raw.target)) ||
    typeof raw.protectLabel !== "boolean"
  )
    throw new Error("模型未明确目标或保护要求");
  const target = raw.target as PhotoCraftInstructionPlan["target"];
  const protectLabel = raw.protectLabel;
  if (raw.operation === "crop") {
    if (
      target !== "selected-area" ||
      protectLabel ||
      ![undefined, "none"].includes(raw.color as string | undefined) ||
      ![undefined, "none"].includes(raw.adjustment as string | undefined) ||
      ![undefined, 0].includes(raw.amount as number | undefined)
    )
      throw new Error("裁切必须使用画框，且不能同时要求保留框外内容");
    return {
      operation: "crop",
      target: "selected-area",
      protectLabel: false,
      ...(raw.square === true ? { square: true } : {}),
    };
  }
  if (raw.operation === "heal") {
    if (
      target !== "selected-area" ||
      protectLabel ||
      ![undefined, "none"].includes(raw.color as string | undefined) ||
      ![undefined, "none"].includes(raw.adjustment as string | undefined) ||
      ![undefined, 0].includes(raw.amount as number | undefined)
    )
      throw new Error("污点修复需要用户点击单个污点，且不能组合其他效果");
    return { operation: "heal", target: "selected-area", protectLabel: false };
  }
  if (raw.operation === "text") {
    const textColor = raw.textColor ?? raw.color ?? "#111111";
    const size = raw.size ?? 48;
    if (
      target !== "selected-area" ||
      protectLabel ||
      typeof raw.text !== "string" ||
      !raw.text.trim() ||
      raw.text.length > 80 ||
      !Number.isInteger(size) ||
      Number(size) < 8 ||
      Number(size) > 160 ||
      !["#111111", "#ffffff", "#cc2020"].includes(String(textColor))
    )
      throw new Error("文字内容、字号或颜色不支持");
    return {
      operation: "text",
      target: "selected-area",
      protectLabel: false,
      text: raw.text,
      size: size as number,
      color: textColor as string,
    };
  }
  if (raw.operation === "canvas-size" || raw.operation === "image-size") {
    const width = raw.width;
    const height = raw.height;
    const maxSide = raw.operation === "image-size" ? 4096 : 8192;
    if (
      target !== "whole-image" ||
      protectLabel ||
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      Number(width) < 1 ||
      Number(height) < 1 ||
      Number(width) > maxSide ||
      Number(height) > maxSide ||
      (raw.operation === "image-size" &&
        Number(width) * Number(height) > 16_000_000)
    )
      throw new Error("图片或画布宽高无效，请明确像素尺寸");
    return {
      operation: raw.operation,
      target: "whole-image",
      protectLabel: false,
      width: width as number,
      height: height as number,
    };
  }
  if (raw.operation === "orient") {
    if (
      target !== "whole-image" ||
      protectLabel ||
      ![
        "rotate-cw",
        "rotate-ccw",
        "rotate-180",
        "flip-horizontal",
        "flip-vertical",
      ].includes(String(raw.mode))
    )
      throw new Error("旋转或翻转方向无效");
    return {
      operation: "orient",
      target: "whole-image",
      protectLabel: false,
      mode: raw.mode as Extract<
        PhotoCraftInstructionPlan,
        { operation: "orient" }
      >["mode"],
    };
  }
  if (raw.operation === "layer-action") {
    if (
      target !== "whole-image" ||
      protectLabel ||
      !["duplicate", "hide", "show"].includes(String(raw.action))
    )
      throw new Error("当前图层操作无效");
    return {
      operation: "layer-action",
      target: "whole-image",
      protectLabel: false,
      action: raw.action as "duplicate" | "hide" | "show",
    };
  }
  if (raw.operation === "levels") {
    const gamma = raw.gamma ?? 1;
    if (
      target !== "whole-image" ||
      protectLabel ||
      !Number.isInteger(raw.inBlack) ||
      !Number.isInteger(raw.inWhite) ||
      Number(raw.inBlack) < 0 ||
      Number(raw.inWhite) > 255 ||
      Number(raw.inBlack) >= Number(raw.inWhite) ||
      typeof gamma !== "number" ||
      !Number.isFinite(gamma) ||
      gamma < 0.1 ||
      gamma > 5
    )
      throw new Error("色阶黑场、白场或伽马无效");
    return {
      operation: "levels",
      target: "whole-image",
      protectLabel: false,
      inBlack: raw.inBlack as number,
      inWhite: raw.inWhite as number,
      gamma,
    };
  }
  if (raw.operation === "text-style") {
    if (
      target !== "whole-image" ||
      protectLabel ||
      (raw.weight === undefined && raw.underline === undefined) ||
      (raw.weight !== undefined &&
        ![400, 700].includes(raw.weight as number)) ||
      (raw.underline !== undefined && typeof raw.underline !== "boolean")
    )
      throw new Error("文字样式参数无效");
    return {
      operation: "text-style",
      target: "whole-image",
      protectLabel: false,
      ...(raw.weight !== undefined ? { weight: raw.weight as 400 | 700 } : {}),
      ...(raw.underline !== undefined
        ? { underline: raw.underline as boolean }
        : {}),
    };
  }
  if (raw.operation === "drop-shadow") {
    if (
      target !== "whole-image" ||
      protectLabel ||
      !Number.isInteger(raw.distance) ||
      !Number.isInteger(raw.size) ||
      !Number.isInteger(raw.opacity) ||
      Number(raw.distance) < 0 ||
      Number(raw.distance) > 100 ||
      Number(raw.size) < 0 ||
      Number(raw.size) > 100 ||
      Number(raw.opacity) < 1 ||
      Number(raw.opacity) > 100
    )
      throw new Error("请明确投影距离、大小和不透明度");
    return {
      operation: "drop-shadow",
      target: "whole-image",
      protectLabel: false,
      distance: raw.distance as number,
      size: raw.size as number,
      opacity: raw.opacity as number,
    };
  }
  if (raw.operation === "recolor") {
    const protectPhrase = normalizeModelProtectPhrase(raw.protectPhrase);
    if (
      target === "whole-image" ||
      !["black", "red", "blue", "green", "gray"].includes(String(raw.color)) ||
      ![undefined, "none"].includes(raw.adjustment as string | undefined) ||
      ![undefined, 0].includes(raw.amount as number | undefined)
    )
      throw new Error("目前仅支持局部改黑、红、蓝、绿或灰");
    if (protectPhrase && !protectLabel) throw new Error("模型遗漏了保护要求");
    return {
      operation: "recolor",
      color: raw.color as "black" | "red" | "blue" | "green" | "gray",
      target,
      protectLabel,
      ...(protectPhrase ? { protectPhrase } : {}),
    };
  }
  if (raw.operation === "adjust") {
    const protectPhrase = normalizeModelProtectPhrase(raw.protectPhrase);
    if (
      ![
        "brightness",
        "contrast",
        "saturation",
        "exposure",
        "vibrance",
        "shadows",
        "highlights",
      ].includes(String(raw.adjustment)) ||
      !Number.isInteger(raw.amount) ||
      Math.abs(raw.amount as number) > 50 ||
      raw.amount === 0 ||
      (target === "whole-image" && protectLabel) ||
      ![undefined, "none"].includes(raw.color as string | undefined)
    )
      throw new Error("调色效果或幅度不支持");
    if (protectPhrase && !protectLabel) throw new Error("模型遗漏了保护要求");
    return {
      operation: "adjust",
      adjustment: raw.adjustment as
        | "brightness"
        | "contrast"
        | "saturation"
        | "exposure"
        | "vibrance"
        | "shadows"
        | "highlights",
      amount: raw.amount as number,
      target,
      protectLabel,
      ...(protectPhrase ? { protectPhrase } : {}),
    };
  }
  throw new Error("该编辑要求暂不支持");
}

/** Preserve model intent, but source exact editable values from the user's words. */
export function reconcilePhotoCraftModelPlan(
  instruction: string,
  value: unknown,
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const raw = { ...(value as Record<string, unknown>) };
  // 任务②实测（2026-10-16，qwen-plus + json_object）：模型返回精确计划但
  // 省略信封字段 unsupported（云端 json_object 不带 schema，json_schema 又让
  // 输出劣化）。模型给出具体能力操作即表示「可执行」，此处补空信封；
  // operation=unsupported 时不补——缺失的拒绝理由原样交给 parse 报错，
  // 不得被静默洗成「完全支持」。
  if (
    typeof raw.operation === "string" &&
    raw.operation !== "unsupported" &&
    typeof raw.unsupported !== "string"
  )
    raw.unsupported = "";
  const clean = instruction.replace(/\s+/g, "");
  const colorAfterVerb = clean
    .replace(/[「“"][^」”"]*[」”"]/gu, "")
    .match(/(?:换成|换为|改成|改为|涂成|变成)([^，。]{1,8}?色)/u)?.[1];
  if (colorAfterVerb && !/^(?:黑|红|蓝|绿|灰)色$/u.test(colorAfterVerb))
    throw new Error("目标颜色不在当前 PhotoCraft 换色能力范围内");
  // M2 默认策略表（§5）：数值/颜色缺失或无文字依据时不阻塞、不追问——按
  // 领域默认策略表补默认值出预览，滑杆接管后续调整。「数值必须来自用户
  // 原话」因此收紧为：原话没有任何独立数字时，幅度一律取表默认，模型自报
  // 数值不作数；原话有数字（哪怕超出 -50~50）都以原话为准，由 parse 拒绝
  // 超范围值，绝不静默改写用户明说的幅度。
  const explicitAmount = /(?<!\d)\d{1,3}(?!\d)/.test(clean);
  if (
    raw.operation === "adjust" &&
    (!explicitAmount || !Number.isInteger(raw.amount))
  )
    raw.amount =
      degreeAmountFromText(instruction).amount *
      adjustDirectionFromText(instruction);
  if (raw.operation === "recolor" && !raw.color) raw.color = "gray";
  if (raw.operation === "drop-shadow") {
    const shadow = strategyFor("drop-shadow")?.defaults as {
      distance: number;
      size: number;
      opacity: number;
    };
    if (!shadow) throw new Error("投影默认策略缺失");
    const distance = clean.match(/距离(\d{1,3})(?:像素|px)?/i);
    const size = clean.match(/(?:大小|模糊|柔和)(\d{1,3})(?:像素|px)?/i);
    const opacity = clean.match(/不透明度(\d{1,3})%/);
    if (distance) raw.distance = Number(distance[1]);
    else if (!Number.isInteger(raw.distance)) raw.distance = shadow.distance;
    if (size) raw.size = Number(size[1]);
    else if (!Number.isInteger(raw.size)) raw.size = shadow.size;
    if (opacity) raw.opacity = Number(opacity[1]);
    else if (!Number.isInteger(raw.opacity)) raw.opacity = shadow.opacity;
  }
  if (raw.operation === "orient" && !raw.mode)
    raw.mode =
      (strategyFor("orient")?.defaults as { mode?: string } | undefined)
        ?.mode ?? "rotate-cw";
  if (
    [
      "canvas-size",
      "image-size",
      "orient",
      "layer-action",
      "levels",
      "text-style",
      "drop-shadow",
    ].includes(String(raw.operation))
  )
    raw.target = "whole-image";
  if (["crop", "heal", "text"].includes(String(raw.operation)))
    raw.target = "selected-area";
  // M4：保护要求从原话截尾提取（与快车道同一 protectTailOf）——标签/商标/
  // Logo 归 protectLabel，其余名词作为 protectPhrase 随计划下发，模型通道
  // 不再静默丢弃「保护天空」类要求。
  const protectTail = protectTailOf(clean);
  raw.protectLabel = protectTail !== null;
  if (protectTail?.phrase) raw.protectPhrase = protectTail.phrase;
  if (raw.operation === "image-size" || raw.operation === "canvas-size") {
    const dimensions = clean.match(/(\d{1,4})[×xX*＊](\d{1,4})(?:像素)?/u);
    if (dimensions) {
      raw.width = Number(dimensions[1]);
      raw.height = Number(dimensions[2]);
    }
  }
  if (raw.operation === "orient") {
    const mode = orientationFromText(instruction);
    if (mode) raw.mode = mode;
  }
  if (raw.operation === "layer-action") {
    const action = layerActionFromText(instruction);
    if (action) raw.action = action;
  }
  if (raw.operation === "levels") {
    const black = clean.match(/(?:输入)?黑(?:场|点)(?:设为|为)?(\d{1,3})/u);
    const white = clean.match(/(?:输入)?白(?:场|点)(?:设为|为)?(\d{1,3})/u);
    const gamma = clean.match(/伽马(?:设为|为)?(\d(?:\.\d{1,2})?)/u);
    if (black) raw.inBlack = Number(black[1]);
    if (white) raw.inWhite = Number(white[1]);
    raw.gamma = gamma ? Number(gamma[1]) : 1;
  }
  if (raw.operation === "text") {
    const quoted = clean.match(/[「“"]([^」”"]{1,80})[」”"]/u);
    const size = clean.match(/(?:字号|大小)(\d{1,3})/u);
    if (quoted) raw.text = quoted[1];
    raw.size = size ? Number(size[1]) : 48;
    raw.textColor = /红色/.test(clean)
      ? "#cc2020"
      : /白色/.test(clean)
        ? "#ffffff"
        : "#111111";
  }
  if (raw.operation === "text-style") {
    if (/加粗|粗体/.test(clean)) raw.weight = 700;
    else if (/常规|取消加粗/.test(clean)) raw.weight = 400;
    if (/(?:加|添加|加上)下划线/.test(clean)) raw.underline = true;
    else if (/(?:去掉|取消|移除)下划线/.test(clean)) raw.underline = false;
  }
  const desiredColor = clean.match(
    /(?:换成|换为|改成|改为|涂成)(黑|红|蓝|绿|灰)色?/u,
  );
  if (raw.operation === "recolor" && desiredColor)
    raw.color = (
      { 黑: "black", 红: "red", 蓝: "blue", 绿: "green", 灰: "gray" } as Record<
        string,
        string
      >
    )[desiredColor[1] ?? ""];
  return raw;
}

export function validatePhotoCraftInstructionAgainstText(
  instruction: string,
  plan: PhotoCraftInstructionPlan,
): void {
  const clean = instruction.replace(/\s+/g, "");
  const colorAfterVerb = clean
    .replace(/[「“"][^」”"]*[」”"]/gu, "")
    .match(/(?:换成|换为|改成|改为|涂成|变成)([^，。]{1,8}?色)/u)?.[1];
  if (colorAfterVerb && !/^(?:黑|红|蓝|绿|灰)色$/u.test(colorAfterVerb))
    throw new Error("目标颜色不在当前 PhotoCraft 换色能力范围内");
  // M4：保护要求判定与快车道同源（protectTailOf）；标签式缺框、清单式
  // 名字对不上都直接否决，杜绝法官放走「静默丢保护」的模型计划。
  const protectTail = protectTailOf(clean);
  if (protectTail && !plan.protectLabel)
    throw new Error("模型遗漏了标签或文字保护要求");
  if (
    protectTail?.phrase &&
    (plan as { protectPhrase?: string }).protectPhrase !== protectTail.phrase
  )
    throw new Error("模型未正确识别保护范围");
  const requested = [
    /(?:换成|改成|改为|涂成|变成)(?:黑|红|蓝|绿|灰|白)色?/.test(clean)
      ? "recolor"
      : null,
    /(?:亮度|对比度|饱和度|曝光|暗部|高光|提亮|调亮|变亮|调暗|更鲜艳)/.test(
      clean,
    )
      ? "adjust"
      : null,
    /(?:裁剪|剪裁|裁切|裁成|裁为)/.test(clean) ? "crop" : null,
    /(?:污点|瑕疵|痘印)/.test(clean) ? "heal" : null,
    /(?:添加|加上|写上|加入)(?:文字|文本|[「“"])/.test(clean) ? "text" : null,
    /画布(?:尺寸)?/.test(clean) ? "canvas-size" : null,
    /(?:图片|照片|图像)(?:的)?(?:尺寸|大小)|(?:缩放|重采样)(?:图片|照片|图像)?/.test(
      clean,
    )
      ? "image-size"
      : null,
    /(?:旋转|翻转)/.test(clean) ? "orient" : null,
    /(?:复制|隐藏|显示)(?:当前|选中的)?图层/.test(clean)
      ? "layer-action"
      : null,
    /色阶|黑场|白场/.test(clean) ? "levels" : null,
    /(?:文字|字体|字重).*(?:加粗|粗体|常规|下划线)/.test(clean)
      ? "text-style"
      : null,
    /投影|阴影/.test(clean) ? "drop-shadow" : null,
  ].filter((item): item is string => item !== null);
  if (new Set(requested).size > 1)
    throw new Error("这条要求包含多个效果，请分步执行并分别检查预览");
  if (requested.length === 1 && requested[0] !== plan.operation)
    throw new Error("模型未正确识别编辑操作");
  if (plan.operation === "canvas-size" || plan.operation === "image-size") {
    const dimensions = clean.match(/(\d{1,4})[×xX*＊](\d{1,4})(?:像素)?/u);
    if (
      !dimensions ||
      Number(dimensions[1]) !== plan.width ||
      Number(dimensions[2]) !== plan.height ||
      [...clean.matchAll(/\d+(?:\.\d+)?/g)].length !== 2
    )
      throw new Error("模型未正确识别宽高；请明确写出宽×高像素");
    return;
  }
  if (plan.operation === "orient") {
    // 原话写明方向（或「旋转一下」裸短语→表默认顺时针）必须逐一匹配；
    // 目标错配（如「把背景旋转」）解析为 null，依然拒绝。
    if (orientationFromText(instruction) !== plan.mode)
      throw new Error("模型未正确识别整图旋转或翻转方向");
    return;
  }
  if (plan.operation === "layer-action") {
    if (layerActionFromText(instruction) !== plan.action)
      throw new Error("模型未正确识别当前图层操作");
    return;
  }
  if (plan.operation === "levels") {
    const black = clean.match(/(?:输入)?黑(?:场|点)(?:设为|为)?(\d{1,3})/u);
    const white = clean.match(/(?:输入)?白(?:场|点)(?:设为|为)?(\d{1,3})/u);
    const gamma = clean.match(/伽马(?:设为|为)?(\d(?:\.\d{1,2})?)/u);
    if (
      !black ||
      !white ||
      Number(black[1]) !== plan.inBlack ||
      Number(white[1]) !== plan.inWhite ||
      (gamma ? Number(gamma[1]) !== plan.gamma : plan.gamma !== 1)
    )
      throw new Error("模型未正确识别色阶参数；请明确黑场、白场及可选伽马");
    return;
  }
  if (plan.operation === "text-style") {
    const bold = /加粗|粗体/.test(clean);
    const regular = /常规|取消加粗/.test(clean);
    const addUnderline = /(?:加|添加|加上)下划线/.test(clean);
    const removeUnderline = /(?:去掉|取消|移除)下划线/.test(clean);
    if (
      (bold && regular) ||
      (addUnderline && removeUnderline) ||
      (!bold && !regular && !addUnderline && !removeUnderline) ||
      (bold && plan.weight !== 700) ||
      (regular && plan.weight !== 400) ||
      (addUnderline && plan.underline !== true) ||
      (removeUnderline && plan.underline !== false)
    )
      throw new Error("模型未正确识别文字样式");
    return;
  }
  if (plan.operation === "drop-shadow") {
    // 默认策略表（§5）：原话写明的值必须逐一匹配；未写明的值必须等于表
    // 默认（距离 8、大小 10、不透明度 55），模型自报数值不作数。
    const shadow = strategyFor("drop-shadow")?.defaults as {
      distance: number;
      size: number;
      opacity: number;
    };
    if (!shadow) throw new Error("投影默认策略缺失");
    const distance = clean.match(/距离(\d{1,3})(?:像素|px)?/i);
    const size = clean.match(/(?:大小|模糊|柔和)(\d{1,3})(?:像素|px)?/i);
    const opacity = clean.match(/不透明度(\d{1,3})%/);
    const checks = [
      [distance, plan.distance, shadow.distance] as [
        RegExpMatchArray | null,
        number,
        number,
      ],
      [size, plan.size, shadow.size] as [
        RegExpMatchArray | null,
        number,
        number,
      ],
      [opacity, plan.opacity, shadow.opacity] as [
        RegExpMatchArray | null,
        number,
        number,
      ],
    ];
    for (const [match, planned, fallback] of checks) {
      if (match ? Number(match[1]) !== planned : planned !== fallback)
        throw new Error(
          match
            ? "模型未正确识别投影参数"
            : "投影参数未写明时应取默认值（距离 8、大小 10、不透明度 55）",
        );
    }
    return;
  }
  if (plan.operation === "text") {
    const quoted = clean.match(/[「“"]([^」”"]{1,80})[」”"]/u);
    const size = clean.match(/(?:字号|大小)(\d{1,3})/u);
    const color = /红色/.test(clean)
      ? "#cc2020"
      : /白色/.test(clean)
        ? "#ffffff"
        : "#111111";
    if (
      !quoted ||
      quoted[1] !== plan.text ||
      (size ? Number(size[1]) !== plan.size : plan.size !== 48) ||
      color !== plan.color
    )
      throw new Error("模型未正确识别文字内容、字号或颜色");
    return;
  }
  const kinds = new Set<string>();
  if (
    /(?:改成|改为|换成|换为|调成|变成|改)(?:黑|红|蓝|绿|灰)(?:色)?/.test(clean)
  )
    kinds.add("recolor");
  if (/(?:裁剪|剪裁|裁切)/.test(clean)) kinds.add("crop");
  if (/(?:污点|瑕疵|痘印)/.test(clean)) kinds.add("heal");
  if (/(?:暗部)/.test(clean)) kinds.add("shadows");
  if (/(?:高光)/.test(clean)) kinds.add("highlights");
  if (/(?:自然饱和度)/.test(clean)) kinds.add("vibrance");
  else if (/(?:饱和度|鲜艳)/.test(clean)) kinds.add("saturation");
  if (/(?:曝光)/.test(clean)) kinds.add("exposure");
  if (/(?:对比度|对比更)/.test(clean)) kinds.add("contrast");
  if (
    !kinds.has("shadows") &&
    !kinds.has("highlights") &&
    /(?:亮度|提亮|调亮|变亮|调暗|变暗)/.test(clean)
  )
    kinds.add("brightness");
  if (kinds.size > 1)
    throw new Error("这条要求包含多个效果，请每次只执行一项编辑");
  const named = [...kinds][0];
  if (
    named &&
    (named === "recolor" || named === "crop" || named === "heal"
      ? plan.operation !== named
      : plan.operation !== "adjust" || plan.adjustment !== named)
  )
    throw new Error("模型未正确识别要求中的编辑效果");
  if (plan.operation === "recolor") {
    const desired = clean.match(
      /(?:换成|换为|改成|改为|涂成)(黑|红|蓝|绿|灰)色?/u,
    );
    const expected =
      desired &&
      (
        {
          黑: "black",
          红: "red",
          蓝: "blue",
          绿: "green",
          灰: "gray",
        } as Record<string, string>
      )[desired[1] ?? ""];
    if (expected && plan.color !== expected)
      throw new Error("模型未正确识别目标颜色");
  }
  if (plan.operation === "adjust") {
    const negative = /(?:降低|减少|调低|压低|调暗|变暗|减弱|更柔和)/.test(
      clean,
    );
    const positive = /(?:提高|增加|提亮|调亮|变亮|增强|更强|更鲜艳)/.test(
      clean,
    );
    if (
      (negative && positive) ||
      (negative && plan.amount > 0) ||
      (positive && plan.amount < 0)
    )
      throw new Error("模型未正确识别调色方向");
    const values = [...clean.matchAll(/(?<!\d)([1-5]?\d)(?!\d)/g)].map(
      (match) => Number(match[1]),
    );
    if (
      values.length > 1 ||
      (values.length === 1 &&
        plan.adjustment !== "exposure" &&
        Math.abs(plan.amount) !== values[0])
    )
      throw new Error("模型未正确识别调色幅度");
  }
  if (
    /(?:移除物体|删除物体|擦除物体|抠图|重绘|生成|换材质|改变形状)/.test(clean)
  )
    throw new Error("这条要求包含当前 PhotoCraft 工作流不支持的操作");
  if (/(?:去掉|移除|删除|擦除)/.test(clean) && plan.operation !== "heal")
    throw new Error("这条要求包含当前 PhotoCraft 工作流不支持的操作");
  if (/帽沿/.test(clean) && plan.target !== "brim")
    throw new Error("模型未正确识别帽沿目标");
  if (/帽子|帽身/.test(clean) && !/帽沿/.test(clean) && plan.target !== "hat")
    throw new Error("模型未正确识别帽子目标");
  if (
    /主体|前景|商品|产品/.test(clean) &&
    !/帽沿|帽子|帽身|背景/.test(clean) &&
    plan.target !== "subject"
  )
    throw new Error("模型未正确识别主体目标");
  if (/背景/.test(clean) && plan.target !== "background")
    throw new Error("模型未正确识别背景目标");
  if (/(?:耳朵|猫耳|左耳|右耳)/.test(clean) && plan.target !== "selected-area")
    throw new Error("耳朵需要画定局部范围");
  if (
    /(?:整张|整体|全图|整幅|整个画面)/.test(clean) &&
    !/(?:整张|整体|全图|整幅|整个画面)(?:图片|照片|画面|图像|图)?的(?:主体|前景|商品|产品|背景)/.test(
      clean,
    ) &&
    plan.target !== "whole-image"
  )
    throw new Error("模型未正确识别整图范围");
  if (/(?:裁剪|剪裁|裁切)/.test(clean) && plan.operation !== "crop")
    throw new Error("模型未正确识别裁切要求");
  if (/(?:污点|瑕疵|痘印)/.test(clean) && plan.operation !== "heal")
    throw new Error("模型未正确识别污点修复要求");
  if (
    /(?:暗部)/.test(clean) &&
    (plan.operation !== "adjust" || plan.adjustment !== "shadows")
  )
    throw new Error("模型未正确识别暗部调整");
  if (
    /(?:高光)/.test(clean) &&
    (plan.operation !== "adjust" || plan.adjustment !== "highlights")
  )
    throw new Error("模型未正确识别高光调整");
}

export function describePhotoCraftPlan(
  plan: PhotoCraftInstructionPlan,
): string {
  if (plan.operation === "crop")
    return plan.square
      ? "用 PhotoCraft 裁成居中的正方形；请检查主体是否完整。"
      : "按画框裁切图片；请检查预览中的构图和边缘。";
  if (plan.operation === "heal")
    return "点击一个小污点，使用 PhotoCraft 原生污点修复；请检查纹理和周围结构。";
  if (plan.operation === "text")
    return `点击文字放置位置，使用 PhotoCraft 原生文字图层写入「${plan.text}」（字号 ${plan.size}）；请检查位置和可读性。`;
  if (plan.operation === "canvas-size")
    return `使用 PhotoCraft 将画布调整为 ${plan.width} × ${plan.height} 像素；请检查主体位置和新增边缘。`;
  if (plan.operation === "image-size")
    return `使用 PhotoCraft 将图片重采样为 ${plan.width} × ${plan.height} 像素；请检查清晰度和比例。`;
  if (plan.operation === "orient")
    return `使用 PhotoCraft 原生命令将整图${
      {
        "rotate-cw": "顺时针旋转 90 度",
        "rotate-ccw": "逆时针旋转 90 度",
        "rotate-180": "旋转 180 度",
        "flip-horizontal": "水平翻转",
        "flip-vertical": "垂直翻转",
      }[plan.mode]
    }；请检查文字方向与构图。`;
  if (plan.operation === "layer-action")
    return `使用 PhotoCraft ${{ duplicate: "复制", hide: "隐藏", show: "显示" }[plan.action]}当前图层；请检查图层列表和画面。`;
  if (plan.operation === "levels")
    return `使用 PhotoCraft 可编辑色阶调整层：黑场 ${plan.inBlack}、白场 ${plan.inWhite}、伽马 ${plan.gamma}；请检查暗部、高光和颜色。`;
  if (plan.operation === "text-style")
    return `使用 PhotoCraft 修改当前文字图层样式：${plan.weight === 700 ? "粗体" : "常规"}${plan.underline === undefined ? "" : plan.underline ? "、加下划线" : "、去掉下划线"}；请检查字形和排版。`;
  if (plan.operation === "drop-shadow")
    return `为 PhotoCraft 当前图层添加可编辑投影：距离 ${plan.distance}、大小 ${plan.size} 像素、不透明度 ${plan.opacity}%；请检查边缘和背景。`;
  const target = {
    hat: "帽子面料",
    brim: "帽沿",
    "selected-area": "画定区域",
    subject: "主体（AI 主体蒙版自动选区）",
    background: "背景（主体以外的区域）",
    "whole-image": "整张图片",
  }[plan.target];
  const effect =
    plan.operation === "recolor"
      ? `改为${{ black: "黑色", red: "红色", blue: "蓝色", green: "绿色", gray: "灰色" }[plan.color]}`
      : `${{ brightness: "亮度", contrast: "对比度", saturation: "饱和度", exposure: "曝光", vibrance: "自然饱和度", shadows: "暗部", highlights: "高光" }[plan.adjustment]}${plan.amount > 0 ? "提高" : "降低"}${Math.abs(plan.amount)}${plan.adjustment === "exposure" ? `（约${Math.abs(plan.amount / 20)}档）` : ""}`;
  return `${target}${effect}；${
    plan.protectLabel
      ? `须画出${plan.protectPhrase ? `「${plan.protectPhrase}」` : "标签"}保护框；`
      : ""
  }请检查预览中的边缘、纹理和背景。`;
}
