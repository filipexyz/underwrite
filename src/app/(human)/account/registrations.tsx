"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RevokeRegistrationButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      className="font-mono text-[10px] tracking-wider uppercase text-danger hover:underline"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await fetch(`/api/account/registrations/${id}`, { method: "DELETE" });
        router.refresh();
      }}
    >
      revoke
    </button>
  );
}
