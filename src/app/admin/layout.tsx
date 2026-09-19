import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireAdminPage } from "@/lib/auth/session";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdminPage();
  return (
    <AppShell section="admin" hint="config · audit · not a key mint">
      {children}
    </AppShell>
  );
}
