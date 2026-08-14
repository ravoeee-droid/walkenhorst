import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { studioApiClient, studioApiUser } from "@/lib/studio-api-auth";

type ChatMessage = { role: "user" | "assistant"; content: string };
type StudioActionName = "select_lead" | "master" | "save" | "publish" | "mode";
type StudioMode = "video" | "landing" | "brand" | "versions" | "render";
export type AssistantClientAction =
  | { type: "navigate"; path: string }
  | { type: "studio"; action: StudioActionName; leadId?: string; mode?: StudioMode }
  | { type: "data_changed"; table: string; id?: string };

type ToolResult = { text: string; action?: AssistantClientAction };

const LEAD_STATUSES = new Set(["new", "research", "ready", "contacted", "engaged", "qualified", "meeting", "proposal", "won", "lost", "nurture"]);
const CAMPAIGN_STATUSES = new Set(["draft", "active", "paused", "completed"]);
const MAILBOX_STATUSES = new Set(["setup", "warming", "ready", "paused", "error"]);
const FOLLOWUP_STATUSES = new Set(["open", "done", "cancelled"]);
const FOLLOWUP_PRIORITIES = new Set(["low", "normal", "high", "hot"]);
const TEMPLATE_TYPES = new Set(["email", "video", "call"]);
const CAMPAIGN_STEP_TYPES = new Set(["email", "video_email", "manual_call", "wait"]);
const VIDEO_PAGE_STATUSES = new Set(["draft", "ready", "sent", "archived"]);
const SHADOW_STYLES = new Set(["none", "soft", "strong"]);
const STUDIO_ACTIONS = new Set<StudioActionName>(["select_lead", "master", "save", "publish", "mode"]);
const STUDIO_MODES = new Set<StudioMode>(["video", "landing", "brand", "versions", "render"]);

function compact<T = any>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function cleanString(value: unknown, max = 2000) {
  return typeof value === "string" ? value.trim().slice(0, max) : undefined;
}

function cleanNumber(value: unknown, min: number, max: number) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.max(min, Math.min(max, number));
}

function cleanColor(value: unknown) {
  const color = cleanString(value, 20);
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : undefined;
}

function cleanStringArray(value: unknown, maxItems = 10, maxLength = 500) {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, maxItems).map((item) => cleanString(item, maxLength)).filter((item): item is string => Boolean(item));
}

function parseArgs(raw: unknown): Record<string, any> {
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function responseText(response: any) {
  const chunks: string[] = [];
  for (const item of compact<any>(response?.output)) {
    if (item?.type !== "message") continue;
    for (const content of compact<any>(item?.content)) {
      if (content?.type === "output_text" && typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

async function ownedCampaign(client: SupabaseClient, userId: string, campaignId: string) {
  const result = await client.from("energy_campaigns").select("id,name").eq("id", campaignId).eq("user_id", userId).maybeSingle();
  return result.error ? null : result.data;
}

async function ownedLead(client: SupabaseClient, userId: string, leadId: string) {
  const result = await client.from("energy_leads").select("id,company_name").eq("id", leadId).eq("user_id", userId).maybeSingle();
  return result.error ? null : result.data;
}

async function loadContext(client: SupabaseClient, userId: string) {
  const requests = await Promise.allSettled([
    client.from("energy_leads").select("id,company_name,contact_name,email,phone,website,city,industry,total_score,status,next_action,do_not_contact,updated_at").eq("user_id", userId).order("total_score", { ascending: false }).limit(100),
    client.from("energy_campaigns").select("id,name,status,daily_limit,send_window_start,send_window_end,timezone,include_video,auto_personalize,reply_stops_sequence,started_at,completed_at,updated_at").eq("user_id", userId).order("updated_at", { ascending: false }).limit(50),
    client.from("energy_mailboxes").select("id,email_address,from_name,status,daily_limit,sent_today,last_error,updated_at").eq("user_id", userId).order("updated_at", { ascending: false }).limit(20),
    client.from("energy_followups").select("id,lead_id,campaign_id,title,due_at,priority,status,reason,created_at").eq("user_id", userId).order("due_at", { ascending: true }).limit(80),
    client.from("energy_video_pages").select("id,lead_id,slug,company_name,prospect_name,headline,intro_text,bullets,cta_label,cta_url,status,is_public,rendered_video_url,updated_at").eq("user_id", userId).order("updated_at", { ascending: false }).limit(60),
    client.from("energy_templates").select("id,name,template_type,subject_template,body_template,is_default,updated_at").eq("user_id", userId).order("updated_at", { ascending: false }).limit(60),
    client.from("energy_activities").select("id,lead_id,campaign_id,activity_type,title,detail,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
    client.from("energy_messages").select("id,lead_id,campaign_id,mailbox_id,direction,status,to_email,from_email,subject,scheduled_at,sent_at,opened_at,clicked_at,replied_at,error,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(60),
    client.from("energy_lead_searches").select("id,query,location,radius_km,result_count,imported_count,filters,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
    client.from("energy_campaign_steps").select("id,campaign_id,step_order,step_type,delay_hours,subject_template,body_template,include_video,active,created_at").order("campaign_id", { ascending: true }).order("step_order", { ascending: true }).limit(200),
    client.from("energy_brand_kits").select("id,name,primary_color,secondary_color,accent_color,background_color,surface_color,text_color,muted_text_color,button_text_color,font_heading,font_body,radius_px,shadow_style,default_cta_label,default_cta_url,trust_headline,trust_body,contact_name,contact_phone,contact_email,is_default,updated_at").eq("user_id", userId).order("is_default", { ascending: false }).limit(10),
  ]);

  const values = requests.map((entry) => entry.status === "fulfilled" && !entry.value.error ? entry.value.data ?? [] : []);
  const [leads, campaigns, mailboxes, followups, videoPages, templates, activities, messages, searches, campaignSteps, brandKits] = values;
  return {
    counts: {
      leads: leads.length,
      campaigns: campaigns.length,
      mailboxes: mailboxes.length,
      openFollowups: followups.filter((row: any) => row.status === "open").length,
      videoPages: videoPages.length,
      templates: templates.length,
      recentMessages: messages.length,
    },
    leads,
    campaigns,
    campaignSteps,
    mailboxes,
    followups,
    videoPages,
    templates,
    activities,
    messages,
    searches,
    brandKits,
  };
}

const TOOLS = [
  {
    type: "function",
    name: "navigate",
    description: "Öffnet einen Bereich im Walkenhorst Energy Sales OS. Nutze nur interne Pfade.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
  },
  {
    type: "function",
    name: "studio_action",
    description: "Steuert Studio V3: Lead wählen, Master öffnen, Ansicht wechseln, speichern oder den aktuell ausgewählten Lead veröffentlichen.",
    parameters: { type: "object", properties: { action: { type: "string", enum: ["select_lead", "master", "save", "publish", "mode"] }, lead_id: { type: "string" }, mode: { type: "string", enum: ["video", "landing", "brand", "versions", "render"] } }, required: ["action"], additionalProperties: false },
  },
  {
    type: "function",
    name: "update_lead",
    description: "Ändert einen bestehenden Lead. Nur angegebene Felder werden angepasst.",
    parameters: { type: "object", properties: { lead_id: { type: "string" }, company_name: { type: "string" }, contact_name: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, website: { type: "string" }, city: { type: "string" }, industry: { type: "string" }, status: { type: "string" }, next_action: { type: "string" }, summary: { type: "string" }, pitch: { type: "string" }, do_not_contact: { type: "boolean" }, next_action_at: { type: "string" } }, required: ["lead_id"], additionalProperties: false },
  },
  {
    type: "function",
    name: "update_campaign",
    description: "Ändert eine Kampagne: Name, Status, Tageslimit, Versandfenster oder Automationsschalter.",
    parameters: { type: "object", properties: { campaign_id: { type: "string" }, name: { type: "string" }, status: { type: "string" }, daily_limit: { type: "number" }, send_window_start: { type: "string" }, send_window_end: { type: "string" }, timezone: { type: "string" }, include_video: { type: "boolean" }, auto_personalize: { type: "boolean" }, reply_stops_sequence: { type: "boolean" } }, required: ["campaign_id"], additionalProperties: false },
  },
  {
    type: "function",
    name: "update_mailbox",
    description: "Ändert Status, Absendername oder Tageslimit einer Mailbox. Passwörter, Secrets und Server-Zugangsdaten sind absichtlich nicht zugänglich.",
    parameters: { type: "object", properties: { mailbox_id: { type: "string" }, from_name: { type: "string" }, status: { type: "string" }, daily_limit: { type: "number" } }, required: ["mailbox_id"], additionalProperties: false },
  },
  {
    type: "function",
    name: "update_followup",
    description: "Ändert ein bestehendes Follow-up.",
    parameters: { type: "object", properties: { followup_id: { type: "string" }, title: { type: "string" }, due_at: { type: "string" }, priority: { type: "string" }, status: { type: "string" } }, required: ["followup_id"], additionalProperties: false },
  },
  {
    type: "function",
    name: "create_followup",
    description: "Legt ein Follow-up für einen Lead an.",
    parameters: { type: "object", properties: { lead_id: { type: "string" }, campaign_id: { type: "string" }, title: { type: "string" }, due_at: { type: "string" }, priority: { type: "string" }, reason: { type: "string" } }, required: ["lead_id", "title", "due_at"], additionalProperties: false },
  },
  {
    type: "function",
    name: "create_template",
    description: "Erstellt eine E-Mail-, Video- oder Call-Vorlage.",
    parameters: { type: "object", properties: { name: { type: "string" }, template_type: { type: "string", enum: ["email", "video", "call"] }, subject_template: { type: "string" }, body_template: { type: "string" }, is_default: { type: "boolean" } }, required: ["name", "template_type"], additionalProperties: false },
  },
  {
    type: "function",
    name: "update_template",
    description: "Ändert eine bestehende E-Mail-, Video- oder Call-Vorlage.",
    parameters: { type: "object", properties: { template_id: { type: "string" }, name: { type: "string" }, template_type: { type: "string", enum: ["email", "video", "call"] }, subject_template: { type: "string" }, body_template: { type: "string" }, is_default: { type: "boolean" } }, required: ["template_id"], additionalProperties: false },
  },
  {
    type: "function",
    name: "create_campaign_step",
    description: "Fügt einer Kampagne einen Sequenz-Schritt hinzu.",
    parameters: { type: "object", properties: { campaign_id: { type: "string" }, step_order: { type: "number" }, step_type: { type: "string", enum: ["email", "video_email", "manual_call", "wait"] }, delay_hours: { type: "number" }, subject_template: { type: "string" }, body_template: { type: "string" }, include_video: { type: "boolean" }, active: { type: "boolean" } }, required: ["campaign_id", "step_order", "step_type"], additionalProperties: false },
  },
  {
    type: "function",
    name: "update_campaign_step",
    description: "Ändert einen vorhandenen Sequenz-Schritt einer Kampagne.",
    parameters: { type: "object", properties: { step_id: { type: "string" }, step_order: { type: "number" }, step_type: { type: "string", enum: ["email", "video_email", "manual_call", "wait"] }, delay_hours: { type: "number" }, subject_template: { type: "string" }, body_template: { type: "string" }, include_video: { type: "boolean" }, active: { type: "boolean" } }, required: ["step_id"], additionalProperties: false },
  },
  {
    type: "function",
    name: "update_video_page",
    description: "Ändert sichere Inhalte einer personalisierten Video-/Landingpage: Texte, CTA, Status und Sichtbarkeit. Slug, Tracking und technische Studio-Daten bleiben geschützt.",
    parameters: { type: "object", properties: { page_id: { type: "string" }, headline: { type: "string" }, intro_text: { type: "string" }, bullets: { type: "array", items: { type: "string" } }, cta_label: { type: "string" }, cta_url: { type: "string" }, status: { type: "string", enum: ["draft", "ready", "sent", "archived"] }, is_public: { type: "boolean" } }, required: ["page_id"], additionalProperties: false },
  },
  {
    type: "function",
    name: "create_activity",
    description: "Schreibt eine nachvollziehbare CRM-Aktivität oder Notiz zu Lead/Kampagne.",
    parameters: { type: "object", properties: { lead_id: { type: "string" }, campaign_id: { type: "string" }, activity_type: { type: "string" }, title: { type: "string" }, detail: { type: "string" } }, required: ["activity_type", "title"], additionalProperties: false },
  },
  {
    type: "function",
    name: "update_brand_kit",
    description: "Ändert sichere Brand-Kit-Einstellungen wie Farben, Typografie, CTA und Kontakttexte. Asset-Dateien und technische Metadaten bleiben geschützt.",
    parameters: { type: "object", properties: { brand_kit_id: { type: "string" }, primary_color: { type: "string" }, secondary_color: { type: "string" }, accent_color: { type: "string" }, background_color: { type: "string" }, surface_color: { type: "string" }, text_color: { type: "string" }, muted_text_color: { type: "string" }, button_text_color: { type: "string" }, font_heading: { type: "string" }, font_body: { type: "string" }, radius_px: { type: "number" }, shadow_style: { type: "string", enum: ["none", "soft", "strong"] }, default_cta_label: { type: "string" }, default_cta_url: { type: "string" }, trust_headline: { type: "string" }, trust_body: { type: "string" }, contact_name: { type: "string" }, contact_phone: { type: "string" }, contact_email: { type: "string" } }, required: ["brand_kit_id"], additionalProperties: false },
  },
];

async function executeTool(name: string, args: Record<string, any>, client: SupabaseClient, userId: string): Promise<ToolResult> {
  if (name === "navigate") {
    const path = cleanString(args.path, 300) || "/dashboard";
    if (!path.startsWith("/") || path.startsWith("//")) return { text: "Navigation abgelehnt: Nur interne Pfade sind erlaubt." };
    return { text: `Öffne ${path}.`, action: { type: "navigate", path } };
  }

  if (name === "studio_action") {
    const action = typeof args.action === "string" && STUDIO_ACTIONS.has(args.action as StudioActionName) ? args.action as StudioActionName : null;
    if (!action) return { text: "Unbekannte Studio-Aktion." };
    const leadId = cleanString(args.lead_id, 80);
    const mode = typeof args.mode === "string" && STUDIO_MODES.has(args.mode as StudioMode) ? args.mode as StudioMode : undefined;
    if (action === "select_lead" && !leadId) return { text: "Zum Öffnen eines Leads fehlt die Lead-ID." };
    if (action === "mode" && !mode) return { text: "Zum Wechseln der Studio-Ansicht fehlt die Ansicht." };
    return { text: `Studio-Aktion „${action}“ wird ausgeführt.`, action: { type: "studio", action, leadId, mode } };
  }

  if (name === "update_lead") {
    const id = cleanString(args.lead_id, 80);
    if (!id) return { text: "Lead-ID fehlt." };
    const patch: Record<string, unknown> = {};
    for (const key of ["company_name", "contact_name", "email", "phone", "website", "city", "industry", "next_action", "summary", "pitch"] as const) {
      const value = cleanString(args[key], key === "summary" || key === "pitch" ? 5000 : 1000);
      if (value !== undefined) patch[key] = value || null;
    }
    if (typeof args.do_not_contact === "boolean") patch.do_not_contact = args.do_not_contact;
    if (typeof args.status === "string" && LEAD_STATUSES.has(args.status)) patch.status = args.status;
    if (typeof args.next_action_at === "string") patch.next_action_at = args.next_action_at;
    patch.updated_at = new Date().toISOString();
    const result = await client.from("energy_leads").update(patch).eq("id", id).eq("user_id", userId).select("id,company_name,status,next_action").single();
    if (result.error) return { text: `Lead konnte nicht geändert werden: ${result.error.message}` };
    return { text: `${result.data.company_name} wurde aktualisiert.`, action: { type: "data_changed", table: "energy_leads", id } };
  }

  if (name === "update_campaign") {
    const id = cleanString(args.campaign_id, 80);
    if (!id) return { text: "Kampagnen-ID fehlt." };
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const nameValue = cleanString(args.name, 300); if (nameValue) patch.name = nameValue;
    if (typeof args.status === "string" && CAMPAIGN_STATUSES.has(args.status)) patch.status = args.status;
    const dailyLimit = cleanNumber(args.daily_limit, 1, 150); if (dailyLimit !== undefined) patch.daily_limit = Math.round(dailyLimit);
    for (const key of ["send_window_start", "send_window_end", "timezone"] as const) { const value = cleanString(args[key], 100); if (value) patch[key] = value; }
    for (const key of ["include_video", "auto_personalize", "reply_stops_sequence"] as const) if (typeof args[key] === "boolean") patch[key] = args[key];
    const result = await client.from("energy_campaigns").update(patch).eq("id", id).eq("user_id", userId).select("id,name,status,daily_limit").single();
    if (result.error) return { text: `Kampagne konnte nicht geändert werden: ${result.error.message}` };
    return { text: `Kampagne „${result.data.name}“ wurde aktualisiert.`, action: { type: "data_changed", table: "energy_campaigns", id } };
  }

  if (name === "update_mailbox") {
    const id = cleanString(args.mailbox_id, 80);
    if (!id) return { text: "Mailbox-ID fehlt." };
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const fromName = cleanString(args.from_name, 300); if (fromName !== undefined) patch.from_name = fromName || null;
    if (typeof args.status === "string" && MAILBOX_STATUSES.has(args.status)) patch.status = args.status;
    const dailyLimit = cleanNumber(args.daily_limit, 1, 50); if (dailyLimit !== undefined) patch.daily_limit = Math.round(dailyLimit);
    const result = await client.from("energy_mailboxes").update(patch).eq("id", id).eq("user_id", userId).select("id,email_address,status,daily_limit").single();
    if (result.error) return { text: `Mailbox konnte nicht geändert werden: ${result.error.message}` };
    return { text: `${result.data.email_address} wurde aktualisiert.`, action: { type: "data_changed", table: "energy_mailboxes", id } };
  }

  if (name === "update_followup") {
    const id = cleanString(args.followup_id, 80);
    if (!id) return { text: "Follow-up-ID fehlt." };
    const patch: Record<string, unknown> = {};
    const title = cleanString(args.title, 500); if (title) patch.title = title;
    if (typeof args.due_at === "string") patch.due_at = args.due_at;
    if (typeof args.priority === "string" && FOLLOWUP_PRIORITIES.has(args.priority)) patch.priority = args.priority;
    if (typeof args.status === "string" && FOLLOWUP_STATUSES.has(args.status)) { patch.status = args.status; if (args.status === "done") patch.completed_at = new Date().toISOString(); }
    const result = await client.from("energy_followups").update(patch).eq("id", id).eq("user_id", userId).select("id,title,status,due_at").single();
    if (result.error) return { text: `Follow-up konnte nicht geändert werden: ${result.error.message}` };
    return { text: `Follow-up „${result.data.title}“ wurde aktualisiert.`, action: { type: "data_changed", table: "energy_followups", id } };
  }

  if (name === "create_followup") {
    const leadId = cleanString(args.lead_id, 80), campaignId = cleanString(args.campaign_id, 80), title = cleanString(args.title, 500), dueAt = cleanString(args.due_at, 100);
    if (!leadId || !title || !dueAt) return { text: "Für das Follow-up fehlen Lead, Titel oder Zeitpunkt." };
    if (!await ownedLead(client, userId, leadId)) return { text: "Lead nicht gefunden oder kein Zugriff." };
    if (campaignId && !await ownedCampaign(client, userId, campaignId)) return { text: "Kampagne nicht gefunden oder kein Zugriff." };
    const priority = typeof args.priority === "string" && FOLLOWUP_PRIORITIES.has(args.priority) ? args.priority : "normal";
    const reason = cleanString(args.reason, 1200) || null;
    const result = await client.from("energy_followups").insert({ user_id: userId, lead_id: leadId, campaign_id: campaignId || null, title, due_at: dueAt, priority, reason }).select("id,title,due_at,priority").single();
    if (result.error) return { text: `Follow-up konnte nicht angelegt werden: ${result.error.message}` };
    return { text: `Follow-up „${result.data.title}“ wurde angelegt.`, action: { type: "data_changed", table: "energy_followups", id: result.data.id } };
  }

  if (name === "create_template") {
    const templateName = cleanString(args.name, 300), type = cleanString(args.template_type, 30);
    if (!templateName || !type || !TEMPLATE_TYPES.has(type)) return { text: "Name oder gültiger Vorlagentyp fehlt." };
    const result = await client.from("energy_templates").insert({ user_id: userId, name: templateName, template_type: type, subject_template: cleanString(args.subject_template, 2000) || null, body_template: cleanString(args.body_template, 12000) || null, is_default: args.is_default === true }).select("id,name,template_type").single();
    if (result.error) return { text: `Vorlage konnte nicht erstellt werden: ${result.error.message}` };
    return { text: `Vorlage „${result.data.name}“ wurde erstellt.`, action: { type: "data_changed", table: "energy_templates", id: result.data.id } };
  }

  if (name === "update_template") {
    const id = cleanString(args.template_id, 80); if (!id) return { text: "Vorlagen-ID fehlt." };
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const templateName = cleanString(args.name, 300); if (templateName) patch.name = templateName;
    const type = cleanString(args.template_type, 30); if (type && TEMPLATE_TYPES.has(type)) patch.template_type = type;
    const subject = cleanString(args.subject_template, 2000); if (subject !== undefined) patch.subject_template = subject || null;
    const body = cleanString(args.body_template, 12000); if (body !== undefined) patch.body_template = body || null;
    if (typeof args.is_default === "boolean") patch.is_default = args.is_default;
    const result = await client.from("energy_templates").update(patch).eq("id", id).eq("user_id", userId).select("id,name,template_type").single();
    if (result.error) return { text: `Vorlage konnte nicht geändert werden: ${result.error.message}` };
    return { text: `Vorlage „${result.data.name}“ wurde aktualisiert.`, action: { type: "data_changed", table: "energy_templates", id } };
  }

  if (name === "create_campaign_step") {
    const campaignId = cleanString(args.campaign_id, 80), type = cleanString(args.step_type, 40), order = cleanNumber(args.step_order, 1, 20);
    if (!campaignId || !type || !CAMPAIGN_STEP_TYPES.has(type) || order === undefined) return { text: "Für den Sequenz-Schritt fehlen Kampagne, Reihenfolge oder Typ." };
    if (!await ownedCampaign(client, userId, campaignId)) return { text: "Kampagne nicht gefunden oder kein Zugriff." };
    const result = await client.from("energy_campaign_steps").insert({ campaign_id: campaignId, step_order: Math.round(order), step_type: type, delay_hours: Math.round(cleanNumber(args.delay_hours, 0, 8760) ?? 0), subject_template: cleanString(args.subject_template, 2000) || null, body_template: cleanString(args.body_template, 12000) || null, include_video: args.include_video === true, active: args.active !== false }).select("id,campaign_id,step_order,step_type").single();
    if (result.error) return { text: `Sequenz-Schritt konnte nicht erstellt werden: ${result.error.message}` };
    return { text: `Sequenz-Schritt ${result.data.step_order} wurde erstellt.`, action: { type: "data_changed", table: "energy_campaign_steps", id: result.data.id } };
  }

  if (name === "update_campaign_step") {
    const id = cleanString(args.step_id, 80); if (!id) return { text: "Schritt-ID fehlt." };
    const current = await client.from("energy_campaign_steps").select("id,campaign_id").eq("id", id).maybeSingle();
    if (current.error || !current.data || !await ownedCampaign(client, userId, current.data.campaign_id)) return { text: "Sequenz-Schritt nicht gefunden oder kein Zugriff." };
    const patch: Record<string, unknown> = {};
    const type = cleanString(args.step_type, 40); if (type && CAMPAIGN_STEP_TYPES.has(type)) patch.step_type = type;
    const order = cleanNumber(args.step_order, 1, 20); if (order !== undefined) patch.step_order = Math.round(order);
    const delay = cleanNumber(args.delay_hours, 0, 8760); if (delay !== undefined) patch.delay_hours = Math.round(delay);
    const subject = cleanString(args.subject_template, 2000); if (subject !== undefined) patch.subject_template = subject || null;
    const body = cleanString(args.body_template, 12000); if (body !== undefined) patch.body_template = body || null;
    if (typeof args.include_video === "boolean") patch.include_video = args.include_video;
    if (typeof args.active === "boolean") patch.active = args.active;
    const result = await client.from("energy_campaign_steps").update(patch).eq("id", id).select("id,step_order,step_type").single();
    if (result.error) return { text: `Sequenz-Schritt konnte nicht geändert werden: ${result.error.message}` };
    return { text: `Sequenz-Schritt ${result.data.step_order} wurde aktualisiert.`, action: { type: "data_changed", table: "energy_campaign_steps", id } };
  }

  if (name === "update_video_page") {
    const id = cleanString(args.page_id, 80); if (!id) return { text: "Seiten-ID fehlt." };
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const key of ["headline", "intro_text", "cta_label", "cta_url"] as const) { const value = cleanString(args[key], key === "intro_text" ? 5000 : 1500); if (value !== undefined) patch[key] = value || null; }
    const bullets = cleanStringArray(args.bullets, 8, 500); if (bullets !== undefined) patch.bullets = bullets;
    if (typeof args.status === "string" && VIDEO_PAGE_STATUSES.has(args.status)) patch.status = args.status;
    if (typeof args.is_public === "boolean") patch.is_public = args.is_public;
    const result = await client.from("energy_video_pages").update(patch).eq("id", id).eq("user_id", userId).select("id,company_name,slug,status,is_public").single();
    if (result.error) return { text: `Landingpage konnte nicht geändert werden: ${result.error.message}` };
    return { text: `Landingpage für ${result.data.company_name} wurde aktualisiert.`, action: { type: "data_changed", table: "energy_video_pages", id } };
  }

  if (name === "create_activity") {
    const leadId = cleanString(args.lead_id, 80), campaignId = cleanString(args.campaign_id, 80), activityType = cleanString(args.activity_type, 100), title = cleanString(args.title, 500), detail = cleanString(args.detail, 5000) || null;
    if (!activityType || !title) return { text: "Aktivitätstyp oder Titel fehlt." };
    if (leadId && !await ownedLead(client, userId, leadId)) return { text: "Lead nicht gefunden oder kein Zugriff." };
    if (campaignId && !await ownedCampaign(client, userId, campaignId)) return { text: "Kampagne nicht gefunden oder kein Zugriff." };
    const result = await client.from("energy_activities").insert({ user_id: userId, lead_id: leadId || null, campaign_id: campaignId || null, activity_type: activityType, title, detail }).select("id,title").single();
    if (result.error) return { text: `CRM-Aktivität konnte nicht angelegt werden: ${result.error.message}` };
    return { text: `CRM-Aktivität „${result.data.title}“ wurde gespeichert.`, action: { type: "data_changed", table: "energy_activities", id: result.data.id } };
  }

  if (name === "update_brand_kit") {
    const id = cleanString(args.brand_kit_id, 80); if (!id) return { text: "Brand-Kit-ID fehlt." };
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const key of ["primary_color", "secondary_color", "accent_color", "background_color", "surface_color", "text_color", "muted_text_color", "button_text_color"] as const) { const value = cleanColor(args[key]); if (value) patch[key] = value; }
    for (const key of ["font_heading", "font_body", "default_cta_label", "default_cta_url", "trust_headline", "trust_body", "contact_name", "contact_phone", "contact_email"] as const) { const value = cleanString(args[key], key === "trust_body" ? 3000 : 1000); if (value !== undefined) patch[key] = value || null; }
    const radius = cleanNumber(args.radius_px, 0, 80); if (radius !== undefined) patch.radius_px = Math.round(radius);
    if (typeof args.shadow_style === "string" && SHADOW_STYLES.has(args.shadow_style)) patch.shadow_style = args.shadow_style;
    const result = await client.from("energy_brand_kits").update(patch).eq("id", id).eq("user_id", userId).select("id,name").single();
    if (result.error) return { text: `Brand Kit konnte nicht geändert werden: ${result.error.message}` };
    return { text: `Brand Kit „${result.data.name}“ wurde aktualisiert.`, action: { type: "data_changed", table: "energy_brand_kits", id } };
  }

  return { text: `Aktion „${name}“ ist nicht freigeschaltet.` };
}

async function callModel(input: ChatMessage[], instructions: string) {
  const gatewayToken = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  const openAiKey = process.env.OPENAI_API_KEY;
  const useGateway = Boolean(gatewayToken);
  const token = gatewayToken || openAiKey;
  if (!token) throw new Error("KI-Zugang fehlt. Auf Vercel wird VERCEL_OIDC_TOKEN automatisch genutzt; lokal AI_GATEWAY_API_KEY oder OPENAI_API_KEY setzen.");

  const response = await fetch(useGateway ? "https://ai-gateway.vercel.sh/v1/responses" : "https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || (useGateway ? "openai/gpt-5.4" : "gpt-5.4"),
      store: false,
      instructions,
      input,
      tools: TOOLS,
      tool_choice: "auto",
      max_output_tokens: 1400,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "KI-Anfrage fehlgeschlagen.");
  return data;
}

export async function handleAssistantRequest(request: Request) {
  const user = await studioApiUser(request);
  const client = studioApiClient(request);
  if (!user || !client) return NextResponse.json({ error: "Nicht autorisiert." }, { status: 401 });

  let body: { message?: string; path?: string; history?: ChatMessage[] } = {};
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 }); }
  const message = cleanString(body.message, 5000);
  if (!message) return NextResponse.json({ error: "Bitte eine Frage oder Anweisung eingeben." }, { status: 400 });

  const history = compact<ChatMessage>(body.history).slice(-10).filter((item): item is ChatMessage => !!item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string").map((item) => ({ role: item.role, content: item.content.slice(0, 3000) }));
  const context = await loadContext(client, user.id);
  const currentPath = cleanString(body.path, 400) || "/dashboard";
  const instructions = `Du bist die Bedien-KI des Walkenhorst Energy Sales OS. Antworte auf Deutsch, kurz, glasklar und handlungsorientiert. Dein Ziel: Auch ein völlig unerfahrener Nutzer soll das komplette Tool sicher bedienen können. Du kennst Leads, Kampagnen, Sequenz-Schritte, Mailbox-Zustände, Follow-ups, Video-Landingpages, Vorlagen, CRM-Aktivitäten, aktuelle Nachrichten-/Reply-Signale, Lead-Suchen und Brand Kits aus dem Systemkontext. Wenn der Nutzer etwas ändern will, verwende ein passendes Tool statt nur zu erklären. Wenn er fragt, was er tun soll, priorisiere konkrete nächste Aktionen nach Score, Replies, Follow-ups, Fehlern und Kampagnenstatus. Du darfst niemals Secrets, SMTP-/IMAP-Passwörter, API-Keys oder Vault-Daten lesen oder ändern. Du darfst keine Datensätze löschen und keine bereits versendeten Nachrichten manipulieren. Bei normalen reversiblen Änderungen handle direkt; bei riskanten oder mehrdeutigen Änderungen erkläre kurz, was fehlt. Aktueller Bereich: ${currentPath}. Systemkontext: ${JSON.stringify(context)}.`;

  try {
    const aiResponse = await callModel([...history, { role: "user", content: message }], instructions);
    const calls = compact<any>(aiResponse?.output).filter((item: any) => item?.type === "function_call");
    if (!calls.length) return NextResponse.json({ message: responseText(aiResponse) || "Ich habe dazu gerade keine verwertbare Antwort erzeugt.", actions: [] });

    const results: string[] = [];
    const actions: AssistantClientAction[] = [];
    for (const call of calls.slice(0, 8)) {
      const result = await executeTool(String(call.name || ""), parseArgs(call.arguments), client, user.id);
      results.push(result.text);
      if (result.action) actions.push(result.action);
    }
    return NextResponse.json({ message: results.join("\n"), actions });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Der KI-Assistent ist gerade nicht erreichbar." }, { status: 502 });
  }
}
