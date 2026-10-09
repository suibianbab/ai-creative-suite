import type { ImageDocument } from "@acs/image-document";

const DATABASE_NAME = "acs-image-studio-local";
const DATABASE_VERSION = 1;

export type LocalProjectSummary = {
  id: string;
  title: string;
  updatedAt: number;
};

type ProjectRecord = LocalProjectSummary & { document: ImageDocument };
type OriginalRecord = { id: string; blob: Blob; name: string; type: string };

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("本地数据库读取失败"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("本地项目保存失败"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("本地项目保存失败"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("projects")) {
        database.createObjectStore("projects", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("originals")) {
        database.createObjectStore("originals", { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("无法打开本地数据库"));
    request.onblocked = () =>
      reject(new Error("请关闭其他旧版编辑器标签后重试"));
  });
}

export async function listLocalProjects(): Promise<LocalProjectSummary[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("projects", "readonly");
    const records = await requestResult(
      transaction.objectStore("projects").getAll() as IDBRequest<
        ProjectRecord[]
      >,
    );
    return records
      .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } finally {
    database.close();
  }
}

export async function saveLocalProject(
  document: ImageDocument,
  originalFiles: Map<string, File>,
): Promise<void> {
  const database = await openDatabase();
  try {
    const assetIds = [
      ...new Set(
        document.layers.flatMap((layer) =>
          layer.kind === "image"
            ? [layer.assetId, ...(layer.mask ? [layer.mask.assetId] : [])]
            : [],
        ),
      ),
    ];
    const read = database.transaction("originals", "readonly");
    const storedIds = await requestResult(
      read.objectStore("originals").getAllKeys() as IDBRequest<IDBValidKey[]>,
    );
    const existing = new Set(storedIds);
    for (const id of assetIds) {
      if (!existing.has(id) && !originalFiles.has(id))
        throw new Error(`图片原图缺失，无法保存项目：${id}`);
    }

    const title =
      document.layers.find((layer) => layer.kind === "image")?.name ??
      "未命名项目";
    const transaction = database.transaction(
      ["projects", "originals"],
      "readwrite",
    );
    const done = transactionDone(transaction);
    const originals = transaction.objectStore("originals");
    for (const id of assetIds) {
      if (existing.has(id)) continue;
      const file = originalFiles.get(id);
      if (!file) throw new Error(`图片原图缺失，无法保存项目：${id}`);
      originals.add({ id, blob: file, name: file.name, type: file.type });
    }
    transaction.objectStore("projects").put({
      id: document.id,
      title,
      updatedAt: Date.now(),
      document,
    } satisfies ProjectRecord);
    await done;
  } finally {
    database.close();
  }
}

export async function loadLocalProject(
  id: string,
): Promise<{ document: ImageDocument; originals: Map<string, File> }> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("projects", "readonly");
    const project = await requestResult(
      transaction.objectStore("projects").get(id) as IDBRequest<
        ProjectRecord | undefined
      >,
    );
    if (!project) throw new Error("本地项目不存在");
    const document = project.document;
    if (
      document.schemaVersion !== 1 ||
      document.id !== id ||
      document.productIdentityLock !== true ||
      !Array.isArray(document.layers)
    ) {
      throw new Error("项目格式无效或版本不兼容");
    }
    const assetIds = [
      ...new Set(
        document.layers.flatMap((layer) =>
          layer.kind === "image"
            ? [layer.assetId, ...(layer.mask ? [layer.mask.assetId] : [])]
            : [],
        ),
      ),
    ];
    const originalsTransaction = database.transaction("originals", "readonly");
    const records = await Promise.all(
      assetIds.map((assetId) =>
        requestResult(
          originalsTransaction
            .objectStore("originals")
            .get(assetId) as IDBRequest<OriginalRecord | undefined>,
        ),
      ),
    );
    const originals = new Map<string, File>();
    for (const [index, assetId] of assetIds.entries()) {
      const record = records[index];
      if (!record) throw new Error(`项目引用的原图缺失：${assetId}`);
      originals.set(
        assetId,
        new File([record.blob], record.name, { type: record.type }),
      );
    }
    return { document, originals };
  } finally {
    database.close();
  }
}
