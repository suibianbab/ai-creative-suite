import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import type { TenantScope } from "../assets/asset-foundation.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_KEY = /^[A-Za-z0-9._:-]{1,128}$/;

export const PHOTOCRAFT_JOB_OPERATIONS = {
  "rotate-cw": "image.imageRotation.90cw",
  "rotate-ccw": "image.imageRotation.90ccw",
  "rotate-180": "image.imageRotation.180",
  "flip-horizontal": "image.imageRotation.flipCanvasHorizontal",
  "flip-vertical": "image.imageRotation.flipCanvasVertical",
  "duplicate-layer": "layer.duplicate",
  "hide-layer": "layer.setProps",
  "show-layer": "layer.setProps",
  "adjust-brightness": "layer.newAdjustmentLayer.brightnessContrast",
  "adjust-contrast": "layer.newAdjustmentLayer.brightnessContrast",
  "adjust-saturation": "layer.newAdjustmentLayer.hueSaturation",
  "adjust-exposure": "layer.newAdjustmentLayer.exposure",
  "adjust-vibrance": "layer.newAdjustmentLayer.vibrance",
  "adjust-shadows": "layer.newAdjustmentLayer.curves",
  "adjust-highlights": "layer.newAdjustmentLayer.curves",
  "masked-adjust-brightness": "layer.newAdjustmentLayer.brightnessContrast",
  "masked-adjust-contrast": "layer.newAdjustmentLayer.brightnessContrast",
  "masked-adjust-saturation": "layer.newAdjustmentLayer.hueSaturation",
  "masked-adjust-exposure": "layer.newAdjustmentLayer.exposure",
  "masked-adjust-vibrance": "layer.newAdjustmentLayer.vibrance",
  "masked-adjust-shadows": "layer.newAdjustmentLayer.curves",
  "masked-adjust-highlights": "layer.newAdjustmentLayer.curves",
  "generate-local": "file.placeEmbedded",
  levels: "layer.newAdjustmentLayer.levels",
} as const;
export type PhotoCraftJobOperation = keyof typeof PHOTOCRAFT_JOB_OPERATIONS;
// batch-recipe 不是单命令操作（params.steps 展开为多条原生命令），单独放行。
export type PhotoCraftJobOperationWithRecipe =
  | PhotoCraftJobOperation
  | "batch-recipe";

// M4 批量配方（方案 §12.3）允许进入配方的整图操作：跨目录复用的动作列表
// 不能携带单图选区（masked-*）、生成（generate-local）或当前图层上下文
// （duplicate/hide/show）——这些与具体图片绑定，复制到别的图上必然错位。
export const PHOTOCRAFT_BATCH_STEP_OPERATIONS = [
  "rotate-cw",
  "rotate-ccw",
  "rotate-180",
  "flip-horizontal",
  "flip-vertical",
  "adjust-brightness",
  "adjust-contrast",
  "adjust-saturation",
  "adjust-exposure",
  "adjust-vibrance",
  "adjust-shadows",
  "adjust-highlights",
  "levels",
] as const;
export type PhotoCraftBatchStepOperation =
  (typeof PHOTOCRAFT_BATCH_STEP_OPERATIONS)[number];
export type PhotoCraftBatchStep = {
  operation: PhotoCraftBatchStepOperation;
  params: Record<string, unknown>;
};
const BATCH_CANVAS_OPERATIONS = new Set([
  "rotate-cw",
  "rotate-ccw",
  "rotate-180",
  "flip-horizontal",
  "flip-vertical",
]);

export function validatedBatchRecipeSteps(
  input: unknown,
): PhotoCraftBatchStep[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 4)
    throw new PhotoCraftJobValidationError("批量配方需要 1 至 4 个步骤");
  const steps: PhotoCraftBatchStep[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new PhotoCraftJobValidationError("批量配方步骤无效");
    if (
      !Object.keys(item).every((key) =>
        ["operation", "params"].includes(key),
      ) ||
      typeof (item as { operation?: unknown }).operation !== "string"
    )
      throw new PhotoCraftJobValidationError("批量配方步骤无效");
    const operation = (item as { operation: string }).operation;
    if (
      !(PHOTOCRAFT_BATCH_STEP_OPERATIONS as readonly string[]).includes(
        operation,
      )
    )
      throw new PhotoCraftJobValidationError(
        "批量配方包含不可用于整目录的操作",
      );
    const typed = operation as PhotoCraftBatchStepOperation;
    steps.push({
      operation: typed,
      params: validatedPhotoCraftJobParams(
        typed,
        (item as { params?: unknown }).params ?? {},
      ),
    });
  }
  // 画布/方向操作只允许在最后一步（与单图序列约束同款：先调效果，最后动画布）。
  if (
    steps
      .slice(0, -1)
      .some((step) => BATCH_CANVAS_OPERATIONS.has(step.operation))
  )
    throw new PhotoCraftJobValidationError(
      "画布、图片尺寸或方向变更请放在最后一步",
    );
  return steps;
}

// P2-2 来源确认闭环（codex 审核 2026-10-16；R1 第二轮复审后收紧）：批量配方
// 必须绑定「在哪张图、哪个不可变版本上、由谁在何时确认过什么步骤」。确认
// 发生在单图确认环，服务端落不可变确认快照（0016）；批量入队只引用该记录
// 并核验其仍有效，不再接受随请求提交的任意 steps+source。
export type PhotoCraftBatchRecipeSource = Readonly<{
  projectId: string;
  version: number;
}>;

export function validatedBatchRecipeSource(
  input: unknown,
): PhotoCraftBatchRecipeSource {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    !Object.keys(input).every((key) => ["projectId", "version"].includes(key))
  )
    throw new PhotoCraftJobValidationError(
      "Invalid PhotoCraft batch recipe source",
    );
  const value = input as { projectId?: unknown; version?: unknown };
  if (
    typeof value.projectId !== "string" ||
    !UUID.test(value.projectId) ||
    !Number.isInteger(value.version) ||
    (value.version as number) < 1
  )
    throw new PhotoCraftJobValidationError(
      "Invalid PhotoCraft batch recipe source",
    );
  return { projectId: value.projectId, version: value.version as number };
}

// R1：规范化步骤的稳定摘要。确认快照与批次记录各存一份，GET 状态可核对
// 「实际执行的配方」与「确认时的配方」一致。
export function batchStepsDigest(steps: unknown): string {
  return createHash("sha256").update(canonicalJson(steps)).digest("hex");
}

export type PhotoCraftBatchConfirmation = Readonly<{
  id: string;
  source: PhotoCraftBatchRecipeSource;
  steps: PhotoCraftBatchStep[];
  stepsDigest: string;
  status: "active" | "revoked";
  confirmedBy: string;
  confirmedAt: string;
}>;

function mappedConfirmation(row: {
  id: string;
  source_project_id: string;
  source_version: number;
  steps: PhotoCraftBatchStep[];
  steps_digest: string;
  status: string;
  confirmed_by: string;
  confirmed_at: Date;
}): PhotoCraftBatchConfirmation {
  return {
    id: row.id,
    source: { projectId: row.source_project_id, version: row.source_version },
    steps: row.steps,
    stepsDigest: row.steps_digest,
    status: row.status === "revoked" ? "revoked" : "active",
    confirmedBy: row.confirmed_by,
    confirmedAt: new Date(row.confirmed_at).toISOString(),
  };
}

// 质量门抽样复检（方案 §12.3）：确定性抽样——按作业 id 排序后每 stride 个取
// 1 个（rate=0.2 → 每 5 张复检 1 张，至少 1 张）。worker 与状态查询共用同一
// 函数，保证「哪几张被复检」在任何一侧可复算。
export const PHOTOCRAFT_BATCH_SAMPLE_RATE = 0.2;
// 单次批量配方的项目数上限（电商目录一批的量级）。
export const PHOTOCRAFT_BATCH_PROJECT_LIMIT = 200;
export function sampleBatchJobIds(
  jobIds: string[],
  rate = PHOTOCRAFT_BATCH_SAMPLE_RATE,
): string[] {
  if (!Array.isArray(jobIds) || jobIds.length === 0) return [];
  const bounded = Math.min(Math.max(rate, 0.01), 1);
  const stride = Math.max(1, Math.round(1 / bounded));
  return [...jobIds].sort().filter((_, index) => index % stride === 0);
}

function billableOperation(
  operation: PhotoCraftJobOperationWithRecipe,
): boolean {
  // 计费作业：generate-local（生成）与 batch-recipe（批量配方按张计费 §12.3）。
  return operation === "generate-local" || operation === "batch-recipe";
}

export type PhotoCraftSelection =
  | { kind: "existing" }
  | { kind: "rect" | "object"; rect: [number, number, number, number] }
  | { kind: "lasso"; points: [number, number][] };
export type PhotoCraftMaskedParams = {
  amount: number;
  selection: PhotoCraftSelection;
  edgeShift: number;
  edgeFeather: number;
  patches: { mode: "add" | "subtract"; points: [number, number][] }[];
  protectRect?: [number, number, number, number];
};
export type PhotoCraftGenerateParams = {
  prompt: string;
  selection: PhotoCraftSelection;
  edgeShift: number;
  edgeFeather: number;
};

function validPoint(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((n) => Number.isInteger(n) && n >= 0 && n <= 8192)
  );
}

function validRect(value: unknown): value is [number, number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((n) => Number.isInteger(n) && n >= 0 && n <= 8192) &&
    value[2] > 0 &&
    value[3] > 0
  );
}

function validPoints(value: unknown): value is [number, number][] {
  return (
    Array.isArray(value) &&
    value.length >= 3 &&
    value.length <= 256 &&
    value.every(validPoint)
  );
}

function validKeys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): boolean {
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every(
      (key) => required.includes(key) || optional.includes(key),
    )
  );
}

function validatedSelection(input: unknown): PhotoCraftSelection {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new PhotoCraftJobValidationError("Invalid PhotoCraft selection");
  const value = input as Record<string, unknown>;
  if (value.kind === "existing" && validKeys(value, ["kind"]))
    return { kind: "existing" };
  if (
    (value.kind === "rect" || value.kind === "object") &&
    validKeys(value, ["kind", "rect"]) &&
    validRect(value.rect)
  )
    return { kind: value.kind, rect: value.rect };
  if (
    value.kind === "lasso" &&
    validKeys(value, ["kind", "points"]) &&
    validPoints(value.points)
  )
    return { kind: "lasso", points: value.points };
  throw new PhotoCraftJobValidationError("Invalid PhotoCraft selection");
}

export function validatedPhotoCraftJobParams(
  operation: PhotoCraftJobOperationWithRecipe,
  input: unknown,
): Record<string, unknown> {
  const params = input ?? {};
  if (!params || typeof params !== "object" || Array.isArray(params))
    throw new PhotoCraftJobValidationError("Invalid PhotoCraft job parameters");
  const keys = Object.keys(params);
  const values = params as Record<string, unknown>;
  if (operation === "batch-recipe") {
    if (!keys.every((key) => key === "steps"))
      throw new PhotoCraftJobValidationError(
        "Invalid PhotoCraft batch recipe parameters",
      );
    return { steps: validatedBatchRecipeSteps(values.steps) };
  }
  if (operation === "generate-local") {
    if (
      !validKeys(
        values,
        ["prompt", "selection"],
        ["edgeShift", "edgeFeather"],
      ) ||
      typeof values.prompt !== "string" ||
      values.prompt.trim().length < 3 ||
      values.prompt.length > 400 ||
      /[\x00-\x08\x0e-\x1f]/.test(values.prompt)
    )
      throw new PhotoCraftJobValidationError(
        "Invalid PhotoCraft generation prompt",
      );
    const selection = validatedSelection(values.selection);
    const edgeShift = values.edgeShift ?? 0;
    const edgeFeather = values.edgeFeather ?? 3;
    if (
      !Number.isInteger(edgeShift) ||
      Math.abs(edgeShift as number) > 32 ||
      !Number.isInteger(edgeFeather) ||
      (edgeFeather as number) < 2 ||
      (edgeFeather as number) > 32
    )
      throw new PhotoCraftJobValidationError(
        "Invalid PhotoCraft generation edge feather",
      );
    return { prompt: values.prompt.trim(), selection, edgeShift, edgeFeather };
  }
  if (operation === "levels") {
    const { inBlack, inWhite, gamma } = values;
    if (
      keys.length !== 3 ||
      !["inBlack", "inWhite", "gamma"].every((key) => keys.includes(key)) ||
      !Number.isInteger(inBlack) ||
      !Number.isInteger(inWhite) ||
      (inBlack as number) < 0 ||
      (inWhite as number) > 255 ||
      (inBlack as number) >= (inWhite as number) ||
      typeof gamma !== "number" ||
      !Number.isFinite(gamma) ||
      gamma < 0.1 ||
      gamma > 5
    )
      throw new PhotoCraftJobValidationError(
        "Invalid PhotoCraft levels parameters",
      );
    return { inBlack: inBlack as number, inWhite: inWhite as number, gamma };
  }
  if (
    operation.startsWith("adjust-") ||
    operation.startsWith("masked-adjust-")
  ) {
    const amount = values.amount;
    if (
      !Number.isInteger(amount) ||
      (amount as number) === 0 ||
      Math.abs(amount as number) > 50
    )
      throw new PhotoCraftJobValidationError(
        "Invalid PhotoCraft adjustment amount",
      );
    if (operation.startsWith("masked-adjust-")) {
      if (
        !validKeys(
          values,
          ["amount", "selection"],
          ["edgeShift", "edgeFeather", "patches", "protectRect"],
        )
      )
        throw new PhotoCraftJobValidationError(
          "Invalid PhotoCraft masked parameters",
        );
      const selection = validatedSelection(values.selection);
      const edgeShift = values.edgeShift ?? 0;
      const edgeFeather = values.edgeFeather ?? 0;
      if (
        !Number.isInteger(edgeShift) ||
        Math.abs(edgeShift as number) > 64 ||
        !Number.isInteger(edgeFeather) ||
        (edgeFeather as number) < 0 ||
        (edgeFeather as number) > 64 ||
        (values.protectRect !== undefined && !validRect(values.protectRect))
      )
        throw new PhotoCraftJobValidationError(
          "Invalid PhotoCraft edge parameters",
        );
      const patches = values.patches ?? [];
      if (
        !Array.isArray(patches) ||
        patches.length > 16 ||
        patches.some(
          (patch) =>
            !patch ||
            typeof patch !== "object" ||
            Array.isArray(patch) ||
            !validKeys(patch as Record<string, unknown>, ["mode", "points"]) ||
            !["add", "subtract"].includes(patch.mode) ||
            !validPoints(patch.points),
        )
      )
        throw new PhotoCraftJobValidationError(
          "Invalid PhotoCraft selection patches",
        );
      return {
        amount,
        selection,
        edgeShift,
        edgeFeather,
        patches: patches.map((patch) => ({
          mode: patch.mode,
          points: patch.points,
        })),
        ...(values.protectRect ? { protectRect: values.protectRect } : {}),
      };
    }
    if (keys.length !== 1 || keys[0] !== "amount")
      throw new PhotoCraftJobValidationError(
        "Invalid PhotoCraft adjustment parameters",
      );
    return { amount: amount as number };
  }
  if (keys.length)
    throw new PhotoCraftJobValidationError(
      "Unexpected PhotoCraft job parameters",
    );
  return {};
}

export class PhotoCraftJobValidationError extends Error {}
export class PhotoCraftJobConflictError extends Error {}
export class PhotoCraftInsufficientCreditsError extends Error {}

export type PhotoCraftEditJob = Readonly<{
  id: string;
  projectId: string;
  expectedVersion: number;
  inputSourceAssetId: string;
  operation: PhotoCraftJobOperationWithRecipe;
  params: Record<string, unknown>;
  status: "queued" | "running" | "succeeded" | "failed";
  attempts: number;
  outputVersion: number | null;
  errorCode: string | null;
  requestKey: string;
}>;

export type ClaimedPhotoCraftJob = PhotoCraftEditJob &
  Readonly<{
    scope: TenantScope;
    leaseToken: string;
  }>;

// 批量配方入队结果：成功的按张作业 + 因项目缺失被跳过的清单（额度整批预检）。
export type PhotoCraftBatchEnqueueResult = Readonly<{
  jobs: readonly PhotoCraftEditJob[];
  skipped: ReadonlyArray<{
    projectId: string;
    reason: "project-unavailable";
  }>;
}>;

type Row = {
  id: string;
  organization_id: string;
  workspace_id: string;
  project_id: string;
  expected_version: number;
  input_source_asset_id: string;
  operation: PhotoCraftJobOperationWithRecipe;
  params: Record<string, unknown>;
  status: PhotoCraftEditJob["status"];
  attempts: number;
  output_version: number | null;
  error_code: string | null;
  lease_token: string | null;
  request_key: string;
  request_sha256?: string;
};

// jsonb 不保留键序：重放比对前先做键序无关的规范化序列化。
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .sort()
    .join(",")}}`;
}

function mapped(row: Row): PhotoCraftEditJob {
  return {
    id: row.id,
    projectId: row.project_id,
    expectedVersion: row.expected_version,
    inputSourceAssetId: row.input_source_asset_id,
    operation: row.operation,
    params: row.params,
    status: row.status,
    attempts: row.attempts,
    outputVersion: row.output_version,
    errorCode: row.error_code,
    requestKey: row.request_key,
  };
}

export class PhotoCraftEditJobStore {
  constructor(private readonly db: pg.Pool) {}

  async grantCredits(
    scope: TenantScope,
    amount: number,
    reference: string,
  ): Promise<number> {
    if (
      !Number.isInteger(amount) ||
      amount < 1 ||
      amount > 100000 ||
      !REQUEST_KEY.test(reference)
    )
      throw new PhotoCraftJobValidationError("Invalid credit grant");
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO workspace_credit_accounts(organization_id,workspace_id) VALUES ($1,$2)
         ON CONFLICT DO NOTHING`,
        [scope.organizationId, scope.workspaceId],
      );
      const account = await client.query<{ available: number }>(
        `SELECT available FROM workspace_credit_accounts WHERE organization_id=$1 AND workspace_id=$2 FOR UPDATE`,
        [scope.organizationId, scope.workspaceId],
      );
      const prior = await client.query<{ amount: number }>(
        `SELECT amount FROM workspace_credit_ledger WHERE organization_id=$1 AND workspace_id=$2
         AND kind='grant' AND reference=$3`,
        [scope.organizationId, scope.workspaceId, reference],
      );
      if (prior.rows[0] && prior.rows[0].amount !== amount)
        throw new PhotoCraftJobConflictError(
          "Credit grant reference reused with different amount",
        );
      const inserted = await client.query(
        `INSERT INTO workspace_credit_ledger(id,organization_id,workspace_id,kind,amount,reference)
         VALUES ($1,$2,$3,'grant',$4,$5) ON CONFLICT DO NOTHING`,
        [
          randomUUID(),
          scope.organizationId,
          scope.workspaceId,
          amount,
          reference,
        ],
      );
      const balance =
        account.rows[0]!.available + (inserted.rowCount ? amount : 0);
      if (inserted.rowCount)
        await client.query(
          `UPDATE workspace_credit_accounts SET available=$3,updated_at=now()
         WHERE organization_id=$1 AND workspace_id=$2`,
          [scope.organizationId, scope.workspaceId, balance],
        );
      await client.query("COMMIT");
      return balance;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async creditBalance(scope: TenantScope): Promise<number> {
    const result = await this.db.query<{ available: number }>(
      `SELECT available FROM workspace_credit_accounts WHERE organization_id=$1 AND workspace_id=$2`,
      [scope.organizationId, scope.workspaceId],
    );
    return result.rows[0]?.available ?? 0;
  }

  async get(
    scope: TenantScope,
    projectId: string,
    id: string,
  ): Promise<PhotoCraftEditJob | null> {
    if (!UUID.test(projectId) || !UUID.test(id)) return null;
    const found = await this.db.query<Row>(
      `SELECT * FROM photocraft_edit_jobs WHERE organization_id=$1 AND workspace_id=$2
       AND project_id=$3 AND id=$4`,
      [scope.organizationId, scope.workspaceId, projectId, id],
    );
    return found.rows[0] ? mapped(found.rows[0]) : null;
  }

  async enqueue(
    scope: TenantScope,
    input: {
      projectId: string;
      expectedVersion: number;
      operation: PhotoCraftJobOperationWithRecipe;
      params?: unknown;
      requestKey: string;
    },
  ): Promise<PhotoCraftEditJob> {
    if (
      !UUID.test(input.projectId) ||
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      (!Object.hasOwn(PHOTOCRAFT_JOB_OPERATIONS, input.operation) &&
        input.operation !== "batch-recipe") ||
      !REQUEST_KEY.test(input.requestKey)
    )
      throw new PhotoCraftJobValidationError("Invalid PhotoCraft edit job");
    const params = validatedPhotoCraftJobParams(input.operation, input.params);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([input.expectedVersion, input.operation, params]))
      .digest("hex");
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const prior = await client.query<Row>(
        `SELECT * FROM photocraft_edit_jobs WHERE organization_id=$1 AND workspace_id=$2
         AND project_id=$3 AND request_key=$4`,
        [
          scope.organizationId,
          scope.workspaceId,
          input.projectId,
          input.requestKey,
        ],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].request_sha256 !== fingerprint)
          throw new PhotoCraftJobConflictError(
            "Request key reused with different edit",
          );
        await client.query("COMMIT");
        return mapped(prior.rows[0]);
      }
      // R4（codex 第二轮复审）：所有会同时触及额度账户与项目的入队统一
      // 「先锁账户行、再锁项目行」，与批量入队同序——反向锁序在单图计费
      // 作业与批量作业并发触及同一工作区+项目时构成死锁（40P01）。
      if (billableOperation(input.operation)) {
        const account = await client.query<{ available: number }>(
          `SELECT available FROM workspace_credit_accounts WHERE organization_id=$1 AND workspace_id=$2 FOR UPDATE`,
          [scope.organizationId, scope.workspaceId],
        );
        if (!account.rows[0] || account.rows[0].available < 1)
          throw new PhotoCraftInsufficientCreditsError("Insufficient credits");
        // 并发闸只限生成：批量配方逐张排队，账本行锁已串行化扣减。
        if (input.operation === "generate-local") {
          const active = await client.query<{ count: string }>(
            `SELECT count(*) FROM photocraft_edit_jobs WHERE organization_id=$1 AND workspace_id=$2
             AND operation='generate-local' AND status IN ('queued','running')`,
            [scope.organizationId, scope.workspaceId],
          );
          if (Number(active.rows[0]?.count ?? 0) >= 2)
            throw new PhotoCraftJobConflictError(
              "Too many active generation jobs",
            );
        }
      }
      const head = await client.query<{
        current_version: number;
        source_asset_id: string;
      }>(
        `SELECT p.current_version, v.source_asset_id FROM photocraft_projects p
         JOIN photocraft_project_versions v ON v.organization_id=p.organization_id
          AND v.workspace_id=p.workspace_id AND v.project_id=p.id AND v.version=p.current_version
         WHERE p.organization_id=$1 AND p.workspace_id=$2 AND p.id=$3 FOR UPDATE OF p`,
        [scope.organizationId, scope.workspaceId, input.projectId],
      );
      if (!head.rows[0])
        throw new PhotoCraftJobConflictError("Project is unavailable");
      if (head.rows[0].current_version !== input.expectedVersion)
        throw new PhotoCraftJobConflictError("Project version has changed");
      const added = await client.query<Row>(
        `INSERT INTO photocraft_edit_jobs
         (id, organization_id, workspace_id, project_id, request_key, request_sha256,
          expected_version, input_source_asset_id, operation, params)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          randomUUID(),
          scope.organizationId,
          scope.workspaceId,
          input.projectId,
          input.requestKey,
          fingerprint,
          input.expectedVersion,
          head.rows[0].source_asset_id,
          input.operation,
          params,
        ],
      );
      if (billableOperation(input.operation)) {
        await client.query(
          `UPDATE workspace_credit_accounts SET available=available-1,updated_at=now()
           WHERE organization_id=$1 AND workspace_id=$2`,
          [scope.organizationId, scope.workspaceId],
        );
        await client.query(
          `INSERT INTO workspace_credit_ledger
           (id,organization_id,workspace_id,job_id,kind,amount,reference)
           VALUES ($1,$2,$3,$4,'reserve',-1,$5)`,
          [
            randomUUID(),
            scope.organizationId,
            scope.workspaceId,
            added.rows[0]!.id,
            `job-${added.rows[0]!.id}`,
          ],
        );
      }
      await client.query("COMMIT");
      return mapped(added.rows[0]!);
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505")
        throw new PhotoCraftJobConflictError(
          "Concurrent job submission; retry with same key",
        );
      throw error;
    } finally {
      client.release();
    }
  }

  // R1（codex 第二轮复审）：登记单图确认环通过的配方——不可变服务端确认
  // 快照。源项目必须存在于本工作区且确认版本即当前版本；确认与并发保存以
  // FOR SHARE 串行，确认时间取自服务端时钟（谁、何时、在哪张图哪个版本上
  // 确认了哪些步骤）。
  async confirmBatchRecipe(
    scope: TenantScope,
    confirmedBy: string,
    input: { source: unknown; steps: unknown },
  ): Promise<PhotoCraftBatchConfirmation> {
    if (!UUID.test(confirmedBy))
      throw new PhotoCraftJobValidationError("Invalid confirming user");
    const source = validatedBatchRecipeSource(input.source);
    const steps = validatedPhotoCraftJobParams("batch-recipe", {
      steps: input.steps,
    }).steps;
    const stepsDigest = batchStepsDigest(steps);
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const head = await client.query<{ current_version: number }>(
        `SELECT current_version FROM photocraft_projects
         WHERE organization_id=$1 AND workspace_id=$2 AND id=$3 FOR SHARE`,
        [scope.organizationId, scope.workspaceId, source.projectId],
      );
      if (!head.rows[0])
        throw new PhotoCraftJobConflictError(
          "Recipe source project is unavailable; confirm the recipe on the current version first",
        );
      if (head.rows[0].current_version !== source.version)
        throw new PhotoCraftJobConflictError(
          "Recipe source version changed; confirm the recipe on the current version first",
        );
      const inserted = await client.query(
        `INSERT INTO photocraft_batch_confirmations
         (id, organization_id, workspace_id, source_project_id, source_version,
          steps, steps_digest, status, confirmed_by, confirmed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,now()) RETURNING *`,
        [
          randomUUID(),
          scope.organizationId,
          scope.workspaceId,
          source.projectId,
          source.version,
          JSON.stringify(steps),
          stepsDigest,
          confirmedBy,
        ],
      );
      await client.query("COMMIT");
      return mappedConfirmation(inserted.rows[0]!);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async batchConfirmationById(
    scope: TenantScope,
    id: string,
  ): Promise<PhotoCraftBatchConfirmation | null> {
    if (!UUID.test(id))
      throw new PhotoCraftJobValidationError("Invalid confirmation id");
    const found = await this.db.query(
      `SELECT * FROM photocraft_batch_confirmations
       WHERE organization_id=$1 AND workspace_id=$2 AND id=$3`,
      [scope.organizationId, scope.workspaceId, id],
    );
    return found.rows[0] ? mappedConfirmation(found.rows[0]) : null;
  }

  async enqueueBatch(
    scope: TenantScope,
    input: {
      projectIds: unknown;
      requestKey: string;
      confirmationId: unknown;
    },
  ): Promise<PhotoCraftBatchEnqueueResult> {
    if (
      !Array.isArray(input.projectIds) ||
      input.projectIds.length === 0 ||
      input.projectIds.length > PHOTOCRAFT_BATCH_PROJECT_LIMIT ||
      input.projectIds.some((id) => typeof id !== "string" || !UUID.test(id)) ||
      !REQUEST_KEY.test(input.requestKey) ||
      typeof input.confirmationId !== "string" ||
      !UUID.test(input.confirmationId)
    )
      throw new PhotoCraftJobValidationError("Invalid PhotoCraft batch recipe");
    const projectIds = [...new Set(input.projectIds)];
    // R4：目标项目按 id 升序加锁（requestedProjects 同时是落库的规范化清单）。
    const requestedProjects = [...projectIds].sort();
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      // R4 统一锁序：先锁额度行——同工作区的批量入队（含同键并发重试）与
      // 单图计费入队在此串行化，后到者读到先到者已提交的批次记录。
      const account = await client.query<{ available: number }>(
        `SELECT available FROM workspace_credit_accounts WHERE organization_id=$1 AND workspace_id=$2 FOR UPDATE`,
        [scope.organizationId, scope.workspaceId],
      );
      // R1：配方与来源只来自不可变确认快照（0016）——直接随请求提交的
      // steps+source 不再被认作已确认配方；记录缺失或已撤销都整批拒绝。
      const confirmed = await client.query<{
        source_project_id: string;
        source_version: number;
        steps: PhotoCraftBatchStep[];
        steps_digest: string;
        status: string;
        confirmed_by: string;
        confirmed_at: Date;
      }>(
        `SELECT * FROM photocraft_batch_confirmations
         WHERE organization_id=$1 AND workspace_id=$2 AND id=$3`,
        [scope.organizationId, scope.workspaceId, input.confirmationId],
      );
      const confirmation = confirmed.rows[0];
      if (!confirmation)
        throw new PhotoCraftJobConflictError(
          "Recipe confirmation not found; confirm the recipe on a single image first",
        );
      if (confirmation.status === "revoked")
        throw new PhotoCraftJobConflictError(
          "Recipe confirmation was revoked; reconfirm the recipe",
        );
      const params = validatedPhotoCraftJobParams("batch-recipe", {
        steps: confirmation.steps,
      });
      if (batchStepsDigest(params.steps) !== confirmation.steps_digest)
        throw new PhotoCraftJobValidationError(
          "Recipe confirmation digest mismatch",
        );
      const source = {
        projectId: confirmation.source_project_id,
        version: confirmation.source_version,
      };
      // P2-1 整改：完整请求内容（规范化项目清单 + 配方 + 确认引用）与跳过
      // 结果持久化在批次记录里；重放按批次记录比对，返回与首次一致的结果、
      // 不再 reserve。
      const priorBatch = await client.query<{
        project_ids: string[];
        params: Record<string, unknown>;
        skipped: { projectId: string; reason: "project-unavailable" }[];
        confirmation_id: string | null;
      }>(
        `SELECT project_ids, params, skipped, confirmation_id
         FROM photocraft_batch_requests
         WHERE organization_id=$1 AND workspace_id=$2 AND request_key=$3`,
        [scope.organizationId, scope.workspaceId, input.requestKey],
      );
      if (priorBatch.rows[0]) {
        const prior = priorBatch.rows[0];
        const same =
          canonicalJson(prior.project_ids) ===
            canonicalJson(requestedProjects) &&
          canonicalJson(prior.params) === canonicalJson(params) &&
          prior.confirmation_id === input.confirmationId;
        if (!same)
          throw new PhotoCraftJobConflictError(
            "Request key reused with different batch recipe",
          );
        const priorJobs = await client.query<Row>(
          `SELECT * FROM photocraft_edit_jobs WHERE organization_id=$1 AND workspace_id=$2
           AND operation='batch-recipe' AND request_key=$3 ORDER BY created_at, id`,
          [scope.organizationId, scope.workspaceId, input.requestKey],
        );
        await client.query("COMMIT");
        return { jobs: priorJobs.rows.map(mapped), skipped: prior.skipped };
      }
      // 遗留数据兼容：0014 之前建的批次没有批次记录，重放仍按已建作业行比对
      // （跳过清单无法还原，只能确认配方与项目一致后按空清单返回）。
      const legacy = await client.query<Row>(
        `SELECT * FROM photocraft_edit_jobs WHERE organization_id=$1 AND workspace_id=$2
         AND operation='batch-recipe' AND request_key=$3`,
        [scope.organizationId, scope.workspaceId, input.requestKey],
      );
      if (legacy.rows.length > 0) {
        const priorProjects = legacy.rows.map((row) => row.project_id).sort();
        const sameProjects =
          priorProjects.length === requestedProjects.length &&
          priorProjects.every((id, index) => id === requestedProjects[index]);
        const sameRecipe = legacy.rows.every(
          (row) => canonicalJson(row.params) === canonicalJson(params),
        );
        if (!sameProjects || !sameRecipe)
          throw new PhotoCraftJobConflictError(
            "Request key reused with different batch recipe",
          );
        await client.query("COMMIT");
        return { jobs: legacy.rows.map(mapped), skipped: [] };
      }
      // R1/R4：源项目版本以 FOR SHARE 复核——确认与批量提交之间的并发保存
      // 不得让过期确认静默通过；FOR SHARE 与保存侧的版本更新互斥。
      const sourceProject = await client.query<{ current_version: number }>(
        `SELECT current_version FROM photocraft_projects
         WHERE organization_id=$1 AND workspace_id=$2 AND id=$3 FOR SHARE`,
        [scope.organizationId, scope.workspaceId, source.projectId],
      );
      if (!sourceProject.rows[0])
        throw new PhotoCraftJobConflictError(
          "Recipe source project is unavailable; reconfirm the recipe",
        );
      if (sourceProject.rows[0].current_version !== source.version)
        throw new PhotoCraftJobConflictError(
          "Recipe source version changed; reconfirm the recipe on the current version",
        );
      // 额度按张预检：不足则整批拒绝，不产生部分扣费。
      const available = account.rows[0]?.available ?? 0;
      if (available < projectIds.length)
        throw new PhotoCraftInsufficientCreditsError(
          "Insufficient credits for batch",
        );
      const jobs: Row[] = [];
      const skipped: { projectId: string; reason: "project-unavailable" }[] =
        [];
      for (const projectId of requestedProjects) {
        const head = await client.query<{
          current_version: number;
          source_asset_id: string;
        }>(
          `SELECT p.current_version, v.source_asset_id FROM photocraft_projects p
           JOIN photocraft_project_versions v ON v.organization_id=p.organization_id
            AND v.workspace_id=p.workspace_id AND v.project_id=p.id AND v.version=p.current_version
           WHERE p.organization_id=$1 AND p.workspace_id=$2 AND p.id=$3 FOR UPDATE OF p`,
          [scope.organizationId, scope.workspaceId, projectId],
        );
        if (!head.rows[0]) {
          skipped.push({ projectId, reason: "project-unavailable" });
          continue;
        }
        const expectedVersion = head.rows[0].current_version;
        const fingerprint = createHash("sha256")
          .update(JSON.stringify([expectedVersion, "batch-recipe", params]))
          .digest("hex");
        const added = await client.query<Row>(
          `INSERT INTO photocraft_edit_jobs
           (id, organization_id, workspace_id, project_id, request_key, request_sha256,
            expected_version, input_source_asset_id, operation, params)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'batch-recipe',$9) RETURNING *`,
          [
            randomUUID(),
            scope.organizationId,
            scope.workspaceId,
            projectId,
            input.requestKey,
            fingerprint,
            expectedVersion,
            head.rows[0].source_asset_id,
            params,
          ],
        );
        await client.query(
          `UPDATE workspace_credit_accounts SET available=available-1,updated_at=now()
           WHERE organization_id=$1 AND workspace_id=$2`,
          [scope.organizationId, scope.workspaceId],
        );
        await client.query(
          `INSERT INTO workspace_credit_ledger
           (id,organization_id,workspace_id,job_id,kind,amount,reference)
           VALUES ($1,$2,$3,$4,'reserve',-1,$5)`,
          [
            randomUUID(),
            scope.organizationId,
            scope.workspaceId,
            added.rows[0]!.id,
            `job-${added.rows[0]!.id}`,
          ],
        );
        jobs.push(added.rows[0]!);
      }
      if (jobs.length === 0)
        throw new PhotoCraftJobConflictError("No projects available for batch");
      // 批次记录与作业同事务写入：重放依据完整请求内容比对并原样返回
      // skipped（P2-1）；来源快照与确认人/确认时间复制自确认快照（R1）——
      // 是单图确认发生的真实时间，不是批量入队时间；confirmation_id 使 GET
      // 状态可回溯到同一条确认记录与配方摘要。全跳过批次已拒绝、无记录可写。
      await client.query(
        `INSERT INTO photocraft_batch_requests
         (id, organization_id, workspace_id, request_key, project_ids, params, skipped,
          source_project_id, source_version, confirmation_id, confirmed_by, confirmed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          randomUUID(),
          scope.organizationId,
          scope.workspaceId,
          input.requestKey,
          JSON.stringify(requestedProjects),
          params,
          JSON.stringify(skipped),
          source.projectId,
          source.version,
          input.confirmationId,
          confirmation.confirmed_by,
          confirmation.confirmed_at,
        ],
      );
      await client.query("COMMIT");
      return { jobs: jobs.map(mapped), skipped };
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505")
        throw new PhotoCraftJobConflictError(
          "Concurrent batch submission; retry with same key",
        );
      throw error;
    } finally {
      client.release();
    }
  }

  async listByRequestKey(
    scope: TenantScope,
    requestKey: string,
  ): Promise<PhotoCraftEditJob[]> {
    if (!REQUEST_KEY.test(requestKey))
      throw new PhotoCraftJobValidationError("Invalid request key");
    const found = await this.db.query<Row>(
      `SELECT * FROM photocraft_edit_jobs WHERE organization_id=$1 AND workspace_id=$2
       AND operation='batch-recipe' AND request_key=$3 ORDER BY created_at, id`,
      [scope.organizationId, scope.workspaceId, requestKey],
    );
    return found.rows.map(mapped);
  }

  // P2-2/R1：按 requestKey 取批次记录里的来源快照与确认追溯——确认引用、
  // 配方摘要（与确认快照内的摘要同一算法）和原始确认时间；0015 之前的批次
  // 没有来源，返回 null（状态查询仍可用，只是无来源可展示）。
  async batchRequestByRequestKey(
    scope: TenantScope,
    requestKey: string,
  ): Promise<
    | (PhotoCraftBatchRecipeSource & {
        confirmationId: string | null;
        stepsDigest: string | null;
        confirmedBy: string;
        confirmedAt: string;
      })
    | null
  > {
    if (!REQUEST_KEY.test(requestKey))
      throw new PhotoCraftJobValidationError("Invalid request key");
    const found = await this.db.query<{
      source_project_id: string | null;
      source_version: number | null;
      confirmation_id: string | null;
      params: { steps?: unknown } | null;
      confirmed_by: string | null;
      confirmed_at: Date | null;
    }>(
      `SELECT source_project_id, source_version, confirmation_id, params,
              confirmed_by, confirmed_at
       FROM photocraft_batch_requests
       WHERE organization_id=$1 AND workspace_id=$2 AND request_key=$3`,
      [scope.organizationId, scope.workspaceId, requestKey],
    );
    const row = found.rows[0];
    if (
      !row ||
      !row.source_project_id ||
      row.source_version === null ||
      !row.confirmed_by ||
      !row.confirmed_at
    )
      return null;
    return {
      projectId: row.source_project_id,
      version: row.source_version,
      confirmationId: row.confirmation_id,
      stepsDigest: row.params?.steps
        ? batchStepsDigest(row.params.steps)
        : null,
      confirmedBy: row.confirmed_by,
      confirmedAt: new Date(row.confirmed_at).toISOString(),
    };
  }

  async claimNext(): Promise<ClaimedPhotoCraftJob | null> {
    const recovery = await this.db.connect();
    try {
      await recovery.query("BEGIN");
      const expired = await recovery.query<Row>(
        `SELECT * FROM photocraft_edit_jobs WHERE status='running' AND attempts>=3
         AND lease_until < now() FOR UPDATE SKIP LOCKED LIMIT 16`,
      );
      for (const row of expired.rows) {
        await recovery.query(
          `UPDATE photocraft_edit_jobs SET status='failed',error_code='WORKER_LOST',
           lease_token=NULL,lease_until=NULL,updated_at=now(),finished_at=now() WHERE id=$1`,
          [row.id],
        );
        if (billableOperation(row.operation))
          await this.refund(recovery, {
            id: row.id,
            scope: {
              organizationId: row.organization_id,
              workspaceId: row.workspace_id,
            },
          });
      }
      await recovery.query("COMMIT");
    } catch (error) {
      await recovery.query("ROLLBACK");
      throw error;
    } finally {
      recovery.release();
    }
    const token = randomUUID();
    const found = await this.db.query<Row>(
      `WITH candidate AS (
         SELECT id FROM photocraft_edit_jobs
         WHERE available_at <= now() AND attempts < 3
           AND (status='queued' OR (status='running' AND lease_until < now()))
         ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE photocraft_edit_jobs j SET status='running', attempts=j.attempts+1,
         lease_token=$1, lease_until=now()+interval '600 seconds', updated_at=now()
       FROM candidate WHERE j.id=candidate.id RETURNING j.*`,
      [token],
    );
    const row = found.rows[0];
    return row
      ? {
          ...mapped(row),
          scope: {
            organizationId: row.organization_id,
            workspaceId: row.workspace_id,
          },
          leaseToken: token,
        }
      : null;
  }

  async succeed(
    job: ClaimedPhotoCraftJob,
    outputVersion: number,
  ): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const changed = await client.query(
        `UPDATE photocraft_edit_jobs SET status='succeeded', output_version=$3,
       lease_token=NULL, lease_until=NULL, updated_at=now(), finished_at=now(), error_code=NULL
       WHERE id=$1 AND lease_token=$2 AND status='running'`,
        [job.id, job.leaseToken, outputVersion],
      );
      if (changed.rowCount !== 1)
        throw new PhotoCraftJobConflictError("Job lease was lost");
      if (billableOperation(job.operation))
        await client.query(
          `INSERT INTO workspace_credit_ledger(id,organization_id,workspace_id,job_id,kind,amount,reference)
       VALUES ($1,$2,$3,$4,'commit',0,$5)`,
          [
            randomUUID(),
            job.scope.organizationId,
            job.scope.workspaceId,
            job.id,
            `job-${job.id}`,
          ],
        );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async fail(
    job: ClaimedPhotoCraftJob,
    code: string,
    permanent: boolean,
  ): Promise<void> {
    const final = permanent || job.attempts >= 3;
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const changed = await client.query(
        `UPDATE photocraft_edit_jobs SET status=$3, error_code=$4,
       lease_token=NULL, lease_until=NULL, updated_at=now(),
       available_at=CASE WHEN $5 THEN available_at ELSE now()+($6 * interval '5 seconds') END,
       finished_at=CASE WHEN $5 THEN now() ELSE NULL END
       WHERE id=$1 AND lease_token=$2 AND status='running'`,
        [
          job.id,
          job.leaseToken,
          final ? "failed" : "queued",
          code,
          final,
          job.attempts,
        ],
      );
      if (changed.rowCount !== 1)
        throw new PhotoCraftJobConflictError("Job lease was lost");
      if (final && billableOperation(job.operation))
        await this.refund(client, job);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async refund(
    client: pg.PoolClient,
    job: Pick<ClaimedPhotoCraftJob, "id" | "scope">,
  ): Promise<void> {
    const reserved = await client.query<{ amount: number }>(
      `SELECT -amount AS amount FROM workspace_credit_ledger WHERE job_id=$1 AND kind='reserve'`,
      [job.id],
    );
    if (!reserved.rows[0]) return;
    const inserted = await client.query(
      `INSERT INTO workspace_credit_ledger(id,organization_id,workspace_id,job_id,kind,amount,reference)
       VALUES ($1,$2,$3,$4,'refund',$5,$6) ON CONFLICT DO NOTHING`,
      [
        randomUUID(),
        job.scope.organizationId,
        job.scope.workspaceId,
        job.id,
        reserved.rows[0].amount,
        `job-${job.id}`,
      ],
    );
    if (inserted.rowCount)
      await client.query(
        `UPDATE workspace_credit_accounts SET available=available+$3,updated_at=now()
       WHERE organization_id=$1 AND workspace_id=$2`,
        [
          job.scope.organizationId,
          job.scope.workspaceId,
          reserved.rows[0].amount,
        ],
      );
  }
}
