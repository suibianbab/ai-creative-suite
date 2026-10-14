CREATE FUNCTION prevent_workspace_credit_ledger_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'workspace_credit_ledger entries are immutable';
END;
$$;

CREATE TRIGGER workspace_credit_ledger_immutable
BEFORE UPDATE OR DELETE ON workspace_credit_ledger
FOR EACH ROW EXECUTE FUNCTION prevent_workspace_credit_ledger_mutation();
