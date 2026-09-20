import Link from "next/link";
import { SiteChrome } from "@/components/site-chrome";

export default function ForbiddenPage() {
  return (
    <SiteChrome>
      <main className="mx-auto w-full max-w-xl px-[max(4vw,28px)] py-24 flex flex-col gap-4">
        <p className="eyebrow">403 / OPS</p>
        <h1 className="page-title">
          Admin <em>only.</em>
        </h1>
        <p className="text-[#53605a] text-sm leading-relaxed">
          This surface is for configuration and audit. Ask Luís to set Auth0{" "}
          <code className="text-ink">app_metadata.role = &quot;admin&quot;</code> (copied to{" "}
          <code className="text-ink">https://underwrite/roles</code> by the Post-Login Action), or add your
          Auth0 <code className="text-ink">sub</code> to{" "}
          <code className="text-ink">UNDERWRITE_ADMIN_USER_IDS</code>.
        </p>
        {/*
         * Never leave a signed-in human at a dead end. `/start` is the initial screen they want;
         * `/` is the way back to the marketing page.
         */}
        <div className="flex flex-wrap gap-3">
          <Link href="/start" className="btn-ink w-fit">
            Go to start →
          </Link>
          <Link href="/" className="btn-ghost w-fit">
            ← home
          </Link>
        </div>
      </main>
    </SiteChrome>
  );
}
