CREATE TABLE photocraft_projects (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  current_version INTEGER NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  original_asset_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, workspace_id, id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, workspace_id, original_asset_id)
    REFERENCES assets(organization_id, workspace_id, id) ON DELETE RESTRICT
);

CREATE TABLE photocraft_project_versions (
  organization_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  project_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  source_asset_id UUID NOT NULL,
  engine_version TEXT NOT NULL CHECK (length(engine_version) BETWEEN 1 AND 40),
  request_key TEXT NOT NULL CHECK (length(request_key) BETWEEN 1 AND 128),
  request_sha256 CHAR(64) NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, workspace_id, project_id, version),
  UNIQUE (organization_id, workspace_id, project_id, request_key),
  FOREIGN KEY (organization_id, workspace_id, project_id)
    REFERENCES photocraft_projects(organization_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, workspace_id, source_asset_id)
    REFERENCES assets(organization_id, workspace_id, id) ON DELETE RESTRICT
);

ALTER TABLE photocraft_projects ADD CONSTRAINT photocraft_project_head_fk
  FOREIGN KEY (organization_id, workspace_id, id, current_version)
  REFERENCES photocraft_project_versions(organization_id, workspace_id, project_id, version)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TRIGGER photocraft_versions_no_mutation BEFORE UPDATE OR DELETE ON photocraft_project_versions
  FOR EACH ROW EXECUTE FUNCTION reject_image_project_version_mutation();

CREATE FUNCTION enforce_photocraft_project_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.original_asset_id IS DISTINCT FROM OLD.original_asset_id
    OR NEW.current_version <> OLD.current_version + 1 THEN
    RAISE EXCEPTION 'Invalid PhotoCraft project head transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER photocraft_head_transition BEFORE UPDATE ON photocraft_projects
  FOR EACH ROW EXECUTE FUNCTION enforce_photocraft_project_head();

CREATE INDEX photocraft_projects_workspace_updated_idx
  ON photocraft_projects (organization_id, workspace_id, updated_at DESC);
