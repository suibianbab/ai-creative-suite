import {
  canonicalJson,
  type VideoProject,
  validateVideoProject,
} from "@acs/video-document";

const DATABASE_NAME = "acs-video-studio-local";
const DATABASE_VERSION = 1;

// 乐观并发：本地副本落后（或超前）于存储即拒绝落库，调用方提示刷新重开。
export class VideoProjectConflictError extends Error {
  constructor(id: string, localVersion: number, storedVersion: number) {
    super(
      `项目 ${id} 已在别处更新（本地 v${localVersion}，存储 v${storedVersion}），请刷新重开`,
    );
    this.name = "VideoProjectConflictError";
  }
}

export type VideoProjectSummary = {
  id: string;
  title: string;
  updatedAt: number;
  savedVersion: number;
};

type ProjectRecord = VideoProjectSummary & { document: VideoProject };

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
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("无法打开本地数据库"));
    request.onblocked = () =>
      reject(new Error("请关闭其他旧版编辑器标签后重试"));
  });
}

export async function listVideoProjects(): Promise<VideoProjectSummary[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("projects", "readonly");
    const records = await requestResult(
      transaction.objectStore("projects").getAll() as IDBRequest<
        ProjectRecord[]
      >,
    );
    return records
      .map(({ id, title, updatedAt, savedVersion }) => ({
        id,
        title,
        updatedAt,
        savedVersion,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } finally {
    database.close();
  }
}

// 保存即 savedVersion + 1；同 id 同内容重放幂等（直接返回存储版本，不再递增）。
// get→版本比较→put 必须在同一个 readwrite 事务内完成：IndexedDB 串行化同库
// readwrite 事务，两个标签页并发保存时后者会在事务内读到前者已提交的版本，
// 于是恰有一个成功、另一个收到 VideoProjectConflictError（P1-C）。
export async function saveVideoProject(
  document: VideoProject,
): Promise<VideoProject> {
  validateVideoProject(document);
  const database = await openDatabase();
  try {
    const transaction = database.transaction("projects", "readwrite");
    const done = transactionDone(transaction);
    const stored = await requestResult(
      transaction.objectStore("projects").get(document.id) as IDBRequest<
        ProjectRecord | undefined
      >,
    );
    if (stored) {
      if (canonicalJson(document) === canonicalJson(stored.document)) {
        await done; // 重放：同 id 同 savedVersion 同内容，等事务空提交
        return stored.document;
      }
      if (document.savedVersion !== stored.document.savedVersion) {
        done.catch(() => {}); // abort 的拒绝在此路径无人等待，别泄漏成未处理拒绝
        transaction.abort();
        throw new VideoProjectConflictError(
          document.id,
          document.savedVersion,
          stored.document.savedVersion,
        );
      }
    }
    const next: VideoProject = {
      ...document,
      savedVersion: document.savedVersion + 1,
    };
    validateVideoProject(next);
    transaction.objectStore("projects").put({
      id: next.id,
      title: next.title,
      updatedAt: Date.now(),
      savedVersion: next.savedVersion,
      document: next,
    } satisfies ProjectRecord);
    await done;
    return next;
  } finally {
    database.close();
  }
}

export async function openVideoProject(
  id: string,
): Promise<VideoProject | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("projects", "readonly");
    const record = await requestResult(
      transaction.objectStore("projects").get(id) as IDBRequest<
        ProjectRecord | undefined
      >,
    );
    return record ? record.document : null;
  } finally {
    database.close();
  }
}
