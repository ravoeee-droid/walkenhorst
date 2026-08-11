import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const raw = req.nextUrl.searchParams.get("url") || "";
  if (!UUID.test(token)) return NextResponse.json({ error: "Ungültiger Tracking-Link" }, { status: 400 });
  let target: URL;
  try { target = new URL(raw); } catch { return NextResponse.json({ error: "Ungültiges Ziel" }, { status: 400 }); }
  if (!["http:", "https:"].includes(target.protocol)) return NextResponse.json({ error: "Ungültiges Ziel" }, { status: 400 });
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return NextResponse.json({ error: "Tracking nicht konfiguriert" }, { status: 503 });
  try {
    const response = await fetch(`${base}/functions/v1/email-public-event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, event: "click", url: target.toString(), userAgent: req.headers.get("user-agent") }),
      cache: "no-store",
    });
    if (!response.ok) return NextResponse.json({ error: "Tracking-Link konnte nicht verifiziert werden" }, { status: 403 });
    return NextResponse.redirect(target, 302);
  } catch {
    return NextResponse.json({ error: "Tracking momentan nicht erreichbar" }, { status: 503 });
  }
}
