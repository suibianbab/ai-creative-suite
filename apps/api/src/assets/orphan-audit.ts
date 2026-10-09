import { S3Client } from "@aws-sdk/client-s3";
import pg from "pg";
import { OrphanObjectSweeper } from "./orphan-object-sweeper.js";

const organizationId = process.argv[2];
const databaseUrl = process.env.DATABASE_URL;
const endpoint = process.env.S3_ENDPOINT;
const bucket = process.env.S3_BUCKET;
const accessKeyId = process.env.S3_ACCESS_KEY;
const secretAccessKey = process.env.S3_SECRET_KEY;
if (
  !organizationId ||
  process.argv.length !== 3 ||
  !databaseUrl ||
  !endpoint ||
  !bucket ||
  !accessKeyId ||
  !secretAccessKey
) {
  throw new Error(
    "Usage: orphan:audit <organization-uuid> with DATABASE_URL and S3_* configured",
  );
}

const db = new pg.Pool({ connectionString: databaseUrl, max: 2 });
const s3 = new S3Client({
  endpoint,
  region: "us-east-1",
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});
try {
  const report = await new OrphanObjectSweeper(db, s3, bucket).sweep(
    organizationId,
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await db.end();
  s3.destroy();
}
