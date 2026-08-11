"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { scoreEnergyLead, slugifyCompany, type EnergyLeadInput } from "@/lib/energy-score";

type LeadStatus = "new" | "research" | "ready" | "contacted" | "engaged" | "qualified" | "meeting" | "proposal" | "won" | "lost" | "nurture";
type Section = "overview" | "leads" | "studio" | "campaigns" | "followups" | "templates" | "audit" | "seo" | "integrations";

type Lead = EnergyLeadInput & {
  id: string;
  user_id: string;
  pv_score: number;
  energy_score: number;
  intent_score: number;
  contactability_score: number;
  total_score: number;
  summary: string | null;
  pitch: string | null;
  next_action: string | null;
  next_action_at: string | null;
  status: LeadStatus;
  created_at: string;
  updated_at: string;
};

type VideoPage = {
  id: string;
  lead_id: string;
  slug: string;
  company_name: string;
  prospect_name: string | null;
  website_url: string | null;
  presenter_video_url: string | null;
  headline: string;
  intro_text: string | null;
  cta_url: string | null;
  duration_seconds: number;
  status: "draft" | "ready" | "sent" | "archived";
  created_at: string;
};

type VideoEvent = {
  video_page_id: string;
  event_type: "view" | "play" | "progress" | "cta_click";
  watch_percent: number | null;
  created_at: string;
};

type Mailbox = {
  id: string;
  email_address: string;
  from_name: string | null;
  provider: string;
  daily_limit: number;
  status: "setup" | "warming" | "ready" | "paused" | "error";
};

type Campaign = {
  id: string;
  name: string;
  status: "draft" | "active" | "paused" | "completed";
  subject_template: string | null;
  body_template: string | null;
  daily_limit: number;
  created_at: string;
};

type AuditResult = {
  url: string;
  score: number;
  seo: number;
  conversion: number;
  trust: number;
  technical: number;
  summary: string;
  findings: Array<{ severity: string; title: string; detail: string; recommendation: string }>;
};

type KeywordIdea = { keyword: string; intent: string; opportunity: number };

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "Neu",
  research: "Research",
  ready: "Bereit",
  contacted: "Kontaktiert",
  engaged: "Interessiert",
  qualified: "Qualifiziert",
  meeting: "Termin",
  proposal: "Angebot",
  won: "Gewonnen",
  lost: "Verloren",
  nurture: "Wiedervorlage",
};

const NAV: Array<{ id: Section; label: string; icon: string }> = [
  { id: "overview", label: "Übersicht", icon: "⌂" },
  { id: "leads", label: "Leads", icon: "◉" },
  { id: "studio", label: "Studio", icon: "▶" },
  { id: "campaigns", label: "Kampagnen", icon: "↗" },
  { id: "followups", label: "Follow-ups", icon: "✓" },
  { id: "templates", label: "Vorlagen", icon: "▤" },
  { id: "audit", label: "Website Analyse", icon: "◇" },
  { id: "seo", label: "SEO Radar", icon: "⌁" },
  { id: "integrations", label: "Integrationen", icon: "⌘" },
];

const TEMPLATES = [
  {
    title: "Video-Analyse",
    type: "E-Mail",
    subject: "{{firstname}}, kurze Analyse für {{company}}",
    body: "Hallo {{firstname}},\n\nich habe mir {{company}} kurz angesehen und dabei ein paar interessante Energie-Hebel gefunden. Ich habe Ihnen dazu ein kurzes Video vorbereitet:\n\n{{video_url}}\n\nViele Grüße",
  },
  {
    title: "Follow-up nach Video",
    type: "E-Mail",
    subject: "Kurze Rückfrage zu meiner Analyse",
    body: "Hallo {{firstname}},\n\nich wollte nur kurz nachhaken, ob Sie meine Analyse bereits ansehen konnten. Wenn das Thema aktuell relevant ist, können wir die Zahlen in 15 Minuten gemeinsam konkretisieren.",
  },
  {
    title: "Call Opener",
    type: "Telefon",
    subject: "",
    body: "Guten Tag {{firstname}}, ich habe mir {{company}} kurz angesehen. Dabei ist mir beim Energie- bzw. PV-Potenzial etwas aufgefallen. Ich würde Ihnen das gern in zwei Minuten zeigen – passt es gerade kurz?",
  },
];

function text(value: FormDataEntryValue | null) {
  const result = String(value ?? "").trim();
  return result || null;
}

function num(value: FormDataEntryValue | null) {
  const result = Number(String(value ?? "").trim());
  return Number.isFinite(result) && result > 0 ? result : null;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "WH";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  } catch {
    return "—";
  }
}

function eventStats(events: VideoEvent[], videoId: string) {
  const rows = events.filter((event) => event.video_page_id === videoId);
  return {
    views: rows.filter((event) => event.event_type === "view").length,
    maxWatch: rows.reduce((max, event) => Math.max(max, event.watch_percent ?? 0), 0),
    ctaClicks: rows.filter((event) => event.event_type === "cta_click").length,
  };
}

function csvFields(line: string, delimiter: string) {
  const fields: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      fields.push(value.trim());
      value = "";
    } else {
      value += char;
    }
  }
  fields.push(value.trim());
  return fields;
}

function normalizeHeader(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function firstValue(row: Record<string, string>, aliases: string[]) {
  for (const alias of aliases) {
    const value = row[alias];
    if (value?.trim()) return value.trim();
  }
  return "";
}

function parseBoolean(value: string) {
  const normalized = value.toLowerCase().trim();
  if (["yes", "ja", "true", "1", "vorhanden"].includes(normalized)) return true;
  if (["no", "nein", "false", "0", "nicht vorhanden"].includes(normalized)) return false;
  return null;
}

export function OutboundDashboard({ user }: { user: User }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const fileInput = useRef<HTMLInputElement>(null);
  const [section, setSection] = useState<Section>("overview");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [videos, setVideos] = useState<VideoPage[]>([]);
  const [events, setEvents] = useState<VideoEvent[]>([]);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [leadModal, setLeadModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [keywords, setKeywords] = useState<KeywordIdea[]>([]);

  const selected = leads.find((lead) => lead.id === selectedId) ?? leads[0] ?? null;
  const selectedVideo = selected ? videos.find((video) => video.lead_id === selected.id && video.status !== "archived") ?? null : null;
  const filteredLeads = leads.filter((lead) => `${lead.company_name} ${lead.contact_name ?? ""} ${lead.city ?? ""} ${lead.industry ?? ""}`.toLowerCase().includes(search.toLowerCase()));

  const requireSessionUserId = useCallback(async () => {
    if (!supabase) return null;
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !data.session?.user) {
      setError("Deine Auth-Session ist nicht gültig. Bitte abmelden, E-Mail bestätigen und neu anmelden.");
      return null;
    }
    return data.session.user.id;
  }, [supabase]);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const activeId = sessionData.session?.user.id;
    if (!activeId) {
      setError("Keine aktive Supabase-Session gefunden.");
      return;
    }

    const [leadResult, videoResult, eventResult, mailboxResult, campaignResult] = await Promise.all([
      supabase.from("energy_leads").select("*").eq("user_id", activeId).order("created_at", { ascending: false }).limit(2000),
      supabase.from("energy_video_pages").select("*").eq("user_id", activeId).order("created_at", { ascending: false }).limit(2000),
      supabase.from("energy_video_events").select("video_page_id,event_type,watch_percent,created_at").order("created_at", { ascending: false }).limit(10000),
      supabase.from("energy_mailboxes").select("*").eq("user_id", activeId).order("created_at", { ascending: true }),
      supabase.from("energy_campaigns").select("*").eq("user_id", activeId).order("created_at", { ascending: false }),
    ]);

    if (leadResult.error) setError(leadResult.error.message);
    else {
      const rows = (leadResult.data ?? []) as Lead[];
      setLeads(rows);
      if (!selectedId && rows.length) setSelectedId(rows[0].id);
    }
    if (!videoResult.error) setVideos((videoResult.data ?? []) as VideoPage[]);
    if (!eventResult.error) setEvents((eventResult.data ?? []) as VideoEvent[]);
    if (!mailboxResult.error) setMailboxes((mailboxResult.data ?? []) as Mailbox[]);
    if (!campaignResult.error) setCampaigns((campaignResult.data ?? []) as Campaign[]);
  }, [selectedId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function insertLead(input: EnergyLeadInput) {
    if (!supabase || !input.company_name) return { ok: false as const };
    const activeId = await requireSessionUserId();
    if (!activeId) return { ok: false as const };
    const score = scoreEnergyLead(input);
    const { data, error: insertError } = await supabase
      .from("energy_leads")
      .insert({
        user_id: activeId,
        ...input,
        pv_score: score.pvScore,
        energy_score: score.energyScore,
        intent_score: score.intentScore,
        contactability_score: score.contactabilityScore,
        total_score: score.totalScore,
        summary: score.summary,
        pitch: score.pitch,
        next_action: score.nextAction,
        status: score.totalScore >= 75 ? "ready" : "research",
      })
      .select("*")
      .single();

    if (insertError) {
      setError(insertError.message);
      return { ok: false as const };
    }
    return { ok: true as const, data: data as Lead };
  }

  async function createLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input: EnergyLeadInput = {
      company_name: String(form.get("company_name") ?? "").trim(),
      website: text(form.get("website")),
      city: text(form.get("city")),
      industry: text(form.get("industry")),
      employees: num(form.get("employees")),
      location_count: num(form.get("location_count")) ?? 1,
      roof_area_m2: num(form.get("roof_area_m2")),
      annual_energy_kwh: num(form.get("annual_energy_kwh")),
      pv_present: form.get("pv_present") === "yes" ? true : form.get("pv_present") === "no" ? false : null,
      contact_name: text(form.get("contact_name")),
      phone: text(form.get("phone")),
      email: text(form.get("email")),
    };
    if (!input.company_name) return;
    setBusy(true);
    setError(null);
    const result = await insertLead(input);
    setBusy(false);
    if (!result.ok) return;
    setSelectedId(result.data.id);
    setLeadModal(false);
    event.currentTarget.reset();
    setMessage(`${input.company_name} wurde angelegt · Opportunity Score ${result.data.total_score}/100.`);
    await load();
  }

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const content = await file.text();
      const lines = content.split(/\r?\n/).filter((line) => line.trim());
      if (lines.length < 2) throw new Error("Die CSV enthält keine Datenzeilen.");
      const delimiter = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
      const headers = csvFields(lines[0], delimiter).map(normalizeHeader);
      let imported = 0;
      for (const line of lines.slice(1, 501)) {
        const fields = csvFields(line, delimiter);
        const row = Object.fromEntries(headers.map((header, index) => [header, fields[index] ?? ""]));
        const company = firstValue(row, ["company_name", "company", "unternehmen", "firma", "name"]);
        if (!company) continue;
        const employees = Number(firstValue(row, ["employees", "mitarbeiter"]));
        const locations = Number(firstValue(row, ["location_count", "locations", "standorte"]));
        const roof = Number(firstValue(row, ["roof_area_m2", "roof", "dachflache", "dachflaeche"]));
        const consumption = Number(firstValue(row, ["annual_energy_kwh", "energy_kwh", "verbrauch", "jahresverbrauch"]));
        const input: EnergyLeadInput = {
          company_name: company,
          website: firstValue(row, ["website", "domain", "url"]) || null,
          city: firstValue(row, ["city", "ort", "stadt"]) || null,
          industry: firstValue(row, ["industry", "branche"]) || null,
          employees: Number.isFinite(employees) && employees > 0 ? employees : null,
          location_count: Number.isFinite(locations) && locations > 0 ? locations : 1,
          roof_area_m2: Number.isFinite(roof) && roof > 0 ? roof : null,
          annual_energy_kwh: Number.isFinite(consumption) && consumption > 0 ? consumption : null,
          pv_present: parseBoolean(firstValue(row, ["pv_present", "pv", "photovoltaik"])),
          contact_name: firstValue(row, ["contact_name", "ansprechpartner", "kontakt"]) || null,
          phone: firstValue(row, ["phone", "telefon", "telephone"]) || null,
          email: firstValue(row, ["email", "e_mail", "mail"]) || null,
        };
        const result = await insertLead(input);
        if (result.ok) imported += 1;
      }
      setMessage(`${imported} Leads wurden aus der CSV importiert.`);
      await load();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "CSV-Import fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(lead: Lead, status: LeadStatus) {
    if (!supabase) return;
    const activeId = await requireSessionUserId();
    if (!activeId) return;
    setBusy(true);
    const { error: updateError } = await supabase.from("energy_leads").update({ status, updated_at: new Date().toISOString() }).eq("id", lead.id).eq("user_id", activeId);
    setBusy(false);
    if (updateError) setError(updateError.message);
    else await load();
  }

  async function createVideo(lead = selected) {
    if (!supabase || !lead) return;
    const activeId = await requireSessionUserId();
    if (!activeId) return;
    const existing = videos.find((video) => video.lead_id === lead.id && video.status !== "archived");
    if (existing) {
      setSelectedId(lead.id);
      setSection("studio");
      return;
    }
    const score = scoreEnergyLead(lead);
    setBusy(true);
    const { error: videoError } = await supabase.from("energy_video_pages").insert({
      user_id: activeId,
      lead_id: lead.id,
      slug: slugifyCompany(lead.company_name),
      company_name: lead.company_name,
      prospect_name: lead.contact_name,
      website_url: lead.website,
      headline: `Kurze Energie-Analyse für ${lead.company_name}`,
      intro_text: score.summary,
      bullets: [`${lead.pv_score}/100 PV-Potenzial`, `${lead.energy_score}/100 Energieeffizienz-Potenzial`, lead.roof_area_m2 ? `ca. ${lead.roof_area_m2} m² erfasste Dachfläche` : "Dach- und Verbrauchsdaten im Potenzialcheck konkretisieren"],
      cta_label: "Kostenlosen Potenzialcheck vereinbaren",
      cta_url: process.env.NEXT_PUBLIC_WALKENHORST_CALENDAR_URL || "https://www.walkenhorst-eko.de/",
      duration_seconds: 97,
      status: "ready",
      is_public: true,
    });
    setBusy(false);
    if (videoError) setError(videoError.message);
    else {
      setSelectedId(lead.id);
      setSection("studio");
      setMessage(`Video-Seite für ${lead.company_name} wurde erstellt.`);
      await load();
    }
  }

  async function updateVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !selectedVideo) return;
    const activeId = await requireSessionUserId();
    if (!activeId) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    const { error: updateError } = await supabase
      .from("energy_video_pages")
      .update({ presenter_video_url: text(form.get("presenter_video_url")), cta_url: text(form.get("cta_url")), updated_at: new Date().toISOString() })
      .eq("id", selectedVideo.id)
      .eq("user_id", activeId);
    setBusy(false);
    if (updateError) setError(updateError.message);
    else {
      setMessage("Video-Konfiguration gespeichert.");
      await load();
    }
  }

  async function createMailbox(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const activeId = await requireSessionUserId();
    if (!activeId) return;
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    if (!email) return;
    setBusy(true);
    const { error: mailboxError } = await supabase.from("energy_mailboxes").insert({
      user_id: activeId,
      email_address: email,
      from_name: text(form.get("from_name")),
      provider: "smtp",
      daily_limit: Math.min(30, num(form.get("daily_limit")) ?? 30),
      status: "setup",
    });
    setBusy(false);
    if (mailboxError) setError(mailboxError.message);
    else {
      event.currentTarget.reset();
      setMessage("Mailbox wurde hinzugefügt.");
      await load();
    }
  }

  async function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const activeId = await requireSessionUserId();
    if (!activeId) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    if (!name) return;
    setBusy(true);
    const { error: campaignError } = await supabase.from("energy_campaigns").insert({
      user_id: activeId,
      name,
      status: "draft",
      subject_template: text(form.get("subject")),
      body_template: text(form.get("body")),
      daily_limit: Math.min(150, num(form.get("daily_limit")) ?? 30),
    });
    setBusy(false);
    if (campaignError) setError(campaignError.message);
    else {
      event.currentTarget.reset();
      setMessage("Kampagne wurde angelegt.");
      await load();
    }
  }

  async function runAudit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setAudit(null);
    setError(null);
    const response = await fetch("/api/website-audit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: String(form.get("url") ?? "") }) });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) setError(data.error || "Website-Analyse fehlgeschlagen.");
    else setAudit(data as AuditResult);
  }

  async function runKeywords(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setKeywords([]);
    setError(null);
    const response = await fetch("/api/keyword-research", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keyword: String(form.get("keyword") ?? ""), country: "DE", language: "de" }) });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) setError(data.error || "Keyword-Recherche fehlgeschlagen.");
    else setKeywords((data.ideas ?? []) as KeywordIdea[]);
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("In die Zwischenablage kopiert.");
    } catch {
      setError("Kopieren war im Browser nicht möglich.");
    }
  }

  const enriched = leads.filter((lead) => lead.contactability_score >= 55).length;
  const contactReady = leads.filter((lead) => Boolean(lead.email || lead.phone)).length;
  const videoReady = videos.filter((video) => video.status === "ready" || video.status === "sent").length;
  const viewedVideoIds = new Set(events.filter((event) => event.event_type === "view" || event.event_type === "play" || event.event_type === "progress").map((event) => event.video_page_id));
  const viewed = videos.filter((video) => viewedVideoIds.has(video.id)).length;
  const meetings = leads.filter((lead) => ["meeting", "proposal", "won"].includes(lead.status)).length;
  const followups = leads.filter((lead) => ["contacted", "engaged", "qualified", "nurture"].includes(lead.status));
  const activeCampaign = campaigns.find((campaign) => campaign.status === "active") ?? campaigns[0] ?? null;
  const readyToSend = leads.filter((lead) => Boolean(lead.email) && videos.some((video) => video.lead_id === lead.id && ["ready", "sent"].includes(video.status))).length;
  const displayNameRaw = String(user.user_metadata?.full_name || user.email?.split("@")[0] || "Raphael");
  const displayName = displayNameRaw.charAt(0).toUpperCase() + displayNameRaw.slice(1);

  function Nav() {
    return (
      <aside className="ob-sidebar">
        <div className="ob-brand"><div className="ob-brandmark">WH</div><span>WALKENHORST</span></div>
        <nav className="ob-nav">
          {NAV.map((item) => (
            <button key={item.id} className={`ob-nav-item ${section === item.id ? "active" : ""}`} onClick={() => setSection(item.id)}>
              <span className="ob-nav-icon">{item.icon}</span><span>{item.label}</span>
              {item.id === "followups" && followups.length > 0 && <span className="ob-count">{followups.length}</span>}
              {item.id === "integrations" && mailboxes.length < 5 && <span className="ob-nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="ob-sidebar-bottom">
          <div className="ob-send-card"><div className="ob-send-title"><span className="ob-live-dot" />Manuell versandbereit</div><strong>{readyToSend} von {leads.length} Leads bereit</strong><button onClick={() => setSection("studio")}>Jetzt prüfen</button></div>
          <div className="ob-user"><div className="ob-avatar">{initials(displayName)}</div><div><strong>{displayName}</strong><button onClick={() => void supabase?.auth.signOut()}>Abmelden</button></div></div>
        </div>
      </aside>
    );
  }

  function Header({ title, kicker }: { title: string; kicker: string }) {
    return (
      <header className="ob-topbar">
        <div><div className="ob-kicker">{kicker}</div><h1>{title}</h1></div>
        <div className="ob-top-actions">
          <div className="ob-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Leads durchsuchen" /><kbd>⌘ K</kbd></div>
          <input ref={fileInput} hidden type="file" accept=".csv,text/csv" onChange={(event) => void importCsv(event)} />
          <button className="ob-btn" onClick={() => fileInput.current?.click()} disabled={busy}>Importieren</button>
          <button className="ob-btn ob-btn-primary" onClick={() => setLeadModal(true)}>＋ Neuer Lead</button>
        </div>
      </header>
    );
  }

  function LeadRows({ rows = filteredLeads, limit }: { rows?: Lead[]; limit?: number }) {
    const visible = typeof limit === "number" ? rows.slice(0, limit) : rows;
    return (
      <div className="ob-table-wrap">
        <table className="ob-table">
          <thead><tr><th>Unternehmen</th><th>Status</th><th>Opportunity</th><th>Watchtime</th><th>Aktualisiert</th><th /></tr></thead>
          <tbody>
            {visible.map((lead) => {
              const video = videos.find((item) => item.lead_id === lead.id && item.status !== "archived");
              const videoStats = video ? eventStats(events, video.id) : null;
              return (
                <tr key={lead.id} onClick={() => setSelectedId(lead.id)} className={selected?.id === lead.id ? "selected" : ""}>
                  <td><div className="ob-company"><div className="ob-company-avatar">{initials(lead.company_name)}</div><div><strong>{lead.company_name}</strong><small>{lead.contact_name || "Noch nicht ermittelt"} · {lead.website?.replace(/^https?:\/\//, "") || lead.city || "ohne Website"}</small></div></div></td>
                  <td><span className={`ob-status ob-status-${lead.status}`}>{STATUS_LABELS[lead.status]}</span></td>
                  <td><div className="ob-score-mini"><strong>{lead.total_score}</strong><span>PV {lead.pv_score} · E {lead.energy_score}</span></div></td>
                  <td>{videoStats ? <strong>{videoStats.maxWatch}%</strong> : "—"}</td>
                  <td><small>{formatDate(lead.updated_at || lead.created_at)}</small></td>
                  <td><div className="ob-row-actions">
                    <button title="Video" onClick={(event) => { event.stopPropagation(); setSelectedId(lead.id); void createVideo(lead); }}>▶</button>
                    {lead.email ? <a title="E-Mail" href={`mailto:${lead.email}`} onClick={(event) => event.stopPropagation()}>✉</a> : <button disabled>✉</button>}
                    {lead.phone ? <a title="Anrufen" href={`tel:${lead.phone}`} onClick={(event) => event.stopPropagation()}>↗</a> : <button disabled>↗</button>}
                  </div></td>
                </tr>
              );
            })}
            {visible.length === 0 && <tr><td colSpan={6}><div className="ob-empty">Noch keine passenden Leads.</div></td></tr>}
          </tbody>
        </table>
      </div>
    );
  }

  function Overview() {
    const stages = [
      { label: "Leads importiert", value: leads.length },
      { label: "Angereichert", value: enriched },
      { label: "Videos bereit", value: videoReady },
      { label: "Kontakt bereit", value: contactReady },
      { label: "Angesehen", value: viewed },
      { label: "Termin", value: meetings },
    ];
    return <>
      <Header kicker="Outbound Video Engine" title={`Guten Tag, ${displayName}.`} />
      <section className="ob-content">
        <div className="ob-kpi-grid">
          {[
            { label: "Leads gesamt", value: leads.length, note: `${followups.length} Follow-ups offen`, icon: "◉", tone: "blue" },
            { label: "Leads angereichert", value: enriched, note: leads.length ? `${Math.round((enriched / leads.length) * 100)} % der Leads` : "0 % der Leads", icon: "✦", tone: "orange" },
            { label: "Videos bereit", value: videoReady, note: leads.length ? `${Math.round((videoReady / leads.length) * 100)} % der Leads` : "0 % der Leads", icon: "▶", tone: "orange" },
            { label: "Video angesehen", value: viewed, note: videoReady ? `${Math.round((viewed / videoReady) * 100)} % View-Rate` : "0 % View-Rate", icon: "⊙", tone: "blue" },
            { label: "Termine gebucht", value: meetings, note: viewed ? `${Math.round((meetings / viewed) * 100)} % der Zuschauer` : "0 % der Zuschauer", icon: "✓", tone: "green" },
          ].map((item) => <article className="ob-kpi" key={item.label}><div className="ob-kpi-head"><span>{item.label}</span><i className={`tone-${item.tone}`}>{item.icon}</i></div><strong>{item.value}</strong><small>{item.note}</small></article>)}
        </div>

        <article className="ob-panel ob-pipeline-panel">
          <div className="ob-panel-head"><div><div className="ob-kicker">Aktive Kampagne</div><h2>{activeCampaign?.name || "Walkenhorst · Gewerbe Energie"}</h2></div><div className="ob-panel-actions"><span className="ob-manual"><i />Manueller Modus</span><button onClick={() => setSection("campaigns")}>Kampagne öffnen →</button></div></div>
          <div className="ob-pipeline">
            {stages.map((stage, index) => <div className="ob-pipeline-stage" key={stage.label}><div className={`ob-pipeline-line ${index === stages.length - 1 ? "last" : ""}`} /><div className={`ob-pipeline-node ${stage.value > 0 ? "done" : ""}`}>{stage.value > 0 ? "✓" : "0"}</div><strong>{stage.value}</strong><span>{stage.label}</span></div>)}
          </div>
        </article>

        <article className="ob-panel ob-recent">
          <div className="ob-panel-head"><div><div className="ob-kicker">Live-Aktivität</div><h2>Letzte Leads</h2></div><button className="ob-btn" onClick={() => setSection("leads")}>Alle Leads ansehen</button></div>
          <LeadRows limit={7} />
        </article>
      </section>
    </>;
  }

  function Leads() {
    return <><Header kicker="Lead Intelligence" title="Leads" /><section className="ob-content"><div className="ob-two-column"><article className="ob-panel"><div className="ob-panel-head"><div><div className="ob-kicker">Energy Radar</div><h2>{filteredLeads.length} Unternehmen</h2></div><button className="ob-btn ob-btn-primary" onClick={() => setLeadModal(true)}>＋ Neuer Lead</button></div><LeadRows /></article><aside className="ob-panel ob-detail">{selected ? <><div className="ob-detail-title"><div className="ob-company-avatar large">{initials(selected.company_name)}</div><div><h2>{selected.company_name}</h2><p>{selected.city || "Ort offen"} · {selected.industry || "Branche offen"}</p></div></div><div className="ob-score-grid"><div><span>Opportunity</span><strong>{selected.total_score}</strong></div><div><span>PV</span><strong>{selected.pv_score}</strong></div><div><span>Energie</span><strong>{selected.energy_score}</strong></div><div><span>Kontakt</span><strong>{selected.contactability_score}</strong></div></div><div className="ob-divider" /><h3>Sales Angle</h3><p className="ob-copy">{selected.summary || "Noch keine Zusammenfassung."}</p><div className="ob-script">{selected.pitch || "Noch kein Pitch."}</div><h3>Nächste Aktion</h3><p className="ob-copy">{selected.next_action || "Research vervollständigen."}</p><label className="ob-field"><span>Status</span><select value={selected.status} onChange={(event) => void updateStatus(selected, event.target.value as LeadStatus)}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><div className="ob-detail-actions"><button className="ob-btn ob-btn-primary" onClick={() => void createVideo(selected)}>▶ Fake Loom</button>{selected.phone && <a className="ob-btn" href={`tel:${selected.phone}`}>Anrufen</a>}</div></> : <div className="ob-empty">Lead auswählen</div>}</aside></div></section></>;
  }

  function Studio() {
    const stats = selectedVideo ? eventStats(events, selectedVideo.id) : null;
    const publicUrl = selectedVideo && typeof window !== "undefined" ? `${window.location.origin}/v/${selectedVideo.slug}` : "";
    return <><Header kicker="Personalized Video Engine" title="Studio" /><section className="ob-content"><div className="ob-studio-layout"><article className="ob-panel"><div className="ob-panel-head"><div><div className="ob-kicker">Lead auswählen</div><h2>Fake-Loom Studio</h2></div></div><label className="ob-field"><span>Unternehmen</span><select value={selected?.id || ""} onChange={(event) => setSelectedId(event.target.value)}><option value="">Lead auswählen</option>{leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.company_name} · {lead.total_score}/100</option>)}</select></label>{selected ? <div className="ob-studio-company"><div className="ob-company-avatar large">{initials(selected.company_name)}</div><div><strong>{selected.company_name}</strong><span>{selected.website || selected.city || "Website fehlt"}</span></div></div> : null}{!selectedVideo && selected && <button className="ob-btn ob-btn-primary ob-full" onClick={() => void createVideo(selected)} disabled={busy}>▶ Personalisierte Video-Seite erstellen</button>}{selectedVideo && <><div className="ob-video-metrics"><div><span>Views</span><strong>{stats?.views ?? 0}</strong></div><div><span>Watchtime</span><strong>{stats?.maxWatch ?? 0}%</strong></div><div><span>CTA Klicks</span><strong>{stats?.ctaClicks ?? 0}</strong></div></div><label className="ob-field"><span>Persönliche Video-URL</span><div className="ob-input-button"><input readOnly value={publicUrl} /><button type="button" onClick={() => void copy(publicUrl)}>Kopieren</button></div></label><form className="ob-form" onSubmit={updateVideo}><label className="ob-field"><span>Talking-Head Video URL</span><input name="presenter_video_url" defaultValue={selectedVideo.presenter_video_url || ""} placeholder="https://…/intro.mp4" /></label><label className="ob-field"><span>CTA / Kalender URL</span><input name="cta_url" defaultValue={selectedVideo.cta_url || ""} placeholder="https://…" /></label><button className="ob-btn ob-btn-primary" disabled={busy}>Speichern</button></form></>}</article><article className="ob-panel ob-preview-panel"><div className="ob-panel-head"><div><div className="ob-kicker">Preview</div><h2>Prospect Landingpage</h2></div>{publicUrl && <a className="ob-btn" href={publicUrl} target="_blank" rel="noreferrer">Öffnen ↗</a>}</div>{selectedVideo ? <iframe className="ob-preview" src={`/v/${selectedVideo.slug}`} title="Video Landingpage Preview" /> : <div className="ob-preview-empty"><div>▶</div><h3>Noch kein Video</h3><p>Wähle einen Lead und erstelle die personalisierte Analyse.</p></div>}</article></div></section></>;
  }

  function Campaigns() {
    return <><Header kicker="Outbound Sequences" title="Kampagnen" /><section className="ob-content"><div className="ob-two-column"><article className="ob-panel"><div className="ob-panel-head"><div><div className="ob-kicker">Campaign Manager</div><h2>Bestehende Kampagnen</h2></div></div><div className="ob-campaign-list">{campaigns.map((campaign) => <div className="ob-campaign" key={campaign.id}><div><span className={`ob-status ob-status-${campaign.status}`}>{campaign.status}</span><h3>{campaign.name}</h3><p>{campaign.subject_template || "Kein Betreff hinterlegt"}</p></div><div className="ob-campaign-limit"><strong>{campaign.daily_limit}</strong><span>/ Tag</span></div></div>)}{campaigns.length === 0 && <div className="ob-empty">Noch keine Kampagne vorhanden.</div>}</div></article><aside className="ob-panel"><div className="ob-kicker">Neue Kampagne</div><h2>Kampagne anlegen</h2><form className="ob-form" onSubmit={createCampaign}><label className="ob-field"><span>Name</span><input name="name" required placeholder="PV Gewerbe · NRW" /></label><label className="ob-field"><span>Betreff</span><input name="subject" placeholder="{{firstname}}, kurze Analyse für {{company}}" /></label><label className="ob-field"><span>E-Mail Template</span><textarea name="body" rows={8} placeholder="Hallo {{firstname}} … {{video_url}}" /></label><label className="ob-field"><span>Tageslimit</span><input name="daily_limit" type="number" min={1} max={150} defaultValue={30} /></label><button className="ob-btn ob-btn-primary" disabled={busy}>Kampagne speichern</button></form></aside></div></section></>;
  }

  function Followups() {
    return <><Header kicker="Next Best Actions" title="Follow-ups" /><section className="ob-content"><article className="ob-panel"><div className="ob-panel-head"><div><div className="ob-kicker">Heute bearbeiten</div><h2>{followups.length} offene Follow-ups</h2></div></div><div className="ob-followup-list">{followups.map((lead) => <div className="ob-followup" key={lead.id}><div className="ob-company"><div className="ob-company-avatar">{initials(lead.company_name)}</div><div><strong>{lead.company_name}</strong><small>{lead.next_action || "Nachfassen und Bedarf prüfen"}</small></div></div><span className={`ob-status ob-status-${lead.status}`}>{STATUS_LABELS[lead.status]}</span><div className="ob-followup-actions">{lead.phone && <a className="ob-btn small" href={`tel:${lead.phone}`}>Anrufen</a>}{lead.email && <a className="ob-btn small" href={`mailto:${lead.email}`}>Mail</a>}<button className="ob-btn small ob-btn-primary" onClick={() => void updateStatus(lead, "meeting")}>Termin</button></div></div>)}{followups.length === 0 && <div className="ob-empty">Keine offenen Follow-ups.</div>}</div></article></section></>;
  }

  function Templates() {
    return <><Header kicker="Messaging Library" title="Vorlagen" /><section className="ob-content"><div className="ob-template-grid">{TEMPLATES.map((template) => <article className="ob-panel ob-template" key={template.title}><div className="ob-kicker">{template.type}</div><h2>{template.title}</h2>{template.subject && <div className="ob-template-subject">{template.subject}</div>}<pre>{template.body}</pre><button className="ob-btn" onClick={() => void copy(`${template.subject ? `Betreff: ${template.subject}\n\n` : ""}${template.body}`)}>Vorlage kopieren</button></article>)}</div></section></>;
  }

  function Audit() {
    return <><Header kicker="Website Intelligence" title="Website Analyse" /><section className="ob-content"><article className="ob-panel"><div className="ob-panel-head"><div><div className="ob-kicker">High-End Audit</div><h2>Website analysieren</h2></div></div><form className="ob-inline-form" onSubmit={runAudit}><input name="url" type="url" required placeholder="https://unternehmen.de" defaultValue={selected?.website || ""} /><button className="ob-btn ob-btn-primary" disabled={busy}>Analyse starten</button></form>{audit && <div className="ob-audit"><div className="ob-audit-score"><strong>{audit.score}</strong><span>Website Score</span></div><div className="ob-audit-bars">{[["SEO", audit.seo],["Conversion", audit.conversion],["Trust", audit.trust],["Technik", audit.technical]].map(([label,value]) => <div key={String(label)}><span>{label}</span><div><i style={{ width: `${Number(value)}%` }} /></div><strong>{value}</strong></div>)}</div><div className="ob-audit-summary"><h3>Executive Summary</h3><p>{audit.summary}</p></div><div className="ob-findings">{audit.findings.map((finding, index) => <article key={`${finding.title}-${index}`}><span className={`ob-severity ${finding.severity.toLowerCase()}`}>{finding.severity}</span><div><h3>{finding.title}</h3><p>{finding.detail}</p><strong>Empfehlung: {finding.recommendation}</strong></div></article>)}</div></div>}</article></section></>;
  }

  function Seo() {
    return <><Header kicker="Search Intelligence" title="SEO Radar" /><section className="ob-content"><article className="ob-panel"><div className="ob-panel-head"><div><div className="ob-kicker">Keyword Research</div><h2>Chancen finden</h2></div></div><form className="ob-inline-form" onSubmit={runKeywords}><input name="keyword" required placeholder="z. B. Photovoltaik Gewerbe" /><button className="ob-btn ob-btn-primary" disabled={busy}>Keywords analysieren</button></form><div className="ob-keyword-grid">{keywords.map((idea) => <div className="ob-keyword" key={idea.keyword}><div><strong>{idea.keyword}</strong><span>{idea.intent}</span></div><div className="ob-keyword-score">{idea.opportunity}</div></div>)}</div>{keywords.length === 0 && <div className="ob-empty">Keyword eingeben, um Opportunity-Ideen zu erzeugen.</div>}</article></section></>;
  }

  function Integrations() {
    return <><Header kicker="Infrastructure" title="Integrationen" /><section className="ob-content"><div className="ob-integration-grid"><article className="ob-panel"><div className="ob-integration-head"><div className="ob-integration-icon">S</div><div><h2>Supabase</h2><p>CRM, Auth & Tracking</p></div><span className="ob-connected">Verbunden</span></div></article><article className="ob-panel"><div className="ob-integration-head"><div className="ob-integration-icon">V</div><div><h2>Vercel</h2><p>App & Landingpages</p></div><span className="ob-connected">Verbunden</span></div></article><article className="ob-panel"><div className="ob-integration-head"><div className="ob-integration-icon">✉</div><div><h2>Mailboxen</h2><p>{mailboxes.length}/5 vorbereitet</p></div><span className={mailboxes.length >= 5 ? "ob-connected" : "ob-setup"}>{mailboxes.length >= 5 ? "Bereit" : "Setup"}</span></div></article></div><div className="ob-two-column"><article className="ob-panel"><div className="ob-panel-head"><div><div className="ob-kicker">Sending Infrastructure</div><h2>Mailboxen</h2></div></div><div className="ob-mailbox-list">{mailboxes.map((mailbox) => <div className="ob-mailbox" key={mailbox.id}><div><strong>{mailbox.email_address}</strong><span>{mailbox.from_name || "Walkenhorst"}</span></div><span className={`ob-status ob-status-${mailbox.status}`}>{mailbox.status}</span><small>{mailbox.daily_limit}/Tag</small></div>)}{mailboxes.length === 0 && <div className="ob-empty">Noch keine Mailbox eingetragen.</div>}</div></article><aside className="ob-panel"><div className="ob-kicker">Mailbox hinzufügen</div><h2>Absender vorbereiten</h2><form className="ob-form" onSubmit={createMailbox}><label className="ob-field"><span>E-Mail</span><input name="email" type="email" required /></label><label className="ob-field"><span>Absendername</span><input name="from_name" placeholder="Walkenhorst Energie" /></label><label className="ob-field"><span>Tageslimit</span><input name="daily_limit" type="number" min={1} max={30} defaultValue={30} /></label><button className="ob-btn ob-btn-primary" disabled={busy || mailboxes.length >= 5}>Mailbox hinzufügen</button></form></aside></div></section></>;
  }

  const Screen = section === "overview" ? Overview : section === "leads" ? Leads : section === "studio" ? Studio : section === "campaigns" ? Campaigns : section === "followups" ? Followups : section === "templates" ? Templates : section === "audit" ? Audit : section === "seo" ? Seo : Integrations;

  return (
    <div className="ob-app">
      <Nav />
      <main className="ob-main">
        {error && <div className="ob-toast error"><span>{error}</span><button onClick={() => setError(null)}>×</button></div>}
        {message && <div className="ob-toast success"><span>{message}</span><button onClick={() => setMessage(null)}>×</button></div>}
        <Screen />
      </main>

      {leadModal && <div className="ob-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setLeadModal(false); }}><section className="ob-modal"><div className="ob-modal-head"><div><div className="ob-kicker">Energy Radar</div><h2>Neuer Lead</h2></div><button onClick={() => setLeadModal(false)}>×</button></div><form className="ob-form" onSubmit={createLead}><div className="ob-form-grid"><label className="ob-field"><span>Unternehmen *</span><input name="company_name" required /></label><label className="ob-field"><span>Ort</span><input name="city" /></label><label className="ob-field"><span>Website</span><input name="website" placeholder="https://…" /></label><label className="ob-field"><span>Branche</span><input name="industry" placeholder="Produktion, Logistik, Hotel …" /></label><label className="ob-field"><span>Mitarbeiter</span><input name="employees" type="number" min={1} /></label><label className="ob-field"><span>Standorte</span><input name="location_count" type="number" min={1} defaultValue={1} /></label><label className="ob-field"><span>Dachfläche m²</span><input name="roof_area_m2" type="number" min={1} /></label><label className="ob-field"><span>Verbrauch kWh/Jahr</span><input name="annual_energy_kwh" type="number" min={1} /></label><label className="ob-field"><span>PV vorhanden?</span><select name="pv_present" defaultValue="unknown"><option value="unknown">Unbekannt</option><option value="no">Nein</option><option value="yes">Ja</option></select></label><label className="ob-field"><span>Ansprechpartner</span><input name="contact_name" /></label><label className="ob-field"><span>Telefon</span><input name="phone" /></label><label className="ob-field"><span>E-Mail</span><input name="email" type="email" /></label></div><div className="ob-modal-actions"><button className="ob-btn" type="button" onClick={() => setLeadModal(false)}>Abbrechen</button><button className="ob-btn ob-btn-primary" disabled={busy}>Lead analysieren & anlegen</button></div></form></section></div>}
    </div>
  );
}
