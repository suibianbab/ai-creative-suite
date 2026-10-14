// PhotoCraft owns the editing engine. Each entry only maps a bounded request to
// native commands and checks that the saved editable document contains the result.
const adjustments = {
  brightness: {
    id: "layer.newAdjustmentLayer.brightnessContrast",
    params: (n) => ({ brightness: n }),
  },
  contrast: {
    id: "layer.newAdjustmentLayer.brightnessContrast",
    params: (n) => ({ contrast: n }),
  },
  saturation: {
    id: "layer.newAdjustmentLayer.hueSaturation",
    params: (n) => ({ saturation: n }),
  },
  exposure: {
    id: "layer.newAdjustmentLayer.exposure",
    params: (n) => ({ exposure: n / 20 }),
  },
  vibrance: {
    id: "layer.newAdjustmentLayer.vibrance",
    params: (n) => ({ vibrance: n }),
  },
  shadows: {
    id: "layer.newAdjustmentLayer.curves",
    params: (n) => ({
      points: [
        [0, 0],
        [64, 64 + n],
        [128, 128],
        [255, 255],
      ],
    }),
  },
  highlights: {
    id: "layer.newAdjustmentLayer.curves",
    params: (n) => ({
      points: [
        [0, 0],
        [128, 128],
        [192, 192 + n],
        [255, 255],
      ],
    }),
  },
};

const editableAdjustment = (after) => {
  if (!after.layers?.[0]?.hasMask || after.layers.length < 2)
    throw new Error("PhotoCraft 未生成可编辑调整图层");
};

export const capabilities = {
  recolor: {
    group: "adjustment",
    selection: "mask",
    nativeIds: ["layer.newAdjustmentLayer.hueSaturation", "layer.setProps"],
    validate({ plan, points, outline, rect, selectionMethod }) {
      if (
        !["black", "red", "blue", "green", "gray"].includes(plan.color) ||
        plan.adjustment !== undefined ||
        plan.amount !== undefined ||
        plan.target === "whole-image" ||
        (selectionMethod === "manual" &&
          points.length < 2 &&
          outline.length < 3 &&
          !(plan.target === "selected-area" && rect))
      )
        throw new Error("局部换色需要面料取样点或轮廓选区和允许的目标颜色");
    },
    commands({ plan, selectionMethod }) {
      const params =
        plan.color === "black"
          ? { saturation: -100, lightness: -85 }
          : plan.color === "gray"
            ? { saturation: -100, lightness: 0 }
            : {
                colorize: true,
                hue: { red: 0, blue: 230, green: 120 }[plan.color],
                saturation: selectionMethod === "provider" ? 35 : 65,
                lightness: 0,
              };
      const steps = [{ id: "layer.newAdjustmentLayer.hueSaturation", params }];
      if (
        ["red", "blue", "green"].includes(plan.color) &&
        selectionMethod === "provider"
      )
        steps.push({ id: "layer.setProps", params: { blend: "Color" } });
      return steps;
    },
    verify({ plan, selectionMethod, after }) {
      editableAdjustment(after);
      if (
        ["red", "blue", "green"].includes(plan.color) &&
        selectionMethod === "provider" &&
        (after.layers[0].blend !== "Color" ||
          after.layers[0].adjustment?.HueSaturation?.saturation !== 35)
      )
        throw new Error("PhotoCraft 未保留毛发换色的明暗混合设置");
    },
  },
  adjust: {
    group: "adjustment",
    selection: "mask",
    nativeIds: [
      ...new Set(Object.values(adjustments).map((entry) => entry.id)),
    ],
    validate({ plan, rect, outline, selectionMethod }) {
      if (
        plan.color !== undefined ||
        !adjustments[plan.adjustment] ||
        !Number.isInteger(plan.amount) ||
        plan.amount === 0 ||
        Math.abs(plan.amount) > 50 ||
        (plan.target === "whole-image" && plan.protectLabel) ||
        (plan.target !== "whole-image" &&
          selectionMethod === "manual" &&
          !rect &&
          outline.length < 3)
      )
        throw new Error("局部调色需要画定区域和 -50～50 的有效幅度");
    },
    commands({ plan }) {
      const entry = adjustments[plan.adjustment];
      return [{ id: entry.id, params: entry.params(plan.amount) }];
    },
    verify({ after }) {
      editableAdjustment(after);
    },
  },
  crop: {
    group: "geometry",
    selection: "none",
    nativeIds: ["image.crop"],
    validate({ plan, rect }) {
      if (
        plan.target !== "selected-area" ||
        plan.protectLabel ||
        !rect ||
        plan.color !== undefined ||
        plan.adjustment !== undefined ||
        plan.amount !== undefined
      )
        throw new Error("按画框裁切需要先画出裁切范围");
    },
    commands({ rect }) {
      return [
        {
          id: "image.crop",
          params: {
            x: rect[0],
            y: rect[1],
            width: rect[2],
            height: rect[3],
            deleteCroppedPixels: false,
          },
        },
      ];
    },
    verify({ rect, after }) {
      if (after.width !== rect[2] || after.height !== rect[3])
        throw new Error("PhotoCraft 裁切结果尺寸不正确");
    },
  },
  heal: {
    group: "retouch",
    selection: "none",
    nativeIds: ["layer.select", "layer.duplicate", "paint.spotHealing"],
    validate({
      plan,
      points,
      rect,
      protectRect,
      outline,
      patches,
      edgeShift,
      edgeFeather,
    }) {
      if (
        plan.target !== "selected-area" ||
        plan.protectLabel ||
        points.length !== 1 ||
        rect ||
        protectRect ||
        outline.length ||
        patches.length ||
        edgeShift ||
        edgeFeather ||
        plan.color !== undefined ||
        plan.adjustment !== undefined ||
        plan.amount !== undefined
      )
        throw new Error("请只点击一个小污点；污点修复不能组合其他选区或效果");
    },
    commands({ points, healSize, before }) {
      const pixel = before.layers?.find(
        (layer) => layer.kind === "Pixel" && layer.visible,
      );
      if (!pixel) throw new Error("PhotoCraft 没有可修复的像素图层");
      const [x, y] = points[0];
      return [
        { id: "layer.select", params: { layer: pixel.id } },
        { id: "layer.duplicate", params: {} },
        {
          id: "paint.spotHealing",
          params: {
            points: [
              [x, y],
              [Math.min(x + 1, before.width - 1), y],
            ],
            size: healSize,
            type: "contentAware",
            target: "pixels",
            sampleAllLayers: true,
          },
        },
      ];
    },
    verify({ before, after }) {
      if (after.layers?.length !== before.layers.length + 1)
        throw new Error("PhotoCraft 未保留可编辑图层");
    },
  },
  text: {
    group: "text",
    selection: "none",
    nativeIds: ["type.create"],
    validate({ plan, points, rect, protectRect, outline, patches }) {
      if (
        plan.target !== "selected-area" ||
        plan.protectLabel ||
        points.length !== 1 ||
        rect ||
        protectRect ||
        outline.length ||
        patches.length ||
        typeof plan.text !== "string" ||
        !plan.text.trim() ||
        plan.text.length > 80 ||
        !Number.isInteger(plan.size) ||
        plan.size < 8 ||
        plan.size > 160 ||
        !/^#[0-9a-fA-F]{6}$/.test(plan.color) ||
        plan.adjustment !== undefined ||
        plan.amount !== undefined
      )
        throw new Error("文字需要点击放置位置，长度、字号或颜色无效");
    },
    commands({ plan, points }) {
      return [
        {
          id: "type.create",
          params: {
            x: points[0][0],
            y: points[0][1],
            text: plan.text,
            size: plan.size,
            color: plan.color,
          },
        },
      ];
    },
    verify({ before, after }) {
      if (
        after.layers?.length !== before.layers.length + 1 ||
        after.layers[0]?.kind !== "Type"
      )
        throw new Error("PhotoCraft 未生成可编辑文字图层");
    },
  },
  "canvas-size": {
    group: "geometry",
    selection: "none",
    nativeIds: ["image.canvasSize"],
    validate({ plan, points, rect, outline, patches, protectRect }) {
      if (
        plan.target !== "whole-image" ||
        plan.protectLabel ||
        points.length ||
        rect ||
        outline.length ||
        patches.length ||
        protectRect ||
        !Number.isInteger(plan.width) ||
        !Number.isInteger(plan.height) ||
        plan.width < 1 ||
        plan.height < 1 ||
        plan.width > 8192 ||
        plan.height > 8192
      )
        throw new Error("画布尺寸无效；请输入 1～8192 像素的宽和高");
    },
    commands({ plan }) {
      return [
        {
          id: "image.canvasSize",
          params: {
            width: plan.width,
            height: plan.height,
            relative: false,
            anchor: "center",
            extensionColor: "white",
          },
        },
      ];
    },
    verify({ plan, after }) {
      if (after.width !== plan.width || after.height !== plan.height)
        throw new Error("PhotoCraft 画布尺寸未按要求改变");
    },
  },
  "image-size": {
    group: "geometry",
    selection: "none",
    nativeIds: ["image.imageSize"],
    validate({ plan, points, rect, outline, patches, protectRect }) {
      if (
        plan.target !== "whole-image" ||
        plan.protectLabel ||
        points.length ||
        rect ||
        outline.length ||
        patches.length ||
        protectRect ||
        !Number.isInteger(plan.width) ||
        !Number.isInteger(plan.height) ||
        plan.width < 1 ||
        plan.height < 1 ||
        plan.width > 4096 ||
        plan.height > 4096 ||
        plan.width * plan.height > 16_000_000
      )
        throw new Error(
          "图片尺寸无效；宽高需为 1～4096 像素且总像素不超过 1600 万",
        );
    },
    commands({ plan }) {
      return [
        {
          id: "image.imageSize",
          params: {
            width: plan.width,
            height: plan.height,
            resample: "lanczos",
          },
        },
      ];
    },
    verify({ plan, before, after }) {
      if (
        after.width !== plan.width ||
        after.height !== plan.height ||
        after.layers?.length !== before.layers?.length ||
        !after.layers?.some((layer) => layer.kind === "Pixel")
      )
        throw new Error("PhotoCraft 图片尺寸或图层保存结果不正确");
    },
  },
  orient: {
    group: "geometry",
    selection: "none",
    nativeIds: [
      "image.imageRotation.90cw",
      "image.imageRotation.90ccw",
      "image.imageRotation.180",
      "image.imageRotation.flipCanvasHorizontal",
      "image.imageRotation.flipCanvasVertical",
    ],
    validate({ plan, points, rect, outline, patches, protectRect }) {
      if (
        plan.target !== "whole-image" ||
        plan.protectLabel ||
        points.length ||
        rect ||
        outline.length ||
        patches.length ||
        protectRect ||
        ![
          "rotate-cw",
          "rotate-ccw",
          "rotate-180",
          "flip-horizontal",
          "flip-vertical",
        ].includes(plan.mode)
      )
        throw new Error("请选择明确的整图旋转方向或水平/垂直翻转");
    },
    commands({ plan }) {
      const id = {
        "rotate-cw": "image.imageRotation.90cw",
        "rotate-ccw": "image.imageRotation.90ccw",
        "rotate-180": "image.imageRotation.180",
        "flip-horizontal": "image.imageRotation.flipCanvasHorizontal",
        "flip-vertical": "image.imageRotation.flipCanvasVertical",
      }[plan.mode];
      return [{ id, params: {} }];
    },
    verify({ plan, before, after }) {
      const quarterTurn =
        plan.mode === "rotate-cw" || plan.mode === "rotate-ccw";
      if (
        after.width !== (quarterTurn ? before.height : before.width) ||
        after.height !== (quarterTurn ? before.width : before.height) ||
        after.layers?.length !== before.layers?.length
      )
        throw new Error("PhotoCraft 未正确保留旋转/翻转后的画布与图层");
    },
  },
  "layer-action": {
    group: "layer",
    selection: "none",
    nativeIds: ["layer.select", "layer.duplicate", "layer.setProps"],
    validate({ plan, points, rect, outline, patches, protectRect }) {
      if (
        plan.target !== "whole-image" ||
        plan.protectLabel ||
        points.length ||
        rect ||
        outline.length ||
        patches.length ||
        protectRect ||
        !["duplicate", "hide", "show"].includes(plan.action)
      )
        throw new Error("请选择复制、隐藏或显示当前图层");
    },
    commands({ plan, before }) {
      const layer = before.layers?.find(
        (item) => item.id === before.activeLayer,
      );
      if (!layer)
        throw new Error("请先在 PhotoCraft 中选择要操作的图层并保存画布");
      if (plan.action === "duplicate")
        return [
          { id: "layer.select", params: { layer: layer.id, mode: "replace" } },
          { id: "layer.duplicate", params: { inPlace: true } },
        ];
      return [
        {
          id: "layer.setProps",
          params: { layer: layer.id, visible: plan.action === "show" },
        },
      ];
    },
    verify({ plan, before, after }) {
      if (plan.action === "duplicate") {
        if (after.layers?.length !== before.layers?.length + 1)
          throw new Error("PhotoCraft 未复制当前图层");
        return;
      }
      const layer = after.layers?.find(
        (item) => item.id === before.activeLayer,
      );
      if (
        after.layers?.length !== before.layers?.length ||
        layer?.visible !== (plan.action === "show")
      )
        throw new Error("PhotoCraft 未更新当前图层可见性");
    },
  },
  levels: {
    group: "adjustment",
    selection: "none",
    nativeIds: ["layer.newAdjustmentLayer.levels"],
    validate({ plan, points, rect, outline, patches, protectRect }) {
      if (
        plan.target !== "whole-image" ||
        plan.protectLabel ||
        points.length ||
        rect ||
        outline.length ||
        patches.length ||
        protectRect ||
        !Number.isInteger(plan.inBlack) ||
        !Number.isInteger(plan.inWhite) ||
        plan.inBlack < 0 ||
        plan.inWhite > 255 ||
        plan.inBlack >= plan.inWhite ||
        !Number.isFinite(plan.gamma) ||
        plan.gamma < 0.1 ||
        plan.gamma > 5
      )
        throw new Error("色阶参数无效；黑场须小于白场，伽马须在 0.1～5 之间");
    },
    commands({ plan }) {
      return [
        {
          id: "layer.newAdjustmentLayer.levels",
          params: {
            inBlack: plan.inBlack,
            inWhite: plan.inWhite,
            gamma: plan.gamma,
          },
        },
      ];
    },
    verify({ plan, before, after }) {
      const layer = after.layers?.[0];
      const master = layer?.adjustment?.Levels?.master;
      if (
        after.layers?.length !== before.layers?.length + 1 ||
        layer?.kind !== "Adjustment" ||
        !layer.hasMask ||
        !master ||
        Math.abs(master.in_black * 255 - plan.inBlack) > 0.02 ||
        Math.abs(master.in_white * 255 - plan.inWhite) > 0.02 ||
        Math.abs(master.gamma - plan.gamma) > 0.001
      )
        throw new Error("PhotoCraft 未保留指定色阶和可编辑调整层");
    },
  },
  "text-style": {
    group: "text",
    selection: "none",
    nativeIds: ["type.setStyle"],
    validate({ plan, points, rect, outline, patches, protectRect }) {
      if (
        plan.target !== "whole-image" ||
        plan.protectLabel ||
        points.length ||
        rect ||
        outline.length ||
        patches.length ||
        protectRect ||
        (plan.weight === undefined && plan.underline === undefined) ||
        (plan.weight !== undefined && ![400, 700].includes(plan.weight)) ||
        (plan.underline !== undefined && typeof plan.underline !== "boolean")
      )
        throw new Error("文字样式参数无效");
    },
    commands({ plan, before }) {
      const layer = before.layers?.find(
        (item) => item.id === before.activeLayer,
      );
      if (layer?.kind !== "Type")
        throw new Error("请先在 PhotoCraft 中选中要编辑的文字图层");
      return [
        {
          id: "type.setStyle",
          params: {
            layer: layer.id,
            ...(plan.weight !== undefined ? { weight: plan.weight } : {}),
            ...(plan.underline !== undefined
              ? { underline: plan.underline }
              : {}),
          },
        },
      ];
    },
    async verify({ plan, before, after, run, source }) {
      if (
        after.layers?.length !== before.layers?.length ||
        after.layers?.find((item) => item.id === before.activeLayer)?.kind !==
          "Type"
      )
        throw new Error("PhotoCraft 未保留可编辑文字图层");
      const output = await run([
        "run",
        source,
        "--cmd",
        "type.info",
        "--params",
        JSON.stringify({ layer: before.activeLayer }),
      ]);
      const style = JSON.parse(output.trim().split("\n").at(-1))?.result
        ?.runs?.[0]?.style;
      if (
        !style ||
        (plan.weight !== undefined && style.weight !== plan.weight) ||
        (plan.underline !== undefined && style.underline !== plan.underline)
      )
        throw new Error("PhotoCraft 未保留指定文字样式");
    },
  },
  "drop-shadow": {
    group: "layer-style",
    selection: "none",
    nativeIds: ["layer.layerStyle.dropShadow"],
    validate({ plan, points, rect, outline, patches, protectRect }) {
      if (
        plan.target !== "whole-image" ||
        plan.protectLabel ||
        points.length ||
        rect ||
        outline.length ||
        patches.length ||
        protectRect ||
        !Number.isInteger(plan.distance) ||
        plan.distance < 0 ||
        plan.distance > 100 ||
        !Number.isInteger(plan.size) ||
        plan.size < 0 ||
        plan.size > 100 ||
        !Number.isInteger(plan.opacity) ||
        plan.opacity < 1 ||
        plan.opacity > 100
      )
        throw new Error(
          "投影参数无效；距离和大小限 0～100 像素，不透明度限 1～100%",
        );
    },
    commands({ plan, before }) {
      const layer = before.layers?.find(
        (item) => item.id === before.activeLayer,
      );
      if (layer?.kind !== "Type" && layer?.kind !== "Pixel")
        throw new Error("请先在 PhotoCraft 中选中可见的文字或独立像素图层");
      if (
        layer.kind === "Pixel" &&
        before.layers.length === 1 &&
        layer.bounds?.[0] === 0 &&
        layer.bounds?.[1] === 0 &&
        layer.bounds?.[2] === before.width &&
        layer.bounds?.[3] === before.height
      )
        throw new Error(
          "整幅背景图层的投影不可见；请先选中独立的商品或文字图层",
        );
      return [
        {
          id: "layer.layerStyle.dropShadow",
          params: {
            layer: layer.id,
            color: "#000000",
            opacity: plan.opacity,
            distance: plan.distance,
            size: plan.size,
            angle: 120,
          },
        },
      ];
    },
    verify({ before, after }) {
      const layer = after.layers?.find(
        (item) => item.id === before.activeLayer,
      );
      if (
        after.layers?.length !== before.layers?.length ||
        !layer?.effects?.items?.some(
          (effect) => effect.kind === "Drop Shadow" && effect.enabled,
        )
      )
        throw new Error("PhotoCraft 未保留可编辑图层投影");
    },
  },
};

export function capabilityFor(plan) {
  const capability = capabilities[plan?.operation];
  if (!capability) throw new Error("PhotoCraft 不支持该编辑操作");
  return capability;
}
