ALTER TABLE photocraft_edit_jobs DROP CONSTRAINT photocraft_edit_jobs_operation_check;
ALTER TABLE photocraft_edit_jobs ADD CONSTRAINT photocraft_edit_jobs_operation_check
CHECK (operation IN (
  'rotate-cw', 'rotate-ccw', 'rotate-180', 'flip-horizontal', 'flip-vertical',
  'duplicate-layer', 'hide-layer', 'show-layer',
  'adjust-brightness', 'adjust-contrast', 'adjust-saturation',
  'adjust-exposure', 'adjust-vibrance', 'adjust-shadows', 'adjust-highlights', 'levels',
  'masked-adjust-brightness', 'masked-adjust-contrast', 'masked-adjust-saturation',
  'masked-adjust-exposure', 'masked-adjust-vibrance', 'masked-adjust-shadows',
  'masked-adjust-highlights', 'generate-local'
));

CREATE TABLE workspace_credit_accounts (
  organization_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  available INTEGER NOT NULL DEFAULT 0 CHECK (available >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, workspace_id),
  FOREIGN KEY (organization_id, workspace_id)
    REFERENCES workspaces(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE workspace_credit_ledger (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  job_id UUID,
  kind TEXT NOT NULL CHECK (kind IN ('grant', 'reserve', 'commit', 'refund')),
  amount INTEGER NOT NULL,
  reference TEXT NOT NULL CHECK (length(reference) BETWEEN 1 AND 128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, workspace_id)
    REFERENCES workspace_credit_accounts(organization_id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (job_id) REFERENCES photocraft_edit_jobs(id) ON DELETE RESTRICT,
  CHECK ((kind='grant' AND amount>0 AND job_id IS NULL) OR
         (kind='reserve' AND amount<0 AND job_id IS NOT NULL) OR
         (kind='refund' AND amount>0 AND job_id IS NOT NULL) OR
         (kind='commit' AND amount=0 AND job_id IS NOT NULL))
);
CREATE UNIQUE INDEX workspace_credit_ledger_job_kind_unique
  ON workspace_credit_ledger(job_id, kind) WHERE job_id IS NOT NULL;
CREATE UNIQUE INDEX workspace_credit_ledger_grant_reference_unique
  ON workspace_credit_ledger(organization_id, workspace_id, reference)
  WHERE kind='grant';
CREATE INDEX workspace_credit_ledger_workspace_idx
  ON workspace_credit_ledger(organization_id, workspace_id, created_at DESC);
