-- Hand-written, not `drizzle-kit generate` output.
--
-- `pnpm db:generate` emitted a migration that also re-created `agent_runtime_secrets`, which
-- `0008_hosted_agent_runtime.sql` already creates. Applying that to any database that has run 0008
-- fails with "relation already exists" — the drizzle snapshots in `drizzle/meta/` have drifted from
-- the applied migrations. Regenerating will keep producing that phantom table until the snapshots are
-- reconciled; until then, migrations for new columns should be written by hand, as this one is.
ALTER TABLE "interview_needs" ADD COLUMN "request_id" text;
