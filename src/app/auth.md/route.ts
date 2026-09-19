import { renderAuthMdSkill } from "@/lib/auth/auth-md-skill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return new Response(renderAuthMdSkill(request), {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
