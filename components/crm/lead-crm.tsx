"use client";

import { FormEvent, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { scoreEnergyLead } from "@/lib/energy-score";
import styles from "./lead-crm.module.css";

type CustomerType = "commercial" | "private";
type LeadStatus = "new" | "research" | "ready" | "contacted" | "engaged" | "qualified" | "meeting" | "proposal" | "won" | "lost" | "nurture";
type BatchKind = "special" | "scrape" | "manual";
type ListScope = "special" | "scrape" | "unbatched" | "all";

type Lead = {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  city: string | null;
  postcode: string | null;
  address: string | null;
  industry: string | null;
  status: LeadStatus;
  customer_type: CustomerType;
  total_score: number;
  intent_score: number;
  next_action: string | null;
  next_action_at: string | null;
  do_not_contact: boolean;
  batch_id: string | null;
  updated_at: string;
};

type LeadBatch = {
  id: string;
  name: string;
  kind: BatchKind;
  industry: string | null;
  source: string | null;
  scraped_at: string | null;
  created_at: string;
};

type Workflow = {
  lead_id: string;
  contact_count: number;
  enrichment_status: string | null;
  page_ready: boolean;
  video_ready: boolean;
  email_draft_ready: boolean;
  email_reviewed: boolean;
  email_sent: boolean;
  email_opened: boolean;
  email_clicked: boolean;
  page_viewed: boolean;
  video_played: boolean;
  max_watch_percent: number;
  cta_clicked: boolean;
  replied: boolean;
  workflow_stage: number;
  workflow_stage_label: string;
  recommended_action: string | null;
  workflow_percent: number;
  video_page_slug: string | null;
  rendered_video_url: string | null;
};

type Row = Lead & { workflow?: Workflow };
type Bulk = { label: string; done: number; total: number; failed: number };

const STATUS: Record<LeadStatus, string> = {
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

const STEPS = ["Lead", "Kontakt", "Loom", "Mail", "Prüfung", "Versand", "Reaktion", "Abschluss"];
const PAGE_SIZE = 40;
const LEAD_FIELDS = "id,company_name,contact_name,email,phone,website,city,postcode,address,industry,status,customer_type,total_score,intent_score,next_action,next_action_at,do_not_contact,batch_id,updated_at";
const FLOW_FIELDS = "lead_id,contact_count,enrichment_status,page_ready,video_ready,email_draft_ready,email_reviewed,email_sent,email_opened,email_clicked,page_viewed,video_played,max_watch_percent,cta_clicked,replied,workflow_stage,workflow_stage_label,recommended_action,workflow_percent,video_page_slug,rendered_video_url";
const BATCH_FIELDS = "id,name,kind,industry,source,scraped_at,created_at";

function stage(w?: Workflow) {
  if (!w) return 0;
  if (w.replied) return 7;
  if (w.email_sent && (w.email_opened || w.email_clicked || w.page_viewed || w.video_played || w.cta_clicked)) return 6;
  if (w.email_sent) return 5;
  if (w.email_reviewed) return 4;
  if (w.email_draft_ready) return 3;
  if (w.video_ready) return 2;
  if (w.enrichment_status || w.contact_count > 0) return 1;
  return 0;
}

function initials(v: string) {
  return v.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join("") || "WH";
}

function searchText(r: Row) {
  return [r.company_name, r.contact_name, r.email, r.phone, r.website, r.city, r.industry, r.workflow?.workflow_stage_label, r.workflow?.recommended_action]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function next(r: Row) {
  const w = r.workflow;
  if (!w?.enrichment_status && !w?.contact_count) return "Kontakte anreichern";
  if (!w?.video_ready) return "Persönlichen Loom erstellen";
  if (!w?.email_draft_ready) return "E-Mail-Entwurf erstellen";
  if (!w?.email_reviewed) return "Entwurf prüfen & freigeben";
  if (!w?.email_sent) return "Freigegebene E-Mail senden";
  if (w.replied) return "Antwort bearbeiten";
  if (w.cta_clicked || (w.video_played && Number(w.max_watch_percent || 0) >= 75)) return "Jetzt anrufen";
  return "Reaktion beobachten";
}

function watch(r: Row) {
  return Math.max(0, Math.min(100, Number(r.workflow?.max_watch_percent || 0)));
}

function isHot(r: Row) {
  return Boolean(r.workflow?.replied || r.workflow?.cta_clicked || watch(r) >= 75 || r.intent_score >= 70);
}

function batchDate(batch?: LeadBatch) {
  const value = batch?.scraped_at || batch?.created_at;
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
  } catch {
    return "";
  }
}

export function LeadCrm({ customerType }: { customerType: CustomerType }) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const commercial = customerType === "commercial";
  const studioTemplateKey = commercial ? "energiekosten" : "pv-privat";

  const [userId, setUserId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [batches, setBatches] = useState<LeadBatch[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search);
  const [stageFilter, setStageFilter] = useState("all");
  const [listScope, setListScope] = useState<ListScope>(commercial ? "special" : "all");
  const [industryFilter, setIndustryFilter] = useState("all");
  const [batchFilter, setBatchFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [bulk, setBulk] = useState<Bulk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) throw new Error("Session abgelaufen.");
      setUserId(session.user.id);

      const [lr, fr, br] = await Promise.all([
        supabase.from("energy_leads").select(LEAD_FIELDS).eq("user_id", session.user.id).eq("customer_type", customerType).order("updated_at", { ascending: false }).limit(5000),
        supabase.from("energy_crm_lead_workflow").select(FLOW_FIELDS).eq("user_id", session.user.id).limit(5000),
        supabase.from("energy_lead_batches").select(BATCH_FIELDS).eq("user_id", session.user.id).order("scraped_at", { ascending: false, nullsFirst: false }).limit(500),
      ]);

      if (lr.error) throw lr.error;
      const fm = new Map<string, Workflow>();
      if (!fr.error) for (const x of (fr.data || []) as Workflow[]) fm.set(x.lead_id, x);
      setRows(((lr.data || []) as Lead[]).map((x) => ({ ...x, workflow: fm.get(x.id) })));
      if (!br.error) setBatches((br.data || []) as LeadBatch[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "CRM konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [customerType, supabase]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => setPage(0), [q, stageFilter, listScope, industryFilter, batchFilter]);
  useEffect(() => setSelected(new Set()), [listScope, industryFilter, batchFilter]);

  const batchMap = useMemo(() => new Map(batches.map((b) => [b.id, b])), [batches]);
  const scrapeIndustries = useMemo<string[]>(
    () => Array.from(new Set<string>(batches.filter((b) => b.kind === "scrape").map((b) => b.industry || "Ohne Branche"))).sort((a: string, b: string) => a.localeCompare(b, "de")),
    [batches],
  );
  const visibleBatches = useMemo(
    () => batches.filter((b) => b.kind === "scrape" && (industryFilter === "all" || (b.industry || "Ohne Branche") === industryFilter)),
    [batches, industryFilter],
  );

  const groupedRows = useMemo(() => rows.filter((r) => {
    if (!commercial || listScope === "all") return true;
    const batch = r.batch_id ? batchMap.get(r.batch_id) : undefined;
    if (listScope === "special") return batch?.kind === "special";
    if (listScope === "unbatched") return !r.batch_id || batch?.kind === "manual";
    if (listScope === "scrape") {
      if (batch?.kind !== "scrape") return false;
      if (industryFilter !== "all" && (batch.industry || r.industry || "Ohne Branche") !== industryFilter) return false;
      if (batchFilter !== "all" && r.batch_id !== batchFilter) return false;
      return true;
    }
    return true;
  }), [rows, commercial, listScope, batchMap, industryFilter, batchFilter]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return groupedRows.filter((r) => (stageFilter === "all" || String(stage(r.workflow)) === stageFilter) && (!s || searchText(r).includes(s)));
  }, [groupedRows, q, stageFilter]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => (Number(isHot(b)) * 5000 + b.intent_score) - (Number(isHot(a)) * 5000 + a.intent_score)), [filtered]);
  const pc = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const p = Math.min(page, pc - 1);
  const visible = sorted.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);
  const all = visible.length > 0 && visible.every((r) => selected.has(r.id));
  const metrics = useMemo(() => rows.reduce((a, r) => {
    a.enrich += r.workflow?.enrichment_status ? 0 : 1;
    a.video += r.workflow?.video_ready ? 1 : 0;
    a.sent += r.workflow?.email_sent ? 1 : 0;
    a.hot += isHot(r) ? 1 : 0;
    return a;
  }, { enrich: 0, video: 0, sent: 0, hot: 0 }), [rows]);

  function toggle(id: string) {
    setSelected((c) => {
      const n = new Set(c);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function toggleVisible() {
    setSelected((c) => {
      const n = new Set(c);
      for (const r of visible) all ? n.delete(r.id) : n.add(r.id);
      return n;
    });
  }

  async function bulkAction(action: "enrich" | "prepare_page" | "create_draft") {
    if (!supabase || !selected.size || bulk) return;
    const ids = [...selected];
    const labels = { enrich: "Kontakte", prepare_page: "Persönliche Looms", create_draft: "Entwürfe" };
    setBulk({ label: labels[action], done: 0, total: ids.length, failed: 0 });
    setError(null);
    try {
      let done = 0;
      let failed = 0;
      const concurrency = action === "prepare_page" ? 2 : 4;
      for (let i = 0; i < ids.length; i += concurrency) {
        await Promise.all(ids.slice(i, i + concurrency).map(async (leadId) => {
          try {
            const r = await supabase.functions.invoke("crm-lead-workflow", { body: { action, leadId, baseUrl: window.location.origin, templateKey: studioTemplateKey } });
            if (r.error || (r.data as any)?.error) throw new Error((r.data as any)?.error || r.error?.message || "Aktion fehlgeschlagen");
          } catch {
            failed++;
          } finally {
            done++;
            setBulk({ label: labels[action], done, total: ids.length, failed });
          }
        }));
      }
      setNotice(`${labels[action]}: ${done - failed}/${ids.length} erfolgreich${failed ? ` · ${failed} Blocker` : ""}`);
      await load();
      window.setTimeout(() => setBulk(null), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk-Aktion fehlgeschlagen.");
      setBulk(null);
    }
  }

  async function createLead(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!supabase || !userId) return;
    const f = new FormData(e.currentTarget);
    const company = String(f.get("company_name") || "").trim();
    const contact = String(f.get("contact_name") || "").trim();
    const display = commercial ? company : contact;
    if (!display) { setError("Name fehlt."); return; }
    const website = String(f.get("website") || "").trim() || null;
    const city = String(f.get("city") || "").trim() || null;
    const industry = commercial ? (String(f.get("industry") || "").trim() || null) : "Privathaushalt";
    const email = String(f.get("email") || "").trim().toLowerCase() || null;
    const phone = String(f.get("phone") || "").trim() || null;
    const scores = scoreEnergyLead({ company_name: display, website, city, industry, employees: null, location_count: 1, roof_area_m2: null, annual_energy_kwh: null, pv_present: null, contact_name: contact || null, phone, email });
    setBusy(true);
    try {
      const r = await supabase.from("energy_leads").insert({
        user_id: userId,
        customer_type: customerType,
        video_template_key: studioTemplateKey,
        company_name: display,
        contact_name: contact || (commercial ? null : display),
        email,
        phone,
        website,
        city,
        industry,
        source: "manual",
        pv_score: scores.pvScore,
        energy_score: scores.energyScore,
        intent_score: scores.intentScore,
        contactability_score: scores.contactabilityScore,
        total_score: scores.totalScore,
        summary: scores.summary,
        pitch: scores.pitch,
        next_action: scores.nextAction,
        status: "research",
      }).select("id").single();
      if (r.error) throw r.error;
      router.push(`/leads/${r.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lead konnte nicht angelegt werden.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected() {
    if (!supabase || !userId || !selected.size || !window.confirm(`${selected.size} Leads löschen?`)) return;
    const r = await supabase.from("energy_leads").delete().eq("user_id", userId).in("id", [...selected]);
    if (r.error) setError(r.error.message);
    else { setSelected(new Set()); await load(); }
  }

  if (loading) return <div className={styles.loading}>CRM wird geladen …</div>;

  return <div className={styles.root}>
    <header className={styles.hero}>
      <div><span>Walkenhorst · Energy Sales OS</span><h1>{commercial ? "Gewerbe CRM" : "Privatkunden CRM"}</h1><p>Ein klarer Prozess pro Lead. Du siehst sofort, was fertig ist, was fehlt und was als Nächstes zu tun ist.</p></div>
      <button onClick={() => setCreateOpen(true)}>+ Lead anlegen</button>
    </header>

    <section className={styles.kpis}>
      <article><small>Leads</small><strong>{rows.length}</strong></article>
      <article><small>Kontakte offen</small><strong>{metrics.enrich}</strong></article>
      <article><small>Looms bereit</small><strong>{metrics.video}</strong></article>
      <article><small>Versendet</small><strong>{metrics.sent}</strong></article>
      <article><small>Hot / Signal</small><strong>{metrics.hot}</strong></article>
    </section>

    {error ? <div className={styles.error}>{error}</div> : null}
    {notice ? <div className={styles.notice}>{notice}</div> : null}

    <section className={styles.workspace}>
      {commercial ? <div className={styles.toolbar}>
        <select value={listScope} onChange={(e) => { setListScope(e.target.value as ListScope); setIndustryFilter("all"); setBatchFilter("all"); }}>
          <option value="special">Sonderliste · aktueller Bestand</option>
          <option value="scrape">Neue Scrapes · nach Branche</option>
          <option value="unbatched">Manuell / ohne Liste</option>
          <option value="all">Alle · nur Gesamtübersicht</option>
        </select>
        {listScope === "scrape" ? <>
          <select value={industryFilter} onChange={(e) => { setIndustryFilter(e.target.value); setBatchFilter("all"); }}>
            <option value="all">Alle Branchen</option>
            {scrapeIndustries.map((industry) => <option value={industry} key={industry}>{industry}</option>)}
          </select>
          <select value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)}>
            <option value="all">Alle Imports dieser Auswahl</option>
            {visibleBatches.map((batch) => <option value={batch.id} key={batch.id}>{batch.name}</option>)}
          </select>
        </> : null}
        <strong>{groupedRows.length} Leads in dieser Liste</strong>
      </div> : null}

      <div className={styles.toolbar}>
        <div className={styles.search}><input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Firma, Ansprechpartner, E-Mail, Ort …" /></div>
        <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}><option value="all">Alle Prozessstufen</option>{STEPS.map((x, i) => <option value={i} key={x}>{i + 1}. {x}</option>)}</select>
        <strong>{filtered.length} Leads</strong>
      </div>

      {selected.size ? <div className={styles.bulk}>
        <div><strong>{selected.size} ausgewählt</strong><span>Schnellbearbeitung</span></div>
        <div className={styles.bulkButtons}>
          <button disabled={!!bulk} onClick={() => void bulkAction("enrich")}>Kontakte anreichern</button>
          <button className={styles.primaryBulk} disabled={!!bulk} onClick={() => void bulkAction("prepare_page")}>Looms erstellen</button>
          <button disabled={!!bulk} onClick={() => void bulkAction("create_draft")}>Entwürfe erstellen</button>
          <button disabled={!!bulk} onClick={() => setSelected(new Set())}>Aufheben</button>
          <button disabled={!!bulk} onClick={() => void deleteSelected()}>Löschen</button>
        </div>
        {bulk ? <div className={styles.bulkProgress}><i><b style={{ width: `${Math.round(bulk.done / Math.max(1, bulk.total) * 100)}%` }} /></i><span>{bulk.label} · {bulk.done}/{bulk.total}{bulk.failed ? ` · ${bulk.failed} Blocker` : ""}</span></div> : null}
      </div> : null}

      <div className={styles.tableWrap}><table>
        <thead><tr><th><input type="checkbox" checked={all} onChange={toggleVisible} /></th><th>Lead</th>{commercial ? <th>Liste</th> : null}<th>Prozess</th><th>Enrichment</th><th>Produktion</th><th>Watchtime</th><th>Nächster Schritt</th></tr></thead>
        <tbody>{visible.map((r) => {
          const w = r.workflow;
          const s = stage(w);
          const wt = watch(r);
          const batch = r.batch_id ? batchMap.get(r.batch_id) : undefined;
          return <tr key={r.id} onClick={() => router.push(`/leads/${r.id}`)}>
            <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
            <td><div className={styles.lead}><span>{initials(r.company_name)}</span><div><strong>{r.company_name}</strong><small>{r.contact_name || "Ansprechpartner offen"}{r.city ? ` · ${r.city}` : ""}</small></div></div></td>
            {commercial ? <td><div className={styles.production}><span className={batch?.kind === "special" ? styles.ok : styles.open}>{batch?.kind === "special" ? "Sonderliste" : batch?.kind === "scrape" ? (batch.industry || r.industry || "Scrape") : "Manuell"}</span><small>{batch?.kind === "scrape" ? batchDate(batch) : batch?.kind === "special" ? "Bestand" : "ohne Batch"}</small></div></td> : null}
            <td><div className={styles.stage}><div>{STEPS.map((_, i) => <i key={i} className={i < s ? styles.done : i === s ? styles.current : ""} />)}</div><strong>{STEPS[s]}</strong><small>{Math.round((s + 1) / STEPS.length * 100)}%</small></div></td>
            <td><span className={w?.enrichment_status ? styles.ok : styles.open}>{w?.enrichment_status ? `${w.contact_count || 0} Kontakt${(w.contact_count || 0) === 1 ? "" : "e"}` : "Offen"}</span></td>
            <td><div className={styles.production}><span className={w?.video_ready ? styles.ok : styles.open}>Loom {w?.video_ready ? "✓ bereit" : "offen"}</span></div></td>
            <td><div className={`${styles.watch} ${wt >= 75 ? styles.hot : ""}`}><strong>{w?.video_played ? `${wt}%` : "—"}</strong><i><b style={{ width: `${wt}%` }} /></i><small>{w?.video_played ? wt >= 75 ? "Hot" : "angesehen" : "kein Play"}</small></div></td>
            <td><div className={styles.next}><strong>{next(r)}</strong><small>{r.intent_score} Intent</small></div></td>
          </tr>;
        })}</tbody>
      </table></div>

      <footer className={styles.pagination}><span>{filtered.length ? `${p * PAGE_SIZE + 1}–${Math.min(filtered.length, p * PAGE_SIZE + PAGE_SIZE)} von ${filtered.length}` : "0 Leads"}</span><div><button disabled={p === 0} onClick={() => setPage((v) => Math.max(0, v - 1))}>Zurück</button><b>{p + 1}/{pc}</b><button disabled={p >= pc - 1} onClick={() => setPage((v) => Math.min(pc - 1, v + 1))}>Weiter</button></div></footer>
    </section>

    {createOpen ? <div className={styles.modalBg} onMouseDown={() => setCreateOpen(false)}><form className={styles.modal} onSubmit={createLead} onMouseDown={(e) => e.stopPropagation()}><h2>Lead anlegen</h2>{commercial ? <label>Unternehmen<input name="company_name" required autoFocus /></label> : null}<label>Ansprechpartner<input name="contact_name" required={!commercial} /></label><div><label>E-Mail<input name="email" type="email" /></label><label>Telefon<input name="phone" /></label></div>{commercial ? <div><label>Website<input name="website" /></label><label>Branche<input name="industry" /></label></div> : null}<label>Ort<input name="city" /></label><div className={styles.modalActions}><button type="button" onClick={() => setCreateOpen(false)}>Abbrechen</button><button disabled={busy}>Lead anlegen</button></div></form></div> : null}
  </div>;
}
