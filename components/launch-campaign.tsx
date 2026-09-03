"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import styles from "./launch-campaign.module.css";

type Metrics = {
  audience: number;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  failed: number;
  bounced: number;
};

type VideoReadiness = {
  required?: number;
  ready?: number;
  liveReady?: number;
  mp4Ready?: number;
  pending?: number;
};

type Campaign = {
  id: string;
  name: string;
  status: "draft" | "active" | "paused" | "completed";
  created_at: string;
  metrics: Metrics;
  videoReadiness?: VideoReadiness;
};

type Mailbox = {
  id: string;
  email_address: string;
  from_name: string | null;
  status: string;
  daily_limit: number;
  sent_today: number;
  last_error: string | null;
};

type AdminLoad = {
  campaigns: Campaign[];
  mailboxes: Mailbox[];
  leadCount: number;
};

type PublishRow = {
  leadId?: string;
  slug?: string;
  url?: string;
  studioRevision?: number;
  error?: string;
};

type PublishResult = {
  ok?: boolean;
  prepared?: number;
  failed?: number;
  liveCaptures?: number;
  staticCaptures?: number;
  results?: PublishRow[];
  error?: string;
};

const SUBJECT = "Kurze Energieanalyse zu {{company}}";
const BODY = `Guten Tag,

ich habe mir {{company}} in {{city}} angesehen und Ihnen dazu ein kurzes persönliches Video aufgenommen.

Hier sind die 107 Sekunden:
{{video_url}}

Ich zeige darin direkt an Ihrem Unternehmen, welche Punkte wir bei Energiekosten und PV zuerst prüfen würden. Wenn bei Ihnen bereits alles optimal gelöst ist, können wir das Thema danach direkt abhaken.

Viele Grüße
Andreas Walkenhorst
Walkenhorst Energie`;

const FOLLOWUP_BODY = `Guten Tag,

ich wollte mein kurzes Video zu {{company}} noch einmal nach oben holen:
{{video_url}}

Falls Energie- oder PV-Potenzial aktuell kein Thema ist, ist das völlig in Ordnung. Wenn doch, reichen danach 15 Minuten für einen ersten Abgleich.

Viele Grüße
Andreas Walkenhorst`;

function pct(value: number, base: number) {
  return base ? `${Math.round((value / base) * 1000) / 10}%` : "0%";
}

function statusLabel(status: Campaign["status"]) {
  if (status === "active") return "läuft";
  if (status === "paused") return "pausiert";
  if (status === "completed") return "beendet";
  return "Entwurf";
}

function posterSlug(row: PublishRow) {
  if (row.slug) return row.slug;
  if (!row.url) return "";
  try {
    const parts = new URL(row.url, window.location.origin).pathname.split("/").filter(Boolean);
    return parts.at(-1) || "";
  } catch {
    return "";
  }
}

export function LaunchCampaign({ user: _user }: { user: User }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [leadCount, setLeadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const callAdmin = useCallback(async (body: Record<string, unknown>) => {
    if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
    const { data, error: invokeError } = await supabase.functions.invoke("campaign-admin", { body });
    if (invokeError) throw new Error(invokeError.message || "Campaign Backend nicht erreichbar.");
    if (data?.error) throw new Error(String(data.error));
    return data;
  }, [supabase]);

  const publishCampaign = useCallback(async (campaignId: string) => {
    if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
    const { data, error: invokeError } = await supabase.functions.invoke("lead-publish", {
      body: {
        action: "prepare_campaign",
        campaignId,
        baseUrl: window.location.origin,
        limit: 30,
      },
    });
    if (invokeError) throw new Error(invokeError.message || "Loom-Videos konnten nicht vorbereitet werden.");
    const result = (data || {}) as PublishResult;
    if (result.error) throw new Error(result.error);
    return result;
  }, [supabase]);

  const preparePosters = useCallback(async (rows: PublishRow[]) => {
    if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
    const usable = rows.filter((row) => row.leadId && posterSlug(row));
    if (!usable.length) throw new Error("Keine Video-Poster konnten den vorbereiteten Leads zugeordnet werden.");

    let done = 0;
    const failures: string[] = [];
    for (let index = 0; index < usable.length; index += 3) {
      const batch = usable.slice(index, index + 3);
      await Promise.all(batch.map(async (row) => {
        const slug = posterSlug(row);
        const revision = Number(row.studioRevision || 1);
        const posterUrl = `${window.location.origin}/api/public/studio-poster/${encodeURIComponent(slug)}?v=${encodeURIComponent(String(revision))}`;
        try {
          const response = await fetch(posterUrl, { method: "GET", cache: "reload" });
          const contentType = String(response.headers.get("content-type") || "").toLowerCase();
          const width = Number(response.headers.get("x-capture-width") || 0);
          const height = Number(response.headers.get("x-capture-height") || 0);
          const bytes = await response.arrayBuffer();
          if (!response.ok || !contentType.startsWith("image/") || width < 1920 || height < 1080 || bytes.byteLength < 5000) {
            throw new Error(`Poster ungültig (${response.status}, ${width}x${height}, ${bytes.byteLength} Bytes)`);
          }
          const { error: updateError } = await supabase
            .from("energy_video_pages")
            .update({ thumbnail_url: posterUrl, updated_at: new Date().toISOString() })
            .eq("lead_id", String(row.leadId))
            .eq("template_key", "energiekosten")
            .in("status", ["ready", "sent"]);
          if (updateError) throw updateError;
          done += 1;
          setProgress(`${done}/${usable.length} E-Mail-Poster geprüft und vorgeladen …`);
        } catch (cause) {
          failures.push(`${slug}: ${cause instanceof Error ? cause.message : "Poster fehlgeschlagen"}`);
        }
      }));
    }

    if (failures.length || done !== usable.length) {
      throw new Error(`Poster-Preflight gestoppt: ${done}/${usable.length} bereit${failures.length ? ` · ${failures.slice(0, 3).join(" · ")}` : ""}. Es wurde noch nichts versendet.`);
    }
    return done;
  }, [supabase]);

  const load = useCallback(async () => {
    try {
      const data = await callAdmin({ action: "load" }) as AdminLoad;
      setCampaigns(data.campaigns || []);
      setMailboxes(data.mailboxes || []);
      setLeadCount(Number(data.leadCount || 0));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Status konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [callAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const readyMailboxes = mailboxes.filter((mailbox) => mailbox.status === "ready");
  const activeCampaigns = campaigns.filter((campaign) => campaign.status === "active");
  const recentCampaigns = campaigns.slice(0, 5);
  const canLaunch = readyMailboxes.length > 0 && leadCount > 0 && !busy;

  async function launchPilot() {
    if (!readyMailboxes.length) {
      setError("Noch keine versandbereite Mailbox. Bitte zuerst unter Einstellungen SMTP testen.");
      return;
    }
    if (!leadCount) {
      setError("Noch keine Leads mit E-Mail vorhanden. Bitte zuerst Leads importieren oder finden.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    setProgress("30 passende Gewerbe-Leads werden ausgewählt …");

    try {
      const date = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" }).format(new Date());
      const created = await callAdmin({
        action: "create",
        name: `Walkenhorst Loom Pilot ${date}`,
        audience: {
          customerType: "commercial",
          source: "",
          minScore: 0,
          maxLeads: 30,
          onlyFresh: true,
        },
        dailyLimit: 30,
        sendIntervalMinutes: 7,
        sendWindowStart: "08:30",
        sendWindowEnd: "17:30",
        includeVideo: true,
        studioTemplateKey: "energiekosten",
        mailboxIds: readyMailboxes.map((mailbox) => mailbox.id),
        trackingBaseUrl: window.location.origin,
        subject: SUBJECT,
        body: BODY,
        steps: [
          {
            stepType: "video_email",
            delayHours: 0,
            subject: SUBJECT,
            body: BODY,
            includeVideo: true,
          },
          {
            stepType: "email",
            delayHours: 72,
            subject: "Kurze Ergänzung zu {{company}}",
            body: FOLLOWUP_BODY,
            includeVideo: true,
          },
          {
            stepType: "manual_call",
            delayHours: 24,
            subject: "",
            body: "",
            includeVideo: false,
          },
        ],
      });

      const campaignId = String(created?.campaignId || "");
      if (!campaignId) throw new Error("Kampagne wurde angelegt, aber ohne Kampagnen-ID zurückgegeben.");

      const audienceCount = Number(created?.audienceCount || 0);
      if (!audienceCount) throw new Error("Für den Pilot wurden keine versandfähigen Gewerbe-Leads ausgewählt.");
      setProgress(`${audienceCount} persönliche Loom-Videos werden aus dem Golden Master gebaut …`);
      const published = await publishCampaign(campaignId);
      const prepared = Number(published.prepared || 0);
      const failed = Number(published.failed || 0);

      if (failed > 0 || prepared < audienceCount) {
        const examples = (published.results || []).filter((row) => row.error).slice(0, 3).map((row) => row.error).filter(Boolean);
        throw new Error(`Video-Preflight gestoppt: ${prepared}/${audienceCount} Looms bereit${examples.length ? ` · ${examples.join(" · ")}` : ""}. Es wurde noch nichts versendet.`);
      }

      setProgress(`${prepared}/${audienceCount} Looms bereit. First Frames werden geprüft …`);
      const posters = await preparePosters(published.results || []);
      if (posters !== audienceCount) throw new Error(`Poster-Preflight unvollständig: ${posters}/${audienceCount}. Es wurde noch nichts versendet.`);

      setProgress(`${prepared}/${audienceCount} Looms und ${posters}/${audienceCount} E-Mail-Poster bereit. Versand wird freigegeben …`);
      await callAdmin({ action: "start", id: campaignId });
      setMessage(`Loom-Pilot gestartet: ${prepared} personalisierte Videos + ${posters} geprüfte First-Frame-Poster · max. 30 Video-Mails pro Tag.`);
      setProgress(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Loom-Pilot konnte nicht gestartet werden.");
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  async function runNow(id: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const data = await callAdmin({ action: "run", id });
      setMessage(data?.worker?.sent ? "Nächste fällige Video-Mail wurde versendet." : "Geprüft: Aktuell ist keine Nachricht fällig.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Worker konnte nicht geprüft werden.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div>
          <div className={styles.kicker}>Walkenhorst · Loom Outreach</div>
          <h1>30 Leads. 30 persönliche Videos. Ein Klick.</h1>
          <p>Ein Golden Master von Andreas wird automatisch pro Unternehmen personalisiert: echte Website im Hintergrund, Talking Head, Scroll-Bewegung, eigener First-Frame-Poster, eigene Video-Seite und anschließend die persönliche Outreach-Mail.</p>
        </div>
        <button className={styles.launchButton} disabled={!canLaunch} onClick={() => void launchPilot()}>
          {busy ? "Launch wird geprüft …" : "30er Loom-Pilot starten"}
        </button>
      </section>

      {progress ? <div className={styles.success}>{progress}</div> : null}
      {error ? <div className={styles.error}>{error}</div> : null}
      {message ? <div className={styles.success}>{message}</div> : null}

      <section className={styles.readiness}>
        <article className={readyMailboxes.length ? styles.readyCard : styles.blockedCard}>
          <span>1</span>
          <div><strong>Mailbox</strong><small>{loading ? "prüfe …" : readyMailboxes.length ? `${readyMailboxes.length} versandbereit` : "fehlt noch"}</small></div>
        </article>
        <article className={leadCount > 0 ? styles.readyCard : styles.blockedCard}>
          <span>2</span>
          <div><strong>Leads</strong><small>{loading ? "prüfe …" : `${leadCount} mit E-Mail verfügbar`}</small></div>
        </article>
        <article className={styles.readyCard}>
          <span>3</span>
          <div><strong>Loom Engine</strong><small>Website + Talking Head + First Frame + Scroll + eigene /v-Seite</small></div>
        </article>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <div className={styles.panelHead}>
            <div><span className={styles.eyebrow}>Live</span><h2>Aktive Kampagnen</h2></div>
            <strong>{activeCampaigns.length}</strong>
          </div>
          {activeCampaigns.length ? activeCampaigns.map((campaign) => {
            const vr = campaign.videoReadiness || {};
            return (
              <div className={styles.campaign} key={campaign.id}>
                <div className={styles.campaignTop}>
                  <div><strong>{campaign.name}</strong><small>{statusLabel(campaign.status)} · {Number(vr.ready || 0)}/{Number(vr.required || 0)} Looms bereit</small></div>
                  <button disabled={busy} onClick={() => void runNow(campaign.id)}>Jetzt prüfen</button>
                </div>
                <div className={styles.metrics}>
                  <div><strong>{campaign.metrics.sent}</strong><span>gesendet</span></div>
                  <div><strong>{campaign.metrics.opened}</strong><span>{pct(campaign.metrics.opened, campaign.metrics.sent)} geöffnet</span></div>
                  <div><strong>{campaign.metrics.replied}</strong><span>{pct(campaign.metrics.replied, campaign.metrics.sent)} Antworten</span></div>
                </div>
              </div>
            );
          }) : <p className={styles.empty}>Noch keine aktive Kampagne. Oben startest du den Loom-Pilot; versendet wird erst, wenn alle ausgewählten Videos und First-Frame-Poster geprüft sind.</p>}
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHead}><div><span className={styles.eyebrow}>Zuletzt</span><h2>Kampagnen</h2></div></div>
          {recentCampaigns.length ? recentCampaigns.map((campaign) => (
            <div className={styles.historyRow} key={campaign.id}>
              <div><strong>{campaign.name}</strong><small>{statusLabel(campaign.status)}</small></div>
              <div><b>{campaign.metrics.sent}</b><span> gesendet · </span><b>{campaign.metrics.replied}</b><span> Antworten</span></div>
            </div>
          )) : <p className={styles.empty}>Noch keine Kampagnen vorhanden.</p>}
        </article>
      </section>

      <section className={styles.rule}>
        <strong>Launch-Regel:</strong> Ein Klick darf nur live gehen, wenn alle 30 Leads Video, echte Website, Andreas-Talking-Head und gecachten First-Frame-Poster vollständig haben. Sonst stoppt der Launch vor dem Versand.
      </section>
    </main>
  );
}
