import { defineConfig } from "drizzle-kit";

/**
 * `pnpm db:generate` diffs `src/lib/db/schema.ts` against the committed
 * snapshots and writes SQL to `drizzle/`. Migrations are applied by
 * `pnpm db:migrate` (scripts/migrate.ts), which works for Neon HTTP and PGlite.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://unused:unused@localhost:5432/unused",
  },
  strict: true,
  verbose: true,
});
