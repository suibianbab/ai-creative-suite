CREATE TABLE organizations (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 1 AND 80),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);

CREATE TABLE assets (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('IMAGE', 'VIDEO', 'AUDIO', 'SVG', 'FONT', 'MODEL_3D', 'DOCUMENT')),
  source TEXT NOT NULL CHECK (source IN ('USER_UPLOAD', 'AI_GENERATED', 'AI_EDITED', 'WEBSITE_IMPORTED', 'BRAND_LIBRARY', 'EXAMPLE_LIBRARY', 'STOCK', 'BLENDER_RENDER')),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  request_fingerprint CHAR(64) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  original_blob_id UUID NOT NULL,
  original_role TEXT NOT NULL DEFAULT 'ORIGINAL' CHECK (original_role = 'ORIGINAL'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, workspace_id, idempotency_key),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE asset_blobs (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  asset_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  role TEXT NOT NULL CHECK (role IN ('ORIGINAL', 'DERIVATIVE')),
  parent_blob_id UUID,
  storage_key TEXT NOT NULL UNIQUE,
  sha256 CHAR(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  content_type TEXT NOT NULL CHECK (length(content_type) BETWEEN 3 AND 200),
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((role = 'ORIGINAL' AND version = 1 AND parent_blob_id IS NULL) OR (role = 'DERIVATIVE' AND version > 1 AND parent_blob_id IS NOT NULL)),
  CHECK (storage_key = ('org/' || organization_id::text || '/' || asset_id::text || '/' || id::text)),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, asset_id, id),
  UNIQUE (organization_id, asset_id, id, role),
  UNIQUE (organization_id, asset_id, version),
  FOREIGN KEY (organization_id, asset_id) REFERENCES assets(organization_id, id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (organization_id, asset_id, parent_blob_id) REFERENCES asset_blobs(organization_id, asset_id, id) DEFERRABLE INITIALLY DEFERRED
);

CREATE UNIQUE INDEX asset_one_original ON asset_blobs (organization_id, asset_id) WHERE role = 'ORIGINAL';

ALTER TABLE assets ADD CONSTRAINT assets_original_blob_fk
  FOREIGN KEY (organization_id, id, original_blob_id, original_role)
  REFERENCES asset_blobs (organization_id, asset_id, id, role)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX assets_workspace_created_idx ON assets (organization_id, workspace_id, created_at DESC);

CREATE FUNCTION reject_asset_original_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.original_blob_id IS DISTINCT FROM OLD.original_blob_id
    OR NEW.original_role IS DISTINCT FROM OLD.original_role THEN
    RAISE EXCEPTION 'Asset ownership and original blob are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER assets_immutable_original BEFORE UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION reject_asset_original_change();

CREATE FUNCTION reject_asset_blob_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Asset blobs are immutable' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER asset_blobs_no_update BEFORE UPDATE OR DELETE ON asset_blobs
  FOR EACH ROW EXECUTE FUNCTION reject_asset_blob_mutation();
