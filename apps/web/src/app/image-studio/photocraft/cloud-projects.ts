import type { CloudConfig } from "../cloud-auth";
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
