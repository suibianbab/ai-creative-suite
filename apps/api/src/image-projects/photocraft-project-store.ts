import { createHash } from "node:crypto";
import type pg from "pg";
import {
  AssetFoundation,
  type TenantScope,
} from "../assets/asset-foundation.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_KEY = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

export class PhotoCraftValidationError extends Error {}
export class PhotoCraftConflictError extends Error {}

export type PhotoCraftProject = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  title: string;
  version: number;
  sourceAssetId: string;
  originalAssetId: string | null;
  engineVersion: string;
}>;

type Row = {
  id: string;
  organization_id: string;
  workspace_id: string;
  title: string;
  current_version: number;
  source_asset_id: string;
  original_asset_id: string | null;
  engine_version: string;
};

function mapRow(row: Row): PhotoCraftProject {
  return {
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    title: row.title,
    version: row.current_version,
    sourceAssetId: row.source_asset_id,
    originalAssetId: row.original_asset_id,
    engineVersion: row.engine_version,
  };
}

const SELECT = `SELECT p.id, p.organization_id, p.workspace_id, p.title,
  p.current_version, p.original_asset_id, v.source_asset_id, v.engine_version
  FROM photocraft_projects p JOIN photocraft_project_versions v
    ON v.organization_id = p.organization_id AND v.workspace_id = p.workspace_id
    AND v.project_id = p.id AND v.version = p.current_version`;

export class PhotoCraftProjectStore {
  constructor(
    private readonly db: pg.Pool,
    private readonly assets: AssetFoundation,
  ) {}

  async list(scope: TenantScope): Promise<PhotoCraftProject[]> {
    const result = await this.db.query<Row>(
      `${SELECT} WHERE p.organization_id = $1 AND p.workspace_id = $2
       ORDER BY p.updated_at DESC, p.id DESC LIMIT 100`,
      [scope.organizationId, scope.workspaceId],
    );
    return result.rows.map(mapRow);
  }

  async get(scope: TenantScope, id: string): Promise<PhotoCraftProject | null> {
    if (!UUID.test(id)) return null;
    const result = await this.db.query<Row>(
      `${SELECT} WHERE p.organization_id = $1 AND p.workspace_id = $2 AND p.id = $3`,
      [scope.organizationId, scope.workspaceId, id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  private async getVersion(
    scope: TenantScope,
    id: string,
    version: number,
  ): Promise<PhotoCraftProject | null> {
    const result = await this.db.query<Row>(
      `SELECT p.id, p.organization_id, p.workspace_id, v.title,
        v.version AS current_version, p.original_asset_id, v.source_asset_id, v.engine_version
       FROM photocraft_projects p JOIN photocraft_project_versions v
         ON v.organization_id=p.organization_id AND v.workspace_id=p.workspace_id
         AND v.project_id=p.id
       WHERE p.organization_id=$1 AND p.workspace_id=$2 AND p.id=$3 AND v.version=$4`,
      [scope.organizationId, scope.workspaceId, id, version],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async readSource(scope: TenantScope, id: string): Promise<Buffer | null> {
    const project = await this.get(scope, id);
    if (!project) return null;
    const original = await this.assets.readOriginal(
      scope,
      project.sourceAssetId,
    );
    return original?.bytes ?? null;
  }

  async getByRequestKey(
    scope: TenantScope,
    id: string,
    requestKey: string,
  ): Promise<PhotoCraftProject | null> {
    if (!UUID.test(id) || !REQUEST_KEY.test(requestKey)) return null;
    const found = await this.db.query<Row>(
      `SELECT p.id, p.organization_id, p.workspace_id, v.title,
        v.version AS current_version, p.original_asset_id, v.source_asset_id, v.engine_version
       FROM photocraft_projects p JOIN photocraft_project_versions v
         ON v.organization_id=p.organization_id AND v.workspace_id=p.workspace_id
         AND v.project_id=p.id
       WHERE p.organization_id=$1 AND p.workspace_id=$2 AND p.id=$3 AND v.request_key=$4`,
      [scope.organizationId, scope.workspaceId, id, requestKey],
    );
    return found.rows[0] ? mapRow(found.rows[0]) : null;
  }

  async save(
    scope: TenantScope,
    input: {
      id: string;
      title: string;
      expectedVersion: number;
      requestKey: string;
      bytes: Buffer;
      original?: { bytes: Buffer; contentType: string; name: string };
    },
  ): Promise<PhotoCraftProject> {
    const title = input.title.trim();
    if (
      !UUID.test(input.id) ||
      !title ||
      title.length > 200 ||
      !REQUEST_KEY.test(input.requestKey) ||
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 0 ||
      !Buffer.isBuffer(input.bytes) ||
      input.bytes.length < 4 ||
      input.bytes.length > MAX_SOURCE_BYTES ||
      !input.bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    )
      throw new PhotoCraftValidationError(
        "Invalid PhotoCraft source or save metadata",
      );
    if (
      input.original &&
      (input.expectedVersion !== 0 ||
        !["image/png", "image/jpeg", "image/webp"].includes(
          input.original.contentType,
        ) ||
        input.original.bytes.length < 1 ||
        input.original.bytes.length > MAX_SOURCE_BYTES)
    )
      throw new PhotoCraftValidationError("Invalid original image");

    const sha = createHash("sha256").update(input.bytes).digest("hex");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([title, sha]))
      .digest("hex");
    const source = await this.assets.createOriginal(scope, {
      idempotencyKey: `pc-${input.id}-${createHash("sha256").update(input.requestKey).digest("hex").slice(0, 32)}`,
      displayName: `${title}.pcraft`.slice(0, 200),
      kind: "DOCUMENT",
      source: "AI_EDITED",
      contentType: "application/x-photocraft",
      bytes: input.bytes,
    });
    const original = input.original
      ? await this.assets.createOriginal(scope, {
          idempotencyKey: `pc-original-${input.id}`,
          displayName: input.original.name.slice(0, 200),
          kind: "IMAGE",
          source: "USER_UPLOAD",
          contentType: input.original.contentType,
          bytes: input.original.bytes,
        })
      : null;

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<{ current_version: number }>(
        `SELECT current_version FROM photocraft_projects
         WHERE organization_id=$1 AND workspace_id=$2 AND id=$3 FOR UPDATE`,
        [scope.organizationId, scope.workspaceId, input.id],
      );
      const current = found.rows[0];
      if (current) {
        const replay = await client.query<{
          version: number;
          request_sha256: string;
        }>(
          `SELECT version, request_sha256 FROM photocraft_project_versions
           WHERE organization_id=$1 AND workspace_id=$2 AND project_id=$3 AND request_key=$4`,
          [scope.organizationId, scope.workspaceId, input.id, input.requestKey],
        );
        if (replay.rows[0]) {
          if (replay.rows[0].request_sha256 !== fingerprint)
            throw new PhotoCraftConflictError(
              "Request key reused with different content",
            );
          await client.query("COMMIT");
          const project = await this.getVersion(
            scope,
            input.id,
            replay.rows[0].version,
          );
          return project!;
        }
        if (current.current_version !== input.expectedVersion)
          throw new PhotoCraftConflictError("Project version has changed");
      } else {
        if (input.expectedVersion !== 0)
          throw new PhotoCraftConflictError(
            "Project does not exist at expected version",
          );
        await client.query(
          `INSERT INTO photocraft_projects
           (id, organization_id, workspace_id, title, current_version, original_asset_id)
           VALUES ($1,$2,$3,$4,1,$5)`,
          [
            input.id,
            scope.organizationId,
            scope.workspaceId,
            title,
            original?.id ?? null,
          ],
        );
      }
      const version = (current?.current_version ?? 0) + 1;
      await client.query(
        `INSERT INTO photocraft_project_versions
         (organization_id, workspace_id, project_id, version, title, source_asset_id,
          engine_version, request_key, request_sha256)
         VALUES ($1,$2,$3,$4,$5,$6,'0.6.0',$7,$8)`,
        [
          scope.organizationId,
          scope.workspaceId,
          input.id,
          version,
          title,
          source.id,
          input.requestKey,
          fingerprint,
        ],
      );
      if (current) {
        await client.query(
          `UPDATE photocraft_projects SET title=$1, current_version=$2, updated_at=now()
           WHERE organization_id=$3 AND workspace_id=$4 AND id=$5`,
          [title, version, scope.organizationId, scope.workspaceId, input.id],
        );
      }
      await client.query("COMMIT");
      const project = await this.get(scope, input.id);
      return project!;
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505")
        throw new PhotoCraftConflictError("Concurrent project save conflict");
      throw error;
    } finally {
      client.release();
    }
  }
}
