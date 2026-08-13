import { NextResponse } from "next/server";
import { studioApiClient, studioApiUser } from "@/lib/studio-api-auth";

export const runtime = "nodejs";

type ChatMessage = { role: "user" | "assistant"; content: string };
type StudioActionName = "select_lead" | "master" | "save" | "publish" | "mode";
type StudioMode = "video" | "landing" | "brand" | "versions" | "render";
type ClientAction =
  | { type: "navigate"; path: string }
  | { type: "studio"; action: StudioActionName; leadId?: string; mode?: StudioMode }
  | { type: "data_changed"; table: string; id?: string };

const LEAD_STATUSES = new Set(["new", "research", "ready", "contacted", "engaged", "qualified", "meeting", "proposal", "won", "lost", "nurture"]);
const CAMPAIGN_STATUSES = new Set(["draft", "active", "paused", "completed"]);
const MAILBOX_STATUSES = new Set(["setup", "warming", "ready", "paused", "error"]);
const FOLLOWUP_STATUSES = new Set(["open", "done", "cancelled"]);
const FOLLOWUP_PRIORITIES = new Set(["low", "normal", "high", "hot"]);
const STUDIO_ACTIONS = new Set<StudioActionName>(["select_lead", "master", "save", "publish", "mode"]);
const STUDIO_MODES = new Set<StudioMode>(["video", "landing", "brand", "versions", "render"]);

function compact<T = any>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
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

function parseArgs(raw: unknown): Record<string, any> {
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function cleanString(value: unknown, max = 2000) {
  return typeof value === "string" ? value.trim().slice(0, max) : undefined;
}

function cleanNumber(value: unknown, min: number, max: number) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.max(min, Math.min(max, number));
}

async function loadContext(client: NonNullable<ReturnType<typeof studioApiClient>>, userId: string) {
  const requests = await Promise.allSettled([
    client.from("energy_leads").select("id,company_name,contact_name,email,phone,website,city,industry,total_score,status,next_action,do_not_contact,updated_at").eq("user_id", userId).order("total_score", { ascending: false }).limit(80),
    client.from("energy_campaigns").select("id,name,status,daily_limit,started_at,completed_at,updated_at").eq("user_id", userId).order("updated_at", { ascending: false }).limit(30),
    client.from("energy_mailboxes").select("id,email_address,from_name,status,daily_limit,sent_today,last_error,updated_at").eq("user_id", userId).order("updated_at", { ascending: false }).limit(20),
    client.from("energy_followups").select("id,lead_id,title,due_at,priority,status,reason,created_at").eq("user_id", userId).order("due_at", { ascending: true }).limit(40),
    client.from("energy_video_pages").select("id,lead_id,slug,company_name,status,is_public,updated_at").eq("user_id", userId).order("updated_at", { ascending: false }).limit(40),
  ]);

  const data = requests.map((entry) => (entry.status === "fulfilled" && !entry.value.error ? entry.value.data ?? [] : []));
  const [leads, campaigns, mailboxes, followups, videoPages] = data;
  return {
    counts: {
      leads: leads.length,
      campaigns: campaigns.length,
      mailboxes: mailboxes.length,
      openFollowups: followups.filter((row: any) => row.status === "open").length,
      videoPages: videoPages.length,
    },
    leads,
    campaigns,
    mailboxes,
    followups,
    videoPages,
  };
}

const tools = [
  {
    type: "function",
    name: "navigate",
    description: "Öffnet einen Bereich im Walkenhorst Sales OS. Nutze nur interne Pfade.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Interner Pfad, z. B. /studio, /pipeline oder /dashboard?section=leads" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "studio_action",
    description: "Steuert Studio V3: einen Lead wählen, Master öffnen, Ansicht wechseln, speichern oder den aktuell ausgewählten Lead veröffentlichen. Für select_lead immer lead_id angeben.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["select_lead", "master", "save", "publish", "mode"] },
        lead_id: { type: "string" },
        mode: { type: "string", enum: ["video", "landing", "brand", "versions", "render"] },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "update_lead",
    description: "Ändert einen Lead. Nur die angegebenen Felder werden angepasst.",
    parameters: {
      type: "object",
      properties: {
        lead_id: { type: "string" }, company_name: { type: "string" }, contact_name: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, website: { type: "string" }, city: { type: "string" }, industry: { type: "string" }, status: { type: "string" }, next_action: { type: "string" }, summary: { type: "string" }, pitch: { type: "string" }, do_not_contact: { type: "boolean" }, next_action_at: { type: "string" },
      },
      required: ["lead_id"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "update_campaign",
    description: "Ändert Name, Status oder Tageslimit einer Kampagne.",
    parameters: {
      type: "object",
      properties: { campaign_id: { type: "string" }, name: { type: "string" }, status: { type: "string" }, daily_limit: { type: "number" } },
      required: ["campaign_id"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "update_mailbox",
    description: "Ändert Status, Absendername oder Tageslimit einer Mailbox. Zugangsdaten werden niemals über den Assistenten geändert.",
    parameters: {
      type: "object",
      properties: { mailbox_id: { type: "string" }, from_name: { type: "string" }, status: { type: "string" }, daily_limit: { type: "number" } },
      required: ["mailbox_id"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "update_followup",
    description: "Ändert ein bestehendes Follow-up.",
    parameters: {
      type: "object",
      properties: { followup_id: { type: "string" }, title: { type: "string" }, due_at: { type: "string" }, priority: { type: "string" }, status: { type: "string" } },
      required: ["followup_id"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "create_followup",
    description: "Legt ein Follow-up für einen Lead an.",
    parameters: {
      type: "object",
      properties: { lead_id: { type: "string" }, title: { type: "string" }, due_at: { type: "string" }, priority: { type: "string" }, reason: { type: "string" } },
      required: ["lead_id", "title", "due_at"],
      additionalProperties: false,
    },
  },
];

async function executeTool(name: string, args: Record<string, any>, client: NonNullable<ReturnType<typeof studioApiClient>>, userId: string): Promise<{ text: string; action?: ClientAction }> {
  if (name === "navigate") {
    const path = cleanString(args.path, 300) || "/dashboard";
    if (!path.startsWith("/") || path.startsWith("//")) return { text: "Navigation abgelehnt: Es sind nur interne Pfade erlaubt." };
    return { text: `Öffne ${path}.`, action: { type: "navigate", path } };
  }

  if (name === "studio_action") {
    const action = typeof args.action === "string" && STUDIO_ACTIONS.has(args.action as StudioActionName) ? args.action as StudioActionName : null;
    if (!action) return { text: "Unbekannte Studio-Aktion." };
    const leadId = cleanString(args.lead_id, 80);
    const mode = typeof args.mode === "string" && STUDIO_MODES.has(args.mode as StudioMode) ? args.mode as StudioMode : undefined;
    if (action === "select_lead" && !leadId) return { text: "Zum Öffnen eines Leads fehlt die Lead-ID." };
    if (action === "mode" && !mode) return { text: "Zum Wechseln der Studio-Ansicht fehlt die gewünschte Ansicht." };
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
    if (typeof args.status === "string" && FOLLOWUP_STATUSES.has(args.status)) {
      patch.status = args.status;
      if (args.status === "done") patch.completed_at = new Date().toISOString();
    }
    const result = await client.from("energy_followups").update(patch).eq("id", id).eq("user_id", userId).select("id,title,status,due_at").single();
    if (result.error) return { text: `Follow-up konnte nicht geändert werden: ${result.error.message}` };
    return { text: `Follow-up „${result.data.title}“ wurde aktualisiert.`, action: { type: "data_changed", table: "energy_followups", id } };
  }

  if (name === "create_followup") {
    const leadId = cleanString(args.lead_id, 80), title = cleanString(args.title, 500), dueAt = cleanString(args.due_at, 100);
    if (!leadId || !title || !dueAt) return { text: "Für das Follow-up fehlen Lead, Titel oder Zeitpunkt." };
    const priority = typeof args.priority === "string" && FOLLOWUP_PRIORITIES.has(args.priority) ? args.priority : "normal";
    const reason = cleanString(args.reason, 1200) || null;
    const result = await client.from("energy_followups").insert({ user_id: userId, lead_id: leadId, title, due_at: dueAt, priority, reason }).select("id,title,due_at,priority").single();
    if (result.error) return { text: `Follow-up konnte nicht angelegt werden: ${result.error.message}` };
    return { text: `Follow-up „${result.data.title}“ wurde angelegt.`, action: { type: "data_changed", table: "energy_followups", id: result.data.id } };
  }

  return { text: `Aktion ${name} ist noch nicht freigeschaltet.` };
}

export async function POST(request: Request) {
  const user = await studioApiUser(request);
  const client = studioApiClient(request);
  if (!user || !client) return NextResponse.json({ error: "Nicht autorisiert." }, { status: 401 });

  const gatewayToken = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  const openAiKey = process.env.OPENAI_API_KEY;
  const useGateway = Boolean(gatewayToken);
  const token = gatewayToken || openAiKey;
  if (!token) return NextResponse.json({ error: "KI-Zugang fehlt. Auf Vercel wird VERCEL_OIDC_TOKEN automatisch genutzt; lokal AI_GATEWAY_API_KEY oder OPENAI_API_KEY setzen." }, { status: 503 });

  let body: { message?: string; path?: string; history?: ChatMessage[] } = {};
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 }); }
  const message = cleanString(body.message, 5000);
  if (!message) return NextResponse.json({ error: "Bitte eine Frage oder Anweisung eingeben." }, { status: 400 });

  const history = compact<ChatMessage>(body.history).slice(-10).filter((item): item is ChatMessage => !!item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string").map((item) => ({ role: item.role, content: item.content.slice(0, 3000) }));
  const context = await loadContext(client, user.id);
  const currentPath = cleanString(body.path, 400) || "/dashboard";

  const instructions = `Du bist der Walkenhorst KI-Assistent innerhalb des Energy Sales OS. Antworte auf Deutsch, extrem klar und handlungsorientiert. Du kennst Leads, Kampagnen, Mailboxen, Follow-ups und veröffentlichte Video-Seiten aus dem mitgelieferten Kontext. Wenn der Nutzer eine Änderung verlangt, nutze ein passendes Tool statt nur zu erklären. Für Navigation und Studio-Steuerung ebenfalls Tools nutzen. Ändere niemals Mailbox-Passwörter, API-Keys oder andere Secrets. Lösche keine Datensätze. Wenn eine Aktion mehrere Schritte braucht, führe nur Schritte aus, die mit den vorhandenen Tools sicher möglich sind, und sage knapp, was erledigt wurde. Bei unklaren riskanten Änderungen frage nach, bei normalen Änderungen handle direkt. Aktueller Bereich: ${currentPath}. Systemkontext: ${JSON.stringify(context)}.`;

  const aiResponse = await fetch(useGateway ? "https://ai-gateway.vercel.sh/v1/responses" : "https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || (useGateway ? "openai/gpt-5.4" : "gpt-5.4"),
      store: false,
      instructions,
      input: [...history, { role: "user", content: message }],
      tools,
      tool_choice: "auto",
      max_output_tokens: 1200,
    }),
  });

  const responseData = await aiResponse.json();
  if (!aiResponse.ok) return NextResponse.json({ error: responseData?.error?.message || "KI-Anfrage fehlgeschlagen." }, { status: 502 });

  const calls = compact<any>(responseData?.output).filter((item: any) => item?.type === "function_call");
  if (!calls.length) return NextResponse.json({ message: responseText(responseData) || "Ich habe dazu gerade keine verwertbare Antwort erzeugt.", actions: [] });

  const results: string[] = [];
  const actions: ClientAction[] = [];
  for (const call of calls.slice(0, 6)) {
    const executed = await executeTool(String(call.name || ""), parseArgs(call.arguments), client, user.id);
    results.push(executed.text);
    if (executed.action) actions.push(executed.action);
  }

  return NextResponse.json({ message: results.join("\n"), actions });
}
