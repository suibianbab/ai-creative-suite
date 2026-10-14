import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client } from "@aws-sdk/client-s3";
import pg from "pg";
import sharp from "sharp";
import { AssetFoundation } from "../assets/asset-foundation.js";
import { inspectGeneratedComposite } from "./generation-quality.js";
import {
  type ImageGenerationProvider,
  QwenImageGenerationProvider,
} from "./image-generation-provider.js";
import {
  type ClaimedPhotoCraftJob,
  PHOTOCRAFT_JOB_OPERATIONS,
  PhotoCraftEditJobStore,
  type PhotoCraftGenerateParams,
  PhotoCraftJobValidationError,
  type PhotoCraftMaskedParams,
} from "./photocraft-edit-jobs.js";
import {
  PhotoCraftConflictError,
  PhotoCraftProjectStore,
} from "./photocraft-project-store.js";

const VERSION = "0.6.0";
const MAX_OUTPUT = 25 * 1024 * 1024;
class GenerationQualityError extends Error {}

type NativeInfo = {
  width?: number;
  height?: number;
  activeLayer?: number;
  hasSelection?: boolean;
  selectionBounds?: [number, number, number, number] | null;
  layers?: {
    id: number;
    visible: boolean;
    kind?: string;
    hasMask?: boolean;
    adjustment?: Record<string, unknown>;
  }[];
};

type NativeStep = { id: string; params: Record<string, unknown> };

function boundedRect(
  rect: [number, number, number, number],
  before: NativeInfo,
): boolean {
  return (
    rect[0] + rect[2] <= (before.width ?? 0) &&
    rect[1] + rect[3] <= (before.height ?? 0)
  );
}

function maskedSelectionSteps(
  before: NativeInfo,
  params: PhotoCraftMaskedParams,
): NativeStep[] {
  const { selection, edgeShift, edgeFeather, patches, protectRect } = params;
  const width = before.width ?? 0;
  const height = before.height ?? 0;
  if (selection.kind === "existing" && !before.hasSelection)
    throw new PhotoCraftJobValidationError(
      "Saved PhotoCraft selection is unavailable",
    );
  if (
    (selection.kind === "rect" || selection.kind === "object") &&
    !boundedRect(selection.rect, before)
  )
    throw new PhotoCraftJobValidationError(
      "PhotoCraft selection is outside the canvas",
    );
  if (
    selection.kind === "lasso" &&
    selection.points.some(([x, y]) => x >= width || y >= height)
  )
    throw new PhotoCraftJobValidationError(
      "PhotoCraft lasso is outside the canvas",
    );
  if (protectRect && !boundedRect(protectRect, before))
    throw new PhotoCraftJobValidationError(
      "PhotoCraft protection is outside the canvas",
    );
  if (
    patches.some((patch) =>
      patch.points.some(([x, y]) => x >= width || y >= height),
    )
  )
    throw new PhotoCraftJobValidationError(
      "PhotoCraft selection patch is outside the canvas",
    );
  const steps: NativeStep[] =
    selection.kind === "existing"
      ? []
      : selection.kind === "lasso"
        ? [
            {
              id: "select.lasso",
              params: { points: selection.points, mode: "replace", feather: 0 },
            },
          ]
        : selection.kind === "object"
          ? [
              {
                id: "select.object",
                params: { rect: selection.rect, mode: "replace" },
              },
              {
                id: "select.refineEdge",
                params: { radius: 3, smartRadius: true, output: "selection" },
              },
            ]
          : [
              {
                id: "select.rect",
                params: {
                  x: selection.rect[0],
                  y: selection.rect[1],
                  width: selection.rect[2],
                  height: selection.rect[3],
                  mode: "replace",
                  feather: 0,
                },
              },
            ];
  if (edgeShift !== 0)
    steps.push({
      id: edgeShift > 0 ? "select.modify.expand" : "select.modify.contract",
      params: { radius: Math.abs(edgeShift) },
    });
  for (const patch of patches)
    steps.push({
      id: "select.lasso",
      params: { points: patch.points, mode: patch.mode, feather: 0 },
    });
  if (edgeFeather > 0)
    steps.push({
      id: "select.modify.feather",
      params: { radius: edgeFeather },
    });
  if (protectRect)
    steps.push({
      id: "select.rect",
      params: {
        x: protectRect[0],
        y: protectRect[1],
        width: protectRect[2],
        height: protectRect[3],
        mode: "subtract",
        feather: 1,
      },
    });
  return steps;
}

export function photoCraftJobSteps(
  operation: ClaimedPhotoCraftJob["operation"],
  before: NativeInfo,
  params: Record<string, unknown> = {},
): NativeStep[] {
  if (operation === "generate-local")
    throw new Error("Generation requires the image Provider pipeline");
  if (
    operation === "duplicate-layer" ||
    operation === "hide-layer" ||
    operation === "show-layer"
  ) {
    const layer = before.layers?.find((item) => item.id === before.activeLayer);
    if (!layer) throw new Error("Selected PhotoCraft layer is unavailable");
    if (operation === "duplicate-layer")
      return [
        { id: "layer.select", params: { layer: layer.id, mode: "replace" } },
        { id: "layer.duplicate", params: { inPlace: true } },
      ];
    return [
      {
        id: "layer.setProps",
        params: { layer: layer.id, visible: operation === "show-layer" },
      },
    ];
  }
  if (operation === "levels")
    return [{ id: PHOTOCRAFT_JOB_OPERATIONS.levels, params }];
  if (
    operation.startsWith("adjust-") ||
    operation.startsWith("masked-adjust-")
  ) {
    const amount = params.amount as number;
    const adjustment = operation.replace(/^masked-/, "");
    const nativeParams: Record<string, unknown> =
      adjustment === "adjust-brightness"
        ? { brightness: amount }
        : adjustment === "adjust-contrast"
          ? { contrast: amount }
          : adjustment === "adjust-saturation"
            ? { saturation: amount }
            : adjustment === "adjust-exposure"
              ? { exposure: amount / 20 }
              : adjustment === "adjust-vibrance"
                ? { vibrance: amount }
                : {
                    points:
                      adjustment === "adjust-shadows"
                        ? [
                            [0, 0],
                            [64, 64 + amount],
                            [128, 128],
                            [255, 255],
                          ]
                        : [
                            [0, 0],
                            [128, 128],
                            [192, 192 + amount],
                            [255, 255],
                          ],
                  };
    const selectionSteps = operation.startsWith("masked-")
      ? maskedSelectionSteps(before, params as PhotoCraftMaskedParams)
      : [];
    return [
      ...selectionSteps,
      { id: PHOTOCRAFT_JOB_OPERATIONS[operation], params: nativeParams },
    ];
  }
  return [{ id: PHOTOCRAFT_JOB_OPERATIONS[operation], params: {} }];
}

export function verifyPhotoCraftJobResult(
  operation: ClaimedPhotoCraftJob["operation"],
  before: NativeInfo,
  after: NativeInfo,
  params: Record<string, unknown> = {},
): void {
  if (
    !Number.isInteger(after.width) ||
    !Number.isInteger(after.height) ||
    (after.width ?? 0) < 1 ||
    (after.height ?? 0) < 1 ||
    !after.layers?.length
  )
    throw new Error("Invalid PhotoCraft document");
  if (operation === "generate-local") {
    const layer = after.layers?.find((item) => item.id === after.activeLayer);
    if (
      after.width !== before.width ||
      after.height !== before.height ||
      after.layers?.length !== (before.layers?.length ?? 0) + 1 ||
      !layer?.hasMask ||
      !before.layers?.every((old) =>
        after.layers?.some((current) => current.id === old.id),
      ) ||
      !after.selectionBounds ||
      after.selectionBounds[2] < 1 ||
      after.selectionBounds[3] < 1
    )
      throw new GenerationQualityError(
        "PhotoCraft did not preserve editable generated layer and mask",
      );
  } else if (
    operation === "levels" ||
    operation.startsWith("adjust-") ||
    operation.startsWith("masked-adjust-")
  ) {
    const layer = after.layers[0];
    if (
      after.layers.length !== (before.layers?.length ?? 0) + 1 ||
      layer?.kind !== "Adjustment" ||
      !layer.hasMask ||
      !before.layers?.every((old) =>
        after.layers?.some((current) => current.id === old.id),
      )
    )
      throw new Error(
        "PhotoCraft did not preserve an editable adjustment layer",
      );
    if (
      operation.startsWith("masked-") &&
      (!after.selectionBounds ||
        after.selectionBounds[2] < 1 ||
        after.selectionBounds[3] < 1 ||
        after.selectionBounds[2] * after.selectionBounds[3] >=
          (after.width ?? 0) * (after.height ?? 0))
    )
      throw new PhotoCraftJobValidationError(
        "PhotoCraft did not preserve a local selection",
      );
    if (operation === "levels") {
      const master = (
        layer.adjustment?.Levels as
          | {
              master?: {
                in_black?: number;
                in_white?: number;
                gamma?: number;
              };
            }
          | undefined
      )?.master;
      if (
        !master ||
        Math.abs((master.in_black ?? -1) * 255 - (params.inBlack as number)) >
          0.02 ||
        Math.abs((master.in_white ?? -1) * 255 - (params.inWhite as number)) >
          0.02 ||
        Math.abs((master.gamma ?? -1) - (params.gamma as number)) > 0.001
      )
        throw new Error("PhotoCraft did not preserve requested levels");
    } else {
      const amount = params.amount as number;
      const adjustment = layer.adjustment;
      const baseOperation = operation.replace(/^masked-/, "");
      const branch =
        baseOperation === "adjust-brightness" ||
        baseOperation === "adjust-contrast"
          ? "BrightnessContrast"
          : baseOperation === "adjust-saturation"
            ? "HueSaturation"
            : baseOperation === "adjust-exposure"
              ? "Exposure"
              : baseOperation === "adjust-vibrance"
                ? "Vibrance"
                : "Curves";
      const data = adjustment?.[branch] as Record<string, unknown> | undefined;
      const field = baseOperation.slice("adjust-".length);
      const expected =
        baseOperation === "adjust-exposure" ? amount / 20 : amount;
      if (!data) throw new Error("PhotoCraft adjustment type is missing");
      if (field === "shadows" || field === "highlights") {
        const curve = data.master as
          | { input?: number; output?: number }[]
          | undefined;
        const index = field === "shadows" ? 1 : 2;
        const anchor = field === "shadows" ? 64 : 192;
        if (
          !Array.isArray(curve) ||
          curve.length !== 4 ||
          Math.abs((curve[index]?.input ?? -1) * 255 - anchor) > 0.02 ||
          Math.abs((curve[index]?.output ?? -1) * 255 - (anchor + amount)) >
            0.02
        )
          throw new Error("PhotoCraft did not preserve requested curve");
      } else {
        const value = data[field];
        if (typeof value !== "number" || Math.abs(value - expected) > 0.001)
          throw new Error(
            "PhotoCraft did not preserve requested adjustment amount",
          );
      }
    }
  } else if (operation === "duplicate-layer") {
    if (after.layers.length !== (before.layers?.length ?? 0) + 1)
      throw new Error("PhotoCraft did not duplicate the layer");
  } else if (operation === "hide-layer" || operation === "show-layer") {
    const layer = after.layers.find((item) => item.id === before.activeLayer);
    if (
      !layer ||
      layer.visible !== (operation === "show-layer") ||
      after.layers.length !== before.layers?.length
    )
      throw new Error("PhotoCraft did not update layer visibility");
  } else {
    const quarterTurn = operation === "rotate-cw" || operation === "rotate-ccw";
    if (
      after.width !== (quarterTurn ? before.height : before.width) ||
      after.height !== (quarterTurn ? before.width : before.height) ||
      after.layers.length !== before.layers?.length
    )
      throw new Error("PhotoCraft did not preserve canvas and layers");
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for PhotoCraft worker`);
  return value;
}

function childEnvironment(): NodeJS.ProcessEnv {
  const names = [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "HOME",
  ];
  return Object.fromEntries(
    names.flatMap((name) =>
      process.env[name] ? [[name, process.env[name]]] : [],
    ),
  );
}

function run(cli: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolveRun, rejectRun) => {
    const sandboxRunner = process.env.PHOTOCRAFT_SANDBOX_RUNNER;
    const child = spawn(
      sandboxRunner ?? cli,
      sandboxRunner ? [cli, ...args] : args,
      {
        cwd,
        env: childEnvironment(),
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 120_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(-65536);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-65536);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectRun(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) rejectRun(new Error("PhotoCraft timed out"));
      else if (code === 0) resolveRun(stdout);
      else
        rejectRun(
          new Error(`PhotoCraft exited ${code}: ${stderr.slice(0, 500)}`),
        );
    });
  });
}

export async function executePhotoCraftJob(
  job: ClaimedPhotoCraftJob,
  dependencies: {
    assets: AssetFoundation;
    projects: PhotoCraftProjectStore;
    jobs: PhotoCraftEditJobStore;
    cli: string;
    workDir: string;
    provider?: ImageGenerationProvider;
  },
): Promise<void> {
  const requestKey = `worker-${job.id}`;
  try {
    const replay = await dependencies.projects.getByRequestKey(
      job.scope,
      job.projectId,
      requestKey,
    );
    if (replay) {
      await dependencies.jobs.succeed(job, replay.version);
      return;
    }
    const source = await dependencies.assets.readOriginal(
      job.scope,
      job.inputSourceAssetId,
    );
    if (
      !source ||
      source.bytes.length < 4 ||
      !source.bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    ) {
      await dependencies.jobs.fail(job, "SOURCE_INVALID", true);
      return;
    }
    const project = await dependencies.projects.get(job.scope, job.projectId);
    if (
      !project ||
      project.version !== job.expectedVersion ||
      project.sourceAssetId !== job.inputSourceAssetId
    ) {
      await dependencies.jobs.fail(job, "VERSION_CONFLICT", true);
      return;
    }
    const folder = await mkdtemp(join(dependencies.workDir, "acs-pc-job-"));
    try {
      const input = join(folder, "input.pcraft");
      const output = join(folder, "output.pcraft");
      await writeFile(input, source.bytes, { flag: "wx" });
      const before = JSON.parse(
        await run(dependencies.cli, ["info", input, "--compact"], folder),
      ) as NativeInfo;
      let steps: NativeStep[];
      let generationRect: [number, number, number, number] | null = null;
      let originalPng: Buffer | null = null;
      if (job.operation === "generate-local") {
        if (!dependencies.provider)
          throw new PhotoCraftJobValidationError(
            "Image Provider is unavailable",
          );
        if (
          !before.width ||
          !before.height ||
          before.width > 4096 ||
          before.height > 4096 ||
          before.width * before.height > 12_000_000
        )
          throw new PhotoCraftJobValidationError(
            "Canvas exceeds generation limits",
          );
        const params = job.params as PhotoCraftGenerateParams;
        const selection = params.selection;
        generationRect =
          selection.kind === "existing"
            ? (before.selectionBounds ?? null)
            : selection.kind === "lasso"
              ? (() => {
                  const xs = selection.points.map((p) => p[0]),
                    ys = selection.points.map((p) => p[1]);
                  const x = Math.min(...xs),
                    y = Math.min(...ys);
                  return [x, y, Math.max(...xs) - x, Math.max(...ys) - y] as [
                    number,
                    number,
                    number,
                    number,
                  ];
                })()
              : selection.rect;
        if (
          !generationRect ||
          !boundedRect(generationRect, before) ||
          generationRect[2] < 16 ||
          generationRect[3] < 16
        )
          throw new PhotoCraftJobValidationError(
            "Generation selection is unavailable or too small",
          );
        const sourcePng = join(folder, "source.png");
        await run(dependencies.cli, ["convert", input, sourcePng], folder);
        originalPng = await readFile(sourcePng);
        const generated = await dependencies.provider.generate({
          image: originalPng,
          prompt: params.prompt,
          rect: generationRect,
          width: before.width,
          height: before.height,
        });
        const metadata = await sharp(generated).metadata();
        if (
          !metadata.width ||
          !metadata.height ||
          metadata.width > 4096 ||
          metadata.height > 4096
        )
          throw new Error("Image Provider output dimensions are invalid");
        const placed = join(folder, "generated.png");
        const normalized =
          metadata.width === before.width && metadata.height === before.height
            ? generated
            : await sharp(generated)
                .resize(before.width, before.height, { fit: "fill" })
                .png()
                .toBuffer();
        if (normalized.length > MAX_OUTPUT)
          throw new Error("Image Provider output is too large");
        await writeFile(placed, normalized, { flag: "wx" });
        steps = [
          ...maskedSelectionSteps(before, {
            amount: 0,
            selection,
            edgeShift: params.edgeShift,
            edgeFeather: params.edgeFeather,
            patches: [],
          }),
          { id: "file.placeEmbedded", params: { path: placed, fit: false } },
          { id: "layer.layerMask.revealSelection", params: {} },
        ];
      } else steps = photoCraftJobSteps(job.operation, before, job.params);
      const args = ["run", input];
      for (const step of steps)
        args.push("--cmd", step.id, "--params", JSON.stringify(step.params));
      args.push("--out", output);
      await run(dependencies.cli, args, folder);
      const bytes = await readFile(output);
      if (
        bytes.length < 4 ||
        bytes.length > MAX_OUTPUT ||
        !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
      )
        throw new Error("Invalid PhotoCraft output");
      const info = JSON.parse(
        await run(dependencies.cli, ["info", output, "--compact"], folder),
      ) as NativeInfo;
      verifyPhotoCraftJobResult(job.operation, before, info, job.params);
      if (job.operation === "generate-local" && generationRect && originalPng) {
        const previewPath = join(folder, "preview.png");
        await run(dependencies.cli, ["convert", output, previewPath], folder);
        const preview = await readFile(previewPath);
        const quality = await inspectGeneratedComposite(
          originalPng,
          preview,
          info.selectionBounds!,
        );
        const requestEdge = await inspectGeneratedComposite(
          originalPng,
          preview,
          generationRect,
        );
        if (
          quality.changedInside < 20 ||
          quality.changedOutside > 40 ||
          quality.rectangularSeam ||
          requestEdge.rectangularSeam
        )
          throw new GenerationQualityError(
            quality.rectangularSeam || requestEdge.rectangularSeam
              ? "Rectangular seam detected"
              : quality.changedOutside > 40
                ? "Pixels outside selection changed"
                : "Generated area did not change",
          );
      }
      const saved = await dependencies.projects.save(job.scope, {
        id: job.projectId,
        title: project.title,
        expectedVersion: job.expectedVersion,
        requestKey,
        bytes,
      });
      await dependencies.jobs.succeed(job, saved.version);
    } finally {
      if (
        dirname(resolve(folder)) !== resolve(dependencies.workDir) ||
        !basename(folder).startsWith("acs-pc-job-")
      )
        throw new Error("Unsafe PhotoCraft temporary path");
      await rm(folder, { recursive: true, force: true });
    }
  } catch (error) {
    const permanent =
      job.operation === "generate-local" ||
      error instanceof PhotoCraftConflictError ||
      error instanceof PhotoCraftJobValidationError ||
      error instanceof GenerationQualityError;
    const code =
      error instanceof PhotoCraftConflictError
        ? "VERSION_CONFLICT"
        : error instanceof PhotoCraftJobValidationError
          ? "INVALID_SELECTION"
          : error instanceof GenerationQualityError
            ? "QUALITY_REJECTED"
            : "ENGINE_ERROR";
    console.error(
      `PhotoCraft job ${job.id} ${code}: ${error instanceof Error ? error.message.slice(0, 500) : "unknown"}`,
    );
    await dependencies.jobs.fail(job, code, permanent);
  }
}

async function main(): Promise<void> {
  const cli = required("PHOTOCRAFT_CLI_PATH");
  if (!isAbsolute(cli)) throw new Error("PHOTOCRAFT_CLI_PATH must be absolute");
  const sandboxRunner = process.env.PHOTOCRAFT_SANDBOX_RUNNER;
  if (process.env.NODE_ENV === "production" && !sandboxRunner)
    throw new Error(
      "Production PhotoCraft worker requires an OS-isolated PHOTOCRAFT_SANDBOX_RUNNER",
    );
  if (sandboxRunner && !isAbsolute(sandboxRunner))
    throw new Error("PHOTOCRAFT_SANDBOX_RUNNER must be absolute");
  const detected = execFileSync(cli, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
    env: childEnvironment(),
  }).trim();
  if (!detected.startsWith(`photocraft-cli ${VERSION} (`))
    throw new Error(`PhotoCraft worker requires CLI ${VERSION}`);
  const workDir = resolve(process.env.PHOTOCRAFT_WORK_DIR ?? tmpdir());
  const db = new pg.Pool({
    connectionString: required("DATABASE_URL"),
    max: 4,
  });
  const s3 = new S3Client({
    endpoint: required("S3_ENDPOINT"),
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: required("S3_ACCESS_KEY"),
      secretAccessKey: required("S3_SECRET_KEY"),
    },
    maxAttempts: 1,
  });
  const assets = new AssetFoundation(db, s3, required("S3_BUCKET"));
  const projects = new PhotoCraftProjectStore(db, assets);
  const jobs = new PhotoCraftEditJobStore(db);
  const provider =
    process.env.IMAGE_LOCAL_EDIT_PROVIDER === "qwen" &&
    process.env.DASHSCOPE_API_KEY
      ? new QwenImageGenerationProvider(
          process.env.DASHSCOPE_API_KEY,
          process.env.IMAGE_LOCAL_EDIT_MODEL || "qwen-image-2.0-pro",
          process.env.DASHSCOPE_IMAGE_ENDPOINT,
        )
      : undefined;
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });
  try {
    while (!stopping) {
      const job = await jobs.claimNext();
      if (job)
        await executePhotoCraftJob(job, {
          assets,
          projects,
          jobs,
          cli,
          workDir,
          provider,
        });
      else await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
    }
  } finally {
    await db.end();
    s3.destroy();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  void main();
