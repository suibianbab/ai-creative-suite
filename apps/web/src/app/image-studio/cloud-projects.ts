import type { ImageDocument } from "@acs/image-document";
import type { CloudConfig } from "./cloud-auth";

export type CloudProjectSummary = {
  id: string;
  title: string;
  version: number;
};
export type CloudProject = CloudProjectSummary & { document: ImageDocument };
export type CloudImportResult = {
  project: CloudProject;
  assetIdMap: Record<string, string>;
};

function base(config: CloudConfig): string {
  return `${config.apiOrigin}/workspaces/${config.workspaceId}/image-projects`;
}

async function checked(response: Response): Promise<Response> {
  if (response.ok) return response;
  if (response.status === 401) throw new Error("登录已过期，请重新登录");
  if (response.status === 403)
    throw new Error("当前账户没有此工作区的访问权限");
  if (response.status === 409)
    throw new Error("项目版本已变化，请重新打开后再保存");
  throw new Error(`云端项目操作失败（HTTP ${response.status}）`);
}

async function request(
  config: CloudConfig,
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return await checked(
    await fetch(`${base(config)}${path}`, {
      ...init,
      cache: "no-store",
      headers: { authorization: `Bearer ${accessToken}`, ...init?.headers },
    }),
  );
}

async function fingerprint(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

export async function listCloudProjects(
  config: CloudConfig,
  token: string,
): Promise<CloudProjectSummary[]> {
  return (await (
    await request(config, token, "")
  ).json()) as CloudProjectSummary[];
}

export async function loadCloudProject(
  config: CloudConfig,
  token: string,
  projectId: string,
): Promise<{ project: CloudProject; originals: Map<string, File> }> {
  const project = (await (
    await request(config, token, `/${projectId}`)
  ).json()) as CloudProject;
  const assetIds = [
    ...new Set(
      project.document.layers.flatMap((layer) =>
        layer.kind === "image"
          ? [layer.assetId, ...(layer.mask ? [layer.mask.assetId] : [])]
          : [],
      ),
    ),
  ];
  const originals = new Map<string, File>();
  await Promise.all(
    assetIds.map(async (id) => {
      const response = await request(
        config,
        token,
        `/${projectId}/assets/${id}`,
      );
      const blob = await response.blob();
      const type = response.headers.get("content-type") ?? blob.type;
      const ext =
        type === "image/png" ? "png" : type === "image/jpeg" ? "jpg" : "webp";
      originals.set(id, new File([blob], `${id}.${ext}`, { type }));
    }),
  );
  return { project, originals };
}

export async function importCloudProject(
  config: CloudConfig,
  token: string,
  document: ImageDocument,
  originals: Map<string, File>,
): Promise<CloudImportResult> {
  const title =
    document.layers.find((layer) => layer.kind === "image")?.name ??
    "未命名项目";
  const json = JSON.stringify(document);
  const form = new FormData();
  form.set("title", title);
  form.set("document", json);
  form.set("requestKey", `browser-${document.id}-${await fingerprint(json)}`);
  const ids = [
    ...new Set(
      document.layers.flatMap((layer) =>
        layer.kind === "image"
          ? [layer.assetId, ...(layer.mask ? [layer.mask.assetId] : [])]
          : [],
      ),
    ),
  ];
  for (const id of ids) {
    const file = originals.get(id);
    if (!file) throw new Error(`本地原图缺失：${id}`);
    form.set(id, file, file.name);
  }
  return (await (
    await request(config, token, "/imports", { method: "POST", body: form })
  ).json()) as CloudImportResult;
}

export async function uploadCloudOriginal(
  config: CloudConfig,
  token: string,
  projectId: string,
  localId: string,
  file: File,
): Promise<string> {
  const form = new FormData();
  form.set("requestKey", `project-${projectId}-${localId}`);
  form.set("original", file, file.name);
  const response = await request(config, token, `/${projectId}/assets`, {
    method: "POST",
    body: form,
  });
  return ((await response.json()) as { id: string }).id;
}

export async function saveCloudProject(
  config: CloudConfig,
  token: string,
  document: ImageDocument,
  expectedVersion: number,
): Promise<CloudProject> {
  const title =
    document.layers.find((layer) => layer.kind === "image")?.name ??
    "未命名项目";
  const json = JSON.stringify(document);
  return (await (
    await request(config, token, `/${document.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title,
        document,
        expectedVersion,
        requestKey: `save-${expectedVersion}-${await fingerprint(json)}`,
      }),
    })
  ).json()) as CloudProject;
}
