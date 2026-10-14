import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { capabilityFor } from "./capability-manifest.mjs";
import {
  executeNativePlan,
  supportedCapabilities,
} from "./native-command-adapter.mjs";
import { prepareSelection, verifySelection } from "./selection-adapter.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = join(
  root,
  ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe",
);
const jobs = join(root, ".tools/photocraft-bridge/jobs");
const port = Number(process.env.PHOTOCRAFT_BRIDGE_PORT ?? 4112);
const pinnedVersion = "0.6.0";
const maxActiveRequests = 1;
let activeRequests = 0;
const maskProvider = "http://127.0.0.1:4101/v1/masks/remove-background";
const maxBytes = 20 * 1024 * 1024;
const origins = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
]);
const formats = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["application/x-photocraft", "pcraft"],
  ["application/octet-stream", "pcraft"],
  ["image/vnd.adobe.photoshop", "psd"],
]);

function json(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

async function body(request, limit = maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit)
      throw new Error(`文件超过 ${Math.round(limit / 1024 / 1024)} MB 限制`);
    chunks.push(chunk);
  }
  if (size === 0) throw new Error("图片为空");
  return Buffer.concat(chunks);
}

function run(args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(cli, args, { cwd: root, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 120_000);
    child.stdout.on("data", (data) => {
      stdout = (stdout + data.toString()).slice(-64_000);
    });
    child.stderr.on("data", (data) => {
      stderr = (stderr + data.toString()).slice(-64_000);
    });
    child.on("error", rejectRun);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) rejectRun(new Error("PhotoCraft 任务超时，请重试"));
      else if (code === 0) resolveRun(stdout);
      else
        rejectRun(
          new Error(stderr.slice(0, 500) || `PhotoCraft 退出码 ${code}`),
        );
    });
  });
}

async function objectSelection(input, rect) {
  const output = await run([
    "run",
    input,
    "--cmd",
    "select.object",
    "--params",
    JSON.stringify({ rect, mode: "replace" }),
  ]);
  const result = JSON.parse(output.trim().split("\n").at(-1));
  return result.result?.selected === true ? result.result.bounds : null;
}

function selectionIsLargeEnough(bounds, target, width, height) {
  if (!bounds) return false;
  const minimumRatio = target === "hat" ? 0.05 : target === "brim" ? 0.01 : 0;
  return bounds[2] * bounds[3] >= width * height * minimumRatio;
}

function expandRect(rect, width, height) {
  const marginX = Math.max(12, Math.round(rect[2] * 0.1));
  const marginY = Math.max(12, Math.round(rect[3] * 0.1));
  const left = Math.max(0, rect[0] - marginX);
  const top = Math.max(0, rect[1] - marginY);
  const right = Math.min(width, rect[0] + rect[2] + marginX);
  const bottom = Math.min(height, rect[1] + rect[3] + marginY);
  return [left, top, right - left, bottom - top];
}

async function handleRequest(request, response) {
  const origin = request.headers.origin;
  if (origin && !origins.has(origin)) {
    json(response, 403, { error: "来源不允许" });
    return;
  }
  if (origin) response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader(
    "access-control-allow-headers",
    "content-type, x-acs-hue, x-acs-plan, x-acs-points, x-acs-rect, x-acs-outline, x-acs-patches, x-acs-edge-shift, x-acs-edge-feather, x-acs-protect-rect, x-acs-selection-method, x-acs-heal-size, x-acs-provider-scope-feather, x-acs-source-job, x-acs-generation-rect, x-acs-generation-selection, x-acs-generation-outline, x-acs-foreground-selection, x-acs-foreground-outline, x-acs-foreground-patches, x-acs-foreground-rect, x-acs-background-shadow",
  );
  response.setHeader("cache-control", "no-store");
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (request.method === "GET" && url.pathname === "/health") {
    json(response, 200, {
      ok: true,
      engine: "PhotoCraft",
      version: pinnedVersion,
      activeRequests,
      maxActiveRequests,
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/v1/capabilities") {
    try {
      json(response, 200, {
        engine: "PhotoCraft",
        version: pinnedVersion,
        groups: supportedCapabilities(cli),
      });
    } catch (error) {
      json(response, 500, {
        error: error instanceof Error ? error.message : "命令目录不可用",
      });
    }
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/normalize") {
    try {
      const mime = (request.headers["content-type"] ?? "").split(";")[0];
      const extension = formats.get(mime);
      if (!extension) throw new Error("不支持的 PhotoCraft 文件格式");
      const id = randomUUID();
      const folder = join(jobs, id);
      await mkdir(folder, { recursive: true });
      const input = join(folder, `input.${extension}`);
      const source = join(folder, "edited.pcraft");
      await writeFile(input, await body(request, 64 * 1024 * 1024));
      await run(["convert", input, source]);
      const info = JSON.parse(await run(["info", source, "--compact"]));
      json(response, 200, {
        id,
        width: info.width,
        height: info.height,
        layers: info.layers?.length ?? 0,
        sourceUrl: `/v1/jobs/${id}/source`,
      });
    } catch (error) {
      json(response, 400, {
        error: error instanceof Error ? error.message : "格式转换失败",
      });
    }
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/preview") {
    try {
      const mime = (request.headers["content-type"] ?? "").split(";")[0];
      const extension = formats.get(mime);
      if (!extension) throw new Error("不支持的图片格式");
      const id = randomUUID();
      const folder = join(jobs, id);
      await mkdir(folder, { recursive: true });
      const input = join(folder, `input.${extension}`);
      const preview = join(folder, "preview.png");
      await writeFile(
        input,
        await body(
          request,
          extension === "pcraft" ? 64 * 1024 * 1024 : maxBytes,
        ),
      );
      await run(["convert", input, preview]);
      json(response, 200, { previewUrl: `/v1/jobs/${id}/preview` });
    } catch (error) {
      json(response, 400, {
        error: error instanceof Error ? error.message : "预览失败",
      });
    }
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/inspect") {
    try {
      const mime = (request.headers["content-type"] ?? "").split(";")[0];
      const extension = formats.get(mime);
      if (!extension) throw new Error("不支持的图片格式");
      const id = randomUUID();
      const folder = join(jobs, id);
      await mkdir(folder, { recursive: true });
      const input = join(folder, `input.${extension}`);
      await writeFile(
        input,
        await body(
          request,
          extension === "pcraft" ? 64 * 1024 * 1024 : maxBytes,
        ),
      );
      const info = JSON.parse(await run(["info", input, "--compact"]));
      const profileResult = await run([
        "run",
        input,
        "--cmd",
        "edit.profileInfo",
        "--params",
        JSON.stringify({ profile: "document" }),
      ]);
      const profile = JSON.parse(profileResult.trim().split("\n").at(-1)).result
        ?.profile;
      json(response, 200, {
        width: info.width,
        height: info.height,
        layers: info.layers?.length ?? 0,
        activeLayer: info.activeLayer ?? null,
        selectedLayers: info.selectedLayers ?? [],
        layerDetails: (info.layers ?? []).map((layer) => ({
          id: layer.id,
          name: layer.name,
          kind: layer.kind,
          visible: layer.visible,
          selected: layer.selected === true,
          hasMask: layer.hasMask === true,
        })),
        hasSelection: info.hasSelection === true,
        selectionBounds: info.selectionBounds ?? null,
        profile: profile?.description ?? "未知配置",
        colorSpace: profile?.colorSpace ?? info.mode,
      });
    } catch (error) {
      json(response, 400, {
        error: error instanceof Error ? error.message : "图片信息读取失败",
      });
    }
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/prepare-foreground") {
    try {
      const sourceJob = request.headers["x-acs-source-job"];
      if (typeof sourceJob !== "string" || !/^[0-9a-f-]{36}$/.test(sourceJob))
        throw new Error("原生源引用无效");
      const selectionSource =
        request.headers["x-acs-foreground-selection"] ?? "provider";
      if (
        !["provider", "existing", "outline", "object"].includes(selectionSource)
      )
        throw new Error("前景选区来源无效");
      const outline = JSON.parse(
        request.headers["x-acs-foreground-outline"] ?? "[]",
      );
      const patches = JSON.parse(
        request.headers["x-acs-foreground-patches"] ?? "[]",
      );
      const objectRect = JSON.parse(
        request.headers["x-acs-foreground-rect"] ?? "null",
      );
      const validPoint = (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        point.every((value) => Number.isInteger(value) && value >= 0);
      if (
        !Array.isArray(outline) ||
        outline.length > 512 ||
        !outline.every(validPoint) ||
        (selectionSource === "outline" && outline.length < 3) ||
        (selectionSource === "object" &&
          (!Array.isArray(objectRect) ||
            objectRect.length !== 4 ||
            !objectRect.every(
              (value) => Number.isInteger(value) && value >= 0,
            ) ||
            objectRect[2] < 4 ||
            objectRect[3] < 4)) ||
        !Array.isArray(patches) ||
        patches.length > 8 ||
        !patches.every(
          (patch) =>
            ["add", "subtract"].includes(patch?.mode) &&
            Array.isArray(patch.points) &&
            patch.points.length >= 3 &&
            patch.points.length <= 24 &&
            patch.points.every(validPoint),
        )
      )
        throw new Error("前景选区修正无效");
      const input = join(jobs, sourceJob, "edited.pcraft");
      const before = JSON.parse(await run(["info", input, "--compact"]));
      if (before.layers.length !== 1)
        throw new Error("请先导出单层合成图后重新导入");
      if (selectionSource === "existing" && !before.hasSelection)
        throw new Error("PhotoCraft 源文件没有可复用的主体选区");
      if (
        [...outline, ...patches.flatMap((patch) => patch.points)].some(
          ([x, y]) => x >= before.width || y >= before.height,
        )
      )
        throw new Error("前景轮廓超出图片范围");
      if (
        selectionSource === "object" &&
        (objectRect[0] + objectRect[2] > before.width ||
          objectRect[1] + objectRect[3] > before.height)
      )
        throw new Error("主体框超出图片范围");
      const id = randomUUID();
      const folder = join(jobs, id);
      await mkdir(folder, { recursive: true });
      const source = join(folder, "edited.pcraft");
      const preview = join(folder, "preview.png");
      let providerMask = null;
      if (selectionSource === "provider") {
        const providerInput = join(folder, "provider-input.png");
        await run(["convert", input, providerInput]);
        const maskResponse = await fetch(maskProvider, {
          method: "POST",
          headers: { "content-type": "image/png" },
          body: await readFile(providerInput),
          signal: AbortSignal.timeout(70_000),
        });
        if (
          !maskResponse.ok ||
          !maskResponse.headers.get("content-type")?.startsWith("image/png")
        )
          throw new Error(
            "主体分割服务不可用，请改用 PhotoCraft 选区或手工轮廓",
          );
        const maskBytes = Buffer.from(await maskResponse.arrayBuffer());
        if (maskBytes.length === 0 || maskBytes.length > maxBytes)
          throw new Error("主体边缘蒙版无效");
        providerMask = join(folder, "provider-mask.png");
        await writeFile(providerMask, maskBytes);
        const maskInfo = JSON.parse(
          await run(["info", providerMask, "--compact"]),
        );
        if (
          maskInfo.width !== before.width ||
          maskInfo.height !== before.height
        )
          throw new Error("主体边缘蒙版尺寸与原图不一致");
      }
      const commands = [
        ...(selectionSource === "outline"
          ? [
              {
                id: "select.lasso",
                params: { points: outline, mode: "replace", feather: 0 },
              },
            ]
          : []),
        ...(selectionSource === "object"
          ? [
              {
                id: "select.object",
                params: {
                  rect: objectRect,
                  mode: "replace",
                  sampleAllLayers: true,
                },
              },
            ]
          : []),
        ...(providerMask
          ? [
              {
                id: "file.placeEmbedded",
                params: { path: providerMask, fit: false },
              },
              {
                id: "select.loadSelection",
                params: { channel: "red", operation: "new" },
              },
              { id: "layer.delete", params: {} },
            ]
          : []),
        ...patches.map((patch) => ({
          id: "select.lasso",
          params: { points: patch.points, mode: patch.mode, feather: 0 },
        })),
        { id: "layer.duplicate", params: { inPlace: true } },
        { id: "layer.layerMask.revealSelection", params: {} },
        { id: "select.deselect", params: {} },
        { id: "layer.newFillLayer.solidColor", params: { color: "#d8c7ad" } },
        { id: "layer.arrange.sendBackward", params: {} },
      ];
      await executeNativePlan({ cli, input, output: source, run, commands });
      const after = JSON.parse(await run(["info", source, "--compact"]));
      if (
        after.layers.length !== 3 ||
        !after.layers[0]?.hasMask ||
        after.layers[1]?.kind !== "Fill"
      )
        throw new Error("PhotoCraft 未建立可修正的主体预览");
      await writeFile(join(folder, "foreground-prepared.flag"), "1", "utf8");
      await run(["convert", source, preview]);
      json(response, 200, {
        id,
        width: after.width,
        height: after.height,
        layers: after.layers.length,
        previewUrl: `/v1/jobs/${id}/preview`,
        sourceUrl: `/v1/jobs/${id}/source`,
      });
    } catch (error) {
      json(response, 400, {
        error: error instanceof Error ? error.message : "主体蒙版预览失败",
      });
    }
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/compose-background") {
    try {
      if ((request.headers["content-type"] ?? "").split(";")[0] !== "image/png")
        throw new Error("背景结果必须是 PNG");
      const sourceJob = request.headers["x-acs-source-job"];
      if (typeof sourceJob !== "string" || !/^[0-9a-f-]{36}$/.test(sourceJob))
        throw new Error("原生源引用无效");
      const selectionSource =
        request.headers["x-acs-foreground-selection"] ?? "provider";
      if (
        !["subject", "existing", "provider", "prepared"].includes(
          selectionSource,
        )
      )
        throw new Error("前景选区来源无效");
      const shadow = request.headers["x-acs-background-shadow"] ?? "off";
      if (!["on", "off"].includes(shadow)) throw new Error("投影选项无效");
      const input = join(jobs, sourceJob, "edited.pcraft");
      const before = JSON.parse(await run(["info", input, "--compact"]));
      if (selectionSource !== "prepared" && before.layers.length !== 1)
        throw new Error(
          "换背景目前需要单层原图，请先在 PhotoCraft 中导出合成图后重新导入",
        );
      if (selectionSource === "prepared") {
        const marker = await readFile(
          join(jobs, sourceJob, "foreground-prepared.flag"),
          "utf8",
        ).catch(() => null);
        if (
          marker !== "1" ||
          before.layers.length !== 3 ||
          !before.layers[0]?.hasMask ||
          before.layers[1]?.kind !== "Fill"
        )
          throw new Error("主体蒙版预览无效，请重新检查选区");
      }
      if (selectionSource === "existing" && !before.hasSelection)
        throw new Error("PhotoCraft 源文件没有可复用的前景选区");
      const generated = await body(request, 25 * 1024 * 1024);
      if (
        !generated
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        throw new Error("背景结果不是 PNG");
      const id = randomUUID();
      const folder = join(jobs, id);
      await mkdir(folder, { recursive: true });
      const generatedPath = join(folder, "background.png");
      const resizedPath = join(folder, "background-resized.png");
      const foregroundSource = join(folder, "foreground.pcraft");
      const source = join(folder, "edited.pcraft");
      const preview = join(folder, "preview.png");
      await writeFile(generatedPath, generated);
      const generatedInfo = JSON.parse(
        await run(["info", generatedPath, "--compact"]),
      );
      if (
        generatedInfo.width !== before.width ||
        generatedInfo.height !== before.height
      )
        await run([
          "run",
          generatedPath,
          "--cmd",
          "image.imageSize",
          "--params",
          JSON.stringify({
            width: before.width,
            height: before.height,
            resample: "lanczos",
          }),
          "--out",
          resizedPath,
        ]);
      const placed =
        generatedInfo.width === before.width &&
        generatedInfo.height === before.height
          ? generatedPath
          : resizedPath;
      if (selectionSource === "prepared") {
        const foregroundId = before.layers[0].id;
        await executeNativePlan({
          cli,
          input,
          output: source,
          run,
          commands: [
            {
              id: "layer.select",
              params: { layer: before.layers[1].id, mode: "replace" },
            },
            { id: "layer.delete", params: {} },
            { id: "file.placeEmbedded", params: { path: placed, fit: false } },
            { id: "layer.arrange.sendBackward", params: {} },
            ...(shadow === "on"
              ? [
                  {
                    id: "layer.layerStyle.dropShadow",
                    params: {
                      color: "#493522",
                      opacity: 38,
                      blend: "multiply",
                      angle: 105,
                      distance: 22,
                      spread: 0,
                      size: 45,
                      layer: foregroundId,
                    },
                  },
                ]
              : []),
          ],
        });
        const after = JSON.parse(await run(["info", source, "--compact"]));
        if (
          after.layers.length !== 3 ||
          !after.layers[0]?.hasMask ||
          after.layers[1]?.kind !== "Smart Object" ||
          (shadow === "on" &&
            !after.layers[0]?.effects?.items?.some(
              (item) => item.kind === "Drop Shadow",
            ))
        )
          throw new Error("PhotoCraft 未保留已修正蒙版、独立背景或投影");
        await run(["convert", source, preview]);
        json(response, 200, {
          id,
          width: after.width,
          height: after.height,
          layers: after.layers.length,
          previewUrl: `/v1/jobs/${id}/preview`,
          sourceUrl: `/v1/jobs/${id}/source`,
        });
        return;
      }
      let providerMask = null;
      if (selectionSource === "provider") {
        const providerInput = join(folder, "provider-input.png");
        await run(["convert", input, providerInput]);
        const maskResponse = await fetch(maskProvider, {
          method: "POST",
          headers: { "content-type": "image/png" },
          body: await readFile(providerInput),
          signal: AbortSignal.timeout(70_000),
        });
        if (
          !maskResponse.ok ||
          !maskResponse.headers.get("content-type")?.startsWith("image/png")
        )
          throw new Error(
            "主体边缘分割服务不可用，请在 PhotoCraft 中建立主体选区后重试",
          );
        const maskBytes = Buffer.from(await maskResponse.arrayBuffer());
        if (maskBytes.length === 0 || maskBytes.length > maxBytes)
          throw new Error("主体边缘蒙版无效");
        providerMask = join(folder, "provider-mask.png");
        await writeFile(providerMask, maskBytes);
        const maskInfo = JSON.parse(
          await run(["info", providerMask, "--compact"]),
        );
        if (
          maskInfo.width !== before.width ||
          maskInfo.height !== before.height
        )
          throw new Error("主体边缘蒙版尺寸与原图不一致");
      }
      await executeNativePlan({
        cli,
        input,
        output: foregroundSource,
        run,
        commands: [
          ...(selectionSource === "subject"
            ? [
                {
                  id: "select.subject",
                  params: { sampleAllLayers: true, mode: "replace" },
                },
              ]
            : []),
          ...(providerMask
            ? [
                {
                  id: "file.placeEmbedded",
                  params: { path: providerMask, fit: false },
                },
                {
                  id: "select.loadSelection",
                  params: { channel: "red", operation: "new" },
                },
                { id: "layer.delete", params: {} },
              ]
            : []),
          { id: "layer.duplicate", params: { inPlace: true } },
          { id: "layer.layerMask.revealSelection", params: {} },
        ],
      });
      const foregroundInfo = JSON.parse(
        await run(["info", foregroundSource, "--compact"]),
      );
      const foregroundId = foregroundInfo.activeLayer;
      if (
        !foregroundInfo.layers.find((layer) => layer.id === foregroundId)
          ?.hasMask
      )
        throw new Error("PhotoCraft 未建立可编辑的前景蒙版");
      await executeNativePlan({
        cli,
        input: foregroundSource,
        output: source,
        run,
        commands: [
          { id: "select.deselect", params: {} },
          { id: "file.placeEmbedded", params: { path: placed, fit: false } },
          { id: "layer.arrange.sendBackward", params: {} },
          ...(shadow === "on"
            ? [
                {
                  id: "layer.layerStyle.dropShadow",
                  params: {
                    color: "#493522",
                    opacity: 38,
                    blend: "multiply",
                    angle: 105,
                    distance: 22,
                    spread: 0,
                    size: 45,
                    layer: foregroundId,
                  },
                },
              ]
            : []),
        ],
      });
      const after = JSON.parse(await run(["info", source, "--compact"]));
      if (
        after.layers.length !== 3 ||
        !after.layers[0]?.hasMask ||
        after.layers[1]?.kind !== "Smart Object"
      )
        throw new Error("PhotoCraft 未建立原图前景蒙版与独立背景图层");
      if (
        shadow === "on" &&
        !after.layers[0]?.effects?.items?.some(
          (item) => item.kind === "Drop Shadow",
        )
      )
        throw new Error("PhotoCraft 未把投影添加到前景图层");
      await run(["convert", source, preview]);
      json(response, 200, {
        id,
        width: after.width,
        height: after.height,
        layers: after.layers.length,
        previewUrl: `/v1/jobs/${id}/preview`,
        sourceUrl: `/v1/jobs/${id}/source`,
      });
    } catch (error) {
      json(response, 400, {
        error: error instanceof Error ? error.message : "背景合成失败",
      });
    }
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/compose-generated") {
    try {
      if ((request.headers["content-type"] ?? "").split(";")[0] !== "image/png")
        throw new Error("生成结果必须是 PNG");
      const sourceJob = request.headers["x-acs-source-job"];
      if (typeof sourceJob !== "string" || !/^[0-9a-f-]{36}$/.test(sourceJob))
        throw new Error("原生源引用无效");
      const rect = JSON.parse(
        request.headers["x-acs-generation-rect"] ?? "null",
      );
      const outline = JSON.parse(
        request.headers["x-acs-generation-outline"] ?? "[]",
      );
      const selectionSource =
        request.headers["x-acs-generation-selection"] ?? "new";
      if (!["new", "existing", "object"].includes(selectionSource))
        throw new Error("局部生成选区来源无效");
      if (
        !Array.isArray(rect) ||
        rect.length !== 4 ||
        !rect.every(Number.isInteger)
      )
        throw new Error("局部生成范围无效");
      if (
        !Array.isArray(outline) ||
        outline.length > 512 ||
        (outline.length > 0 && outline.length < 3) ||
        !outline.every(
          (point) =>
            Array.isArray(point) &&
            point.length === 2 &&
            point.every(Number.isInteger),
        )
      )
        throw new Error("局部生成轮廓无效");
      const input = join(jobs, sourceJob, "edited.pcraft");
      const before = JSON.parse(await run(["info", input, "--compact"]));
      if (selectionSource === "existing" && !before.hasSelection)
        throw new Error("PhotoCraft 源文件没有可复用的选区");
      if (selectionSource === "existing" && outline.length > 0)
        throw new Error("不能同时使用当前选区和轮廓");
      if (
        rect[0] < 0 ||
        rect[1] < 0 ||
        rect[2] < 1 ||
        rect[3] < 1 ||
        rect[0] + rect[2] > before.width ||
        rect[1] + rect[3] > before.height
      )
        throw new Error("局部生成范围超出图片");
      if (
        outline.some(
          ([x, y]) => x < 0 || y < 0 || x >= before.width || y >= before.height,
        )
      )
        throw new Error("局部生成轮廓超出图片");
      const generated = await body(request, 25 * 1024 * 1024);
      if (
        !generated
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        throw new Error("生成结果不是 PNG");
      const id = randomUUID();
      const folder = join(jobs, id);
      await mkdir(folder, { recursive: true });
      const generatedPath = join(folder, "generated.png");
      const resizedPath = join(folder, "generated-resized.png");
      const source = join(folder, "edited.pcraft");
      const preview = join(folder, "preview.png");
      await writeFile(generatedPath, generated);
      const generatedInfo = JSON.parse(
        await run(["info", generatedPath, "--compact"]),
      );
      if (
        generatedInfo.width !== before.width ||
        generatedInfo.height !== before.height
      )
        await run([
          "run",
          generatedPath,
          "--cmd",
          "image.imageSize",
          "--params",
          JSON.stringify({
            width: before.width,
            height: before.height,
            resample: "lanczos",
          }),
          "--out",
          resizedPath,
        ]);
      const placed =
        generatedInfo.width === before.width &&
        generatedInfo.height === before.height
          ? generatedPath
          : resizedPath;
      await executeNativePlan({
        cli,
        input,
        output: source,
        run,
        commands: [
          ...(selectionSource === "existing"
            ? []
            : [
                outline.length >= 3
                  ? {
                      id: "select.lasso",
                      params: { points: outline, mode: "replace", feather: 0 },
                    }
                  : selectionSource === "object"
                    ? { id: "select.object", params: { rect, mode: "replace" } }
                    : {
                        id: "select.rect",
                        params: {
                          x: rect[0],
                          y: rect[1],
                          width: rect[2],
                          height: rect[3],
                          mode: "replace",
                          feather: 0,
                        },
                      },
              ]),
          ...(selectionSource === "object"
            ? [
                {
                  id: "select.refineEdge",
                  params: { radius: 3, smartRadius: true, output: "selection" },
                },
              ]
            : outline.length >= 3
              ? [
                  {
                    id: "select.modify.expand",
                    params: { radius: 1, applyAtCanvasBounds: false },
                  },
                ]
              : []),
          { id: "select.modify.feather", params: { radius: 3 } },
          { id: "file.placeEmbedded", params: { path: placed, fit: false } },
          { id: "layer.layerMask.revealSelection", params: {} },
        ],
      });
      const after = JSON.parse(await run(["info", source, "--compact"]));
      if (
        after.layers.length !== before.layers.length + 1 ||
        !after.layers.find((layer) => layer.id === after.activeLayer)?.hasMask
      )
        throw new Error("PhotoCraft 未保留可编辑的生成结果蒙版");
      await run(["convert", source, preview]);
      json(response, 200, {
        id,
        width: after.width,
        height: after.height,
        layers: after.layers.length,
        previewUrl: `/v1/jobs/${id}/preview`,
        sourceUrl: `/v1/jobs/${id}/source`,
      });
    } catch (error) {
      json(response, 400, {
        error: error instanceof Error ? error.message : "生成结果导入失败",
      });
    }
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/export") {
    try {
      const mime = (request.headers["content-type"] ?? "").split(";")[0];
      const extension = formats.get(mime);
      const format = url.searchParams.get("format");
      const profile = url.searchParams.get("profile");
      if (
        !extension ||
        !["png", "jpg", "webp", "tif", "psd"].includes(format) ||
        !["preserve", "srgb"].includes(profile)
      )
        throw new Error("导出格式或色彩配置无效");
      const id = randomUUID();
      const folder = join(jobs, id);
      await mkdir(folder, { recursive: true });
      const input = join(folder, `input.${extension}`);
      const converted = join(folder, "srgb.pcraft");
      const output = join(folder, `export.${format}`);
      await writeFile(
        input,
        await body(
          request,
          extension === "pcraft" ? 64 * 1024 * 1024 : maxBytes,
        ),
      );
      let source = input;
      if (profile === "srgb") {
        await run([
          "run",
          input,
          "--cmd",
          "edit.convertToProfile",
          "--params",
          JSON.stringify({ profile: "srgb", intent: "relative", bpc: true }),
          "--out",
          converted,
        ]);
        source = converted;
      }
      await run(["convert", source, output]);
      const info = JSON.parse(await run(["info", output, "--compact"]));
      await writeFile(join(folder, "export-format.txt"), format, "utf8");
      json(response, 200, {
        id,
        width: info.width,
        height: info.height,
        layers: info.layers?.length ?? 0,
        format,
        profile,
        downloadUrl: `/v1/jobs/${id}/export`,
      });
    } catch (error) {
      json(response, 400, {
        error: error instanceof Error ? error.message : "导出失败",
      });
    }
    return;
  }
  const strokeMatch = /^\/v1\/jobs\/([0-9a-f-]{36})\/mask-stroke$/.exec(
    url.pathname,
  );
  if (request.method === "POST" && strokeMatch) {
    try {
      const params = JSON.parse((await body(request)).toString("utf8"));
      const { points, mode, size, hardness } = params;
      const validPoint = (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        point.every((value) => Number.isInteger(value) && value >= 0);
      if (
        !Array.isArray(points) ||
        points.length < 1 ||
        points.length > 512 ||
        !points.every(validPoint) ||
        !["add", "erase"].includes(mode) ||
        !Number.isInteger(size) ||
        size < 1 ||
        size > 300 ||
        typeof hardness !== "number" ||
        !Number.isFinite(hardness) ||
        hardness < 0 ||
        hardness > 1
      )
        throw new Error("蒙版笔触参数无效");
      const prior = join(jobs, strokeMatch[1], "edited.pcraft");
      const infoBefore = JSON.parse(await run(["info", prior, "--compact"]));
      const active = infoBefore.layers?.find(
        (layer) => layer.id === infoBefore.activeLayer,
      );
      if (!active?.hasMask) throw new Error("当前图层没有可精修的蒙版");
      if (
        points.some(([x, y]) => x >= infoBefore.width || y >= infoBefore.height)
      )
        throw new Error("蒙版笔触超出图片范围");
      const id = randomUUID();
      const folder = join(jobs, id);
      await mkdir(folder, { recursive: true });
      const source = join(folder, "edited.pcraft");
      const preview = join(folder, "preview.png");
      const commands = ["run", prior];
      if (infoBefore.hasSelection) commands.push("--cmd", "select.deselect");
      commands.push(
        "--cmd",
        "paint.stroke",
        "--params",
        JSON.stringify({
          points,
          size,
          hardness,
          opacity: 1,
          color: mode === "add" ? "#ffffff" : "#000000",
          target: "mask",
        }),
        "--out",
        source,
      );
      await run(commands);
      const prepared = await readFile(
        join(jobs, strokeMatch[1], "foreground-prepared.flag"),
        "utf8",
      ).catch(() => null);
      if (prepared === "1")
        await writeFile(join(folder, "foreground-prepared.flag"), "1", "utf8");
      const info = JSON.parse(await run(["info", source, "--compact"]));
      if (!info.layers?.find((layer) => layer.id === active.id)?.hasMask)
        throw new Error("PhotoCraft 未保留可编辑蒙版");
      await run(["convert", source, preview]);
      json(response, 200, {
        id,
        width: info.width,
        height: info.height,
        layers: info.layers.length,
        previewUrl: `/v1/jobs/${id}/preview`,
        sourceUrl: `/v1/jobs/${id}/source`,
      });
    } catch (error) {
      json(response, 400, {
        error: error instanceof Error ? error.message : "蒙版精修失败",
      });
    }
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/instruction") {
    try {
      const mime = (request.headers["content-type"] ?? "").split(";")[0];
      const extension = formats.get(mime);
      if (!extension) throw new Error("不支持的图片格式");
      let plan,
        points,
        rect,
        outline,
        patches,
        edgeShift,
        edgeFeather,
        protectRect,
        selectionMethod,
        healSize,
        providerScopeFeather;
      try {
        plan = JSON.parse(request.headers["x-acs-plan"] ?? "");
        points = JSON.parse(request.headers["x-acs-points"] ?? "");
        rect = JSON.parse(request.headers["x-acs-rect"] ?? "null");
        outline = JSON.parse(request.headers["x-acs-outline"] ?? "[]");
        patches = JSON.parse(request.headers["x-acs-patches"] ?? "[]");
        edgeShift = Number(request.headers["x-acs-edge-shift"] ?? 0);
        edgeFeather = Number(request.headers["x-acs-edge-feather"] ?? 2);
        protectRect = JSON.parse(
          request.headers["x-acs-protect-rect"] ?? "null",
        );
        selectionMethod = request.headers["x-acs-selection-method"] ?? "manual";
        healSize = Number(request.headers["x-acs-heal-size"] ?? 32);
        providerScopeFeather = Number(
          request.headers["x-acs-provider-scope-feather"] ?? 80,
        );
      } catch {
        throw new Error("编辑计划或选区无效");
      }
      const validPoint = (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        point.every((n) => Number.isInteger(n) && n >= 0 && n <= 8192);
      const validRect = (value) =>
        Array.isArray(value) &&
        value.length === 4 &&
        value.every((n) => Number.isInteger(n) && n >= 0 && n <= 8192) &&
        value[2] > 0 &&
        value[3] > 0;
      const validPatch = (value) =>
        value &&
        ["add", "subtract"].includes(value.mode) &&
        Array.isArray(value.points) &&
        value.points.length >= 3 &&
        value.points.length <= 24 &&
        value.points.every(validPoint);
      const capability = capabilityFor(plan);
      if (
        !["manual", "object", "provider", "existing"].includes(
          selectionMethod,
        ) ||
        !["hat", "brim", "selected-area", "whole-image"].includes(
          plan.target,
        ) ||
        typeof plan.protectLabel !== "boolean" ||
        !Array.isArray(points) ||
        points.length > 6 ||
        !points.every(validPoint) ||
        !Array.isArray(outline) ||
        outline.length > 512 ||
        !outline.every(validPoint) ||
        (outline.length > 0 && outline.length < 3) ||
        !Array.isArray(patches) ||
        patches.length > 8 ||
        !patches.every(validPatch) ||
        !Number.isInteger(edgeShift) ||
        Math.abs(edgeShift) > 20 ||
        !Number.isInteger(edgeFeather) ||
        edgeFeather < 0 ||
        edgeFeather > 8 ||
        !Number.isInteger(healSize) ||
        healSize < 4 ||
        healSize > 160 ||
        !Number.isInteger(providerScopeFeather) ||
        providerScopeFeather < 0 ||
        providerScopeFeather > 120 ||
        (rect !== null && !validRect(rect)) ||
        (protectRect !== null && !validRect(protectRect))
      )
        throw new Error("编辑计划或选区参数无效");
      if (plan.protectLabel && !protectRect)
        throw new Error("请先画出标签保护框");
      const requiresSelection =
        capability.selection === "mask" && plan.target !== "whole-image";
      if (requiresSelection && selectionMethod === "object" && !rect)
        throw new Error("PhotoCraft 智能选物体需要先画出包含目标的矩形");
      if (
        requiresSelection &&
        selectionMethod === "provider" &&
        !rect &&
        outline.length < 3
      )
        throw new Error("AI 边缘蒙版需要画框或至少 3 个轮廓点");
      if (
        requiresSelection &&
        selectionMethod === "manual" &&
        plan.target === "brim" &&
        outline.length < 3
      )
        throw new Error("只编辑帽沿时请用轮廓点圈出帽沿");
      if (
        requiresSelection &&
        selectionMethod === "manual" &&
        plan.target === "selected-area" &&
        !rect &&
        outline.length < 3
      )
        throw new Error("请画出要编辑的区域");
      if (
        requiresSelection &&
        patches.length > 0 &&
        !rect &&
        outline.length < 3 &&
        points.length < 2
      )
        throw new Error("补选或剔除前请先建立主选区");
      capability.validate({
        plan,
        points,
        rect,
        outline,
        patches,
        edgeShift,
        edgeFeather,
        protectRect,
        selectionMethod,
      });
      const id = randomUUID();
      const folder = join(jobs, id);
      await mkdir(folder, { recursive: true });
      const input = join(folder, `input.${extension}`);
      const source = join(folder, "edited.pcraft");
      const preview = join(folder, "preview.png");
      await writeFile(
        input,
        await body(
          request,
          extension === "pcraft" ? 64 * 1024 * 1024 : maxBytes,
        ),
      );
      const infoInput = JSON.parse(await run(["info", input, "--compact"]));
      if (
        Number.isInteger(plan.expectedLayerId) &&
        infoInput.activeLayer !== plan.expectedLayerId
      )
        throw new Error(
          "PhotoCraft 当前图层已变化，请保存画布并重新解析编辑要求",
        );
      if (
        requiresSelection &&
        selectionMethod === "existing" &&
        !infoInput.hasSelection
      )
        throw new Error("PhotoCraft 当前没有选区，请先在画布建立选区并保存");
      const within = (value) =>
        !value ||
        (value[0] + value[2] <= infoInput.width &&
          value[1] + value[3] <= infoInput.height);
      if (
        points.some(
          ([x, y]) => x >= infoInput.width || y >= infoInput.height,
        ) ||
        outline.some(
          ([x, y]) => x >= infoInput.width || y >= infoInput.height,
        ) ||
        patches.some(({ points: patchPoints }) =>
          patchPoints.some(
            ([x, y]) => x >= infoInput.width || y >= infoInput.height,
          ),
        ) ||
        !within(rect) ||
        !within(protectRect)
      )
        throw new Error("取样点或选区超出图片范围");
      const commands = await prepareSelection({
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
      });
      for (const step of capability.commands({
        plan,
        points,
        rect,
        healSize,
        before: infoInput,
        selectionMethod,
      }))
        commands.push(step);
      await executeNativePlan({ cli, input, output: source, commands, run });
      const info = JSON.parse(await run(["info", source, "--compact"]));
      await capability.verify({
        plan,
        rect,
        before: infoInput,
        after: info,
        selectionMethod,
        run,
        source,
      });
      verifySelection({
        requiresSelection,
        selectionMethod,
        info,
        plan,
        selectionIsLargeEnough,
      });
      await run(["convert", source, preview]);
      json(response, 200, {
        id,
        width: info.width,
        height: info.height,
        layers: info.layers.length,
        selectionBounds: info.selectionBounds ?? null,
        previewUrl: `/v1/jobs/${id}/preview`,
        sourceUrl: `/v1/jobs/${id}/source`,
      });
    } catch (error) {
      json(response, 400, {
        error: error instanceof Error ? error.message : "局部编辑失败",
      });
    }
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/edit") {
    try {
      const mime = (request.headers["content-type"] ?? "").split(";")[0];
      const extension = formats.get(mime);
      const hue = Number(request.headers["x-acs-hue"]);
      if (!extension || !Number.isInteger(hue) || hue < -180 || hue > 180)
        throw new Error(
          "需要 PNG/JPEG/WebP/PhotoCraft 文件与 -180～180 的色相值",
        );
      const id = randomUUID();
      const folder = join(jobs, id);
      await mkdir(folder, { recursive: true });
      const input = join(folder, `input.${extension}`);
      const source = join(folder, "edited.pcraft");
      const preview = join(folder, "preview.png");
      await writeFile(
        input,
        await body(
          request,
          extension === "pcraft" ? 64 * 1024 * 1024 : maxBytes,
        ),
      );
      await run([
        "run",
        input,
        "--cmd",
        "image.adjustments.hueSaturation",
        "--params",
        JSON.stringify({ hue }),
        "--out",
        source,
      ]);
      const info = JSON.parse(await run(["info", source, "--compact"]));
      await run(["convert", source, preview]);
      json(response, 200, {
        id,
        width: info.width,
        height: info.height,
        layers: info.layers?.length ?? 0,
        previewUrl: `/v1/jobs/${id}/preview`,
        sourceUrl: `/v1/jobs/${id}/source`,
      });
    } catch (error) {
      json(response, 400, {
        error: error instanceof Error ? error.message : "编辑失败",
      });
    }
    return;
  }
  const match = /^\/v1\/jobs\/([0-9a-f-]{36})\/(preview|source|export)$/.exec(
    url.pathname,
  );
  if (request.method === "GET" && match) {
    try {
      const folder = join(jobs, match[1]);
      const exportFormat =
        match[2] === "export"
          ? await readFile(join(folder, "export-format.txt"), "utf8")
          : null;
      if (
        exportFormat &&
        !["png", "jpg", "webp", "tif", "psd"].includes(exportFormat)
      )
        throw new Error("导出格式无效");
      const file =
        match[2] === "preview"
          ? join(folder, "preview.png")
          : match[2] === "source"
            ? join(folder, "edited.pcraft")
            : exportFormat
              ? join(folder, `export.${exportFormat}`)
              : null;
      if (!file) throw new Error("导出文件不存在");
      const data = await readFile(file);
      response.writeHead(200, {
        "content-type":
          match[2] === "preview"
            ? "image/png"
            : match[2] === "export"
              ? {
                  png: "image/png",
                  jpg: "image/jpeg",
                  webp: "image/webp",
                  tif: "image/tiff",
                  psd: "image/vnd.adobe.photoshop",
                }[exportFormat]
              : "application/octet-stream",
        "content-length": data.length,
        ...(match[2] === "source"
          ? { "content-disposition": 'attachment; filename="edited.pcraft"' }
          : match[2] === "export"
            ? {
                "content-disposition": `attachment; filename="photocraft-export.${exportFormat}"`,
              }
            : {}),
      });
      response.end(data);
    } catch {
      json(response, 404, { error: "编辑文件不存在" });
    }
    return;
  }
  json(response, 404, { error: "未知路径" });
}

const detectedVersion = execFileSync(cli, ["--version"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
  timeout: 10_000,
}).trim();
if (!detectedVersion.startsWith(`photocraft-cli ${pinnedVersion} (`))
  throw new Error(`PhotoCraft 版本不匹配：${detectedVersion}`);

const server = createServer((request, response) => {
  const counted = request.method === "POST";
  if (counted && activeRequests >= maxActiveRequests) {
    response.setHeader("retry-after", "3");
    json(response, 429, { error: "PhotoCraft 任务繁忙，请稍后重试" });
    return;
  }
  if (counted) activeRequests++;
  void handleRequest(request, response)
    .catch((error) => {
      if (!response.headersSent)
        json(response, 500, {
          error: error instanceof Error ? error.message : "桥接任务失败",
        });
      else response.destroy(error);
    })
    .finally(() => {
      if (counted) activeRequests--;
    });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `PhotoCraft dev bridge listening on http://127.0.0.1:${port}\n`,
  );
});
