import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Selection is prepared before any effect. The actual selection commands are PhotoCraft commands.
export async function prepareSelection({
  plan,
  infoInput,
  requiresSelection,
  selectionMethod,
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
  maskProvider,
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
    const maskResponse = await fetch(maskProvider, {
      method: "POST",
      headers: {
        "content-type":
          extension === "pcraft" || extension === "psd" ? "image/png" : mime,
      },
      body: await readFile(
        extension === "pcraft" || extension === "psd" ? providerInput : input,
      ),
      signal: AbortSignal.timeout(70_000),
    });
    if (!maskResponse.ok)
      throw new Error(`AI 分割服务不可用（HTTP ${maskResponse.status}）`);
    if (!maskResponse.headers.get("content-type")?.startsWith("image/png"))
      throw new Error("AI 分割服务未返回 PNG 蒙版");
    const maskBytes = Buffer.from(await maskResponse.arrayBuffer());
    if (maskBytes.length === 0 || maskBytes.length > maxBytes)
      throw new Error("AI 蒙版大小无效");
    const mask = join(folder, "provider-mask.png");
    await writeFile(mask, maskBytes);
    const maskInfo = JSON.parse(await run(["info", mask, "--compact"]));
    if (
      maskInfo.width !== infoInput.width ||
      maskInfo.height !== infoInput.height
    )
      throw new Error("AI 蒙版尺寸与原图不一致");
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
    if (maskSelection.result?.selected !== true)
      throw new Error("AI 蒙版没有选中主体，请换图或使用 PhotoCraft 手工选区");
    command("file.placeEmbedded", { path: mask, fit: false });
    command("select.loadSelection", {
      channel: "red",
      operation: "new",
    });
    command("layer.delete", {});
    if (outline.length >= 3)
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
    selectionMethod === "provider" &&
    !info.selectionBounds
  )
    throw new Error(
      "AI 蒙版与局部范围没有交集，无法产生可见编辑。请调整轮廓点或画框后重新预览。",
    );
}
