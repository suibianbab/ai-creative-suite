import type { DependencyStatus, ReadinessResponse } from "@acs/shared";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { Injectable } from "@nestjs/common";
import { Redis } from "ioredis";
import pg from "pg";

const CHECK_TIMEOUT_MS = 2500;

async function checkPostgres(): Promise<DependencyStatus> {
  const url = process.env.DATABASE_URL;
  if (!url) return "unconfigured";

  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: CHECK_TIMEOUT_MS,
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return "ok";
  } catch {
    return "unavailable";
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function checkRedis(): Promise<DependencyStatus> {
  const url = process.env.REDIS_URL;
  if (!url) return "unconfigured";

  const client = new Redis(url, {
    lazyConnect: true,
    connectTimeout: CHECK_TIMEOUT_MS,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  try {
    await client.connect();
    return (await client.ping()) === "PONG" ? "ok" : "unavailable";
  } catch {
    return "unavailable";
  } finally {
    client.disconnect();
  }
}

async function checkObjectStore(): Promise<DependencyStatus> {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY } = process.env;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
    return "unconfigured";
  }

  const client = new S3Client({
    endpoint: S3_ENDPOINT,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
    maxAttempts: 1,
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: S3_BUCKET }), {
      abortSignal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    return "ok";
  } catch {
    return "unavailable";
  } finally {
    client.destroy();
  }
}

@Injectable()
export class ReadinessService {
  async check(): Promise<ReadinessResponse> {
    const [postgres, redis, objectstore] = await Promise.all([
      checkPostgres(),
      checkRedis(),
      checkObjectStore(),
    ]);
    const checks = { postgres, redis, objectstore };
    return {
      service: "api",
      status: Object.values(checks).every((status) => status === "ok")
        ? "ready"
        : "not_ready",
      checks,
    };
  }
}
