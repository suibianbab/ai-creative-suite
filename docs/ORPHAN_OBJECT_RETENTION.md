# Orphan object retention and audit

`AssetFoundation.createOriginal` writes a new immutable S3 key before committing its blob record. A process crash or failed database transaction can leave an S3 object with no `asset_blobs` row. The same applies during retry-safe local project import. These objects consume storage but are not user assets.

`OrphanObjectSweeper` scans **one explicitly named organization** under `org/<organization-uuid>/`. The audit command is dry-run only:

```bash
cd apps/api
pnpm orphan:audit <organization-uuid>
```

The report lists scanned objects, candidates, database-backed objects, recent objects, malformed keys, and deletions (always empty for this command). It requires the same local `.env` and SSH tunnel as the API development services. No browser or public HTTP route is registered.

Deletion rules in the internal service:

1. The organization must exist. The object key must exactly match `org/<organization>/<asset-uuid>/<blob-uuid>`; any other key is ignored.
2. Objects modified within the last **seven days** are retained. The minimum cannot be lowered by the caller.
3. Any matching `asset_blobs` row retains the object, including original and derivative blobs. A candidate is checked again after `HeadObject` and immediately before deletion.
4. The S3 `DeleteObject` request carries the previously observed ETag in `If-Match`; changed objects are not deleted. Listing is completed before any deletion, with a 10,000-object cap per run.
5. The CLI deliberately cannot request deletion. The internal `execute` path is for isolated testing until an independent security/operations review approves a scheduled job and operational controls.

The seven-day grace period is a conservative development retention choice, not a finalized customer data retention or deletion policy. This sweep never removes cataloged assets, project versions, or database rows. It relies on the current invariant that any committed blob has an `asset_blobs` record; future storage paths must preserve or extend that invariant.

The integration test uses a random PostgreSQL schema and random organization prefix in the development RustFS bucket. It creates one cataloged original, one orphan, and one malformed object; dry-run leaves all three, and the internal conditional delete removes only the orphan. Run from `apps/api` with the VM tunnel active:

```bash
node --env-file=../../.env --import tsx src/assets/orphan-object-sweeper.integration.ts
```
