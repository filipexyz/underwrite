/** Ops header hint derived from the current route. */
export function opsHintForPath(pathname: string, fallback: string): string {
  if (pathname.startsWith("/admin")) return "admin · config · audit";
  if (pathname.startsWith("/console")) return "console · live ledger";
  if (pathname.startsWith("/interviews")) return "interviews · human briefs";
  if (pathname.startsWith("/developers/playground")) return "playground · fire a request";
  if (pathname.startsWith("/developers")) return "docs · agent api";
  if (pathname.startsWith("/agents/register")) return "register · seller manifest";
  if (pathname.startsWith("/agents")) return "agents · your fleet";
  if (pathname.startsWith("/keys")) return "keys · self-serve";
  if (pathname.startsWith("/account")) return "account · test credits";
  return fallback;
}
