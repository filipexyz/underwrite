import Link from "next/link";
import { SiteChrome } from "@/components/site-chrome";

export default function UnauthorizedPage() {
  return (
    <SiteChrome>
      <main className="mx-auto w-full max-w-xl px-[max(4vw,28px)] py-24 flex flex-col gap-4">
        <p className="eyebrow">401 / SESSION</p>
        <h1 className="page-title">
          Sign in <em>required.</em>
        </h1>
        <p className="text-[#53605a] text-sm leading-relaxed">
          Self-serve keys, seller registration, and the admin area need a Clerk session.
        </p>
        <Link href="/" className="btn-ghost w-fit">
          ← home
        </Link>
      </main>
    </SiteChrome>
  );
}
