import { S3Client } from "@aws-sdk/client-s3";
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createRemoteJWKSet } from "jose";
import pg from "pg";
import { AssetFoundation } from "../assets/asset-foundation.js";
import {
  AccessContextResolver,
  JwtAuthProvider,
} from "../auth/access-context.js";
import { ImageProjectStore } from "./image-project-store.js";
import { LocalImageImportService } from "./local-image-import.js";
import { PhotoCraftEditJobStore } from "./photocraft-edit-jobs.js";
import { PhotoCraftProjectStore } from "./photocraft-project-store.js";
import { PhotoCraftQualityReviewStore } from "./photocraft-quality-reviews.js";

type ProjectServices = Readonly<{
  db: pg.Pool;
  s3: S3Client;
  access: AccessContextResolver;
  assets: AssetFoundation;
  projects: ImageProjectStore;
  imports: LocalImageImportService;
  photocraftProjects: PhotoCraftProjectStore;
  photocraftJobs: PhotoCraftEditJobStore;
  photocraftReviews: PhotoCraftQualityReviewStore;
}>;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for project HTTP routes`);
  return value;
}

/** No implicit development identity: routes stay unavailable until every dependency is configured. */
@Injectable()
export class ImageProjectHttpService implements OnModuleDestroy {
  private services: ProjectServices | null = null;

  get(): ProjectServices {
    if (this.services) return this.services;
    const issuer = required("AUTH_ISSUER");
    const audience = required("AUTH_AUDIENCE");
    const jwksUrl = required("AUTH_JWKS_URL");
    const url = new URL(jwksUrl);
    const issuerUrl = new URL(issuer);
    const loopbackHttp =
      process.env.AUTH_ALLOW_INSECURE_LOOPBACK === "true" &&
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      process.env.NODE_ENV !== "production";
    if (!loopbackHttp && url.protocol !== "https:") {
      throw new Error("AUTH_JWKS_URL must use HTTPS");
    }
    if (url.username || url.password || url.hash)
      throw new Error("AUTH_JWKS_URL cannot contain credentials or fragment");
    if (
      (issuerUrl.protocol !== "https:" &&
        !(
          loopbackHttp &&
          issuerUrl.protocol === "http:" &&
          issuerUrl.host === url.host
        )) ||
      issuerUrl.username ||
      issuerUrl.password ||
      issuerUrl.hash ||
      issuerUrl.search
    )
      throw new Error(
        "AUTH_ISSUER must be trusted HTTPS or matching development loopback",
      );
    const provider = loopbackHttp
      ? new JwtAuthProvider(
          {
            issuer,
            audience,
            algorithms: ["RS256"],
            maxTokenAgeSeconds: 3600,
          },
          createRemoteJWKSet(url),
        )
      : JwtAuthProvider.remote(
          {
            issuer,
            audience,
            algorithms: ["RS256", "ES256"],
            maxTokenAgeSeconds: 3600,
          },
          jwksUrl,
        );
    const databaseUrl = required("DATABASE_URL");
    const endpoint = required("S3_ENDPOINT");
    const accessKeyId = required("S3_ACCESS_KEY");
    const secretAccessKey = required("S3_SECRET_KEY");
    const bucket = required("S3_BUCKET");
    const db = new pg.Pool({ connectionString: databaseUrl, max: 10 });
    const s3 = new S3Client({
      endpoint,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      maxAttempts: 1,
    });
    const assets = new AssetFoundation(db, s3, bucket);
    const projects = new ImageProjectStore(db);
    this.services = {
      db,
      s3,
      access: new AccessContextResolver(db, provider),
      assets,
      projects,
      imports: new LocalImageImportService(db, assets, projects),
      photocraftProjects: new PhotoCraftProjectStore(db, assets),
      photocraftJobs: new PhotoCraftEditJobStore(db),
      photocraftReviews: new PhotoCraftQualityReviewStore(db),
    };
    return this.services;
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.services) return;
    await this.services.db.end();
    this.services.s3.destroy();
  }
}
