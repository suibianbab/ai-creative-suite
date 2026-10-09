import { createHash, randomUUID } from "node:crypto";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type pg from "pg";

export type TenantScope = Readonly<{
  organizationId: string;
  workspaceId: string;
}>;
export type AssetKind =
  | "IMAGE"
  | "VIDEO"
  | "AUDIO"
  | "SVG"
  | "FONT"
  | "MODEL_3D"
  | "DOCUMENT";
export type AssetSource =
  | "USER_UPLOAD"
  | "AI_GENERATED"
  | "AI_EDITED"
  | "WEBSITE_IMPORTED"
  | "BRAND_LIBRARY"
  | "EXAMPLE_LIBRARY"
  | "STOCK"
  | "BLENDER_RENDER";

export type CreateOriginalInput = Readonly<{
  idempotencyKey: string;
  displayName: string;
  kind: AssetKind;
  source: AssetSource;
  contentType: string;
  bytes: Buffer;
}>;

export type OriginalAsset = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  kind: AssetKind;
  source: AssetSource;
  displayName: string;
  originalBlobId: string;
  storageKey: string;
  sha256: string;
  byteSize: number;
  contentType: string;
  requestFingerprint: string;
}>;

type AssetRow = {
  id: string;
  organization_id: string;
  workspace_id: string;
  kind: AssetKind;
  source: AssetSource;
  display_name: string;
  original_blob_id: string;
  storage_key: string;
  sha256: string;
  byte_size: string;
  content_type: string;
  request_fingerprint: string;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,128}$/;
const MIME = /^[a-z][a-z0-9.+-]*\/[a-z0-9.+-]+$/i;
const MAX_ORIGINAL_BYTES = 25 * 1024 * 1024;
const ASSET_KINDS = new Set<AssetKind>([
  "IMAGE",
  "VIDEO",
  "AUDIO",
  "SVG",
  "FONT",
  "MODEL_3D",
  "DOCUMENT",
]);
const ASSET_SOURCES = new Set<AssetSource>([
  "USER_UPLOAD",
  "AI_GENERATED",
  "AI_EDITED",
  "WEBSITE_IMPORTED",
  "BRAND_LIBRARY",
  "EXAMPLE_LIBRARY",
  "STOCK",
  "BLENDER_RENDER",
]);

export class AssetConflictError extends Error {}
export class AssetScopeError extends Error {}
export class AssetIntegrityError extends Error {}

function requireScope(scope: TenantScope): void {
  if (!UUID.test(scope.organizationId) || !UUID.test(scope.workspaceId)) {
    throw new AssetScopeError(
      "Tenant scope must contain valid organization and workspace UUIDs",
    );
  }
}

function mapRow(row: AssetRow): OriginalAsset {
  return {
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    kind: row.kind,
    source: row.source,
    displayName: row.display_name,
    originalBlobId: row.original_blob_id,
    storageKey: row.storage_key,
    sha256: row.sha256,
    byteSize: Number(row.byte_size),
    contentType: row.content_type,
    requestFingerprint: row.request_fingerprint,
  };
}

function normalized(input: CreateOriginalInput) {
  if (!ASSET_KINDS.has(input.kind) || !ASSET_SOURCES.has(input.source)) {
    throw new AssetConflictError("Invalid asset kind or source");
  }
  if (!IDEMPOTENCY_KEY.test(input.idempotencyKey))
    throw new AssetConflictError("Invalid idempotency key");
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 200 || displayName.includes("\0")) {
    throw new AssetConflictError("Invalid display name");
  }
  if (!MIME.test(input.contentType) || input.contentType.length > 200) {
    throw new AssetConflictError("Invalid content type");
  }
  if (
    !Buffer.isBuffer(input.bytes) ||
    input.bytes.length < 1 ||
    input.bytes.length > MAX_ORIGINAL_BYTES
  ) {
    throw new AssetConflictError(
      `Original bytes must be 1-${MAX_ORIGINAL_BYTES}`,
    );
  }
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        displayName,
        kind: input.kind,
        source: input.source,
        contentType: input.contentType,
        sha256,
      }),
    )
    .digest("hex");
  return { displayName, sha256, fingerprint };
}

const SELECT_ORIGINAL = `
  SELECT a.id, a.organization_id, a.workspace_id, a.kind, a.source, a.display_name,
         a.original_blob_id, a.request_fingerprint, b.storage_key, b.sha256,
         b.byte_size::text, b.content_type
  FROM assets a
  JOIN asset_blobs b ON b.organization_id = a.organization_id
    AND b.asset_id = a.id AND b.id = a.original_blob_id AND b.role = 'ORIGINAL'
`;

/** Internal-only until an authenticated caller can mint TenantScope. No HTTP route is registered. */
export class AssetFoundation {
  constructor(
    private readonly db: pg.Pool,
    private readonly objectStore: S3Client,
    private readonly bucket: string,
  ) {
    if (!bucket) throw new Error("S3 bucket is required");
  }

  private async requireWorkspace(scope: TenantScope): Promise<void> {
    const result = await this.db.query(
      "SELECT 1 FROM workspaces WHERE organization_id = $1 AND id = $2",
      [scope.organizationId, scope.workspaceId],
    );
    if (result.rowCount !== 1)
      throw new AssetScopeError("Workspace is outside tenant scope");
  }

  private async findByKey(
    scope: TenantScope,
    key: string,
  ): Promise<OriginalAsset | null> {
    const result = await this.db.query<AssetRow>(
      `${SELECT_ORIGINAL} WHERE a.organization_id = $1 AND a.workspace_id = $2 AND a.idempotency_key = $3`,
      [scope.organizationId, scope.workspaceId, key],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async get(
    scope: TenantScope,
    assetId: string,
  ): Promise<OriginalAsset | null> {
    requireScope(scope);
    if (!UUID.test(assetId)) return null;
    const result = await this.db.query<AssetRow>(
      `${SELECT_ORIGINAL} WHERE a.organization_id = $1 AND a.workspace_id = $2 AND a.id = $3`,
      [scope.organizationId, scope.workspaceId, assetId],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async createOriginal(
    scope: TenantScope,
    input: CreateOriginalInput,
  ): Promise<OriginalAsset> {
    requireScope(scope);
    const values = normalized(input);
    await this.requireWorkspace(scope);
    const existing = await this.findByKey(scope, input.idempotencyKey);
    if (existing) {
      if (existing.requestFingerprint !== values.fingerprint)
        throw new AssetConflictError(
          "Idempotency key reused with different input",
        );
      return existing;
    }

    const assetId = randomUUID();
    const blobId = randomUUID();
    const storageKey = `org/${scope.organizationId}/${assetId}/${blobId}`;
    await this.objectStore.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        Body: input.bytes,
        ContentLength: input.bytes.length,
        ContentType: input.contentType,
        IfNoneMatch: "*",
      }),
    );

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO assets (id, organization_id, workspace_id, kind, source, display_name,
          idempotency_key, request_fingerprint, original_blob_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          assetId,
          scope.organizationId,
          scope.workspaceId,
          input.kind,
          input.source,
          values.displayName,
          input.idempotencyKey,
          values.fingerprint,
          blobId,
        ],
      );
      await client.query(
        `INSERT INTO asset_blobs (id, organization_id, asset_id, version, role, storage_key,
          sha256, byte_size, content_type, provenance)
         VALUES ($1,$2,$3,1,'ORIGINAL',$4,$5,$6,$7,$8::jsonb)`,
        [
          blobId,
          scope.organizationId,
          assetId,
          storageKey,
          values.sha256,
          input.bytes.length,
          input.contentType,
          JSON.stringify({ source: input.source }),
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") {
        const winnerResult = await client.query<AssetRow>(
          `${SELECT_ORIGINAL} WHERE a.organization_id = $1 AND a.workspace_id = $2 AND a.idempotency_key = $3`,
          [scope.organizationId, scope.workspaceId, input.idempotencyKey],
        );
        const winner = winnerResult.rows[0]
          ? mapRow(winnerResult.rows[0])
          : null;
        if (winner) {
          if (winner.requestFingerprint !== values.fingerprint)
            throw new AssetConflictError(
              "Idempotency key reused with different input",
            );
          return winner;
        }
      }
      throw error;
    } finally {
      client.release();
    }
    const created = await this.get(scope, assetId);
    if (!created)
      throw new AssetIntegrityError("Committed asset could not be reloaded");
    return created;
  }

  async readOriginal(
    scope: TenantScope,
    assetId: string,
  ): Promise<{ asset: OriginalAsset; bytes: Buffer } | null> {
    const asset = await this.get(scope, assetId);
    if (!asset) return null;
    const response = await this.objectStore.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: asset.storageKey }),
    );
    if (!response.Body)
      throw new AssetIntegrityError("Original object is missing");
    const bytes = Buffer.from(await response.Body.transformToByteArray());
    if (
      bytes.length !== asset.byteSize ||
      createHash("sha256").update(bytes).digest("hex") !== asset.sha256
    ) {
      throw new AssetIntegrityError(
        "Original object does not match immutable blob record",
      );
    }
    return { asset, bytes };
  }
}
