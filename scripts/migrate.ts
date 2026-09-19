/**
 * `pnpm db:migrate` — applies the SQL in `drizzle/` to `DATABASE_URL`
 * (Neon over HTTP) or to the local PGlite directory when it is unset.
 */
import "./load-env";
import { describeDriver, openDb } from "@/lib/db/client";

async function main() {
  const url = process.env.DATABASE_URL;
  const driver = describeDriver(url);
  console.log(`[db:migrate] driver=${driver}${driver === "pglite" ? " (no DATABASE_URL — using ./.data/pglite)" : ""}`);
  const handle = await openDb(url);
  await handle.migrate();
  await handle.close();
  console.log("[db:migrate] done");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
