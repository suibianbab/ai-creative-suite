import type { CloudConfig } from "../cloud-auth";
import type { PhotoCraftBatchStep } from "./batch-recipe";
import type { PhotoCraftQualityGrade } from "./local-projects";

export type PhotoCraftCloudProject = {
  id: string;
  title: string;
  version: number;
  sourceAssetId: string;
  originalAssetId: string | null;
  engineVersion: string;
};

export type PhotoCraftCloudEditJob = {
  id: string;
  projectId: string;
  expectedVersion: number;
  operation:
    | "rotate-cw"
    | "rotate-ccw"
    | "rotate-180"
    | "flip-horizontal"
    | "flip-vertical"
    | "duplicate-layer"
    | "hide-layer"
    | "show-layer"
    | "adjust-brightness"
    | "adjust-contrast"
    | "adjust-saturation"
    | "adjust-exposure"
    | "adjust-vibrance"
    | "adjust-shadows"
    | "adjust-highlights"
    | "levels"
    | "masked-adjust-brightness"
    | "masked-adjust-contrast"
    | "masked-adjust-saturation"
    | "masked-adjust-exposure"
    | "masked-adjust-vibrance"
    | "masked-adjust-shadows"
    | "masked-adjust-highlights"
    | "generate-local";
  params: Record<string, unknown>;
  status: "queued" | "running" | "succeeded" | "failed";
  attempts: number;
  outputVersion: number | null;
  errorCode: string | null;
};

export type PhotoCraftCloudQualityReview = {
  id: string;
  projectId: string;
  sourceVersion: number;
  reviewerUserId: string;
  grade: PhotoCraftQualityGrade;
  note: string;
  checks: boolean[];
  criteria: string[];
  createdAt: string;
};

function base(config: CloudConfig): string {
  return `${config.apiOrigin}/workspaces/${config.workspaceId}/photocraft-projects`;
}

// P2-2 批量配方（方案 §12.3）：状态查询/入队结果里的作业形状（operation 固定
// batch-recipe，服务端展开 steps 逐张执行）。
export type PhotoCraftBatchRecipeJob = {
  id: string;
  projectId: string;
  expectedVersion: number;
  operation: "batch-recipe";
  params: Record<string, unknown>;
  status: "queued" | "running" | "succeeded" | "failed";
  attempts: number;
  outputVersion: number | null;
  errorCode: string | null;
  requestKey: string;
};
export type PhotoCraftBatchRecipeSource = {
  projectId: string;
  version: number;
  confirmationId: string | null;
  stepsDigest: string | null;
  confirmedBy: string;
  confirmedAt: string;
};
// R1：单图确认环登记的服务端确认快照（不可变）。
export type PhotoCraftBatchConfirmation = {
  id: string;
  source: { projectId: string; version: number };
  steps: PhotoCraftBatchStep[];
  stepsDigest: string;
  status: "active" | "revoked";
  confirmedBy: string;
  confirmedAt: string;
};
export type PhotoCraftBatchRecipeStatus = {
  requestKey: string;
  total: number;
  statuses: Record<string, number>;
  sampledJobIds: string[];
  source: PhotoCraftBatchRecipeSource | null;
  jobs: PhotoCraftBatchRecipeJob[];
};
export type PhotoCraftBatchRecipeEnqueueResult = {
  jobs: PhotoCraftBatchRecipeJob[];
  skipped: { projectId: string; reason: string }[];
};

function batchBase(config: CloudConfig): string {
  return `${config.apiOrigin}/workspaces/${config.workspaceId}/photocraft-batch-recipes`;
}

// 批量端点的 409 语义与单项目保存不同（确认缺失/撤销/来源过期/键冲突），
// 把服务端理由翻成可行动的提示，而不是「版本已变化，请重新打开」。
async function checkedBatch(response: Response): Promise<Response> {
  if (response.ok) return response;
  if (response.status === 401) throw new Error("登录已过期，请重新登录");
  if (response.status === 403)
    throw new Error("当前账户没有此工作区的访问权限");
  if (response.status === 402)
    throw new Error("工作区积分不足，批量任务未入队（未产生扣费）");
  if (response.status === 409) {
    const detail = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    const message = detail?.message ?? "";
    if (message.includes("confirm the recipe on a single image first"))
      throw new Error(
        "配方确认记录不存在：请先在单图上勾选确认计划，再发起批量。",
      );
    if (message.includes("was revoked"))
      throw new Error("配方确认已被撤销，请重新确认后再提交批量。");
    if (message.includes("source version changed"))
      throw new Error(
        "配方来源版本已变化：源项目产生了新版本。请重新打开当前版本、再次确认配方后提交。",
      );
    if (message.includes("source project is unavailable"))
      throw new Error("配方来源项目已不可用。请重新确认配方后提交。");
    if (message.includes("reused with different batch recipe"))
      throw new Error("同一批量请求号已用于不同的配方内容，请刷新后重试。");
    if (message.includes("No projects available"))
      throw new Error("目标项目全部不可用，未创建批量任务。");
    throw new Error(`批量配方冲突：${message || "请刷新后重试"}`);
  }
  throw new Error(`PhotoCraft 批量操作失败（HTTP ${response.status}）`);
}

// R1：把单图确认环通过的配方登记为服务端确认快照。确认时间/人以服务端
// 记录为准；返回的 id 供批量入队引用。
export async function createPhotoCraftBatchConfirmation(
  config: CloudConfig,
  token: string,
  input: {
    source: { projectId: string; version: number };
    steps: PhotoCraftBatchStep[];
  },
): Promise<PhotoCraftBatchConfirmation> {
  const response = await checkedBatch(
    await fetch(
      `${config.apiOrigin}/workspaces/${config.workspaceId}/photocraft-batch-confirmations`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
        cache: "no-store",
      },
    ),
  );
  return (await response.json()) as PhotoCraftBatchConfirmation;
}

export async function enqueuePhotoCraftBatchRecipe(
  config: CloudConfig,
  token: string,
  input: {
    requestKey: string;
    projectIds: string[];
    confirmationId: string;
  },
): Promise<PhotoCraftBatchRecipeEnqueueResult> {
  const response = await checkedBatch(
    await fetch(batchBase(config), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        requestKey: input.requestKey,
        projectIds: input.projectIds,
        confirmationId: input.confirmationId,
      }),
      cache: "no-store",
    }),
  );
  return (await response.json()) as PhotoCraftBatchRecipeEnqueueResult;
}

export async function getPhotoCraftBatchRecipeStatus(
  config: CloudConfig,
  token: string,
  requestKey: string,
): Promise<PhotoCraftBatchRecipeStatus> {
  const response = await checkedBatch(
    await fetch(`${batchBase(config)}/${encodeURIComponent(requestKey)}`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    }),
  );
  return (await response.json()) as PhotoCraftBatchRecipeStatus;
}

async function checked(response: Response): Promise<Response> {
  if (response.ok) return response;
  if (response.status === 401) throw new Error("登录已过期，请重新登录");
  if (response.status === 403) throw new Error("当前账户没有此工作区访问权限");
  if (response.status === 402)
    throw new Error("生成积分不足，请先为工作区充值积分");
  if (response.status === 409)
    throw new Error("云端项目版本已变化，请重新打开");
  throw new Error(`PhotoCraft 云端项目操作失败（HTTP ${response.status}）`);
}

export async function getPhotoCraftCloudCredits(
  config: CloudConfig,
  token: string,
): Promise<{ available: number; generationCost: number }> {
  const response = await checked(
    await fetch(
      `${config.apiOrigin}/workspaces/${config.workspaceId}/photocraft-credits`,
      {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    ),
  );
  return (await response.json()) as {
    available: number;
    generationCost: number;
  };
}

export async function listPhotoCraftCloudProjects(
  config: CloudConfig,
  token: string,
): Promise<PhotoCraftCloudProject[]> {
  const response = await checked(
    await fetch(base(config), {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    }),
  );
  return (await response.json()) as PhotoCraftCloudProject[];
}

export async function loadPhotoCraftCloudSource(
  config: CloudConfig,
  token: string,
  id: string,
): Promise<ArrayBuffer> {
  const response = await checked(
    await fetch(`${base(config)}/${id}/source`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    }),
  );
  return await response.arrayBuffer();
}

export async function submitPhotoCraftCloudEditJob(
  config: CloudConfig,
  token: string,
  input: {
    projectId: string;
    expectedVersion: number;
    operation: PhotoCraftCloudEditJob["operation"];
    params?: Record<string, unknown>;
    requestKey: string;
  },
): Promise<PhotoCraftCloudEditJob> {
  const response = await checked(
    await fetch(`${base(config)}/${input.projectId}/jobs`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        expectedVersion: input.expectedVersion,
        operation: input.operation,
        params: input.params ?? {},
        requestKey: input.requestKey,
      }),
      cache: "no-store",
    }),
  );
  return (await response.json()) as PhotoCraftCloudEditJob;
}

export async function getPhotoCraftCloudEditJob(
  config: CloudConfig,
  token: string,
  projectId: string,
  jobId: string,
): Promise<PhotoCraftCloudEditJob> {
  const response = await checked(
    await fetch(`${base(config)}/${projectId}/jobs/${jobId}`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    }),
  );
  return (await response.json()) as PhotoCraftCloudEditJob;
}

export async function listPhotoCraftCloudQualityReviews(
  config: CloudConfig,
  token: string,
  projectId: string,
  version: number,
): Promise<PhotoCraftCloudQualityReview[]> {
  const response = await checked(
    await fetch(`${base(config)}/${projectId}/reviews/${version}`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    }),
  );
  return (await response.json()) as PhotoCraftCloudQualityReview[];
}

export async function appendPhotoCraftCloudQualityReview(
  config: CloudConfig,
  token: string,
  projectId: string,
  version: number,
  review: Pick<
    PhotoCraftCloudQualityReview,
    "grade" | "note" | "checks" | "criteria"
  >,
): Promise<PhotoCraftCloudQualityReview> {
  const response = await checked(
    await fetch(`${base(config)}/${projectId}/reviews/${version}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        requestKey: `browser-${crypto.randomUUID()}`,
        grade: review.grade,
        note: review.note,
        checks: review.checks,
        criteria: review.criteria,
      }),
      cache: "no-store",
    }),
  );
  return (await response.json()) as PhotoCraftCloudQualityReview;
}

export async function savePhotoCraftCloudProject(
  config: CloudConfig,
  token: string,
  project: {
    id: string;
    title: string;
    expectedVersion: number;
    bytes: ArrayBuffer;
    original?: File | null;
  },
): Promise<PhotoCraftCloudProject> {
  const form = new FormData();
  form.set("id", project.id);
  form.set("title", project.title);
  form.set("expectedVersion", String(project.expectedVersion));
  const metadata = new TextEncoder().encode(
    JSON.stringify([project.id, project.title, project.expectedVersion]),
  );
  const keyContent = new Uint8Array(
    metadata.byteLength + project.bytes.byteLength,
  );
  keyContent.set(metadata);
  keyContent.set(new Uint8Array(project.bytes), metadata.byteLength);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", keyContent),
  );
  const hash = [...digest]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  form.set(
    "requestKey",
    `browser-${project.expectedVersion}-${hash.slice(0, 32)}`,
  );
  form.set(
    "source",
    new Blob([project.bytes], { type: "application/x-photocraft" }),
    `${project.title}.pcraft`,
  );
  if (
    project.expectedVersion === 0 &&
    project.original &&
    ["image/png", "image/jpeg", "image/webp"].includes(project.original.type)
  ) {
    form.set("original", project.original, project.original.name);
  }
  const response = await checked(
    await fetch(
      project.expectedVersion === 0
        ? base(config)
        : `${base(config)}/${project.id}`,
      {
        method: project.expectedVersion === 0 ? "POST" : "PUT",
        headers: { authorization: `Bearer ${token}` },
        body: form,
        cache: "no-store",
      },
    ),
  );
  return (await response.json()) as PhotoCraftCloudProject;
}
