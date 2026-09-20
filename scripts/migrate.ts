/**
 * `pnpm db:migrate` — applies the SQL in `drizzle/` to `DATABASE_URL`
 * (Neon over HTTP) or to the local PGlite directory when it is unset.
 *
 * `pnpm build` runs this before `next build`, so every Vercel deploy applies
 * pending migrations. Idempotent: applied migrations are skipped. Seeding is
 * deliberately not part of the build — it resets trust and wallets.
 */
import "./load-env";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describeDriver, openDb } from "@/lib/db/client";

/**
 * Refuse to migrate when the newest entry is not the newest by timestamp.
 *
 * drizzle's migrator reads the **latest applied** migration once and then applies a migration only when
 * `created_at < folderMillis`. A journal entry whose `when` is lower than one already applied is
 * therefore skipped **silently** — the run still prints "done".
 *
 * That is exactly how `0010_interview_request_handoff` shipped without ever running on production:
 * `drizzle-kit generate` stamped it with wall-clock-now, which was lower than the hand-placed future
 * timestamps on 0008/0009, so the column it adds never existed and every read of the table failed.
 *
 * This checks the last entry against the max, which is the condition that matters: any entry below the
 * current max will be skipped on a database that has applied the max.
 */
function assertJournalIsMonotonic(folder: string): void {
  const journalPath = join(folder, "meta", "_journal.json");
  let entries: Array<{ idx: number; tag: string; when: number }>;
  try {
    entries = (JSON.parse(readFileSync(journalPath, "utf8")) as { entries: typeof entries }).entries;
  } catch {
    return; // No journal (or unreadable) — let the migrator produce its own error.
  }
  if (entries.length === 0) return;

  const max = Math.max(...entries.map((e) => e.when));
  const last = entries[entries.length - 1];
  if (last.when >= max) return;

  const blockers = entries.filter((e) => e.when > last.when).map((e) => `${e.tag} (${e.when})`);
  console.error(
    [
      `[db:migrate] refusing to run: "${last.tag}" is the newest migration in the journal but not the`,
      `newest by timestamp (when=${last.when}, max=${max}).`,
      "drizzle skips any migration older than the latest applied one, silently, and would leave the",
      "schema behind the code.",
      `Higher-timestamped entries: ${blockers.join(", ")}`,
      `Fix: set "when" for "${last.tag}" in drizzle/meta/_journal.json to a value greater than ${max}.`,
    ].join("\n"),
  );
  process.exit(1);
}

async function main() {
  assertJournalIsMonotonic(join(process.cwd(), "drizzle"));

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
