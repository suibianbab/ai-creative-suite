import { createHash } from "node:crypto";
import {
  applyImageOperation,
  createImageDocument,
  type ImageDocument,
} from "@acs/image-document";
import type pg from "pg";
import type { TenantScope } from "../assets/asset-foundation.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_KEY = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MAX_LAYERS = 200;

export class ImageProjectValidationError extends Error {}
export class ImageProjectConflictError extends Error {}
export class ImageProjectAssetError extends Error {}

export type SavedImageProject = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  title: string;
  version: number;
  document: ImageDocument;
}>;

type ProjectRow = {
  id: string;
  organization_id: string;
  workspace_id: string;
  title: string;
  current_version: number;
  document: ImageDocument;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireScope(scope: TenantScope): void {
  if (!UUID.test(scope.organizationId) || !UUID.test(scope.workspaceId)) {
    throw new ImageProjectValidationError("Invalid tenant scope");
  }
}

export function validateImageDocumentForStorage(value: unknown): {
  document: ImageDocument;
  json: string;
  assetIds: string[];
} {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new ImageProjectValidationError(
      "ImageDocument is not JSON serializable",
    );
  }
  if (!json || Buffer.byteLength(json) > MAX_DOCUMENT_BYTES) {
    throw new ImageProjectValidationError("ImageDocument exceeds size limit");
  }
  const parsed: unknown = JSON.parse(json);
  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== 1 ||
    parsed.productIdentityLock !== true ||
    typeof parsed.id !== "string" ||
    !UUID.test(parsed.id) ||
    !isRecord(parsed.canvas) ||
    !Number.isInteger(parsed.canvas.width) ||
    !Number.isInteger(parsed.canvas.height) ||
    (parsed.canvas.width as number) < 1 ||
    (parsed.canvas.width as number) > 8192 ||
    (parsed.canvas.height as number) < 1 ||
    (parsed.canvas.height as number) > 8192 ||
    typeof parsed.canvas.background !== "string" ||
    !/^#[0-9a-fA-F]{6}$/.test(parsed.canvas.background) ||
    !Array.isArray(parsed.layers) ||
    parsed.layers.length > MAX_LAYERS
  ) {
    throw new ImageProjectValidationError("Invalid ImageDocument header");
  }
  const document = parsed as ImageDocument;
  const assetIds = new Set<string>();
  let checked = createImageDocument(document.id);
  for (const layer of document.layers) {
    if (
      !isRecord(layer) ||
      typeof layer.id !== "string" ||
      !UUID.test(layer.id) ||
      typeof layer.name !== "string" ||
      layer.name.length < 1 ||
      layer.name.length > 200 ||
      ![
        layer.x,
        layer.y,
        layer.width,
        layer.height,
        layer.rotation,
        layer.opacity,
      ].every((number) => typeof number === "number" && Number.isFinite(number))
    ) {
      throw new ImageProjectValidationError(
        "Invalid layer identity or geometry",
      );
    }
    if (layer.kind === "image") {
      if (
        typeof layer.assetId !== "string" ||
        !UUID.test(layer.assetId) ||
        !Number.isInteger(layer.sourceWidth) ||
        !Number.isInteger(layer.sourceHeight) ||
        (layer.sourceWidth as number) < 1 ||
        (layer.sourceHeight as number) < 1 ||
        (layer.sourceWidth as number) > 30000 ||
        (layer.sourceHeight as number) > 30000
      ) {
        throw new ImageProjectValidationError("Invalid image layer source");
      }
      assetIds.add(layer.assetId);
      if (layer.mask !== undefined) {
        if (
          !isRecord(layer.mask) ||
          typeof layer.mask.assetId !== "string" ||
          !UUID.test(layer.mask.assetId) ||
          !Array.isArray(layer.mask.strokes) ||
          layer.mask.strokes.length > 5000
        ) {
          throw new ImageProjectValidationError("Invalid mask reference");
        }
        assetIds.add(layer.mask.assetId);
      }
    } else if (layer.kind === "text") {
      if (
        typeof layer.text !== "string" ||
        layer.text.length > 10000 ||
        typeof layer.color !== "string" ||
        !/^#[0-9a-fA-F]{6}$/.test(layer.color) ||
        typeof layer.fontFamily !== "string" ||
        layer.fontFamily.length > 200
      ) {
        throw new ImageProjectValidationError("Invalid text layer");
      }
    } else {
      throw new ImageProjectValidationError("Unknown layer kind");
    }
    try {
      checked =
        layer.kind === "image"
          ? applyImageOperation(checked, { type: "addImage", layer })
          : applyImageOperation(checked, { type: "addText", layer });
    } catch (error) {
      throw new ImageProjectValidationError(
        `Invalid ImageDocument layer: ${(error as Error).message}`,
      );
    }
  }
  return { document, json, assetIds: [...assetIds] };
}

function mapRow(row: ProjectRow): SavedImageProject {
  return {
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    title: row.title,
    version: row.current_version,
    document: row.document,
  };
}

/** Internal-only until authenticated membership and workspace role resolve TenantScope. */
export class ImageProjectStore {
  constructor(private readonly db: pg.Pool) {}

  async list(
    scope: TenantScope,
  ): Promise<Array<Omit<SavedImageProject, "document">>> {
    requireScope(scope);
    const result = await this.db.query<{
      id: string;
      organization_id: string;
      workspace_id: string;
      title: string;
      current_version: number;
    }>(
      `SELECT id, organization_id, workspace_id, title, current_version
       FROM image_projects WHERE organization_id = $1 AND workspace_id = $2
       ORDER BY updated_at DESC, id DESC LIMIT 100`,
      [scope.organizationId, scope.workspaceId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      workspaceId: row.workspace_id,
      title: row.title,
      version: row.current_version,
    }));
  }

  async get(
    scope: TenantScope,
    projectId: string,
  ): Promise<SavedImageProject | null> {
    requireScope(scope);
    if (!UUID.test(projectId)) return null;
    const result = await this.db.query<ProjectRow>(
      `SELECT p.id, p.organization_id, p.workspace_id, p.title, p.current_version, v.document
       FROM image_projects p JOIN image_project_versions v
         ON v.organization_id = p.organization_id AND v.workspace_id = p.workspace_id
         AND v.project_id = p.id AND v.version = p.current_version
       WHERE p.organization_id = $1 AND p.workspace_id = $2 AND p.id = $3`,
      [scope.organizationId, scope.workspaceId, projectId],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async save(
    scope: TenantScope,
    title: string,
    value: unknown,
    expectedVersion: number,
    requestKey: string,
  ): Promise<SavedImageProject> {
    requireScope(scope);
    const { document, json, assetIds } = validateImageDocumentForStorage(value);
    const cleanTitle = title.trim();
    if (
      !cleanTitle ||
      cleanTitle.length > 200 ||
      !REQUEST_KEY.test(requestKey) ||
      !Number.isInteger(expectedVersion) ||
      expectedVersion < 0
    ) {
      throw new ImageProjectValidationError(
        "Invalid title, request key, or expected version",
      );
    }
    const requestSha256 = createHash("sha256")
      .update(JSON.stringify([cleanTitle, json]))
      .digest("hex");
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const project = await client.query<{
        title: string;
        current_version: number;
      }>(
        `SELECT title, current_version FROM image_projects
         WHERE organization_id = $1 AND workspace_id = $2 AND id = $3 FOR UPDATE`,
        [scope.organizationId, scope.workspaceId, document.id],
      );
      const current = project.rows[0];
      let version: number;
      if (current) {
        const replay = await client.query<{
          version: number;
          request_sha256: string;
        }>(
          `SELECT version, request_sha256 FROM image_project_versions
           WHERE organization_id = $1 AND workspace_id = $2 AND project_id = $3 AND request_key = $4`,
          [scope.organizationId, scope.workspaceId, document.id, requestKey],
        );
        if (replay.rows[0]) {
          if (replay.rows[0].request_sha256 !== requestSha256) {
            throw new ImageProjectConflictError(
              "Request key reused with different content",
            );
          }
          version = replay.rows[0].version;
          const saved = await client.query<ProjectRow>(
            `SELECT p.id, p.organization_id, p.workspace_id, v.title, v.version AS current_version, v.document
             FROM image_project_versions v JOIN image_projects p
               ON p.organization_id = v.organization_id AND p.workspace_id = v.workspace_id AND p.id = v.project_id
             WHERE v.organization_id = $1 AND v.workspace_id = $2 AND v.project_id = $3 AND v.version = $4`,
            [scope.organizationId, scope.workspaceId, document.id, version],
          );
          await client.query("COMMIT");
          return mapRow(saved.rows[0]!);
        }
        if (current.current_version !== expectedVersion) {
          throw new ImageProjectConflictError("Project version has changed");
        }
        version = current.current_version + 1;
      } else {
        if (expectedVersion !== 0)
          throw new ImageProjectConflictError(
            "Project does not exist at expected version",
          );
        version = 1;
        await client.query(
          `INSERT INTO image_projects (id, organization_id, workspace_id, title, current_version)
           VALUES ($1,$2,$3,$4,1)`,
          [document.id, scope.organizationId, scope.workspaceId, cleanTitle],
        );
      }
      if (assetIds.length) {
        const owned = await client.query<{ id: string }>(
          `SELECT id FROM assets WHERE organization_id = $1 AND workspace_id = $2
           AND kind = 'IMAGE' AND id = ANY($3::uuid[])`,
          [scope.organizationId, scope.workspaceId, assetIds],
        );
        if (owned.rowCount !== assetIds.length) {
          throw new ImageProjectAssetError(
            "ImageDocument references assets outside workspace",
          );
        }
      }
      await client.query(
        `INSERT INTO image_project_versions
         (organization_id, workspace_id, project_id, version, title, request_key, request_sha256, document)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [
          scope.organizationId,
          scope.workspaceId,
          document.id,
          version,
          cleanTitle,
          requestKey,
          requestSha256,
          json,
        ],
      );
      for (const assetId of assetIds) {
        await client.query(
          `INSERT INTO image_project_asset_refs (organization_id, workspace_id, project_id, version, asset_id)
           VALUES ($1,$2,$3,$4,$5)`,
          [
            scope.organizationId,
            scope.workspaceId,
            document.id,
            version,
            assetId,
          ],
        );
      }
      if (current) {
        await client.query(
          `UPDATE image_projects SET title = $1, current_version = $2, updated_at = now()
           WHERE organization_id = $3 AND workspace_id = $4 AND id = $5`,
          [
            cleanTitle,
            version,
            scope.organizationId,
            scope.workspaceId,
            document.id,
          ],
        );
      }
      await client.query("COMMIT");
      return {
        id: document.id,
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        title: cleanTitle,
        version,
        document,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") {
        const replay = await client.query<
          ProjectRow & { request_sha256: string }
        >(
          `SELECT p.id, p.organization_id, p.workspace_id, v.title, v.version AS current_version,
                  v.document, v.request_sha256
           FROM image_project_versions v JOIN image_projects p
             ON p.organization_id = v.organization_id AND p.workspace_id = v.workspace_id AND p.id = v.project_id
           WHERE v.organization_id = $1 AND v.workspace_id = $2 AND v.project_id = $3 AND v.request_key = $4`,
          [scope.organizationId, scope.workspaceId, document.id, requestKey],
        );
        if (replay.rows[0]) {
          if (replay.rows[0].request_sha256 !== requestSha256) {
            throw new ImageProjectConflictError(
              "Request key reused with different content",
            );
          }
          return mapRow(replay.rows[0]);
        }
        throw new ImageProjectConflictError(
          "Concurrent save or project identity conflict",
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
