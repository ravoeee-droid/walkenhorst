import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@7";

const H = {
  "content-type": "application/json",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, x-worker-key",
  "access-control-allow-methods": "POST, OPTIONS",
};
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: H });

function env() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const pubs = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  const secs = Deno.env.get("SUPABASE_SECRET_KEYS");
  const pub = pubs ? JSON.parse(pubs)?.default : Deno.env.get("SUPABASE_ANON_KEY");
  const secret = secs ? JSON.parse(secs)?.default : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !pub || !secret) throw new Error("Backend configuration missing");
  return { url, pub, secret };
}

function admin() {
  const e = env();
  return createClient(e.url, e.secret, { auth: { persistSession: false, autoRefreshToken: false } });
}
type DB = ReturnType<typeof admin>;

async function requestUser(req: Request) {
  const a = req.headers.get("authorization") || "";
  const token = a.toLowerCase().startsWith("bearer ") ? a.slice(7).trim() : "";
  if (!token) return null;
  const e = env();
  const c = createClient(e.url, e.pub, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.getUser(token);
  if (error || !data.user) return null;
  const owner = typeof data.user.app_metadata?.workspace_owner_id === "string"
    ? data.user.app_metadata.workspace_owner_id.trim()
    : "";
  return { ...data.user, id: owner || data.user.id };
}

async function authorize(req: Request, db: DB) {
  const u = await requestUser(req);
  if (u) return { ok: true as const, userId: u.id };
  const supplied = req.headers.get("x-worker-key") || "";
  if (!supplied) return { ok: false as const, userId: null };
  const { data } = await db.rpc("energy_get_system_secret", { p_name: "energy_worker_key" });
  return data && String(data) === supplied
    ? { ok: true as const, userId: null }
    : { ok: false as const, userId: null };
}

const NAME_TITLE = /^(herr|frau|hr\.?|fr\.?|dr\.?|prof\.?|professor|dipl\.?-?ing\.?|dipl\.?|ing\.?|mag\.?|mba|m\.?sc\.?|b\.?sc\.?|ph\.?d\.?)$/i;
function firstName(v: unknown) {
  let raw = String(v || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  if (raw.includes(",")) {
    const parts = raw.split(",").map((x) => x.trim()).filter(Boolean);
    if (parts.length > 1) raw = parts.slice(1).join(" ");
  }
  const tokens = raw.split(/\s+/).filter(Boolean);
  while (tokens.length && NAME_TITLE.test(tokens[0].replace(/[,:;]+$/g, ""))) tokens.shift();
  return (tokens[0] || "")
    .replace(/^[^A-Za-zÀ-ÖØ-öø-ÿÄÖÜäöüß-]+|[^A-Za-zÀ-ÖØ-öø-ÿÄÖÜäöüß'-]+$/g, "");
}

function cleanReason(lead: any) {
  const candidates = [lead?.summary, lead?.research_context?.firecrawl?.signals?.[0], lead?.pitch];
  for (const value of candidates) {
    const s = String(value || "").trim();
    if (s && !/daten anreichern|outbound priorisieren/i.test(s)) return s;
  }
  return "";
}

function personalize(template: string, lead: any, videoUrl: string) {
  const reason = cleanReason(lead);
  return String(template || "")
    .replaceAll("{{firstname}}", firstName(lead.contact_name))
    .replaceAll("{{company}}", String(lead.company_name || ""))
    .replaceAll("{{city}}", String(lead.city || ""))
    .replaceAll("{{industry}}", String(lead.industry || ""))
    .replaceAll("{{opportunity}}", String(lead.total_score ?? ""))
    .replaceAll("{{reason}}", reason)
    .replaceAll("{{video_url}}", videoUrl || "");
}

function escapeHtml(v: string) {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

function toHtml(text: string, base: string, token: string) {
  const linked = escapeHtml(text)
    .replace(/https?:\/\/[^\s&lt;&gt;]+/g, (url) => `<a href="${base}/api/t/c/${token}?url=${encodeURIComponent(url)}">${url}</a>`)
    .replace(/\n/g, "<br>");
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#151515">${linked}<br><br><span style="font-size:11px;color:#888">Kein Interesse? <a href="${base}/u/${token}">Abmelden</a></span><img src="${base}/api/t/o/${token}" width="1" height="1" alt="" style="display:none"></div>`;
}

function timeToMinutes(v: string) {
  const [h, m] = String(v || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function currentLocalMinutes(tz: string) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  return Number(p.find((x) => x.type === "hour")?.value || 0) * 60 + Number(p.find((x) => x.type === "minute")?.value || 0);
}

function insideWindow(c: any) {
  const now = currentLocalMinutes(c.timezone || "Europe/Berlin");
  const start = timeToMinutes(c.send_window_start || "08:30");
  const end = timeToMinutes(c.send_window_end || "17:30");
  return start <= end ? now >= start && now <= end : now >= start || now <= end;
}

function scheduledIn(hours: number) {
  return new Date(Date.now() + Math.max(0, Number(hours) || 0) * 3600000).toISOString();
}

async function smtpPassword(db: DB, m: any, userId: string) {
  const { data, error } = await db.rpc("energy_get_mailbox_secrets", { p_mailbox_id: m.id, p_user_id: userId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return String(row?.smtp_password || "");
}

function mailboxLimit(m: any) {
  const hard = Math.max(1, Number(m.daily_limit || 30));
  if (m.ramp_enabled === false) return hard;
  const target = Math.max(1, Math.min(hard, Number(m.ramp_target_limit || hard)));
  const start = Math.max(1, Math.min(target, Number(m.ramp_start_limit || 10)));
  const inc = Math.max(0, Number(m.ramp_increment_per_day || 5));
  const started = m.ramp_started_at ? new Date(m.ramp_started_at).getTime() : Date.now();
  return Math.max(1, Math.min(target, start + Math.max(0, Math.floor((Date.now() - started) / 86400000)) * inc));
}

async function chooseMailbox(db: DB, userId: string, tz: string) {
  const { data } = await db
    .from("energy_mailboxes")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "ready")
    .order("sent_today", { ascending: true });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  for (const m of data || []) {
    const used = m.sent_today_on === today ? Number(m.sent_today || 0) : 0;
    if (used < mailboxLimit(m)) return { mailbox: m, today, used };
  }
  return null;
}

async function chooseVariant(db: DB, c: any, member: any, step: any) {
  if (!c.ab_testing_enabled || Number(step.step_order) !== 1) return null;
  const { data } = await db
    .from("energy_campaign_variants")
    .select("*")
    .eq("campaign_id", c.id)
    .eq("user_id", c.user_id)
    .eq("active", true)
    .order("created_at");
  if (!data?.length) return null;
  const total = data.reduce((s: number, v: any) => s + Math.max(1, Number(v.weight || 1)), 0);
  let point = Array.from(String(member.id)).reduce((s: number, x: string) => s + x.charCodeAt(0), 0) % total;
  for (const v of data) {
    point -= Math.max(1, Number(v.weight || 1));
    if (point < 0) return v;
  }
  return data[0];
}

async function verifyWebsiteCapture(db: DB, page: any) {
  const existingVerified = page?.website_capture_status === "verified" &&
    Number(page?.website_capture_width || 0) >= 1920 &&
    Number(page?.website_capture_height || 0) >= 1080 &&
    Boolean(page?.website_capture_verified_at);
  if (existingVerified) {
    return { ok: true, width: Number(page.website_capture_width), height: Number(page.website_capture_height), cached: true };
  }

  const url = String(page?.website_capture_url || "").trim();
  if (!/^https:\/\//i.test(url)) {
    const reason = "Personalisierter Website-Screenshot fehlt";
    if (page?.id) await db.from("energy_video_pages").update({ website_capture_status: "failed", website_capture_error: reason, website_capture_verified_at: null }).eq("id", page.id);
    return { ok: false, reason };
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "image/webp,image/*;q=0.9,*/*;q=0.1" },
      signal: AbortSignal.timeout(50000),
    });
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const width = Number(response.headers.get("x-capture-width") || 0);
    const height = Number(response.headers.get("x-capture-height") || 0);
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok || !contentType.startsWith("image/") || width < 1920 || height < 1080) {
      const reason = `Website-Screenshot ungültig (${response.status}, ${contentType || "kein Bild"}, ${width}x${height})`;
      await db.from("energy_video_pages").update({ website_capture_status: "failed", website_capture_error: reason.slice(0, 500), website_capture_verified_at: null, website_capture_width: width || null, website_capture_height: height || null }).eq("id", page.id);
      return { ok: false, reason };
    }
    const now = new Date().toISOString();
    await db.from("energy_video_pages").update({ website_capture_status: "verified", website_capture_error: null, website_capture_verified_at: now, website_capture_width: width, website_capture_height: height }).eq("id", page.id);
    return { ok: true, width, height, cached: false };
  } catch (error) {
    const reason = `Website-Screenshot konnte nicht erzeugt werden: ${error instanceof Error ? error.message : "unbekannter Fehler"}`.slice(0, 500);
    await db.from("energy_video_pages").update({ website_capture_status: "failed", website_capture_error: reason, website_capture_verified_at: null }).eq("id", page.id);
    return { ok: false, reason };
  }
}

async function readyVideo(db: DB, lead: any, c: any, base: string) {
  const templateKey = String(c?.lead_filter?.studio_template_key || "energiekosten").trim() || "energiekosten";
  const { data: cfg, error: ce } = await db
    .from("energy_studio_configs")
    .select("id,autosave_revision,published_revision")
    .eq("user_id", c.user_id)
    .eq("scope", "global")
    .is("lead_id", null)
    .eq("template_key", templateKey)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (ce) throw ce;
  if (!cfg?.id || Number(cfg.autosave_revision) !== Number(cfg.published_revision)) {
    return { ok: false, reason: `Golden Master ${templateKey} ist nicht veröffentlicht` };
  }

  const { data: p, error: pe } = await db
    .from("energy_video_pages")
    .select("id,slug,rendered_video_url,rendered_video_format,rendered_at,studio_revision,status,timeline_v3,website_capture_url,website_capture_status,website_capture_verified_at,website_capture_width,website_capture_height,website_capture_error,presenter_video_url")
    .eq("user_id", c.user_id)
    .eq("lead_id", lead.id)
    .eq("template_key", templateKey)
    .in("status", ["ready", "sent"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pe) throw pe;

  const revisionMatches = Boolean(p?.id && Number(p.studio_revision) === Number(cfg.autosave_revision));
  const timeline = p?.timeline_v3 as any;
  const items = Array.isArray(timeline?.tracks) ? timeline.tracks.flatMap((track: any) => Array.isArray(track?.items) ? track.items : []) : [];
  const websiteItem = items.find((item: any) => item?.type === "website");
  const presenterItem = items.find((item: any) => item?.type === "presenter");
  const noPresentationImages = templateKey !== "energiekosten" || !items.some((item: any) => item?.type === "image");
  const b2bPresenter = templateKey !== "energiekosten" || String(presenterItem?.metadata?.audience || "") === "b2b";
  const personalizedWebsite = templateKey !== "energiekosten" || Boolean(websiteItem?.sourceUrl && p?.website_capture_url && String(websiteItem.sourceUrl) === String(p.website_capture_url));

  const liveReady = Boolean(
    revisionMatches &&
      timeline &&
      Number(timeline.version) === 3 &&
      Array.isArray(timeline.tracks) &&
      noPresentationImages &&
      b2bPresenter &&
      personalizedWebsite,
  );
  const mp4Ready = Boolean(
    revisionMatches &&
      p?.rendered_video_url &&
      String(p.rendered_video_format || "").toLowerCase() === "mp4" &&
      p.rendered_at,
  );

  if (!liveReady && !mp4Ready) {
    return { ok: false, reason: `Personalisierte Live-Timeline oder finales MP4 für ${lead.company_name || lead.id} fehlt oder ist veraltet` };
  }

  let capture: any = { ok: true, width: null, height: null, cached: false };
  if (templateKey === "energiekosten") {
    capture = await verifyWebsiteCapture(db, p);
    if (!capture.ok) return { ok: false, reason: capture.reason || "Website-Screenshot fehlt" };
  }

  return {
    ok: true,
    pageId: p.id,
    url: `${base}/v/${p.slug}`,
    renderedUrl: mp4Ready ? p.rendered_video_url : null,
    studioRevision: Number(p.studio_revision),
    templateKey,
    deliveryMode: liveReady ? "live_timeline_v3" : "rendered_mp4",
    captureWidth: capture.width,
    captureHeight: capture.height,
  };
}

async function advance(db: DB, member: any, steps: any[]) {
  const next = steps.find((s) => Number(s.step_order) === Number(member.current_step) + 1 && s.active !== false);
  if (!next) {
    await db
      .from("energy_campaign_members")
      .update({ status: "completed", last_step_at: new Date().toISOString(), next_step_at: null, updated_at: new Date().toISOString() })
      .eq("id", member.id);
    return;
  }
  await db
    .from("energy_campaign_members")
    .update({
      current_step: next.step_order,
      last_step_at: new Date().toISOString(),
      next_step_at: scheduledIn(next.delay_hours),
      updated_at: new Date().toISOString(),
    })
    .eq("id", member.id);
}

async function processMember(db: DB, c: any, member: any, steps: any[], baseOverride: string | null) {
  const lead = member.energy_leads;
  if (!lead || lead.do_not_contact || !lead.email || lead.email_status === "invalid") {
    await db
      .from("energy_campaign_members")
      .update({
        status: "stopped",
        stopped_reason: lead?.do_not_contact ? "do_not_contact" : lead?.email_status === "invalid" ? "invalid_email" : "missing_email",
        updated_at: new Date().toISOString(),
      })
      .eq("id", member.id);
    return { sent: 0, failed: 0, manual: 0, blocked: 0 };
  }

  const step = steps.find((x) => Number(x.step_order) === Number(member.current_step));
  if (!step) {
    await db.from("energy_campaign_members").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", member.id);
    return { sent: 0, failed: 0, manual: 0, blocked: 0 };
  }
  if (step.step_type === "wait") {
    await advance(db, member, steps);
    return { sent: 0, failed: 0, manual: 0, blocked: 0 };
  }
  if (step.step_type === "manual_call") {
    await db.from("energy_followups").insert({
      user_id: c.user_id,
      lead_id: lead.id,
      campaign_id: c.id,
      title: `${lead.company_name} anrufen`,
      due_at: new Date().toISOString(),
      priority: Number(lead.intent_score || 0) >= 70 ? "hot" : "high",
      reason: lead.next_action || "Kampagnen-Schritt",
    });
    await db.from("energy_activities").insert({
      user_id: c.user_id,
      lead_id: lead.id,
      campaign_id: c.id,
      activity_type: "call_task",
      title: "Call-Aufgabe erstellt",
    });
    await advance(db, member, steps);
    return { sent: 0, failed: 0, manual: 1, blocked: 0 };
  }

  const base = String(c.tracking_base_url || baseOverride || "").replace(/\/$/, "");
  if (!/^https:\/\//i.test(base)) return { sent: 0, failed: 1, manual: 0, blocked: 0 };

  const needsVideo = Boolean(c.include_video || step.include_video || step.step_type === "video_email");
  const video = needsVideo ? await readyVideo(db, lead, c, base) : null;
  if (needsVideo && !video?.ok) {
    await db.from("energy_activities").insert({
      user_id: c.user_id,
      lead_id: lead.id,
      campaign_id: c.id,
      activity_type: "send_blocked",
      title: "Video-Mail blockiert",
      detail: String(video?.reason || "Video fehlt"),
      metadata: { step_order: step.step_order },
    });
    return { sent: 0, failed: 0, manual: 0, blocked: 1 };
  }

  if (video?.pageId) {
    await db.from("energy_campaign_members").update({ video_page_id: video.pageId, updated_at: new Date().toISOString() }).eq("id", member.id);
  }

  const variant = await chooseVariant(db, c, member, step);
  const subject = personalize(
    variant?.subject_template || step.subject_template || c.subject_template || "Kurze Energieanalyse zu {{company}}",
    lead,
    video?.url || "",
  );
  const text = personalize(variant?.body_template || step.body_template || c.body_template || "", lead, video?.url || "");
  if (/\{\{[^}]+\}\}/.test(subject + "\n" + text) || /daten anreichern|outbound priorisieren/i.test(text)) {
    return { sent: 0, failed: 0, manual: 0, blocked: 1 };
  }

  const { data: prior } = await db
    .from("energy_messages")
    .select("*")
    .eq("campaign_member_id", member.id)
    .eq("step_order", step.step_order)
    .eq("direction", "outbound")
    .maybeSingle();
  if (prior && ["sent", "delivered", "opened", "clicked", "replied"].includes(prior.status)) {
    await advance(db, member, steps);
    return { sent: 0, failed: 0, manual: 0, blocked: 0 };
  }

  const selection = await chooseMailbox(db, c.user_id, c.timezone || "Europe/Berlin");
  if (!selection) return { sent: 0, failed: 0, manual: 0, blocked: 1 };
  const { mailbox, today, used } = selection;
  const password = await smtpPassword(db, mailbox, c.user_id);
  if (!password || !mailbox.smtp_host || !mailbox.smtp_username) {
    await db
      .from("energy_mailboxes")
      .update({ status: "error", last_error: "SMTP-Konfiguration unvollständig", updated_at: new Date().toISOString() })
      .eq("id", mailbox.id);
    return { sent: 0, failed: 1, manual: 0, blocked: 0 };
  }

  let message = prior;
  if (!message) {
    const ins = await db
      .from("energy_messages")
      .insert({
        user_id: c.user_id,
        lead_id: lead.id,
        campaign_id: c.id,
        campaign_member_id: member.id,
        mailbox_id: mailbox.id,
        step_order: step.step_order,
        direction: "outbound",
        status: "queued",
        to_email: lead.email,
        from_email: mailbox.email_address,
        subject,
        body_text: text,
        scheduled_at: new Date().toISOString(),
        metadata: {
          video_url: video?.url || "",
          rendered_video_url: video?.renderedUrl || null,
          video_delivery_mode: video?.deliveryMode || null,
          studio_revision: video?.studioRevision || null,
          template_key: video?.templateKey || null,
          website_capture_width: video?.captureWidth || null,
          website_capture_height: video?.captureHeight || null,
          variant_id: variant?.id || null,
          variant_name: variant?.name || null,
        },
      })
      .select("*")
      .single();
    if (ins.error || !ins.data) return { sent: 0, failed: 1, manual: 0, blocked: 0 };
    message = ins.data;
  }

  const html = toHtml(text, base, message.tracking_token);
  await db
    .from("energy_messages")
    .update({ status: "sending", subject, body_text: text, body_html: html, mailbox_id: mailbox.id, updated_at: new Date().toISOString() })
    .eq("id", message.id);

  try {
    const transport = nodemailer.createTransport({
      host: mailbox.smtp_host,
      port: Number(mailbox.smtp_port) || 587,
      secure: Boolean(mailbox.smtp_secure),
      auth: { user: mailbox.smtp_username, pass: password },
      connectionTimeout: 12000,
      greetingTimeout: 12000,
      socketTimeout: 20000,
    });
    const unsub = `${base}/u/${message.tracking_token}`;
    const info = await transport.sendMail({
      from: mailbox.from_name ? `"${String(mailbox.from_name).replace(/\"/g, "")}" <${mailbox.email_address}>` : mailbox.email_address,
      to: lead.email,
      replyTo: mailbox.reply_to || mailbox.email_address,
      subject,
      text,
      html,
      headers: {
        "X-Walkenhorst-Lead": lead.id,
        "X-Walkenhorst-Message": message.id,
        "List-Unsubscribe": `<${unsub}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    const now = new Date().toISOString();
    await db.from("energy_messages").update({ status: "sent", provider_message_id: info.messageId || null, sent_at: now, error: null, updated_at: now }).eq("id", message.id);
    await db.from("energy_mailboxes").update({ sent_today: used + 1, sent_today_on: today, last_error: null, updated_at: now }).eq("id", mailbox.id);
    await db
      .from("energy_leads")
      .update({ status: ["new", "research", "ready"].includes(lead.status) ? "contacted" : lead.status, last_contact_at: now, updated_at: now })
      .eq("id", lead.id);
    await db.from("energy_campaign_members").update({ last_message_id: message.id, updated_at: now }).eq("id", member.id);
    await db.from("energy_activities").insert({
      user_id: c.user_id,
      lead_id: lead.id,
      campaign_id: c.id,
      activity_type: "email_sent",
      title: `E-Mail Schritt ${step.step_order} versendet`,
      detail: subject,
      metadata: {
        message_id: message.id,
        mailbox: mailbox.email_address,
        studio_revision: video?.studioRevision || null,
        video_delivery_mode: video?.deliveryMode || null,
        website_capture_width: video?.captureWidth || null,
        website_capture_height: video?.captureHeight || null,
        variant_id: variant?.id || null,
      },
    });
    if (variant?.id) await db.rpc("energy_increment_variant_metric", { p_variant_id: variant.id, p_metric: "sent" });
    await advance(db, member, steps);
    return { sent: 1, failed: 0, manual: 0, blocked: 0 };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 500) : "SMTP-Versand fehlgeschlagen";
    await db.from("energy_messages").update({ status: "failed", error: msg, updated_at: new Date().toISOString() }).eq("id", message.id);
    await db.from("energy_mailboxes").update({ last_error: msg, updated_at: new Date().toISOString() }).eq("id", mailbox.id);
    return { sent: 0, failed: 1, manual: 0, blocked: 0 };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: H });
  if (req.method !== "POST") return out({ error: "Method not allowed" }, 405);
  const db = admin();
  try {
    const a = await authorize(req, db);
    if (!a.ok) return out({ error: "Nicht autorisiert" }, 401);
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(25, Number(body?.limit) || 10));
    const baseOverride = typeof body?.baseUrl === "string" ? body.baseUrl : null;

    let q = db.from("energy_campaigns").select("*").eq("status", "active");
    if (a.userId) q = q.eq("user_id", a.userId);
    const { data: campaigns, error } = await q;
    if (error) throw error;

    const totals = { processed: 0, sent: 0, failed: 0, manual: 0, blocked: 0 };
    for (const c of campaigns || []) {
      if (totals.processed >= limit) break;
      if (!insideWindow(c)) continue;

      const since = new Date(Date.now() - 86400000).toISOString();
      const { count } = await db
        .from("energy_messages")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", c.id)
        .eq("direction", "outbound")
        .in("status", ["sent", "delivered", "opened", "clicked", "replied"])
        .gte("sent_at", since);
      if ((count || 0) >= Number(c.daily_limit || 30)) continue;

      const { data: steps } = await db
        .from("energy_campaign_steps")
        .select("*")
        .eq("campaign_id", c.id)
        .eq("active", true)
        .order("step_order");
      if (!steps?.length) continue;

      const due = new Date().toISOString();
      const { data: members, error: me } = await db
        .from("energy_campaign_members")
        .select("*,energy_leads(*)")
        .eq("campaign_id", c.id)
        .eq("status", "queued")
        .or(`next_step_at.is.null,next_step_at.lte.${due}`)
        .limit(limit - totals.processed);
      if (me) throw me;

      for (const member of members || []) {
        if (totals.processed >= limit) break;
        totals.processed++;
        const r = await processMember(db, c, member, steps, baseOverride);
        totals.sent += r.sent;
        totals.failed += r.failed;
        totals.manual += r.manual;
        totals.blocked += r.blocked;
        if (r.blocked) break;
      }
    }
    return out({ ok: true, ...totals });
  } catch (e) {
    return out({ error: e instanceof Error ? e.message.slice(0, 900) : "Worker error" }, 500);
  }
});
