import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import type { TenantScope } from "../assets/asset-foundation.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_KEY = /^[A-Za-z0-9._:-]{1,128}$/;
export type QualityGrade = "ready" | "minor" | "manual" | "unsuitable";
export type PhotoCraftCloudQualityReview = Readonly<{
  id: string;
  projectId: string;
  sourceVersion: number;
  reviewerUserId: string;
  grade: QualityGrade;
  note: string;
  checks: boolean[];
  criteria: string[];
  createdAt: string;
}>;
export class PhotoCraftQualityValidationError extends Error {}
export class PhotoCraftQualityConflictError extends Error {}

type Row = {
  id: string;
  project_id: string;
  source_version: number;
  reviewer_user_id: string;
  grade: QualityGrade;
  note: string;
  checks: boolean[];
  criteria: string[];
  created_at: Date;
  request_sha256: string;
};
function map(row: Row): PhotoCraftCloudQualityReview {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceVersion: row.source_version,
    reviewerUserId: row.reviewer_user_id,
    grade: row.grade,
    note: row.note,
    checks: row.checks,
    criteria: row.criteria,
    createdAt: row.created_at.toISOString(),
  };
}

export class PhotoCraftQualityReviewStore {
  constructor(private readonly db: pg.Pool) {}

  async list(
    scope: TenantScope,
    projectId: string,
    version: number,
  ): Promise<PhotoCraftCloudQualityReview[]> {
    if (!UUID.test(projectId) || !Number.isInteger(version) || version < 1)
      throw new PhotoCraftQualityValidationError("Invalid project version");
    const rows = await this.db.query<Row>(
      `SELECT r.* FROM photocraft_quality_reviews r WHERE organization_id=$1 AND workspace_id=$2
       AND project_id=$3 AND source_version=$4 ORDER BY created_at DESC, id DESC LIMIT 100`,
      [scope.organizationId, scope.workspaceId, projectId, version],
    );
    return rows.rows.map(map);
  }

  async append(
    scope: TenantScope,
    userId: string,
    input: {
      projectId: string;
      sourceVersion: number;
      requestKey: string;
      grade: QualityGrade;
      note: string;
      checks: boolean[];
      criteria: string[];
    },
  ): Promise<PhotoCraftCloudQualityReview> {
    if (
      !UUID.test(input.projectId) ||
      !UUID.test(userId) ||
      !Number.isInteger(input.sourceVersion) ||
      input.sourceVersion < 1 ||
      !REQUEST_KEY.test(input.requestKey) ||
      !["ready", "minor", "manual", "unsuitable"].includes(input.grade) ||
      typeof input.note !== "string" ||
      input.note.length > 2000 ||
      !Array.isArray(input.checks) ||
      input.checks.length !== 4 ||
      input.checks.some((value) => typeof value !== "boolean") ||
      !Array.isArray(input.criteria) ||
      input.criteria.length !== 4 ||
      input.criteria.some(
        (value) =>
          typeof value !== "string" || value.length < 1 || value.length > 200,
      ) ||
      (input.grade === "ready"
        ? !input.checks.every(Boolean)
        : !input.note.trim())
    )
      throw new PhotoCraftQualityValidationError("Invalid quality review");
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([input.grade, input.note, input.checks, input.criteria]),
      )
      .digest("hex");
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const previous = await client.query<Row>(
        `SELECT * FROM photocraft_quality_reviews WHERE organization_id=$1 AND workspace_id=$2
         AND project_id=$3 AND source_version=$4 AND request_key=$5`,
        [
          scope.organizationId,
          scope.workspaceId,
          input.projectId,
          input.sourceVersion,
          input.requestKey,
        ],
      );
      if (previous.rows[0]) {
        if (previous.rows[0].request_sha256 !== fingerprint)
          throw new PhotoCraftQualityConflictError(
            "Review key reused with different content",
          );
        await client.query("COMMIT");
        return map(previous.rows[0]);
      }
      const version = await client.query(
        `SELECT 1 FROM photocraft_project_versions WHERE organization_id=$1 AND workspace_id=$2
         AND project_id=$3 AND version=$4`,
        [
          scope.organizationId,
          scope.workspaceId,
          input.projectId,
          input.sourceVersion,
        ],
      );
      if (!version.rowCount)
        throw new PhotoCraftQualityConflictError(
          "Project version is unavailable",
        );
      const added = await client.query<Row>(
        `INSERT INTO photocraft_quality_reviews
         (id,organization_id,workspace_id,project_id,source_version,reviewer_user_id,
          request_key,request_sha256,grade,note,checks,criteria)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [
          randomUUID(),
          scope.organizationId,
          scope.workspaceId,
          input.projectId,
          input.sourceVersion,
          userId,
          input.requestKey,
          fingerprint,
          input.grade,
          input.note,
          JSON.stringify(input.checks),
          JSON.stringify(input.criteria),
        ],
      );
      await client.query("COMMIT");
      return map(added.rows[0]!);
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505")
        throw new PhotoCraftQualityConflictError(
          "Concurrent review submission; retry with same key",
        );
      throw error;
    } finally {
      client.release();
    }
  }
}
