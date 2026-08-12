import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const jsonHeaders = { "content-type": "application/json", "cache-control": "no-store" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secretSet = Deno.env.get("SUPABASE_SECRET_KEYS");
  const modern = secretSet ? JSON.parse(secretSet)?.default : null;
  const key = modern || legacy;
  if (!url || !key) throw new Error("Supabase backend configuration missing");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return new Response(JSON.stringify({ ok: false }), { status: 405, headers: jsonHeaders });
  try {
    const body = await req.json();
    const token = String(body?.token || "").trim();
    const event = String(body?.event || "").trim();
    if (!uuid.test(token) || !["open", "click", "unsubscribe"].includes(event)) return new Response(JSON.stringify({ ok: false }), { status: 400, headers: jsonHeaders });
    const admin = adminClient();
    if (event === "unsubscribe") {
      const { data, error } = await admin.rpc("energy_unsubscribe", { p_token: token });
      if (error) throw error;
      return new Response(JSON.stringify({ ok: Boolean(data) }), { status: data ? 200 : 404, headers: jsonHeaders });
    }
    const target = typeof body?.url === "string" ? body.url.slice(0, 2048) : null;
    if (event === "click") {
      if (!target || !/^https?:\/\//i.test(target)) return new Response(JSON.stringify({ ok: false }), { status: 400, headers: jsonHeaders });
      const { data: message } = await admin.from("energy_messages").select("body_text,metadata").eq("tracking_token", token).maybeSingle();
      const allowed = Boolean(message && (String(message.body_text || "").includes(target) || String(message.metadata?.video_url || "") === target));
      if (!allowed) return new Response(JSON.stringify({ ok: false }), { status: 403, headers: jsonHeaders });
    }
    const agent = typeof body?.userAgent === "string" ? body.userAgent.slice(0, 500) : req.headers.get("user-agent");
    const { data, error } = await admin.rpc("energy_track_email_event", { p_token: token, p_event: event, p_url: target, p_user_agent: agent });
    if (error) throw error;
    return new Response(JSON.stringify({ ok: Boolean(data) }), { status: data ? 200 : 404, headers: jsonHeaders });
  } catch {
    return new Response(JSON.stringify({ ok: false }), { status: 500, headers: jsonHeaders });
  }
});
