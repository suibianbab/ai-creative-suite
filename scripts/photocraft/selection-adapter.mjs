import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * 蒙版→原生选区共用机制（C 项从 provider 分支抽出，两种来源同一条链）：
 * CLI info 强校验蒙版尺寸==文档（错位选区不如干净失败），探针 run 确认
 * select.loadSelection 后选区非空，再返回原生命令三连 placeEmbedded →
 * loadSelection(红通道) → layer.delete。PhotoCraft 的 loadSelection 只接受
 * 文件路径——这是外部像素蒙版进原生选区的唯一通道（ADR-0012：画布/像素
 * 操作归原生引擎，桥只编排命令）。
 */
async function loadMaskSelection({
  run,
  input,
  mask,
  width,
  height,
  sizeError,
  emptyError,
}) {
  const maskInfo = JSON.parse(await run(["info", mask, "--compact"]));
  if (maskInfo.width !== width || maskInfo.height !== height)
    throw new Error(sizeError);
  const maskProbe = await run([
    "run",
    input,
    "--cmd",
    "file.placeEmbedded",
    "--params",
    JSON.stringify({ path: mask, fit: false }),
    "--cmd",
    "select.loadSelection",
    "--params",
    JSON.stringify({ channel: "red", operation: "new" }),
  ]);
  const maskSelection = JSON.parse(maskProbe.trim().split("\n").at(-1));
  if (maskSelection.result?.selected !== true) throw new Error(emptyError);
  return [
    { id: "file.placeEmbedded", params: { path: mask, fit: false } },
    {
      id: "select.loadSelection",
      params: { channel: "red", operation: "new" },
    },
    { id: "layer.delete", params: {} },
  ];
}

// Selection is prepared before any effect. The actual selection commands are PhotoCraft commands.
export async function prepareSelection({
  plan,
  infoInput,
  requiresSelection,
  selectionMethod,
  maskPath = null,
  input,
  folder,
  extension,
  mime,
  rect,
  outline,
  points,
  patches,
  edgeShift,
  edgeFeather,
  protectRect,
  providerScopeFeather,
  run,
  fetchMask,
  maxBytes,
  objectSelection,
  selectionIsLargeEnough,
  expandRect,
}) {
  const commands = [];
  const command = (id, params) => commands.push({ id, params });
  if (!requiresSelection) {
    if (infoInput.hasSelection) command("select.deselect", {});
  } else if (requiresSelection && selectionMethod === "existing") {
    // Keep the selection serialized in the native .pcraft source.
  } else if (requiresSelection && selectionMethod === "object") {
    let objectRect = rect;
    let objectBounds = await objectSelection(input, objectRect);
    let sawTinySelection = objectBounds !== null;
    if (
      !selectionIsLargeEnough(
        objectBounds,
        plan.target,
        infoInput.width,
        infoInput.height,
      )
    ) {
      objectRect = expandRect(rect, infoInput.width, infoInput.height);
      objectBounds = await objectSelection(input, objectRect);
      sawTinySelection ||= objectBounds !== null;
      if (
        !selectionIsLargeEnough(
          objectBounds,
          plan.target,
          infoInput.width,
          infoInput.height,
        )
      )
        throw new Error(
          sawTinySelection
            ? "PhotoCraft 只识别到很小的区域，无法形成可见换色。请重新画框，完整包住要改色的帽子或帽沿，并留少许背景。"
            : "PhotoCraft 未在画框中识别到物体。请扩大画框，完整包住目标并留少许背景。",
        );
    }
    command("select.object", { rect: objectRect, mode: "replace" });
    command("select.refineEdge", {
      radius: 3,
      smartRadius: true,
      output: "selection",
    });
  } else if (requiresSelection && selectionMethod === "provider") {
    const providerInput = join(folder, "provider-input.png");
    if (extension === "pcraft" || extension === "psd")
      await run(["convert", input, providerInput]);
    const maskResponse = await fetchMask(
      await readFile(
        extension === "pcraft" || extension === "psd" ? providerInput : input,
      ),
      extension === "pcraft" || extension === "psd" ? "image/png" : mime,
    );
    if (!maskResponse.ok)
      throw new Error(`AI 分割服务不可用（HTTP ${maskResponse.status}）`);
    if (!maskResponse.contentType.startsWith("image/png"))
      throw new Error("AI 分割服务未返回 PNG 蒙版");
    const maskBytes = maskResponse.bytes;
    if (!maskBytes || maskBytes.length === 0 || maskBytes.length > maxBytes)
      throw new Error("AI 蒙版大小无效");
    const mask = join(folder, "provider-mask.png");
    await writeFile(mask, maskBytes);
    commands.push(
      ...(await loadMaskSelection({
        run,
        input,
        mask,
        width: infoInput.width,
        height: infoInput.height,
        sizeError: "AI 蒙版尺寸与原图不一致",
        emptyError: "AI 蒙版没有选中主体，请换图或使用 PhotoCraft 手工选区",
      })),
    );
    // subject/background targets resolve from the mask alone on any image; a
    // drawn scope stays available as an optional refinement, not a requirement.
    const subjectLevelTarget =
      plan.target === "subject" || plan.target === "background";
    if (plan.target === "background") command("select.inverse", {});
    if (subjectLevelTarget && outline.length < 3 && !rect) {
      // mask-only selection: nothing to intersect
    } else if (outline.length >= 3)
      command("select.lasso", {
        points: outline,
        mode: "intersect",
        feather: providerScopeFeather,
      });
    else
      command("select.rect", {
        x: rect[0],
        y: rect[1],
        width: rect[2],
        height: rect[3],
        mode: "intersect",
        feather: providerScopeFeather,
      });
  } else if (requiresSelection && selectionMethod === "mask") {
    // C 项：候选真实像素蒙版 → PhotoCraft 原生选区，与 provider 蒙版同一条
    // 命令链；蒙版即精确范围，不做范围交集（outline 仅作套索降级的数据，
    // 此处不再叠加）。edgeShift/edgeFeather/patches/protectRect 公共尾部
    // 照常叠加在选区之上。
    commands.push(
      ...(await loadMaskSelection({
        run,
        input,
        mask: maskPath,
        width: infoInput.width,
        height: infoInput.height,
        sizeError: "候选蒙版尺寸与文档不一致，请重新确认候选",
        emptyError: "候选蒙版没有选中任何像素，请重新确认候选或改用轮廓套索",
      })),
    );
  } else if (requiresSelection && outline.length >= 3)
    command("select.lasso", {
      points: outline,
      mode: "replace",
      feather: 0,
    });
  else if (
    requiresSelection &&
    plan.operation === "recolor" &&
    points.length >= 2
  )
    command("select.colorRange", { points, fuzziness: 100 });
  if (
    requiresSelection &&
    selectionMethod === "manual" &&
    rect &&
    outline.length < 3
  )
    command("select.rect", {
      x: rect[0],
      y: rect[1],
      width: rect[2],
      height: rect[3],
      mode:
        plan.operation === "recolor" && points.length >= 2
          ? "intersect"
          : "replace",
      feather: 0,
    });
  if (requiresSelection && edgeShift !== 0)
    command(edgeShift > 0 ? "select.modify.expand" : "select.modify.contract", {
      radius: Math.abs(edgeShift),
    });
  if (
    plan.operation === "recolor" &&
    requiresSelection &&
    selectionMethod === "manual" &&
    outline.length >= 3 &&
    points.length >= 2
  )
    command("select.colorRange", {
      points,
      fuzziness: 100,
      mode: "intersect",
    });
  if (requiresSelection)
    for (const patch of patches)
      command("select.lasso", {
        points: patch.points,
        mode: patch.mode,
        feather: 0,
      });
  if (requiresSelection && edgeFeather > 0)
    command("select.modify.feather", { radius: edgeFeather });
  if (requiresSelection && protectRect)
    command("select.rect", {
      x: protectRect[0],
      y: protectRect[1],
      width: protectRect[2],
      height: protectRect[3],
      mode: "subtract",
      feather: 1,
    });
  return commands;
}

export function verifySelection({
  requiresSelection,
  selectionMethod,
  info,
  plan,
  selectionIsLargeEnough,
}) {
  if (
    requiresSelection &&
    selectionMethod === "object" &&
    !selectionIsLargeEnough(
      info.selectionBounds,
      plan.target,
      info.width,
      info.height,
    )
  )
    throw new Error(
      "PhotoCraft 精修后选区过小，无法形成可见换色。请扩大画框并重新预览。",
    );
  if (
    requiresSelection &&
    ["provider", "mask"].includes(selectionMethod) &&
    !info.selectionBounds
  )
    throw new Error(
      selectionMethod === "mask"
        ? "候选蒙版选区在编辑后丢失，请重新确认候选或改用轮廓套索。"
        : plan.target === "background"
          ? "主体蒙版几乎覆盖整张图，没有可编辑的背景区域。请改用画框指定局部范围。"
          : "AI 蒙版与局部范围没有交集，无法产生可见编辑。请调整轮廓点或画框后重新预览。",
    );
}
