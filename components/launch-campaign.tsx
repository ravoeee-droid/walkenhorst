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

type Campaign = {
  id: string;
  name: string;
  status: "draft" | "active" | "paused" | "completed";
  created_at: string;
  metrics: Metrics;
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

const SUBJECT = "{{firstname}}, kurze Frage zu {{company}}";
const BODY = `Guten Tag {{firstname}},

ich habe mir {{company}} in {{city}} kurz angesehen. {{reason}}

Ich wollte deshalb einmal direkt fragen: Ist das Thema Energiekosten bzw. PV für Ihren Betrieb aktuell grundsätzlich interessant?

Wenn ja, schicke ich Ihnen die wichtigsten Punkte kompakt rüber.

Viele Grüße
Andreas Walkenhorst`;

const FOLLOWUP_BODY = `Guten Tag {{firstname}},

ich wollte meine kurze Nachricht zu {{company}} noch einmal nach oben holen.

Falls Energie- und PV-Potenzial aktuell ein Thema ist, genügt ein kurzes „ja“ – dann schicke ich Ihnen die Punkte kompakt zusammen.

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

export function LaunchCampaign({ user: _user }: { user: User }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [leadCount, setLeadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const callAdmin = useCallback(async (body: Record<string, unknown>) => {
    if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
    const { data, error: invokeError } = await supabase.functions.invoke("campaign-admin", { body });
    if (invokeError) throw new Error(invokeError.message || "Campaign Backend nicht erreichbar.");
    if (data?.error) throw new Error(String(data.error));
    return data;
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

    try {
      const date = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" }).format(new Date());
      const created = await callAdmin({
        action: "create",
        name: `Walkenhorst Pilot ${date}`,
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
        includeVideo: false,
        mailboxIds: readyMailboxes.map((mailbox) => mailbox.id),
        trackingBaseUrl: window.location.origin,
        subject: SUBJECT,
        body: BODY,
        steps: [
          {
            stepType: "email",
            delayHours: 0,
            subject: SUBJECT,
            body: BODY,
            includeVideo: false,
          },
          {
            stepType: "email",
            delayHours: 72,
            subject: "Kurze Ergänzung zu {{company}}",
            body: FOLLOWUP_BODY,
            includeVideo: false,
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

      await callAdmin({ action: "start", id: campaignId });
      setMessage(`Pilot gestartet: ${Number(created?.audienceCount || 0)} frische Gewerbe-Leads, max. 30 E-Mails pro Tag. Kein Video-Renderer nötig.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pilot konnte nicht gestartet werden.");
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
      setMessage(data?.worker?.sent ? "Nächste fällige Nachricht wurde versendet." : "Geprüft: Aktuell ist keine Nachricht fällig.");
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
          <div className={styles.kicker}>Walkenhorst Outbound · Launch Mode</div>
          <h1>30 gute Leads. Eine Kampagne. Antworten erzeugen.</h1>
          <p>Kein Studio, kein Rendern, kein Technik-Zirkus. Der Pilot nutzt eine kurze personalisierte E-Mail, ein automatisches Follow-up und danach eine Call-Aufgabe.</p>
        </div>
        <button className={styles.launchButton} disabled={!canLaunch} onClick={() => void launchPilot()}>
          {busy ? "Wird gestartet …" : "30er-Pilot starten"}
        </button>
      </section>

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
          <div><strong>Sequenz</strong><small>E-Mail → Follow-up → Call</small></div>
        </article>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <div className={styles.panelHead}>
            <div><span className={styles.eyebrow}>Live</span><h2>Aktive Kampagnen</h2></div>
            <strong>{activeCampaigns.length}</strong>
          </div>
          {activeCampaigns.length ? activeCampaigns.map((campaign) => (
            <div className={styles.campaign} key={campaign.id}>
              <div className={styles.campaignTop}>
                <div><strong>{campaign.name}</strong><small>{statusLabel(campaign.status)}</small></div>
                <button disabled={busy} onClick={() => void runNow(campaign.id)}>Jetzt prüfen</button>
              </div>
              <div className={styles.metrics}>
                <div><strong>{campaign.metrics.sent}</strong><span>gesendet</span></div>
                <div><strong>{campaign.metrics.opened}</strong><span>{pct(campaign.metrics.opened, campaign.metrics.sent)} geöffnet</span></div>
                <div><strong>{campaign.metrics.replied}</strong><span>{pct(campaign.metrics.replied, campaign.metrics.sent)} Antworten</span></div>
              </div>
            </div>
          )) : <p className={styles.empty}>Noch keine aktive Kampagne. Sobald Mailbox und Leads bereit sind, startest du oben den 30er-Pilot.</p>}
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
        <strong>Launch-Regel:</strong> Erst wenn der 30er-Pilot sauber sendet und Antworten erzeugt, erhöhen wir Volumen oder schalten personalisierte Videos wieder dazu.
      </section>
    </main>
  );
}
