/**
 * Database handle.
 *
 * - Production / any real `DATABASE_URL`: Neon over HTTP (`@neondatabase/serverless`
 *   + `drizzle-orm/neon-http`). Stateless per call — the right fit for Vercel functions.
 * - No `DATABASE_URL` or `pglite://…`: embedded PGlite. Same Drizzle API, same
 *   migrations, zero setup. Used for local dev without Neon and for tests.
 *
 * Both are Postgres and both run the committed SQL migrations in `drizzle/`.
 */
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
export type DbDriver = "neon-http" | "pglite";

export type DbHandle = {
  db: Db;
  driver: DbDriver;
  /** Applies pending migrations from `drizzle/` (idempotent). */
  migrate: () => Promise<void>;
  close: () => Promise<void>;
};

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");
const DEFAULT_PGLITE_DIR = path.join(process.cwd(), ".data", "pglite");

declare global {
  var __underwriteDb: Promise<DbHandle> | undefined;
}

export function describeDriver(url: string | undefined): DbDriver {
  if (!url || url.startsWith("pglite:")) return "pglite";
  return "neon-http";
}

async function createNeon(url: string): Promise<DbHandle> {
  const { neon } = await import("@neondatabase/serverless");
  const { drizzle } = await import("drizzle-orm/neon-http");
  const { migrate } = await import("drizzle-orm/neon-http/migrator");
  const sql = neon(url);
  const db = drizzle({ client: sql, schema });
  return {
    db,
    driver: "neon-http",
    migrate: () => migrate(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    close: async () => {},
  };
}

async function createPglite(url: string | undefined): Promise<DbHandle> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const target = url ? url.replace(/^pglite:\/\//, "") : DEFAULT_PGLITE_DIR;
  const inMemory = target === "memory" || target === ":memory:";
  if (!inMemory) {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(target, { recursive: true });
  }
  const client = inMemory ? new PGlite() : new PGlite(target);
  await client.waitReady;
  const db = drizzle({ client, schema });
  return {
    db,
    driver: "pglite",
    migrate: () => migrate(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    close: () => client.close(),
  };
}

/**
 * Opens a handle for an explicit URL (scripts and tests). Prefer `getDb()` in app code.
 */
export async function openDb(url: string | undefined): Promise<DbHandle> {
  if (describeDriver(url) === "neon-http") return createNeon(url as string);
  if (process.env.VERCEL && !url) {
    throw new Error("DATABASE_URL is required on Vercel — the embedded PGlite fallback is for local development only (a function's filesystem is read-only and not shared between invocations).");
  }
  return createPglite(url);
}

/**
 * Process-wide handle. PGlite auto-migrates and auto-seeds on first use so
 * `pnpm dev` works with an empty `.env`; Neon expects `pnpm db:migrate && pnpm db:seed`.
 */
export function getDb(): Promise<DbHandle> {
  if (!globalThis.__underwriteDb) {
    globalThis.__underwriteDb = (async () => {
      const handle = await openDb(env.databaseUrl);
      if (handle.driver === "pglite") {
        await handle.migrate();
        const { seedIfEmpty } = await import("./seed");
        await seedIfEmpty(handle.db);
      }
      return handle;
    })().catch((error) => {
      globalThis.__underwriteDb = undefined;
      throw error;
    });
  }
  return globalThis.__underwriteDb;
}
