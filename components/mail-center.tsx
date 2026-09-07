"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAppUser } from "@/components/app-user-context";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import styles from "./mail-center.module.css";

type Tab = "inbox" | "outbox";
type Period = "7" | "30" | "90" | "all";
type StatusFilter = "all" | "sent" | "opened" | "clicked" | "replied" | "problem";

type Lead = {
  id: string;
  company_name: string | null;
  contact_name: string | null;
  contact_title: string | null;
  email: string | null;
  customer_type: string | null;
  status: string | null;
};

type Mailbox = {
  id: string;
  email_address: string;
  from_name: string | null;
  status: string;
  last_sync_at: string | null;
  last_error: string | null;
};

type Campaign = { id: string; name: string };
type MailEvent = { id: number; event_type: string; url: string | null; created_at: string };
type VideoEvent = { id: number; event_type: string; watch_percent: number | null; watch_seconds: number | null; created_at: string };

type Message = {
  id: string;
  lead_id: string | null;
  campaign_id: string | null;
  mailbox_id: string | null;
  direction: "inbound" | "outbound";
  status: string;
  to_email: string | null;
  from_email: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  provider_message_id: string | null;
  tracking_token: string | null;
  sent_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  replied_at: string | null;
  error: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
  step_order: number | null;
  lead: Lead | Lead[] | null;
  mailbox: Mailbox | Mailbox[] | null;
  campaign: Campaign | Campaign[] | null;
};

type Stats = {
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  problem: number;
  inbound: number;
};

const SUCCESS = ["sent", "delivered", "opened", "clicked", "replied"];
const EMPTY_STATS: Stats = { sent: 0, opened: 0, clicked: 0, replied: 0, problem: 0, inbound: 0 };

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] || null : value;
}

function dateTime(value: string | null | undefined) {
  if (!value) return "–";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function timeOnly(value: string | null | undefined) {
  if (!value) return "–";
  return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function percent(part: number, total: number) {
  if (!total) return "0 %";
  return `${Math.round((part / total) * 100)} %`;
}

function preview(text: string | null | undefined) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 140);
}

function safeMailPreviewHtml(html: string | null | undefined) {
  if (!html) return "";
  return String(html)
    .replace(/<img\b[^>]*\/api\/t\/o\/[^>]*>/gi, "")
    .replace(/href=(['"])[^'"]*\1/gi, 'href="#"')
    .replace(/<script\b[\s\S]*?<\/script>/gi, "");
}

function messageStatus(message: Message) {
  if (message.direction === "inbound") return { label: "Empfangen", tone: "neutral" };
  if (message.status === "bounced") return { label: "Bounce", tone: "danger" };
  if (message.status === "failed") return { label: "Fehler", tone: "danger" };
  if (message.replied_at || message.status === "replied") return { label: "Geantwortet", tone: "success" };
  if (message.clicked_at || message.status === "clicked") return { label: "Geklickt", tone: "success" };
  if (message.opened_at || message.status === "opened") return { label: "Geöffnet", tone: "info" };
  if (message.status === "delivered") return { label: "Zugestellt", tone: "success" };
  if (message.status === "sent") return { label: "Versendet", tone: "neutral" };
  if (message.status === "sending") return { label: "Wird gesendet", tone: "neutral" };
  if (message.status === "queued" || message.status === "ready") return { label: "Wartet", tone: "neutral" };
  return { label: message.status || "Unbekannt", tone: "neutral" };
}

export function MailCenter() {
  const user = useAppUser();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [tab, setTab] = useState<Tab>("inbox");
  const [period, setPeriod] = useState<Period>("30");
  const [mailboxFilter, setMailboxFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<MailEvent[]>([]);
  const [videoEvents, setVideoEvents] = useState<VideoEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let active = true;

    const load = async () => {
      try {
        if (!lastLoadedAt) setLoading(true);
        setError(null);
        const since = period === "all" ? null : new Date(Date.now() - Number(period) * 86400000).toISOString();

        const applyCommon = (query: any) => {
          let next = query.eq("user_id", user.id);
          if (since) next = next.gte("created_at", since);
          if (mailboxFilter !== "all") next = next.eq("mailbox_id", mailboxFilter);
          return next;
        };

        const count = async (mutate: (query: any) => any) => {
          let query = supabase.from("energy_messages").select("id", { count: "exact", head: true });
          query = applyCommon(query);
          const result = await mutate(query);
          if (result.error) throw result.error;
          return Number(result.count || 0);
        };

        let messageQuery = supabase
          .from("energy_messages")
          .select(`
            id,lead_id,campaign_id,mailbox_id,direction,status,to_email,from_email,subject,body_text,body_html,
            provider_message_id,tracking_token,sent_at,opened_at,clicked_at,replied_at,error,metadata,created_at,step_order,
            lead:energy_leads!energy_messages_lead_id_fkey(id,company_name,contact_name,contact_title,email,customer_type,status),
            mailbox:energy_mailboxes!energy_messages_mailbox_id_fkey(id,email_address,from_name,status,last_sync_at,last_error),
            campaign:energy_campaigns!energy_messages_campaign_id_fkey(id,name)
          `)
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(800);
        if (since) messageQuery = messageQuery.gte("created_at", since);
        if (mailboxFilter !== "all") messageQuery = messageQuery.eq("mailbox_id", mailboxFilter);

        const [messageResult, mailboxResult, sent, opened, clicked, replied, bounced, failed, inbound] = await Promise.all([
          messageQuery,
          supabase.from("energy_mailboxes").select("id,email_address,from_name,status,last_sync_at,last_error").eq("user_id", user.id).order("email_address"),
          count((q) => q.eq("direction", "outbound").in("status", SUCCESS)),
          count((q) => q.eq("direction", "outbound").not("opened_at", "is", null)),
          count((q) => q.eq("direction", "outbound").not("clicked_at", "is", null)),
          count((q) => q.eq("direction", "outbound").not("replied_at", "is", null)),
          count((q) => q.eq("direction", "outbound").eq("status", "bounced")),
          count((q) => q.eq("direction", "outbound").eq("status", "failed")),
          count((q) => q.eq("direction", "inbound")),
        ]);

        if (messageResult.error) throw messageResult.error;
        if (mailboxResult.error) throw mailboxResult.error;
        if (!active) return;
        setMessages((messageResult.data || []) as unknown as Message[]);
        setMailboxes((mailboxResult.data || []) as Mailbox[]);
        setStats({ sent, opened, clicked, replied, problem: bounced + failed, inbound });
        setLastLoadedAt(new Date());
      } catch (cause) {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "E-Mail-Daten konnten nicht geladen werden.");
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [supabase, user.id, period, mailboxFilter]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return messages.filter((message) => {
      if (tab === "inbox" && message.direction !== "inbound") return false;
      if (tab === "outbox" && message.direction !== "outbound") return false;
      if (tab === "outbox" && statusFilter !== "all") {
        if (statusFilter === "sent" && !SUCCESS.includes(message.status)) return false;
        if (statusFilter === "opened" && !message.opened_at) return false;
        if (statusFilter === "clicked" && !message.clicked_at) return false;
        if (statusFilter === "replied" && !message.replied_at) return false;
        if (statusFilter === "problem" && !["bounced", "failed"].includes(message.status)) return false;
      }
      if (!needle) return true;
      const lead = one(message.lead);
      return [
        lead?.company_name,
        lead?.contact_name,
        message.from_email,
        message.to_email,
        message.subject,
        message.body_text,
      ].some((value) => String(value || "").toLowerCase().includes(needle));
    });
  }, [messages, tab, statusFilter, search]);

  useEffect(() => {
    if (!filtered.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !filtered.some((message) => message.id === selectedId)) setSelectedId(filtered[0].id);
  }, [filtered, selectedId]);

  const selected = useMemo(() => filtered.find((message) => message.id === selectedId) || null, [filtered, selectedId]);

  useEffect(() => {
    if (!supabase || !selected) {
      setEvents([]);
      setVideoEvents([]);
      return;
    }
    let active = true;
    const loadDetail = async () => {
      const [mailResult, videoResult] = await Promise.all([
        supabase.from("energy_email_events").select("id,event_type,url,created_at").eq("message_id", selected.id).order("created_at", { ascending: true }),
        selected.tracking_token
          ? supabase.from("energy_video_events").select("id,event_type,watch_percent,watch_seconds,created_at").eq("message_tracking_token", selected.tracking_token).order("created_at", { ascending: true })
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (!active) return;
      setEvents((mailResult.data || []) as MailEvent[]);
      setVideoEvents((videoResult.data || []) as VideoEvent[]);
    };
    void loadDetail();
    return () => { active = false; };
  }, [supabase, selected?.id, selected?.tracking_token]);

  const activeMailboxes = mailboxes.filter((mailbox) => mailbox.status === "ready").length;
  const latestSync = mailboxes.map((mailbox) => mailbox.last_sync_at).filter(Boolean).sort().at(-1) || null;
  const selectedLead = selected ? one(selected.lead) : null;
  const selectedMailbox = selected ? one(selected.mailbox) : null;
  const selectedCampaign = selected ? one(selected.campaign) : null;
  const opens = events.filter((event) => event.event_type === "open");
  const clicks = events.filter((event) => event.event_type === "click");
  const maxWatch = videoEvents.reduce((max, event) => Math.max(max, Number(event.watch_percent || 0)), 0);
  const attachments = Array.isArray(selected?.metadata?.attachments) ? selected?.metadata?.attachments : [];
  const recipientPreview = selected?.direction === "outbound" ? safeMailPreviewHtml(selected.body_html) : "";

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Kommunikation</p>
          <h1>E-Mail</h1>
          <p className={styles.subtitle}>Eingang, Ausgang und Interaktionen aus allen Walkenhorst-Postfächern.</p>
        </div>
        <div className={styles.health}>
          <span className={activeMailboxes === mailboxes.length && mailboxes.length ? styles.healthDotOk : styles.healthDot} />
          <div>
            <strong>{activeMailboxes}/{mailboxes.length} Postfächer aktiv</strong>
            <small>Sync alle 5 Min. · letzter Sync {timeOnly(latestSync)}</small>
          </div>
        </div>
      </header>

      <section className={styles.stats} aria-label="E-Mail Kennzahlen">
        <div className={styles.stat}><span>Erfolgreich versendet</span><strong>{stats.sent}</strong><small>{period === "all" ? "Gesamt" : `letzte ${period} Tage`}</small></div>
        <div className={styles.stat}><span>Geöffnet</span><strong>{stats.opened}</strong><small>{percent(stats.opened, stats.sent)} Open Rate</small></div>
        <div className={styles.stat}><span>Geklickt</span><strong>{stats.clicked}</strong><small>{percent(stats.clicked, stats.sent)} Klickrate</small></div>
        <div className={styles.stat}><span>Antworten</span><strong>{stats.replied}</strong><small>{percent(stats.replied, stats.sent)} Reply Rate</small></div>
        <div className={styles.stat}><span>Bounces / Fehler</span><strong>{stats.problem}</strong><small>{percent(stats.problem, stats.sent + stats.problem)} Fehlerquote</small></div>
      </section>

      <section className={styles.controls}>
        <div className={styles.tabs}>
          <button className={tab === "inbox" ? styles.tabActive : styles.tab} type="button" onClick={() => setTab("inbox")}>Eingang <span>{stats.inbound}</span></button>
          <button className={tab === "outbox" ? styles.tabActive : styles.tab} type="button" onClick={() => setTab("outbox")}>Ausgang <span>{stats.sent + stats.problem}</span></button>
        </div>
        <div className={styles.filters}>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Firma, Kontakt, E-Mail oder Betreff suchen" aria-label="E-Mails suchen" />
          {tab === "outbox" && (
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} aria-label="Status filtern">
              <option value="all">Alle Status</option>
              <option value="sent">Erfolgreich versendet</option>
              <option value="opened">Geöffnet</option>
              <option value="clicked">Geklickt</option>
              <option value="replied">Geantwortet</option>
              <option value="problem">Bounce / Fehler</option>
            </select>
          )}
          <select value={mailboxFilter} onChange={(event) => setMailboxFilter(event.target.value)} aria-label="Postfach filtern">
            <option value="all">Alle Postfächer</option>
            {mailboxes.map((mailbox) => <option key={mailbox.id} value={mailbox.id}>{mailbox.email_address}</option>)}
          </select>
          <select value={period} onChange={(event) => setPeriod(event.target.value as Period)} aria-label="Zeitraum filtern">
            <option value="7">7 Tage</option>
            <option value="30">30 Tage</option>
            <option value="90">90 Tage</option>
            <option value="all">Gesamt</option>
          </select>
        </div>
      </section>

      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.workspace}>
        <div className={styles.listPane}>
          <div className={styles.listHeader}>
            <strong>{tab === "inbox" ? "Posteingang" : "Gesendet"}</strong>
            <span>{filtered.length} angezeigt{lastLoadedAt ? ` · aktualisiert ${timeOnly(lastLoadedAt.toISOString())}` : ""}</span>
          </div>
          <div className={styles.messageList}>
            {loading && !messages.length && <div className={styles.empty}>E-Mails werden geladen …</div>}
            {!loading && !filtered.length && <div className={styles.empty}>{tab === "inbox" ? "Noch keine eingegangenen E-Mails im gewählten Zeitraum." : "Keine versendeten E-Mails für diesen Filter."}</div>}
            {filtered.map((message) => {
              const lead = one(message.lead);
              const status = messageStatus(message);
              const party = message.direction === "inbound" ? message.from_email : message.to_email;
              const title = lead?.company_name || lead?.contact_name || party || "Unbekannter Absender";
              return (
                <button key={message.id} type="button" className={selectedId === message.id ? styles.messageActive : styles.message} onClick={() => setSelectedId(message.id)}>
                  <div className={styles.messageTop}>
                    <strong>{title}</strong>
                    <time>{dateTime(message.sent_at || message.created_at)}</time>
                  </div>
                  <div className={styles.messageMeta}>{lead?.contact_name ? `${lead.contact_name} · ` : ""}{party}</div>
                  <div className={styles.subject}>{message.subject || "Ohne Betreff"}</div>
                  {message.body_text && <div className={styles.preview}>{preview(message.body_text)}</div>}
                  <div className={styles.badges}>
                    <span className={`${styles.badge} ${styles[`tone_${status.tone}`]}`}>{status.label}</span>
                    {message.direction === "outbound" && message.opened_at && <span className={styles.miniBadge}>Geöffnet</span>}
                    {message.direction === "outbound" && message.clicked_at && <span className={styles.miniBadge}>Klick</span>}
                    {message.direction === "outbound" && message.replied_at && <span className={styles.miniBadge}>Antwort</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <article className={styles.detailPane}>
          {!selected && <div className={styles.detailEmpty}>E-Mail auswählen, um Details zu sehen.</div>}
          {selected && (
            <>
              <div className={styles.detailHeader}>
                <div>
                  <div className={styles.detailKicker}>{selected.direction === "inbound" ? "Eingegangen" : "Ausgegangen"} · {dateTime(selected.sent_at || selected.created_at)}</div>
                  <h2>{selected.subject || "Ohne Betreff"}</h2>
                  <p>Von {selected.from_email || "–"} an {selected.to_email || "–"}</p>
                </div>
                <span className={`${styles.detailStatus} ${styles[`tone_${messageStatus(selected).tone}`]}`}>{messageStatus(selected).label}</span>
              </div>

              <div className={styles.contextGrid}>
                <div><span>Firma</span><strong>{selectedLead?.company_name || "Nicht zugeordnet"}</strong></div>
                <div><span>Kontakt</span><strong>{selectedLead?.contact_name || selected.from_email || selected.to_email || "–"}</strong></div>
                <div><span>Postfach</span><strong>{selectedMailbox?.email_address || selected.from_email || selected.to_email || "–"}</strong></div>
                <div><span>Kampagne</span><strong>{selectedCampaign?.name || "–"}</strong></div>
              </div>

              {selected.direction === "outbound" && (
                <div className={styles.interactions}>
                  <div><span>Versendet</span><strong>{selected.sent_at ? dateTime(selected.sent_at) : "–"}</strong></div>
                  <div><span>Öffnungen</span><strong>{Math.max(opens.length, selected.opened_at ? 1 : 0)}</strong><small>{selected.opened_at ? dateTime(selected.opened_at) : "–"}</small></div>
                  <div><span>Klicks</span><strong>{Math.max(clicks.length, selected.clicked_at ? 1 : 0)}</strong><small>{selected.clicked_at ? dateTime(selected.clicked_at) : "–"}</small></div>
                  <div><span>Video</span><strong>{maxWatch ? `${maxWatch} %` : "–"}</strong><small>{maxWatch ? "max. Watchtime" : "keine Daten"}</small></div>
                  <div><span>Antwort</span><strong>{selected.replied_at ? "Ja" : "Nein"}</strong><small>{selected.replied_at ? dateTime(selected.replied_at) : "–"}</small></div>
                </div>
              )}

              <section className={styles.bodySection}>
                <div className={styles.sectionTitle}>
                  <strong>{recipientPreview ? "Empfängeransicht" : "Mailtext"}</strong>
                  <span>{recipientPreview ? "Interne Vorschau · Klicks deaktiviert" : selected.step_order ? `Sequenz Schritt ${selected.step_order}` : ""}</span>
                </div>
                {recipientPreview ? (
                  <div className={styles.htmlPreviewWrap} aria-label="Nicht klickbare Empfängeransicht">
                    <iframe className={styles.htmlPreview} title="Empfängeransicht der E-Mail" sandbox="" srcDoc={recipientPreview} tabIndex={-1} />
                  </div>
                ) : (
                  <div className={styles.mailBody}>{selected.body_text || (selected.direction === "inbound" ? "Für ältere Eingangsmails wurde der Mailtext noch nicht gespeichert. Neue Mails werden vollständig synchronisiert." : "Kein Text gespeichert.")}</div>
                )}
              </section>

              {attachments.length > 0 && (
                <section className={styles.simpleSection}>
                  <strong>Anhänge</strong>
                  <div className={styles.attachmentList}>{attachments.map((attachment: any, index: number) => <span key={`${attachment?.filename || "Anhang"}-${index}`}>{attachment?.filename || "Anhang"}{attachment?.mimeType ? ` · ${attachment.mimeType}` : ""}</span>)}</div>
                </section>
              )}

              {selected.direction === "outbound" && clicks.some((event) => event.url) && (
                <section className={styles.simpleSection}>
                  <strong>Geklickte Links</strong>
                  <div className={styles.linkList}>{clicks.filter((event) => event.url).map((event) => <a key={event.id} href={event.url || "#"} target="_blank" rel="noreferrer">{event.url}</a>)}</div>
                </section>
              )}

              {selected.error && <div className={styles.messageError}><strong>Versandfehler</strong><span>{selected.error}</span></div>}

              <footer className={styles.detailFooter}>
                {selectedLead?.id ? <Link href={`/leads/${selectedLead.id}`}>Lead öffnen</Link> : <span>Keinem CRM-Lead zugeordnet</span>}
                <div>
                  {selected.metadata?.video_url && <a href={String(selected.metadata.video_url)} target="_blank" rel="noreferrer">Video öffnen</a>}
                  <span>Message-ID: {selected.provider_message_id || selected.id}</span>
                </div>
              </footer>
            </>
          )}
        </article>
      </section>
    </main>
  );
}
