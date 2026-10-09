import { createHash, randomUUID } from "node:crypto";
import type { ImageDocument } from "@acs/image-document";
import type pg from "pg";
import {
  AssetFoundation,
  type TenantScope,
} from "../assets/asset-foundation.js";
import {
  ImageProjectStore,
  type SavedImageProject,
  validateImageDocumentForStorage,
} from "./image-project-store.js";

const REQUEST_KEY = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_FILES = 50;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

export class LocalImageImportConflictError extends Error {}
export class LocalImageImportValidationError extends Error {}

export type LocalOriginal = Readonly<{
  displayName: string;
  contentType: string;
  bytes: Buffer;
}>;

export type LocalImageImportResult = Readonly<{
  project: SavedImageProject;
  assetIdMap: ReadonlyMap<string, string>;
}>;

type ImportRow = {
  id: string;
  source_sha256: string;
  destination_project_id: string;
};

/** Internal import boundary; HTTP authentication and upload transport are separate gates. */
export class LocalImageImportService {
  constructor(
    private readonly db: pg.Pool,
    private readonly assets: AssetFoundation,
    private readonly projects: ImageProjectStore,
  ) {}

  async import(
    scope: TenantScope,
    title: string,
    source: unknown,
    originals: ReadonlyMap<string, LocalOriginal>,
    requestKey: string,
  ): Promise<LocalImageImportResult> {
    const { document, json, assetIds } =
      validateImageDocumentForStorage(source);
    const cleanTitle = title.trim();
    if (
      !UUID.test(scope.organizationId) ||
      !UUID.test(scope.workspaceId) ||
      !REQUEST_KEY.test(requestKey) ||
      !cleanTitle ||
      cleanTitle.length > 200 ||
      originals.size !== assetIds.length ||
      assetIds.length > MAX_FILES ||
      assetIds.some((id) => !originals.has(id))
    ) {
      throw new LocalImageImportValidationError(
        "Invalid import key, title, or original file set",
      );
    }
    let totalBytes = 0;
    const fileManifest = assetIds.sort().map((localId) => {
      const file = originals.get(localId)!;
      if (
        !file.displayName.trim() ||
        !Buffer.isBuffer(file.bytes) ||
        file.bytes.length < 1 ||
        file.bytes.length > 25 * 1024 * 1024
      ) {
        throw new LocalImageImportValidationError("Invalid original file");
      }
      totalBytes += file.bytes.length;
      return [
        localId,
        file.displayName,
        file.contentType,
        createHash("sha256").update(file.bytes).digest("hex"),
      ];
    });
    if (totalBytes > MAX_TOTAL_BYTES)
      throw new LocalImageImportValidationError(
        "Import exceeds total size limit",
      );
    const sourceSha256 = createHash("sha256")
      .update(JSON.stringify([cleanTitle, json, fileManifest]))
      .digest("hex");
    const importId = randomUUID();
    const destinationProjectId = randomUUID();
    await this.db.query(
      `INSERT INTO local_image_imports
       (id, organization_id, workspace_id, request_key, source_project_id, source_sha256, destination_project_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (organization_id, workspace_id, request_key) DO NOTHING`,
      [
        importId,
        scope.organizationId,
        scope.workspaceId,
        requestKey,
        document.id,
        sourceSha256,
        destinationProjectId,
      ],
    );
    const saved = await this.db.query<ImportRow>(
      `SELECT id, source_sha256, destination_project_id FROM local_image_imports
       WHERE organization_id = $1 AND workspace_id = $2 AND request_key = $3`,
      [scope.organizationId, scope.workspaceId, requestKey],
    );
    const row = saved.rows[0];
    if (!row)
      throw new LocalImageImportConflictError("Import record is unavailable");
    if (row.source_sha256 !== sourceSha256) {
      throw new LocalImageImportConflictError(
        "Import key reused with different project or originals",
      );
    }

    const assetIdMap = new Map<string, string>();
    for (const localId of assetIds) {
      const file = originals.get(localId)!;
      const asset = await this.assets.createOriginal(scope, {
        idempotencyKey: `import-${row.id}-${localId}`,
        displayName: file.displayName,
        kind: "IMAGE",
        source: "USER_UPLOAD",
        contentType: file.contentType,
        bytes: file.bytes,
      });
      assetIdMap.set(localId, asset.id);
    }
    const rewritten: ImageDocument = {
      ...document,
      id: row.destination_project_id,
      layers: document.layers.map((layer) =>
        layer.kind === "image"
          ? {
              ...layer,
              assetId: assetIdMap.get(layer.assetId)!,
              mask: layer.mask
                ? {
                    ...layer.mask,
                    assetId: assetIdMap.get(layer.mask.assetId)!,
                  }
                : undefined,
            }
          : layer,
      ),
    };
    const project = await this.projects.save(
      scope,
      cleanTitle,
      rewritten,
      0,
      `import-${row.id}`,
    );
    await this.db.query(
      `UPDATE local_image_imports SET completed_at = now()
       WHERE organization_id = $1 AND workspace_id = $2 AND id = $3 AND completed_at IS NULL`,
      [scope.organizationId, scope.workspaceId, row.id],
    );
    return { project, assetIdMap };
  }
}
