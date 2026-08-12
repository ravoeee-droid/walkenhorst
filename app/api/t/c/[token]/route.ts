import { NextRequest } from "next/server";
import { postPublicEmailEvent } from "@/lib/email-public-event";

export async function GET(req: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const rawTarget = req.nextUrl.searchParams.get("url") || "";
  const target = rawTarget.replaceAll("&amp;", "&");
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new Response("Ungültiger Link", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    return new Response("Ungültiger Link", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  const tracked = await postPublicEmailEvent({ token, event: "click", url: parsed.toString(), userAgent: req.headers.get("user-agent") });
  if (!tracked.ok) {
    return new Response("Link konnte nicht bestätigt werden.", { status: tracked.status === 403 ? 403 : 503, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }

  return Response.redirect(parsed.toString(), 302);
}
