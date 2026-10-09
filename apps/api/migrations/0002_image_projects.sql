ALTER TABLE assets ADD CONSTRAINT assets_workspace_identity UNIQUE (organization_id, workspace_id, id);

CREATE TABLE image_projects (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  current_version INTEGER NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, workspace_id, id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE image_project_versions (
  organization_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  project_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  request_key TEXT NOT NULL CHECK (length(request_key) BETWEEN 1 AND 128),
  request_sha256 CHAR(64) NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  document JSONB NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, workspace_id, project_id, version),
  UNIQUE (organization_id, workspace_id, project_id, request_key),
  FOREIGN KEY (organization_id, workspace_id, project_id)
    REFERENCES image_projects(organization_id, workspace_id, id) ON DELETE RESTRICT
);

CREATE TABLE image_project_asset_refs (
  organization_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  project_id UUID NOT NULL,
  version INTEGER NOT NULL,
  asset_id UUID NOT NULL,
  PRIMARY KEY (organization_id, workspace_id, project_id, version, asset_id),
  FOREIGN KEY (organization_id, workspace_id, project_id, version)
    REFERENCES image_project_versions(organization_id, workspace_id, project_id, version) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, workspace_id, asset_id)
    REFERENCES assets(organization_id, workspace_id, id) ON DELETE RESTRICT
);

ALTER TABLE image_projects ADD CONSTRAINT image_project_head_fk
  FOREIGN KEY (organization_id, workspace_id, id, current_version)
  REFERENCES image_project_versions(organization_id, workspace_id, project_id, version)
  DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION reject_image_project_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Image project versions and asset references are immutable' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER image_project_versions_no_mutation BEFORE UPDATE OR DELETE ON image_project_versions
  FOR EACH ROW EXECUTE FUNCTION reject_image_project_version_mutation();

CREATE TRIGGER image_project_asset_refs_no_mutation BEFORE UPDATE OR DELETE ON image_project_asset_refs
  FOR EACH ROW EXECUTE FUNCTION reject_image_project_version_mutation();

CREATE FUNCTION enforce_image_project_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.current_version <= OLD.current_version
    OR NEW.current_version <> OLD.current_version + 1 THEN
    RAISE EXCEPTION 'Invalid image project head transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER image_project_head_transition BEFORE UPDATE ON image_projects
  FOR EACH ROW EXECUTE FUNCTION enforce_image_project_head();
