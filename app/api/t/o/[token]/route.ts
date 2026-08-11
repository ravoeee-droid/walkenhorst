import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (UUID.test(token)) {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (base) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      try {
        await fetch(`${base}/functions/v1/email-public-event`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token, event: "open", userAgent: req.headers.get("user-agent") }),
          cache: "no-store",
          signal: controller.signal,
        });
      } catch { /* Tracking must never break the email pixel response. */ }
      finally { clearTimeout(timer); }
    }
  }
  return new Response(GIF, { headers: { "content-type": "image/gif", "cache-control": "no-store, no-cache, must-revalidate, max-age=0" } });
}
