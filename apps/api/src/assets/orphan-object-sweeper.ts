import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type S3Client,
} from "@aws-sdk/client-s3";
import type pg from "pg";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_AGE_DAYS = 7;
const MAX_LISTED_OBJECTS = 10_000;

export type OrphanSweepReport = Readonly<{
  organizationId: string;
  dryRun: boolean;
  scanned: number;
  referenced: number;
  tooRecent: number;
  invalid: number;
  candidates: string[];
  deleted: string[];
}>;

export type OrphanSweepOptions = Readonly<{
  execute?: boolean;
  now?: Date;
  minimumAgeDays?: number;
}>;

/** Never scans outside one explicit organization or deletes a database-backed blob. */
export class OrphanObjectSweeper {
  constructor(
    private readonly db: pg.Pool,
    private readonly objectStore: S3Client,
    private readonly bucket: string,
  ) {
    if (!bucket) throw new Error("S3 bucket is required");
  }

  private async isReferenced(organizationId: string, key: string) {
    const result = await this.db.query(
      "SELECT 1 FROM asset_blobs WHERE organization_id = $1 AND storage_key = $2",
      [organizationId, key],
    );
    return result.rowCount === 1;
  }

  async sweep(
    organizationId: string,
    options: OrphanSweepOptions = {},
  ): Promise<OrphanSweepReport> {
    const now = options.now ?? new Date();
    const ageDays = options.minimumAgeDays ?? MIN_AGE_DAYS;
    if (
      !UUID.test(organizationId) ||
      !Number.isInteger(ageDays) ||
      ageDays < MIN_AGE_DAYS ||
      !Number.isFinite(now.getTime())
    ) {
      throw new Error(
        "A valid organization and at least seven days are required",
      );
    }
    const exists = await this.db.query(
      "SELECT 1 FROM organizations WHERE id = $1",
      [organizationId],
    );
    if (exists.rowCount !== 1) throw new Error("Organization not found");

    const prefix = `org/${organizationId}/`;
    const exactKey = new RegExp(
      `^org/${organizationId}/([0-9a-f-]{36})/([0-9a-f-]{36})$`,
      "i",
    );
    const cutoff = now.getTime() - ageDays * DAY_MS;
    const objects: { key: string; lastModified: Date; etag: string }[] = [];
    let token: string | undefined;
    do {
      const page = await this.objectStore.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const item of page.Contents ?? []) {
        objects.push({
          key: item.Key ?? "",
          lastModified: item.LastModified ?? new Date(Number.NaN),
          etag: item.ETag ?? "",
        });
      }
      if (objects.length > MAX_LISTED_OBJECTS)
        throw new Error(
          "Too many objects for one sweep; use a smaller organization batch",
        );
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
      if (page.IsTruncated && !token)
        throw new Error("Object listing ended without a continuation token");
    } while (token);

    const report = {
      organizationId,
      dryRun: !options.execute,
      scanned: objects.length,
      referenced: 0,
      tooRecent: 0,
      invalid: 0,
      candidates: [] as string[],
      deleted: [] as string[],
    };
    for (const object of objects) {
      const match = exactKey.exec(object.key);
      if (
        !match ||
        !UUID.test(match[1]!) ||
        !UUID.test(match[2]!) ||
        !object.etag ||
        !Number.isFinite(object.lastModified.getTime())
      ) {
        report.invalid++;
        continue;
      }
      if (object.lastModified.getTime() > cutoff) {
        report.tooRecent++;
        continue;
      }
      if (await this.isReferenced(organizationId, object.key)) {
        report.referenced++;
        continue;
      }
      report.candidates.push(object.key);
      if (!options.execute) continue;

      // Recheck both systems before a conditional delete. A failed precondition aborts.
      const head = await this.objectStore.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: object.key }),
      );
      if (
        head.ETag !== object.etag ||
        !head.LastModified ||
        head.LastModified.getTime() > cutoff ||
        (await this.isReferenced(organizationId, object.key))
      ) {
        continue;
      }
      await this.objectStore.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: object.key,
          IfMatch: object.etag,
        }),
      );
      report.deleted.push(object.key);
    }
    return report;
  }
}
