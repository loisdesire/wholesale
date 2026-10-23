-- Runs once, when the local Postgres data directory is first created.
-- The application connects as this role. It is deliberately NOT a superuser and has
-- no BYPASSRLS, because either of those makes Postgres skip row-level security —
-- which is what keeps one organization's data away from another's.
-- (Local-development password; set a real secret anywhere else.)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wholesale_app') THEN
    CREATE ROLE wholesale_app LOGIN PASSWORD 'wholesale_app' NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
