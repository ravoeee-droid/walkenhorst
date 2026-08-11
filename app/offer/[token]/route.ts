import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) return new NextResponse("Link nicht verfügbar", { status: 404 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return new NextResponse("Tracking ist nicht konfiguriert", { status: 503 });

  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/functions/v1/document-track`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: key },
      body: JSON.stringify({ token, userAgent: request.headers.get("user-agent") ?? "" }),
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    const target = typeof data?.target_url === "string" ? data.target_url : "";
    if (!response.ok || !/^https?:\/\//i.test(target)) return new NextResponse("Dokument nicht verfügbar", { status: 404 });
    return NextResponse.redirect(target, { status: 307 });
  } catch {
    return new NextResponse("Dokument konnte nicht geöffnet werden", { status: 502 });
  }
}
