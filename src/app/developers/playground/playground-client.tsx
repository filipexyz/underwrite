"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { Badge, Empty, Panel } from "@/app/console/ui";
import {
  BUYER_KEY_STORAGE,
  SAMPLE_BUYER_REQUEST,
  SAMPLE_SELLER_PATCH,
  SELLER_KEY_STORAGE,
  bearerHeaders,
  formatJson,
  isTerminalRequestStatus,
  parseJsonBody,
} from "@/lib/developers/playground";

const SESSION_EVENT = "uw-playground-session";

function subscribeSession(onStoreChange: () => void) {
  window.addEventListener(SESSION_EVENT, onStoreChange);
  return () => window.removeEventListener(SESSION_EVENT, onStoreChange);
}

function useSessionKey(storageKey: string): [string, (value: string) => void] {
  const value = useSyncExternalStore(subscribeSession, () => readSession(storageKey), () => "");
  const setValue = useCallback(
    (next: string) => {
      writeSession(storageKey, next);
      window.dispatchEvent(new Event(SESSION_EVENT));
    },
    [storageKey],
  );
  return [value, setValue];
}

type Tab = "buyer" | "seller";
type CallResult = { status: number; body: unknown };

const POLL_MS = 400;
const POLL_TRIES = 90;

function readSession(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeSession(key: string, value: string) {
  try {
    if (value.trim()) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    /* private mode */
  }
}

async function readResult(res: Response): Promise<CallResult> {
  const text = await res.text();
  if (!text) return { status: res.status, body: null };
  try {
    return { status: res.status, body: JSON.parse(text) as unknown };
  } catch {
    return { status: res.status, body: text };
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function Playground() {
  const [tab, setTab] = useState<Tab>("buyer");
  const [buyerKey, setBuyerKey] = useSessionKey(BUYER_KEY_STORAGE);
  const [sellerKey, setSellerKey] = useSessionKey(SELLER_KEY_STORAGE);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={tab === "buyer" ? "btn-ink" : "btn-ghost"} onClick={() => setTab("buyer")}>
          {tab === "buyer" ? (
            <>
              <span>Buyer request</span>
              <strong>→</strong>
            </>
          ) : (
            "Buyer request"
          )}
        </button>
        <button type="button" className={tab === "seller" ? "btn-ink" : "btn-ghost"} onClick={() => setTab("seller")}>
          {tab === "seller" ? (
            <>
              <span>Seller /me</span>
              <strong>→</strong>
            </>
          ) : (
            "Seller /me"
          )}
        </button>
      </div>
      {tab === "buyer" ? (
        <BuyerPanel keyValue={buyerKey} onKeyChange={setBuyerKey} />
      ) : (
        <SellerPanel keyValue={sellerKey} onKeyChange={setSellerKey} />
      )}
    </div>
  );
}

function KeyField({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  hint: string;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      <span className="eyebrow !mb-0">{label}</span>
      <input
        id={id}
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input-mesh font-mono text-xs"
      />
      <span className="mono text-[10px] text-muted">{hint}</span>
    </label>
  );
}

function ResultPane({ result, pending, error }: { result: CallResult | null; pending: boolean; error: string | null }) {
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (pending) return <p className="mono text-xs text-muted">calling…</p>;
  if (!result) return <Empty>No response yet.</Empty>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="eyebrow !mb-0">HTTP</span>
        <Badge value={String(result.status)} />
      </div>
      <pre className="overflow-x-auto bg-[#d8dfd8] p-3.5 font-mono text-[11px] leading-[1.65] whitespace-pre-wrap max-h-[480px]">
        {formatJson(result.body)}
      </pre>
    </div>
  );
}

function BuyerPanel({ keyValue, onKeyChange }: { keyValue: string; onKeyChange: (value: string) => void }) {
  const [body, setBody] = useState(() => formatJson(SAMPLE_BUYER_REQUEST));
  const [wait, setWait] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CallResult | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const fire = useCallback(async () => {
    setError(null);
    setPending(true);
    setResult(null);
    setStatus(null);
    const parsed = parseJsonBody(body);
    if (!parsed.ok) {
      setError(parsed.error);
      setPending(false);
      return;
    }
    try {
      const path = wait ? "/api/v1/requests?wait=1" : "/api/v1/requests";
      const posted = await fetch(path, {
        method: "POST",
        headers: bearerHeaders(keyValue, true),
        body: JSON.stringify(parsed.value),
      });
      const accepted = await readResult(posted);
      setResult(accepted);
      const requestId =
        accepted.body && typeof accepted.body === "object" && "request_id" in accepted.body
          ? String((accepted.body as { request_id: unknown }).request_id)
          : "";
      const nextStatus =
        accepted.body && typeof accepted.body === "object" && "status" in accepted.body
          ? String((accepted.body as { status: unknown }).status)
          : null;
      setStatus(nextStatus);
      if (!posted.ok || wait || !requestId) return;

      let after = 0;
      for (let i = 0; i < POLL_TRIES; i++) {
        await sleep(POLL_MS);
        const feed = await fetch(`/api/v1/requests/${requestId}/events?after=${after}`, {
          headers: bearerHeaders(keyValue),
        });
        const tick = await readResult(feed);
        if (!feed.ok) {
          setResult(tick);
          return;
        }
        const payload = tick.body as { status?: string; events?: Array<{ seq?: number }> };
        setStatus(payload.status ?? null);
        const last = payload.events?.at(-1)?.seq;
        if (typeof last === "number") after = last;
        if (payload.status && isTerminalRequestStatus(payload.status)) {
          const detail = await fetch(`/api/v1/requests/${requestId}`, { headers: bearerHeaders(keyValue) });
          setResult(await readResult(detail));
          return;
        }
      }
      setError("timed out waiting for a terminal status — GET the request id to keep polling");
    } catch (err) {
      setError(err instanceof Error ? err.message : "request failed");
    } finally {
      setPending(false);
    }
  }, [body, keyValue, wait]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Sample request" eyebrow="POST /API/V1/REQUESTS">
        <div className="flex flex-col gap-3">
          <KeyField
            id="buyer-key"
            label="Buyer key"
            value={keyValue}
            onChange={onKeyChange}
            placeholder="uw_buyer_…"
            hint="Stored in sessionStorage only. Leave empty for demoday (no legacy env)."
          />
          <label htmlFor="buyer-body" className="flex flex-col gap-1 text-sm">
            <span className="eyebrow !mb-0">JSON body</span>
            <textarea
              id="buyer-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={16}
              spellCheck={false}
              className="input-mesh font-mono text-[11px] leading-[1.65]"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-[#46514d]">
            <input type="checkbox" checked={wait} onChange={(e) => setWait(e.target.checked)} />
            <span>
              <code className="text-ink">?wait=1</code> — block until settled
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending} onClick={() => void fire()} className="btn-ink">
              <span>{pending ? "Firing…" : "Fire request"}</span>
              <strong>→</strong>
            </button>
            <button type="button" className="btn-ghost" onClick={() => setBody(formatJson(SAMPLE_BUYER_REQUEST))}>
              Reset sample
            </button>
            <button type="button" className="btn-ghost" onClick={() => onKeyChange("")}>
              Clear key
            </button>
          </div>
        </div>
      </Panel>
      <Panel
        title="Response"
        eyebrow="JSON"
        aside={status ? <Badge value={status} /> : pending ? <Badge value="calling" /> : null}
      >
        <ResultPane result={result} pending={pending} error={error} />
      </Panel>
    </div>
  );
}

function SellerPanel({ keyValue, onKeyChange }: { keyValue: string; onKeyChange: (value: string) => void }) {
  const [body, setBody] = useState(() => formatJson(SAMPLE_SELLER_PATCH));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CallResult | null>(null);

  const getMe = useCallback(async () => {
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/v1/agents/me", { headers: bearerHeaders(keyValue) });
      setResult(await readResult(res));
    } catch (err) {
      setError(err instanceof Error ? err.message : "GET failed");
    } finally {
      setPending(false);
    }
  }, [keyValue]);

  const patchMe = useCallback(async () => {
    setError(null);
    setPending(true);
    const parsed = parseJsonBody(body);
    if (!parsed.ok) {
      setError(parsed.error);
      setPending(false);
      return;
    }
    try {
      const res = await fetch("/api/v1/agents/me", {
        method: "PATCH",
        headers: bearerHeaders(keyValue, true),
        body: JSON.stringify(parsed.value),
      });
      setResult(await readResult(res));
    } catch (err) {
      setError(err instanceof Error ? err.message : "PATCH failed");
    } finally {
      setPending(false);
    }
  }, [body, keyValue]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Bound agent" eyebrow="GET / PATCH /API/V1/AGENTS/ME">
        <div className="flex flex-col gap-3">
          <KeyField
            id="seller-key"
            label="Seller key"
            value={keyValue}
            onChange={onKeyChange}
            placeholder="uw_seller_…"
            hint="Stored in sessionStorage only. A seller key is always required."
          />
          <label htmlFor="seller-body" className="flex flex-col gap-1 text-sm">
            <span className="eyebrow !mb-0">PATCH JSON</span>
            <textarea
              id="seller-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              spellCheck={false}
              className="input-mesh font-mono text-[11px] leading-[1.65]"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending} onClick={() => void getMe()} className="btn-ink">
              <span>{pending ? "Calling…" : "GET me"}</span>
              <strong>→</strong>
            </button>
            <button type="button" disabled={pending} onClick={() => void patchMe()} className="btn-ghost">
              PATCH me
            </button>
            <button type="button" className="btn-ghost" onClick={() => onKeyChange("")}>
              Clear key
            </button>
          </div>
        </div>
      </Panel>
      <Panel title="Response" eyebrow="JSON">
        <ResultPane result={result} pending={pending} error={error} />
      </Panel>
    </div>
  );
}
