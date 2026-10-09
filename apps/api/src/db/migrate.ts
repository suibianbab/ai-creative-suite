import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required for migrations");

const client = new pg.Client({
  connectionString: url,
  connectionTimeoutMillis: 5000,
});
const migrations = resolve(process.cwd(), "migrations");

try {
  await client.connect();
  const files = (await readdir(migrations))
    .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
    .sort();
  if (files.length === 0) throw new Error(`No migrations in ${migrations}`);
  for (const file of files) {
    const sql = await readFile(resolve(migrations, file), "utf8");
    const sha256 = createHash("sha256").update(sql).digest("hex");
    await client.query("BEGIN");
    try {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('acs_schema_migrations'))",
      );
      await client.query(`
        CREATE TABLE IF NOT EXISTS acs_schema_migrations (
          filename TEXT PRIMARY KEY,
          sha256 CHAR(64) NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      const existing = await client.query<{ sha256: string }>(
        "SELECT sha256 FROM acs_schema_migrations WHERE filename = $1",
        [file],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].sha256 !== sha256)
          throw new Error(`Migration changed after application: ${file}`);
        await client.query("COMMIT");
        console.log(`skip ${file}`);
        continue;
      }
      await client.query(sql);
      await client.query(
        "INSERT INTO acs_schema_migrations (filename, sha256) VALUES ($1, $2)",
        [file, sha256],
      );
      await client.query("COMMIT");
      console.log(`applied ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.end();
}
