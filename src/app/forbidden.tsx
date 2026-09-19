import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <main className="mx-auto w-full max-w-xl px-6 py-24 flex flex-col gap-4">
      <p className="mono text-xs text-danger tracking-widest uppercase">403</p>
      <h1 className="text-2xl font-semibold tracking-tight">Admin only</h1>
      <p className="text-muted text-sm">
        This surface is for configuration and audit. Ask Luís to set Clerk public metadata{" "}
        <code className="text-foreground">{`{ "role": "admin" }`}</code> on your user, or add your Clerk
        user id to <code className="text-foreground">UNDERWRITE_ADMIN_USER_IDS</code>.
      </p>
      <Link href="/" className="text-accent text-sm hover:underline w-fit">
        ← home
      </Link>
    </main>
  );
}
