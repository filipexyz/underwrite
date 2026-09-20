import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireAdminPage } from "@/lib/auth/session";

/**
 * The ops console is an **admin** surface, not a signed-in one.
 *
 * It lists every request in the system regardless of owner and exposes the two most destructive
 * controls in the app: `fireDemoRequest` (spends real inference) and `resetCatalog` (re-seeds the
 * shared catalog, wiping every agent's axes, wallets and pairwise trust). `/admin` already used
 * `requireAdminPage`; `/console` was the odd one out behind `requireSignedInPage`, so any new
 * account landed on an internal observability page with a catalog-reset button on it.
 *
 * With Auth0 off `resolveSessionIdentity` returns `local-dev` as admin, so local development and
 * the offline demo are unaffected.
 */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  await requireAdminPage();
  return (
    <AppShell section="console" hint="debug ui · internal">
      {children}
    </AppShell>
  );
}
