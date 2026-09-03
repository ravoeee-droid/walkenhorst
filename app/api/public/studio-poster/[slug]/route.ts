import { createClient } from "@supabase/supabase-js";
import { captureStudioPoster } from "@/lib/studio-poster-capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase-Konfiguration fehlt.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    if (!slug || slug.length > 180) return Response.json({ error: "Ungültiger Link." }, { status: 400 });

    const requestUrl = new URL(request.url);
    const version = String(requestUrl.searchParams.get("v") || "").trim().replace(/[^0-9A-Za-z._-]/g, "").slice(0, 40);
    const supabase = client();
    const { data, error } = await supabase
      .from("energy_video_pages")
      .select("website_capture_url,presenter_video_url,status,is_public,updated_at")
      .eq("slug", slug)
      .eq("is_public", true)
      .in("status", ["ready", "sent"])
      .maybeSingle();

    if (error || !data?.website_capture_url || !data?.presenter_video_url) {
      return Response.json({ error: "Video-Poster nicht verfügbar." }, { status: 404 });
    }

    const poster = await captureStudioPoster(data.website_capture_url, data.presenter_video_url);
    return new Response(new Uint8Array(poster.buffer), {
      status: 200,
      headers: {
        "content-type": "image/webp",
        "cache-control": version ? "public, max-age=31536000, immutable" : "no-store, max-age=0",
        "x-capture-width": String(poster.width),
        "x-capture-height": String(poster.height),
        "x-poster-version": version || "unversioned",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message.slice(0, 500) : "Video-Poster fehlgeschlagen." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
