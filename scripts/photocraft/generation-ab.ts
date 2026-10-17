// E-2（第七轮 E 项）生成模型同图 A/B：仅「确需生成」的操作（移除补画 / 整幅
// 背景替换）在真实 DashScope 模型间对照；调色/换色等 PhotoCraft 原生调整层
// 能做的操作不交给生成模型（边界断言走既有 IMG-030/IMG-033 能力表与路由测试，
// 本脚本不再重复调用）。
//
// 对照臂：
//   A 基线 qwen-image-2.0-pro（生产 IMAGE_LOCAL_EDIT_MODEL 默认）
//   B 挑战 qwen-image-3.0-pro（账号模型列表确认在场）
//   C mask 接口模型探针 qwen-image-edit（此前账号实测 Model not exist；本轮
//     再探一次并如实记录，不假装有第三臂数据）
// 口径：同图（qa/fixtures/photocraft-hat-teal.png）同 prompt 同 rect，走生产
// QwenLocalImageEditProvider（同一请求体构造）；指标 =
// inspectGeneratedComposite（changedInside/changedOutside/rectangularSeam +
// 尺寸不变检查）+ 耗时 + 字节数；产物 PNG 落 artifacts/photocraft-e2-2026-10-17/
// 供人工视觉复核。质量差异是评测发现不失败；基础设施错（无密钥/零成功生成）
// 或任一预定 A/B 臂失败即非零退出。不据此切换 IMAGE_LOCAL_EDIT_MODEL 默认值。
// 用法（cwd=apps/api）：
//   node --env-file=../../.env --import tsx ../../scripts/photocraft/generation-ab.ts
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { inspectGeneratedComposite } from "../../apps/api/src/image-projects/generation-quality";
import { QwenLocalImageEditProvider } from "../../apps/web/src/app/image-studio/photocraft/local-image-provider";
import { missingComparisonArms } from "./generation-ab-status.mjs";

const root = resolve(import.meta.dirname, "../..");
const OUT = resolve(root, "artifacts/photocraft-e2-2026-10-17");
const SOURCE = resolve(root, "qa/fixtures/photocraft-hat-teal.png");

const MODELS = [
  { key: "qwen-image-2.0-pro", label: "baseline-2.0-pro" },
  { key: "qwen-image-3.0-pro", label: "challenger-3.0-pro" },
];
const MASK_INTERFACE_PROBE = "qwen-image-edit"; // 预期 Model not exist，如实记录

const CASES = {
  remove: {
    prompt:
      "Remove the white FORM 01 label patch from the cap crown. Reconstruct the original teal woven fabric and stitching naturally underneath it. Preserve all other details.",
    rect: [600, 470, 300, 190] as [number, number, number, number],
  },
  background: {
    prompt:
      "Replace only the gray studio background with a soft warm beige studio background. Keep the cap itself, its exact shape, fabric, label and colors unchanged.",
    rect: [0, 0, 1254, 1254] as [number, number, number, number],
  },
} as const;

type Row = {
  model: string;
  case: string;
  ok: boolean;
  tookMs?: number;
  bytes?: number;
  dims?: { width: number; height: number };
  dimsMatch?: boolean;
  changedInside?: number;
  changedOutside?: number;
  rectangularSeam?: boolean;
  output?: string;
  error?: string;
};

async function runArm(
  model: string,
  caseKey: keyof typeof CASES,
  key: string,
): Promise<Row> {
  const provider = new QwenLocalImageEditProvider(
    key,
    model,
    process.env.DASHSCOPE_IMAGE_ENDPOINT,
  );
  const bytes = await readFile(SOURCE);
  const selected = CASES[caseKey];
  const started = Date.now();
  // 本机到 dashscope 的连接偶发 reset（undici fetch failed 而 curl 可通）；
  // 生成调用贵且慢，失败重试 3 次（指数退避），仍失败如实记 error。
  let result: Buffer | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3 && !result; attempt += 1) {
    if (attempt > 0) {
      await new Promise((sleep) => setTimeout(sleep, 5000 * attempt));
    }
    try {
      const fresh = new File([new Uint8Array(bytes)], "source.png", {
        type: "image/png",
      });
      result = await provider.edit(
        fresh,
        fresh,
        selected.prompt,
        selected.rect,
      );
    } catch (error) {
      lastError = error;
      const cause = (error as { cause?: unknown })?.cause;
      console.log(
        `  retry ${model} ${caseKey} #${attempt + 1} failed: ${String(error).slice(0, 90)}${cause ? ` cause=${String(cause).slice(0, 90)}` : ""}`,
      );
    }
  }
  if (!result) {
    return {
      model,
      case: caseKey,
      ok: false,
      tookMs: Date.now() - started,
      error: String(lastError)
        .replace(/sk-[A-Za-z0-9-]+/g, "[redacted]")
        .slice(0, 300),
    };
  }
  try {
    const tookMs = Date.now() - started;
    const name = `${caseKey}-${model.replace(/[^a-z0-9.-]/gi, "-")}.png`;
    await writeFile(resolve(OUT, name), result);
    const sourcePng = {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
    const dims = {
      width: result.readUInt32BE(16),
      height: result.readUInt32BE(20),
    };
    let metrics: Omit<Row, "model" | "case" | "ok"> = {};
    if (dims.width === sourcePng.width && dims.height === sourcePng.height) {
      const inspected = await inspectGeneratedComposite(
        bytes,
        result,
        selected.rect,
      );
      metrics = {
        dimsMatch: true,
        changedInside: inspected.changedInside,
        changedOutside: inspected.changedOutside,
        rectangularSeam: inspected.rectangularSeam,
      };
    } else {
      metrics = { dimsMatch: false };
    }
    return {
      model,
      case: caseKey,
      ok: true,
      tookMs,
      bytes: result.length,
      dims,
      output: name,
      ...metrics,
    };
  } catch (error) {
    return {
      model,
      case: caseKey,
      ok: false,
      tookMs: Date.now() - started,
      error: String(error)
        .replace(/sk-[A-Za-z0-9-]+/g, "[redacted]")
        .slice(0, 300),
    };
  }
}

async function main() {
  const key = process.env.DASHSCOPE_API_KEY;
  if (!key)
    throw new Error(
      "DASHSCOPE_API_KEY is required（--env-file 指向含密钥的 .env）",
    );
  const { mkdir } = await import("node:fs/promises");
  await mkdir(OUT, { recursive: true });

  const rows: Row[] = [];
  for (const model of MODELS) {
    for (const caseKey of Object.keys(CASES) as (keyof typeof CASES)[]) {
      const row = await runArm(model.key, caseKey, key);
      rows.push(row);
      console.log(
        `${model.label} ${caseKey}: ${row.ok ? `ok ${row.tookMs}ms in=${row.changedInside} out=${row.changedOutside} seam=${row.rectangularSeam}` : `ERROR ${row.error?.slice(0, 120)}`}`,
      );
    }
  }
  // mask 接口模型探针（预期不可用；失败即记录，不算基础设施错）
  const probe = await runArm(MASK_INTERFACE_PROBE, "remove", key);
  rows.push(probe);
  console.log(
    `mask-interface probe ${MASK_INTERFACE_PROBE}: ${probe.ok ? "ok（意外可用，需补第三臂）" : `unavailable — ${probe.error?.slice(0, 120)}`}`,
  );

  const incompleteArms = missingComparisonArms(
    MODELS.map((model) => model.key),
    Object.keys(CASES),
    rows,
  );
  const report = {
    executedAt: new Date().toISOString(),
    source: "qa/fixtures/photocraft-hat-teal.png",
    arms: MODELS,
    maskInterfaceProbe: MASK_INTERFACE_PROBE,
    rows,
    comparisonComplete: incompleteArms.length === 0,
    incompleteArms,
    boundary:
      "整图/局部调色、换色等 PhotoCraft 原生调整层能做的操作不交给生成模型（能力表与路由由 IMG-030/IMG-033 钉死）；本 A/B 仅覆盖确需生成的移除补画与整幅背景替换。",
    note: "报告 only：不据此切换 IMAGE_LOCAL_EDIT_MODEL 默认值；视觉质量结论以 artifacts/photocraft-e2-2026-10-17/ 人工复核为准。",
  };
  await writeFile(
    resolve(OUT, "generation-ab-report.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );
  console.log(`报告：${resolve(OUT, "generation-ab-report.json")}`);
  if (incompleteArms.length > 0) {
    console.error(`A/B 不完整：${incompleteArms.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(String(error).replace(/sk-[A-Za-z0-9-]+/g, "[redacted]"));
  process.exitCode = 1;
});
