import {
  assertAppendOnlyEvolution,
  canonicalJson,
  type VideoProject,
  VideoProjectMutationError,
  validateVideoProject,
} from "@acs/video-document";

export { VideoProjectMutationError };

const DATABASE_NAME = "acs-video-studio-local";
const DATABASE_VERSION = 2;

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

// 不可变文档版本（P1-B）：versions store 以 `${projectId}:${savedVersion}` 为键
// 保存每个已落库版本的完整快照；projects store 只保留当前指针。
type VersionSnapshot = {
  projectId: string;
  savedVersion: number;
  savedAt: number;
  document: VideoProject;
};

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
      if (!database.objectStoreNames.contains("versions")) {
        const versions = database.createObjectStore("versions");
        // v1→v2 迁移：v1 只有一条可覆盖的当前记录。升级时把每条存量记录
        // 固化为首个快照（沿用记录内的 savedVersion），旧数据不丢。
        if (request.transaction) {
          const projects = request.transaction.objectStore("projects");
          const cursorRequest = projects.openCursor();
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) return;
            const record = cursor.value as ProjectRecord;
            versions.put(
              {
                projectId: record.id,
                savedVersion: record.document.savedVersion,
                savedAt: record.updatedAt,
                document: record.document,
              },
              `${record.id}:${record.document.savedVersion}`,
            );
            cursor.continue();
          };
        }
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

// 读回某个已保存版本的完整快照；不存在返回 null。
export async function readVideoProjectVersion(
  id: string,
  savedVersion: number,
): Promise<VideoProject | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("versions", "readonly");
    const snapshot = await requestResult(
      transaction
        .objectStore("versions")
        .get(`${id}:${savedVersion}`) as IDBRequest<
        VersionSnapshot | undefined
      >,
    );
    return snapshot ? snapshot.document : null;
  } finally {
    database.close();
  }
}

// 保存即 savedVersion + 1；同 id 同内容重放幂等（直接返回存储版本，不再递增）。
// get→版本比较→演进校验→双 put 在同一个 readwrite 事务内完成（P1-C）：
// IndexedDB 串行化同库 readwrite 事务，两个标签页并发保存时后者会在事务内
// 读到前者已提交的版本，恰有一个成功、另一个收到 VideoProjectConflictError。
// 演进校验（P1-B）：旧镜头的内容版本/事件、渲染与交付记录只允许追加，
// 改写或删除旧值在落库前被拒；每个版本写入不可变快照。
export async function saveVideoProject(
  document: VideoProject,
): Promise<VideoProject> {
  validateVideoProject(document);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      ["projects", "versions"],
      "readwrite",
    );
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
    if (stored) {
      assertAppendOnlyEvolution(stored.document, next);
    }
    transaction.objectStore("versions").put(
      {
        projectId: next.id,
        savedVersion: next.savedVersion,
        savedAt: Date.now(),
        document: next,
      } satisfies VersionSnapshot,
      `${next.id}:${next.savedVersion}`,
    );
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

// 导入（P1-A 闭环回程）：工作台导出 → CLI 渲染回写 → 导回，同一项目 ID 贯穿。
// 语义：本地没有 → 原样入库（不递增）；同内容 → 幂等重放；
// 恰好快进一版且是已存版本的只追加演进 → 接受为新当前版本（快照同样落库）；
// 落后/跳版/同版本分叉 → 冲突，调用方提示刷新或另存为新项目。
export async function importVideoProject(
  document: VideoProject,
): Promise<VideoProject> {
  validateVideoProject(document);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      ["projects", "versions"],
      "readwrite",
    );
    const done = transactionDone(transaction);
    const stored = await requestResult(
      transaction.objectStore("projects").get(document.id) as IDBRequest<
        ProjectRecord | undefined
      >,
    );
    const commit = (doc: VideoProject) => {
      transaction.objectStore("versions").put(
        {
          projectId: doc.id,
          savedVersion: doc.savedVersion,
          savedAt: Date.now(),
          document: doc,
        } satisfies VersionSnapshot,
        `${doc.id}:${doc.savedVersion}`,
      );
      transaction.objectStore("projects").put({
        id: doc.id,
        title: doc.title,
        updatedAt: Date.now(),
        savedVersion: doc.savedVersion,
        document: doc,
      } satisfies ProjectRecord);
    };
    if (!stored) {
      commit(document);
      await done;
      return document;
    }
    if (canonicalJson(document) === canonicalJson(stored.document)) {
      await done; // 幂等重放
      return stored.document;
    }
    if (document.savedVersion === stored.document.savedVersion + 1) {
      try {
        assertAppendOnlyEvolution(stored.document, document);
      } catch (error) {
        done.catch(() => {});
        transaction.abort();
        throw error;
      }
      commit(document);
      await done;
      return document;
    }
    done.catch(() => {});
    transaction.abort();
    throw new VideoProjectConflictError(
      document.id,
      document.savedVersion,
      stored.document.savedVersion,
    );
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
