import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <main className="mx-auto w-full max-w-xl px-6 py-24 flex flex-col gap-4">
      <p className="mono text-xs text-warn tracking-widest uppercase">401</p>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in required</h1>
      <p className="text-muted text-sm">Self-serve keys, seller registration, and the admin area need a Clerk session.</p>
      <Link href="/" className="text-accent text-sm hover:underline w-fit">
        ← home
      </Link>
    </main>
  );
}
