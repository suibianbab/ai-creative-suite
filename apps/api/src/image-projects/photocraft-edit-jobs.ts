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
  operation: PhotoCraftJobOperation,
  input: unknown,
): Record<string, unknown> {
  const params = input ?? {};
  if (!params || typeof params !== "object" || Array.isArray(params))
    throw new PhotoCraftJobValidationError("Invalid PhotoCraft job parameters");
  const keys = Object.keys(params);
  const values = params as Record<string, unknown>;
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
  operation: PhotoCraftJobOperation;
  params: Record<string, unknown>;
  status: "queued" | "running" | "succeeded" | "failed";
  attempts: number;
  outputVersion: number | null;
  errorCode: string | null;
}>;

export type ClaimedPhotoCraftJob = PhotoCraftEditJob &
  Readonly<{
    scope: TenantScope;
    leaseToken: string;
  }>;

type Row = {
  id: string;
  organization_id: string;
  workspace_id: string;
  project_id: string;
  expected_version: number;
  input_source_asset_id: string;
  operation: PhotoCraftJobOperation;
  params: Record<string, unknown>;
  status: PhotoCraftEditJob["status"];
  attempts: number;
  output_version: number | null;
  error_code: string | null;
  lease_token: string | null;
  request_sha256?: string;
};

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
      operation: PhotoCraftJobOperation;
      params?: unknown;
      requestKey: string;
    },
  ): Promise<PhotoCraftEditJob> {
    if (
      !UUID.test(input.projectId) ||
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      !Object.hasOwn(PHOTOCRAFT_JOB_OPERATIONS, input.operation) ||
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
      if (input.operation === "generate-local") {
        const account = await client.query<{ available: number }>(
          `SELECT available FROM workspace_credit_accounts WHERE organization_id=$1 AND workspace_id=$2 FOR UPDATE`,
          [scope.organizationId, scope.workspaceId],
        );
        if (!account.rows[0] || account.rows[0].available < 1)
          throw new PhotoCraftInsufficientCreditsError(
            "Insufficient generation credits",
          );
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
      if (input.operation === "generate-local") {
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
        if (row.operation === "generate-local")
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
      if (job.operation === "generate-local")
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
      if (final && job.operation === "generate-local")
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
