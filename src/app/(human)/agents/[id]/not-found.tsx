import Link from "next/link";

export default function AgentNotFound() {
  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <p className="eyebrow">404 / REGISTRY</p>
      <h1 className="page-title">
        Agent <em>not found.</em>
      </h1>
      <p className="text-sm text-[#53605a]">That id is missing, or you do not own it.</p>
      <Link href="/agents" className="btn-ghost w-fit">
        ← your agents
      </Link>
    </div>
  );
}
