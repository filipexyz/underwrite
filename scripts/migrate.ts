/**
 * `pnpm db:migrate` — applies the SQL in `drizzle/` to `DATABASE_URL`
 * (Neon over HTTP) or to the local PGlite directory when it is unset.
 *
 * `pnpm build` runs this before `next build`, so every Vercel deploy applies
 * pending migrations. Idempotent: applied migrations are skipped. Seeding is
 * deliberately not part of the build — it resets trust and wallets.
 */
import "./load-env";
import { describeDriver, openDb } from "@/lib/db/client";

async function main() {
  const url = process.env.DATABASE_URL;
  const driver = describeDriver(url);

  if (!url && process.env.VERCEL) {
    console.error(
      [
        "[db:migrate] DATABASE_URL is not set.",
        "On Vercel the build applies migrations to Neon before `next build`, so every environment that",
        "deploys (Production and Preview) needs DATABASE_URL in the project's Environment Variables —",
        "a Neon branch per preview works well. The embedded PGlite fallback is for local development only.",
      ].join("\n"),
    );
    process.exit(1);
  }

  const target = driver === "neon-http" ? "" : url ? ` (${url})` : " (no DATABASE_URL — using ./.data/pglite)";
  console.log(`[db:migrate] driver=${driver}${target}`);
  const handle = await openDb(url);
  await handle.migrate();
  await handle.close();
  console.log("[db:migrate] done");
}

main().catch((error) => {
  console.error("[db:migrate] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
