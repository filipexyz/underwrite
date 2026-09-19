import Link from "next/link";

export default function AgentNotFound() {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">Agent not found</h1>
      <p className="text-sm text-muted">That id is missing, or you do not own it.</p>
      <Link href="/agents" className="text-sm text-accent hover:underline">
        Back to your agents
      </Link>
    </div>
  );
}
