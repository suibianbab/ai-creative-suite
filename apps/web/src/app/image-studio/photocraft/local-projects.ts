export type PhotoCraftQualityGrade =
  | "ready"
  | "minor"
  | "manual"
  | "unsuitable";

export type PhotoCraftQualityReview = {
  grade: PhotoCraftQualityGrade;
  note: string;
  checks: boolean[];
  criteria: string[];
  reviewedAt: number;
  sourceVersion: number;
};

export type PhotoCraftLocalProject = {
  id: string;
  title: string;
  version: number;
  cloudVersion?: number;
  syncedLocalVersion?: number;
  createdAt: number;
  updatedAt: number;
  bytes: ArrayBuffer;
  original?: { bytes: ArrayBuffer; name: string; type: string };
  qualityReview?: PhotoCraftQualityReview;
  qualityHistory?: PhotoCraftQualityReview[];
};

const DATABASE = "acs-photocraft-projects-v1";
const STORE = "projects";

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listPhotoCraftProjects(): Promise<
  PhotoCraftLocalProject[]
> {
  const db = await database();
  try {
    const tx = db.transaction(STORE, "readonly");
    const projects = await result(
      tx.objectStore(STORE).getAll() as IDBRequest<PhotoCraftLocalProject[]>,
    );
    return sortValidPhotoCraftProjects(projects);
  } finally {
    db.close();
  }
}

export function sortValidPhotoCraftProjects(
  projects: unknown[],
): PhotoCraftLocalProject[] {
  return projects
    .filter((project): project is PhotoCraftLocalProject => {
      if (!project || typeof project !== "object") return false;
      const candidate = project as Partial<PhotoCraftLocalProject>;
      return (
        typeof candidate.id === "string" &&
        typeof candidate.updatedAt === "number" &&
        candidate.bytes instanceof ArrayBuffer
      );
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadPhotoCraftProject(
  id: string,
): Promise<PhotoCraftLocalProject | undefined> {
  const db = await database();
  try {
    const tx = db.transaction(STORE, "readonly");
    return await result(
      tx.objectStore(STORE).get(id) as IDBRequest<
        PhotoCraftLocalProject | undefined
      >,
    );
  } finally {
    db.close();
  }
}

export async function savePhotoCraftProject(
  currentId: string | null,
  title: string,
  bytes: ArrayBuffer,
  original?: File | null,
  review?: Omit<PhotoCraftQualityReview, "reviewedAt" | "sourceVersion">,
): Promise<PhotoCraftLocalProject> {
  if (!bytes.byteLength) throw new Error("PhotoCraft 保存文件为空");
  const originalRecord = original
    ? {
        bytes: await original.arrayBuffer(),
        name: original.name,
        type: original.type,
      }
    : undefined;
  const db = await database();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const previous = currentId
      ? await result(
          store.get(currentId) as IDBRequest<
            PhotoCraftLocalProject | undefined
          >,
        )
      : undefined;
    const now = Date.now();
    const version = (previous?.version ?? 0) + 1;
    const priorHistory =
      previous?.qualityHistory ??
      (previous?.qualityReview ? [previous.qualityReview] : []);
    const qualityReview = review
      ? {
          ...review,
          checks: [...review.checks],
          criteria: [...review.criteria],
          reviewedAt: now,
          sourceVersion: version,
        }
      : undefined;
    const project: PhotoCraftLocalProject = {
      id: previous?.id ?? currentId ?? crypto.randomUUID(),
      title: title.trim().slice(0, 200) || "未命名 PhotoCraft 项目",
      version,
      cloudVersion: previous?.cloudVersion,
      syncedLocalVersion: previous?.syncedLocalVersion,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      bytes,
      original: originalRecord ?? previous?.original,
      qualityReview,
      qualityHistory: qualityReview
        ? [...priorHistory, qualityReview]
        : [...priorHistory],
    };
    await result(store.put(project));
    return project;
  } finally {
    db.close();
  }
}

export async function reviewPhotoCraftProject(
  id: string,
  review: Omit<PhotoCraftQualityReview, "reviewedAt" | "sourceVersion">,
): Promise<PhotoCraftLocalProject> {
  const db = await database();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const project = await result(
      store.get(id) as IDBRequest<PhotoCraftLocalProject | undefined>,
    );
    if (!project) throw new Error("本地项目不存在");
    const qualityReview: PhotoCraftQualityReview = {
      ...review,
      checks: [...review.checks],
      criteria: [...review.criteria],
      reviewedAt: Date.now(),
      sourceVersion: project.version,
    };
    const history =
      project.qualityHistory ??
      (project.qualityReview ? [project.qualityReview] : []);
    const updated: PhotoCraftLocalProject = {
      ...project,
      qualityReview,
      qualityHistory: [
        ...history.filter((item) => item.sourceVersion !== project.version),
        qualityReview,
      ],
    };
    await result(store.put(updated));
    return updated;
  } finally {
    db.close();
  }
}

export function hasUnsyncedPhotoCraftDraft(
  project: PhotoCraftLocalProject,
): boolean {
  return (
    project.version !==
    (project.syncedLocalVersion ?? project.cloudVersion ?? 0)
  );
}

type CloudCacheInput = {
  id: string;
  title: string;
  version: number;
  bytes: ArrayBuffer;
};

export function planPhotoCraftCloudCache(
  previous: PhotoCraftLocalProject | undefined,
  input: CloudCacheInput,
  now: number,
  preservedId: string,
): {
  project: PhotoCraftLocalProject;
  preservedDraft: PhotoCraftLocalProject | null;
} {
  const preservedDraft =
    previous && hasUnsyncedPhotoCraftDraft(previous)
      ? ({
          ...previous,
          id: preservedId,
          title: `${previous.title.slice(0, 190)}（本地保留草稿）`,
          cloudVersion: undefined,
          syncedLocalVersion: undefined,
          updatedAt: now,
        } satisfies PhotoCraftLocalProject)
      : null;
  const project: PhotoCraftLocalProject = {
    id: input.id,
    title: input.title,
    version: input.version,
    cloudVersion: input.version,
    syncedLocalVersion: input.version,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    bytes: input.bytes,
    original: previous?.original,
    qualityReview: undefined,
    qualityHistory: preservedDraft
      ? []
      : (previous?.qualityHistory ??
        (previous?.qualityReview ? [previous.qualityReview] : [])),
  };
  return { project, preservedDraft };
}

export async function cachePhotoCraftCloudProject(
  input: CloudCacheInput,
): Promise<{
  project: PhotoCraftLocalProject;
  preservedDraft: PhotoCraftLocalProject | null;
}> {
  const db = await database();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const previous = await result(
      store.get(input.id) as IDBRequest<PhotoCraftLocalProject | undefined>,
    );
    const { project, preservedDraft } = planPhotoCraftCloudCache(
      previous,
      input,
      Date.now(),
      crypto.randomUUID(),
    );
    if (preservedDraft) await result(store.put(preservedDraft));
    await result(store.put(project));
    return { project, preservedDraft };
  } finally {
    db.close();
  }
}

export async function markPhotoCraftCloudVersion(
  id: string,
  cloudVersion: number,
  uploadedLocalVersion: number,
): Promise<boolean> {
  const db = await database();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const project = await result(
      store.get(id) as IDBRequest<PhotoCraftLocalProject | undefined>,
    );
    if (!project) throw new Error("本地项目不存在");
    const sourceStillCurrent = project.version === uploadedLocalVersion;
    await result(
      store.put({
        ...project,
        cloudVersion,
        syncedLocalVersion: sourceStillCurrent
          ? uploadedLocalVersion
          : (project.syncedLocalVersion ?? 0),
      }),
    );
    return sourceStillCurrent;
  } finally {
    db.close();
  }
}
