import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { asWorkspaceUser } from "../_shared/workspace.ts";

const headers = {
  "content-type": "application/json",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

function envKeys() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const publishableSet = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  const secretSet = Deno.env.get("SUPABASE_SECRET_KEYS");
  const publicKey = publishableSet ? JSON.parse(publishableSet)?.default : Deno.env.get("SUPABASE_ANON_KEY");
  const secretKey = secretSet ? JSON.parse(secretSet)?.default : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !publicKey || !secretKey) throw new Error("Backend configuration missing");
  return { url, publicKey, secretKey };
}

async function userFromRequest(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return null;
  const { url, publicKey } = envKeys();
  const scoped = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await scoped.auth.getUser(token);
  if (error || !data.user) return null;
  return asWorkspaceUser(data.user);
}

function admin() {
  const { url, secretKey } = envKeys();
  return createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

type DB = ReturnType<typeof admin>;
type Audience = {
  customerType?: string;
  source?: string;
  minScore?: number;
  maxLeads?: number;
  onlyFresh?: boolean;
};
type StepInput = {
  stepType?: string;
  delayHours?: number;
  subject?: string;
  body?: string;
  includeVideo?: boolean;
};

function cleanAudience(value: any): Required<Audience> {
  return {
    customerType: ["commercial", "private"].includes(String(value?.customerType)) ? String(value.customerType) : "all",
    source: String(value?.source || "").trim(),
    minScore: Math.max(0, Math.min(100, Number(value?.minScore) || 0)),
    maxLeads: Math.max(1, Math.min(500, Number(value?.maxLeads) || 50)),
    onlyFresh: value?.onlyFresh !== false,
  };
}

function cleanSteps(value: any): StepInput[] {
  const raw = Array.isArray(value) ? value.slice(0, 10) : [];
  const allowed = new Set(["email", "video_email", "manual_call", "wait"]);
  return raw.map((step: any, index: number) => ({
    stepType: allowed.has(String(step?.stepType)) ? String(step.stepType) : index === 0 ? "video_email" : "email",
    delayHours: Math.max(0, Math.min(8760, Number(step?.delayHours) || 0)),
    subject: String(step?.subject || "").trim(),
    body: String(step?.body || "").trim(),
    includeVideo: Boolean(step?.includeVideo || step?.stepType === "video_email"),
  }));
}

function buildLeadQuery(db: DB, userId: string, audience: Required<Audience>, count = false) {
  let q: any = db
    .from("energy_leads")
    .select("id,company_name,contact_name,email,city,source,total_score,status,customer_type", count ? { count: "exact" } : undefined)
    .eq("user_id", userId)
    .not("email", "is", null)
    .neq("email", "")
    .eq("do_not_contact", false)
    .is("unsubscribed_at", null)
    .neq("email_status", "invalid")
    .gte("total_score", audience.minScore);
  if (audience.customerType !== "all") q = q.eq("customer_type", audience.customerType);
  if (audience.source) q = q.eq("source", audience.source);
  if (audience.onlyFresh) q = q.in("status", ["new", "research", "ready"]);
  return q.order("total_score", { ascending: false }).order("created_at", { ascending: false }).limit(audience.maxLeads);
}

async function previewAudience(db: DB, userId: string, input: any) {
  const audience = cleanAudience(input);
  const { data, error, count } = await buildLeadQuery(db, userId, audience, true);
  if (error) throw error;
  return { audience, matched: Number(count || 0), selected: (data || []).length, sample: (data || []).slice(0, 8) };
}

async function ownedCampaign(db: DB, id: string, userId: string) {
  const { data, error } = await db.from("energy_campaigns").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

function cleanedLeadFilter(campaign: any) {
  const filter = { ...(campaign?.lead_filter || {}) } as Record<string, unknown>;
  delete filter.mailboxes_paused_by_campaign;
  return filter;
}

async function restoreCampaignMailboxes(db: DB, campaign: any, userId: string) {
  const ids = Array.isArray(campaign?.lead_filter?.mailboxes_paused_by_campaign)
    ? campaign.lead_filter.mailboxes_paused_by_campaign.map(String).filter(Boolean)
    : [];
  if (!ids.length) return;
  const { error } = await db.from("energy_mailboxes").update({ status: "ready", updated_at: new Date().toISOString() }).eq("user_id", userId).eq("status", "paused").in("id", ids);
  if (error) throw error;
}

async function campaignSnapshot(db: DB, campaign: any) {
  const [{ data: steps }, { data: members }, { data: messages }] = await Promise.all([
    db.from("energy_campaign_steps").select("*").eq("campaign_id", campaign.id).order("step_order"),
    db.from("energy_campaign_members").select("id,status,current_step,stopped_reason,reply_status").eq("campaign_id", campaign.id),
    db.from("energy_messages").select("id,status,to_email,from_email,subject,sent_at,opened_at,clicked_at,replied_at,error,step_order,created_at,energy_leads(company_name)").eq("campaign_id", campaign.id).eq("direction", "outbound").order("created_at", { ascending: false }).limit(1000),
  ]);
  const memberRows = members || [];
  const messageRows = messages || [];
  const sent = messageRows.filter((m: any) => m.sent_at || ["sent", "delivered", "opened", "clicked", "replied"].includes(m.status)).length;
  const opened = messageRows.filter((m: any) => m.opened_at || ["opened", "clicked", "replied"].includes(m.status)).length;
  const clicked = messageRows.filter((m: any) => m.clicked_at || m.status === "clicked").length;
  const replied = messageRows.filter((m: any) => m.replied_at || m.status === "replied").length;
  const failed = messageRows.filter((m: any) => m.status === "failed").length;
  const bounced = messageRows.filter((m: any) => m.status === "bounced").length;
  return {
    ...campaign,
    steps: steps || [],
    metrics: {
      audience: memberRows.length,
      queued: memberRows.filter((m: any) => m.status === "queued").length,
      completed: memberRows.filter((m: any) => m.status === "completed").length,
      stopped: memberRows.filter((m: any) => m.status === "stopped").length,
      sent,
      opened,
      clicked,
      replied,
      failed,
      bounced,
    },
    recentMessages: messageRows.slice(0, 30),
  };
}

async function loadAll(db: DB, userId: string) {
  const [{ data: campaigns, error: campaignError }, { data: mailboxes, error: mailboxError }, { count: leadCount }] = await Promise.all([
    db.from("energy_campaigns").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    db.from("energy_mailboxes").select("id,email_address,from_name,status,daily_limit,sent_today,last_tested_at,last_error").eq("user_id", userId).order("created_at"),
    db.from("energy_leads").select("id", { count: "exact", head: true }).eq("user_id", userId).not("email", "is", null).eq("do_not_contact", false),
  ]);
  if (campaignError) throw campaignError;
  if (mailboxError) throw mailboxError;
  const detailed = await Promise.all((campaigns || []).map((campaign: any) => campaignSnapshot(db, campaign)));
  return { campaigns: detailed, mailboxes: mailboxes || [], leadCount: Number(leadCount || 0) };
}

async function createCampaign(db: DB, userId: string, body: any) {
  const name = String(body?.name || "").trim();
  if (!name) throw new Error("Kampagnenname fehlt");
  const audience = cleanAudience(body?.audience || {});
  const steps = cleanSteps(body?.steps);
  if (!steps.length) throw new Error("Mindestens ein Kampagnen-Schritt ist erforderlich");
  const trackingBaseUrl = String(body?.trackingBaseUrl || "").replace(/\/$/, "");
  if (!/^https:\/\//i.test(trackingBaseUrl)) throw new Error("Tracking-URL muss mit https:// beginnen");
  const requestedMailboxIds = Array.isArray(body?.mailboxIds) ? body.mailboxIds.map(String).filter(Boolean).slice(0, 10) : [];
  let mailboxIds: string[] = [];
  if (requestedMailboxIds.length) {
    const { data: owned, error } = await db.from("energy_mailboxes").select("id").eq("user_id", userId).in("id", requestedMailboxIds);
    if (error) throw error;
    mailboxIds = (owned || []).map((row: any) => row.id);
  }
  const subject = String(body?.subject || steps.find(step => ["email", "video_email"].includes(String(step.stepType)))?.subject || "{{firstname}}, kurze Frage zu {{company}}").trim();
  const messageBody = String(body?.body || steps.find(step => ["email", "video_email"].includes(String(step.stepType)))?.body || "Guten Tag {{firstname}},\n\nich habe mir {{company}} angesehen. {{reason}}\n\n{{video_url}}\n\nPasst ein kurzer Austausch dazu?\n\nViele Grüße\nWalkenhorst Energie").trim();
  const now = new Date().toISOString();
  const { data: campaign, error: campaignError } = await db.from("energy_campaigns").insert({
    user_id: userId,
    name,
    status: "draft",
    subject_template: subject,
    body_template: messageBody,
    daily_limit: Math.max(1, Math.min(150, Number(body?.dailyLimit) || 30)),
    tracking_base_url: trackingBaseUrl,
    include_video: body?.includeVideo !== false,
    auto_personalize: body?.autoPersonalize !== false,
    reply_stops_sequence: true,
    send_window_start: String(body?.sendWindowStart || "08:30"),
    send_window_end: String(body?.sendWindowEnd || "17:30"),
    timezone: "Europe/Berlin",
    send_interval_minutes: Math.max(5, Math.min(60, Number(body?.sendIntervalMinutes) || 5)),
    mailbox_ids: mailboxIds,
    lead_filter: { ...audience, studio_template_key: String(body?.studioTemplateKey || "pv-gewerbe"), created_via: "campaign_command_center" },
    updated_at: now,
  }).select("*").single();
  if (campaignError || !campaign) throw campaignError || new Error("Kampagne konnte nicht erstellt werden");

  const stepRows = steps.map((step, index) => ({
    campaign_id: campaign.id,
    step_order: index + 1,
    step_type: step.stepType,
    delay_hours: index === 0 ? 0 : step.delayHours,
    subject_template: step.subject || null,
    body_template: step.body || null,
    include_video: Boolean(step.includeVideo),
    active: true,
  }));
  const { error: stepError } = await db.from("energy_campaign_steps").insert(stepRows);
  if (stepError) throw stepError;

  const { data: leads, error: leadError } = await buildLeadQuery(db, userId, audience, false);
  if (leadError) throw leadError;
  const members = (leads || []).map((lead: any) => ({ campaign_id: campaign.id, lead_id: lead.id, status: "queued", current_step: 1, next_step_at: null }));
  if (members.length) {
    const { error: memberError } = await db.from("energy_campaign_members").insert(members);
    if (memberError) throw memberError;
  }
  return { campaignId: campaign.id, audienceCount: members.length };
}

async function kickWorker(db: DB, baseUrl: string | null) {
  const { url } = envKeys();
  const { data: key } = await db.rpc("energy_get_system_secret", { p_name: "energy_worker_key" });
  if (!key) return { ok: false, reason: "Worker-Key fehlt" };
  try {
    const response = await fetch(`${url}/functions/v1/campaign-worker`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-key": String(key) },
      body: JSON.stringify({ limit: 1, ...(baseUrl ? { baseUrl } : {}) }),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, ...data };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Worker konnte nicht gestartet werden" };
  }
}

async function pauseCampaign(db: DB, campaign: any, userId: string) {
  await restoreCampaignMailboxes(db, campaign, userId);
  const { error } = await db.from("energy_campaigns").update({ status: "paused", next_send_at: null, lead_filter: cleanedLeadFilter(campaign), updated_at: new Date().toISOString() }).eq("id", campaign.id).eq("user_id", userId);
  if (error) throw error;
}

async function startCampaign(db: DB, userId: string, id: string, kick = true) {
  let campaign = await ownedCampaign(db, id, userId);
  if (!campaign) throw new Error("Kampagne nicht gefunden");
  const [{ count: members }, { count: steps }] = await Promise.all([
    db.from("energy_campaign_members").select("id", { count: "exact", head: true }).eq("campaign_id", id),
    db.from("energy_campaign_steps").select("id", { count: "exact", head: true }).eq("campaign_id", id).eq("active", true),
  ]);
  if (!members) throw new Error("Die Kampagne hat noch keine Empfänger");
  if (!steps) throw new Error("Die Kampagne hat noch keine Sequenz");
  if (!/^https:\/\//i.test(String(campaign.tracking_base_url || ""))) throw new Error("Tracking-URL fehlt");

  const { data: otherActive, error: activeError } = await db.from("energy_campaigns").select("*").eq("user_id", userId).eq("status", "active").neq("id", id);
  if (activeError) throw activeError;
  for (const other of otherActive || []) await pauseCampaign(db, other, userId);

  // Recover a stale mailbox lock if the campaign was interrupted without a clean pause.
  await restoreCampaignMailboxes(db, campaign, userId);
  campaign = { ...campaign, lead_filter: cleanedLeadFilter(campaign) };

  const { data: allMailboxes, error: mailboxError } = await db.from("energy_mailboxes").select("id,email_address,status").eq("user_id", userId).order("created_at");
  if (mailboxError) throw mailboxError;
  const requestedIds = Array.isArray(campaign.mailbox_ids) ? campaign.mailbox_ids.map(String) : [];
  const readyRows = (allMailboxes || []).filter((row: any) => row.status === "ready");
  const effectiveSelectedIds = requestedIds.length ? requestedIds : readyRows.map((row: any) => row.id);
  const readySelected = readyRows.filter((row: any) => effectiveSelectedIds.includes(row.id));
  if (!readySelected.length) throw new Error("Keine ausgewählte Mailbox ist versandbereit. Erst SMTP-Passwort hinterlegen und testen.");

  // campaign-worker selects from all mailboxes in status=ready. While this campaign is active,
  // only the selected ready mailboxes remain ready. On pause/switch they are restored safely.
  const pausedByCampaign = readyRows.filter((row: any) => !effectiveSelectedIds.includes(row.id)).map((row: any) => row.id);
  if (pausedByCampaign.length) {
    const { error } = await db.from("energy_mailboxes").update({ status: "paused", updated_at: new Date().toISOString() }).eq("user_id", userId).eq("status", "ready").in("id", pausedByCampaign);
    if (error) throw error;
  }

  const now = new Date().toISOString();
  const patch: any = {
    status: "active",
    completed_at: null,
    next_send_at: now,
    mailbox_ids: effectiveSelectedIds,
    lead_filter: { ...cleanedLeadFilter(campaign), mailboxes_paused_by_campaign: pausedByCampaign },
    updated_at: now,
  };
  if (!campaign.started_at) patch.started_at = now;
  const { error } = await db.from("energy_campaigns").update(patch).eq("id", id).eq("user_id", userId);
  if (error) throw error;
  const worker = kick ? await kickWorker(db, String(campaign.tracking_base_url || "")) : null;
  return { ok: true, worker };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  try {
    const user = await userFromRequest(req);
    if (!user) return reply({ error: "Nicht autorisiert" }, 401);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "load");
    const db = admin();

    if (action === "load") return reply({ ok: true, ...(await loadAll(db, user.id)) });
    if (action === "preview") return reply({ ok: true, ...(await previewAudience(db, user.id, body?.audience || {})) });
    if (action === "create") return reply({ ok: true, ...(await createCampaign(db, user.id, body)) });

    const id = String(body?.id || "");
    if (!id) return reply({ error: "Kampagnen-ID fehlt" }, 400);
    const campaign = await ownedCampaign(db, id, user.id);
    if (!campaign) return reply({ error: "Kampagne nicht gefunden" }, 404);

    if (action === "start" || action === "resume") return reply(await startCampaign(db, user.id, id, true));
    if (action === "run") {
      if (campaign.status !== "active") return reply({ error: "Kampagne ist nicht aktiv" }, 409);
      return reply({ ok: true, worker: await kickWorker(db, String(campaign.tracking_base_url || "")) });
    }
    if (action === "pause") {
      await pauseCampaign(db, campaign, user.id);
      return reply({ ok: true });
    }
    if (action === "delete") {
      if (campaign.status === "active") return reply({ error: "Aktive Kampagne zuerst pausieren" }, 409);
      await restoreCampaignMailboxes(db, campaign, user.id);
      const { error } = await db.from("energy_campaigns").delete().eq("id", id).eq("user_id", user.id);
      if (error) throw error;
      return reply({ ok: true });
    }
    return reply({ error: "Unbekannte Aktion" }, 400);
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message.slice(0, 700) : "Interner Fehler" }, 500);
  }
});