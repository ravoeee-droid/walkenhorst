import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.8";

const H = {
  "content-type": "application/json",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, x-worker-key",
  "access-control-allow-methods": "POST, OPTIONS",
};
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: H });

type Verification = {
  status: "safe" | "risky" | "domain_valid" | "invalid" | "unknown";
  reason: string;
  meta: Record<string, unknown>;
};

function env() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  const secret = keys ? JSON.parse(keys)?.default : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !secret) throw new Error("Backend configuration missing");
  return { url, secret: String(secret) };
}
function admin() {
  const e = env();
  return createClient(e.url, e.secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

type DB = ReturnType<typeof admin>;

async function authorized(req: Request, db: DB) {
  const supplied = req.headers.get("x-worker-key") || "";
  if (!supplied) return false;
  const { data } = await db.rpc("energy_get_system_secret", { p_name: "energy_worker_key" });
  return Boolean(data && String(data) === supplied);
}

const DISPOSABLE = new Set([
  "10minutemail.com", "guerrillamail.com", "mailinator.com", "temp-mail.org",
  "tempmail.com", "yopmail.com", "trashmail.com", "sharklasers.com",
  "getnada.com", "dispostable.com", "maildrop.cc", "fakeinbox.com",
]);
const ROLE_LOCALPARTS = new Set(["info", "office", "kontakt", "contact", "sales", "hello", "mail", "service", "support"]);

function normalizeEmail(raw: unknown) {
  return String(raw || "").trim().toLowerCase();
}
function syntaxOk(email: string) {
  if (!email || email.length > 254 || /\s/.test(email)) return false;
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > 64 || domain.length > 253 || !domain.includes(".")) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local) && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain);
}

async function dnsJson(domain: string, type: "MX" | "A") {
  const url = new URL("https://cloudflare-dns.com/dns-query");
  url.searchParams.set("name", domain);
  url.searchParams.set("type", type);
  const response = await fetch(url, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`dns_${response.status}`);
  return await response.json() as { Status?: number; Answer?: Array<{ type?: number; data?: string }> };
}

async function reacher(email: string): Promise<Verification | null> {
  const base = String(Deno.env.get("REACHER_BASE_URL") || "").replace(/\/$/, "");
  const token = String(Deno.env.get("REACHER_API_TOKEN") || "");
  if (!base) return null;
  try {
    const response = await fetch(`${base}/v0/check_email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: token } : {}),
      },
      body: JSON.stringify({ to_email: email }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return { status: "unknown", reason: `reacher_http_${response.status}`, meta: { provider: "reacher" } };
    const data = await response.json() as Record<string, unknown>;
    const reachable = String(data.is_reachable || "unknown").toLowerCase();
    const mapped = reachable === "safe" ? "safe" : reachable === "invalid" ? "invalid" : reachable === "risky" ? "risky" : "unknown";
    return { status: mapped, reason: `reacher_${reachable}`, meta: { provider: "reacher", result: data } };
  } catch (error) {
    return { status: "unknown", reason: `reacher_error:${error instanceof Error ? error.message : "unknown"}`, meta: { provider: "reacher" } };
  }
}

async function verify(email: string): Promise<Verification> {
  if (!syntaxOk(email)) return { status: "invalid", reason: "invalid_syntax", meta: {} };
  const [local, domain] = email.split("@");
  if (DISPOSABLE.has(domain)) return { status: "invalid", reason: "disposable_domain", meta: { domain } };

  const reacherResult = await reacher(email);
  if (reacherResult && reacherResult.status !== "unknown") return reacherResult;

  try {
    const mx = await dnsJson(domain, "MX");
    if (Number(mx.Status) === 3) return { status: "invalid", reason: "domain_nxdomain", meta: { domain } };
    const mxAnswers = (mx.Answer || []).filter((x) => Number(x.type) === 15).map((x) => String(x.data || ""));
    if (mxAnswers.some((x) => /^\s*0\s+\.?\s*$/.test(x))) return { status: "invalid", reason: "null_mx", meta: { domain, mx: mxAnswers } };
    if (mxAnswers.length) {
      return {
        status: "domain_valid",
        reason: ROLE_LOCALPARTS.has(local) ? "mx_ok_role_inbox" : "mx_ok",
        meta: { domain, mx: mxAnswers.slice(0, 8), role_inbox: ROLE_LOCALPARTS.has(local), provider: reacherResult?.meta?.provider || "dns" },
      };
    }

    const a = await dnsJson(domain, "A");
    const aAnswers = (a.Answer || []).filter((x) => Number(x.type) === 1).map((x) => String(x.data || ""));
    if (aAnswers.length) return { status: "domain_valid", reason: "a_fallback_ok", meta: { domain, a: aAnswers.slice(0, 4) } };
    return { status: "invalid", reason: "no_mail_route", meta: { domain } };
  } catch (error) {
    return { status: "unknown", reason: `dns_error:${error instanceof Error ? error.message : "unknown"}`, meta: { domain } };
  }
}

async function candidates(db: DB, limit: number) {
  const preferred = await db.from("energy_campaign_members")
    .select("lead_id")
    .eq("status", "queued")
    .eq("current_step", 1)
    .limit(limit * 2);
  const ids = Array.from(new Set((preferred.data || []).map((x: any) => String(x.lead_id || "")).filter(Boolean)));
  const rows: any[] = [];
  if (ids.length) {
    const q = await db.from("energy_leads")
      .select("id,user_id,email,email_status,email_verification_status")
      .in("id", ids)
      .neq("email_status", "invalid")
      .in("email_verification_status", ["unchecked", "unknown"])
      .limit(limit);
    rows.push(...(q.data || []));
  }
  if (rows.length < limit) {
    const extra = await db.from("energy_leads")
      .select("id,user_id,email,email_status,email_verification_status")
      .not("email", "is", null)
      .neq("email", "")
      .neq("email_status", "invalid")
      .in("email_verification_status", ["unchecked", "unknown"])
      .order("created_at", { ascending: false })
      .limit(limit - rows.length);
    const seen = new Set(rows.map((x) => x.id));
    rows.push(...(extra.data || []).filter((x: any) => !seen.has(x.id)));
  }
  return rows.slice(0, limit);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: H });
  if (req.method !== "POST") return out({ error: "Method not allowed" }, 405);
  const db = admin();
  if (!(await authorized(req, db))) return out({ error: "Nicht autorisiert" }, 401);

  const body = await req.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(100, Number(body?.limit) || 25));
  const rows = await candidates(db, limit);
  const totals = { processed: 0, safe: 0, risky: 0, domain_valid: 0, invalid: 0, unknown: 0 };

  for (const lead of rows) {
    const email = normalizeEmail(lead.email);
    const result = await verify(email);
    totals.processed++;
    totals[result.status]++;
    const now = new Date().toISOString();
    const update: Record<string, unknown> = {
      email_verification_status: result.status,
      email_verification_reason: result.reason.slice(0, 500),
      email_verified_at: now,
      email_verification_meta: result.meta,
      updated_at: now,
    };
    if (result.status === "invalid") update.email_status = "invalid";
    if (result.status === "safe") update.email_status = "valid";
    await db.from("energy_leads").update(update).eq("id", lead.id);
    if (result.status === "invalid") {
      await db.from("energy_campaign_members")
        .update({ status: "stopped", stopped_reason: "email_verifier_invalid", updated_at: now })
        .eq("lead_id", lead.id)
        .eq("status", "queued");
    }
  }

  return out({ ok: true, provider: Deno.env.get("REACHER_BASE_URL") ? "reacher+dns" : "dns", totals });
});
