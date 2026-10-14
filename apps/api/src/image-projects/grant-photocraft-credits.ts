import pg from "pg";
import { PhotoCraftEditJobStore } from "./photocraft-edit-jobs.js";

/** Operator-only funding path. No public API can grant credits. */
async function main() {
  const [workspaceId, amountText, reference] = process.argv.slice(2);
  const amount = Number(amountText);
  if (
    !workspaceId ||
    !/^[0-9a-f-]{36}$/i.test(workspaceId) ||
    !Number.isInteger(amount) ||
    amount < 1 ||
    amount > 100000 ||
    !reference ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(reference)
  )
    throw new Error(
      "Usage: grant-photocraft-credits <workspace-uuid> <amount> <unique-reference>",
    );
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });
  try {
    const found = await db.query<{ organization_id: string }>(
      "SELECT organization_id FROM workspaces WHERE id=$1",
      [workspaceId],
    );
    if (!found.rows[0]) throw new Error("Workspace not found");
    const available = await new PhotoCraftEditJobStore(db).grantCredits(
      { organizationId: found.rows[0].organization_id, workspaceId },
      amount,
      reference,
    );
    process.stdout.write(`Workspace credit balance: ${available}\n`);
  } finally {
    await db.end();
  }
}
void main();
