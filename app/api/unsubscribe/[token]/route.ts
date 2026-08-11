import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(_req: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!UUID.test(token)) return NextResponse.redirect(new URL(`/u/${token}?status=invalid`, _req.url), 303);
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return NextResponse.redirect(new URL(`/u/${token}?status=error`, _req.url), 303);
  try {
    const response = await fetch(`${base}/functions/v1/email-public-event`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, event: "unsubscribe" }), cache: "no-store" });
    return NextResponse.redirect(new URL(`/u/${token}?status=${response.ok ? "done" : "error"}`, _req.url), 303);
  } catch {
    return NextResponse.redirect(new URL(`/u/${token}?status=error`, _req.url), 303);
  }
}
