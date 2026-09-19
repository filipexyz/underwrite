/**
 * `pnpm db:seed` — (re)seeds the six-agent catalog, axes and wallets.
 * Idempotent; requests and the ledger are never touched.
 */
import "./load-env";
import { describeDriver, openDb } from "@/lib/db/client";
import { seed, SEED_AGENTS } from "@/lib/db/seed";

async function main() {
  const url = process.env.DATABASE_URL;
  console.log(`[db:seed] driver=${describeDriver(url)}`);
  const handle = await openDb(url);
  if (handle.driver === "pglite") await handle.migrate();
  const { agents } = await seed(handle.db);
  await handle.close();
  console.log(`[db:seed] ${agents} agents: ${SEED_AGENTS.map((a) => a.agent_id).join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
