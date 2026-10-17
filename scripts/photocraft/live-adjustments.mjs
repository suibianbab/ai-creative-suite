// Numeric parameter table for live adjustment sliders (M2 slider handoff).
// Ranges mirror the pinned PhotoCraft 0.6.0 command registry:
// layer.newAdjustmentLayer.<kind> / layer.setAdjustment.
// Curves and per-channel Levels objects stay out of the slider surface —
// the plan pipeline still creates them, only live numeric tuning is bounded.

const numeric = (min, max) => ({ type: "number", min, max });

export const liveAdjustmentParams = {
  BrightnessContrast: {
    brightness: numeric(-150, 150),
    contrast: numeric(-50, 100),
  },
  HueSaturation: {
    hue: numeric(-180, 180),
    saturation: numeric(-100, 100),
    lightness: numeric(-100, 100),
  },
  Exposure: {
    exposure: numeric(-20, 20),
    offset: numeric(-0.5, 0.5),
    gamma: numeric(0.01, 9.99),
  },
  Vibrance: {
    vibrance: numeric(-100, 100),
    saturation: numeric(-100, 100),
  },
  Levels: {
    inBlack: numeric(0, 253),
    inWhite: numeric(2, 255),
    gamma: numeric(0.01, 9.99),
    outBlack: numeric(0, 255),
    outWhite: numeric(0, 255),
  },
};

export function validateLiveAdjustment(kind, params) {
  const table = liveAdjustmentParams[kind];
  if (!table) throw new Error(`该调整层（${kind}）暂不支持滑杆连续调整`);
  if (
    !params ||
    typeof params !== "object" ||
    Array.isArray(params) ||
    Object.keys(params).length < 1
  )
    throw new Error("滑杆参数无效");
  for (const [key, value] of Object.entries(params)) {
    const rule = table[key];
    if (!rule) throw new Error(`参数 ${key} 不在 ${kind} 滑杆范围内`);
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new Error(`参数 ${key} 必须是数字`);
    if (value < rule.min || value > rule.max)
      throw new Error(`参数 ${key} 超出范围 ${rule.min}～${rule.max}`);
  }
  return true;
}
