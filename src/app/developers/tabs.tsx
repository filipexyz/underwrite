import Link from "next/link";

export function DevelopersTabs({ current }: { current: "docs" | "playground" }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Link href="/developers" className={current === "docs" ? "btn-ink" : "btn-ghost"}>
        {current === "docs" ? (
          <>
            <span>Docs</span>
            <strong>→</strong>
          </>
        ) : (
          "Docs"
        )}
      </Link>
      <Link href="/developers/playground" className={current === "playground" ? "btn-ink" : "btn-ghost"}>
        {current === "playground" ? (
          <>
            <span>Playground</span>
            <strong>→</strong>
          </>
        ) : (
          "Playground"
        )}
      </Link>
    </div>
  );
}
