"use client";

import { FormEvent, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { scoreEnergyLead } from "@/lib/energy-score";
import styles from "./lead-crm.module.css";

type CustomerType = "commercial" | "private";
type LeadStatus = "new" | "research" | "ready" | "contacted" | "engaged" | "qualified" | "meeting" | "proposal" | "won" | "lost" | "nurture";

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
  updated_at: string;
};

const STATUS_LABEL: Record<LeadStatus, string> = {
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

const STATUS_OPTIONS = Object.entries(STATUS_LABEL) as Array<[LeadStatus, string]>;
const PAGE_SIZE = 40;
const LEAD_FIELDS = "id,company_name,contact_name,email,phone,website,city,postcode,address,industry,status,customer_type,total_score,intent_score,next_action,next_action_at,do_not_contact,updated_at";

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  } catch {
    return "—";
  }
}

function datetimeLocal(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "WH";
}

function searchableLead(lead: Lead) {
  return [
    lead.company_name,
    lead.contact_name,
    lead.email,
    lead.phone,
    lead.website,
    lead.city,
    lead.postcode,
    lead.address,
    lead.industry,
    lead.next_action,
    STATUS_LABEL[lead.status],
    lead.status,
  ].filter(Boolean).join(" ").toLowerCase();
}

export function LeadCrm({ customerType }: { customerType: CustomerType }) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [rows, setRows] = useState<Lead[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState<"all" | LeadStatus>("all");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [quickLeadId, setQuickLeadId] = useState<string | null>(null);

  const isCommercial = customerType === "commercial";
  const label = isCommercial ? "Gewerbekunden" : "Privatkunden";
  const singular = isCommercial ? "Gewerbe-Lead" : "Privatkunden-Lead";

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) throw new Error("Session abgelaufen. Bitte neu anmelden.");
      setUserId(session.user.id);
      const result = await supabase
        .from("energy_leads")
        .select(LEAD_FIELDS)
        .eq("user_id", session.user.id)
        .eq("customer_type", customerType)
        .order("updated_at", { ascending: false })
        .limit(750);
      if (result.error) throw result.error;
      setRows((result.data || []) as Lead[]);
      setSelected(new Set());
      setPage(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "CRM konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [customerType, supabase]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(0); }, [deferredSearch, statusFilter]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && target?.tagName !== "INPUT" && target?.tagName !== "TEXTAREA" && target?.tagName !== "SELECT") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape" && quickLeadId) setQuickLeadId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [quickLeadId]);

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return rows.filter((lead) => {
      if (statusFilter !== "all" && lead.status !== statusFilter) return false;
      return !q || searchableLead(lead).includes(q);
    });
  }, [rows, deferredSearch, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visibleRows = useMemo(() => filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE), [filtered, safePage]);
  const selectedRows = useMemo(() => rows.filter((lead) => selected.has(lead.id)), [rows, selected]);
  const quickLead = useMemo(() => rows.find((lead) => lead.id === quickLeadId) || null, [rows, quickLeadId]);
  const metrics = useMemo(() => rows.reduce((acc, lead) => {
    acc.contactable += !lead.do_not_contact && Boolean(lead.email || lead.phone) ? 1 : 0;
    acc.hot += lead.intent_score >= 70 || lead.status === "engaged" || lead.status === "qualified" ? 1 : 0;
    acc.actionDue += lead.next_action_at && new Date(lead.next_action_at).getTime() <= Date.now() ? 1 : 0;
    return acc;
  }, { contactable: 0, hot: 0, actionDue: 0 }), [rows]);
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((lead) => selected.has(lead.id));
  const rangeStart = filtered.length ? safePage * PAGE_SIZE + 1 : 0;
  const rangeEnd = Math.min(filtered.length, safePage * PAGE_SIZE + PAGE_SIZE);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleVisible() {
    setSelected((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleRows.forEach((lead) => next.delete(lead.id));
      else visibleRows.forEach((lead) => next.add(lead.id));
      return next;
    });
  }

  async function quickEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !userId || !quickLead) return;
    const form = new FormData(event.currentTarget);
    const nextAt = String(form.get("next_action_at") || "").trim();
    const payload = {
      contact_name: String(form.get("contact_name") || "").trim() || null,
      email: String(form.get("email") || "").trim().toLowerCase() || null,
      phone: String(form.get("phone") || "").trim() || null,
      status: String(form.get("status") || quickLead.status) as LeadStatus,
      next_action: String(form.get("next_action") || "").trim() || null,
      next_action_at: nextAt ? new Date(nextAt).toISOString() : null,
      industry: isCommercial ? (String(form.get("industry") || "").trim() || null) : quickLead.industry,
      city: String(form.get("city") || "").trim() || null,
      do_not_contact: String(form.get("do_not_contact") || "no") === "yes",
      updated_at: new Date().toISOString(),
    };
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await supabase.from("energy_leads").update(payload).eq("user_id", userId).eq("id", quickLead.id).select(LEAD_FIELDS).single();
      if (result.error) throw result.error;
      const updated = result.data as Lead;
      setRows((current) => current.map((lead) => lead.id === updated.id ? updated : lead));
      setNotice(`${updated.company_name} wurde aktualisiert.`);
      setQuickLeadId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Schnellbearbeitung fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function bulkEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !userId || selected.size === 0) return;
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const status = String(form.get("status") || "");
    const type = String(form.get("customer_type") || "");
    const industry = String(form.get("industry") || "").trim();
    const nextAction = String(form.get("next_action") || "").trim();
    const dnc = String(form.get("dnc") || "");
    if (status) payload.status = status;
    if (type) payload.customer_type = type;
    if (industry) payload.industry = industry;
    if (nextAction) payload.next_action = nextAction;
    if (dnc === "yes") payload.do_not_contact = true;
    if (dnc === "no") payload.do_not_contact = false;
    if (Object.keys(payload).length === 1) {
      setError("Wähle mindestens eine Änderung aus.");
      return;
    }
    setBusy(true); setError(null); setNotice(null);
    try {
      const ids = Array.from(selected);
      const result = await supabase.from("energy_leads").update(payload).eq("user_id", userId).in("id", ids);
      if (result.error) throw result.error;
      setNotice(`${ids.length} Leads wurden aktualisiert.`);
      setBulkOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mehrfachbearbeitung fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected() {
    if (!supabase || !userId || selected.size === 0) return;
    const ids = Array.from(selected);
    const ok = window.confirm(`${ids.length} ausgewählte Leads endgültig löschen? Zugehörige CRM-Aktivitäten, Follow-ups, Nachrichten und Studio-Daten können dabei ebenfalls entfernt werden.`);
    if (!ok) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await supabase.from("energy_leads").delete().eq("user_id", userId).in("id", ids);
      if (result.error) throw result.error;
      setNotice(`${ids.length} Leads wurden gelöscht.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Löschen fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function createLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !userId) return;
    const form = new FormData(event.currentTarget);
    const company = String(form.get("company_name") || "").trim();
    const contact = String(form.get("contact_name") || "").trim();
    const displayName = isCommercial ? company : contact;
    if (!displayName) { setError(isCommercial ? "Unternehmensname fehlt." : "Name fehlt."); return; }
    const website = String(form.get("website") || "").trim() || null;
    const city = String(form.get("city") || "").trim() || null;
    const industry = isCommercial ? (String(form.get("industry") || "").trim() || null) : "Privathaushalt";
    const email = String(form.get("email") || "").trim() || null;
    const phone = String(form.get("phone") || "").trim() || null;
    const scores = scoreEnergyLead({ company_name: displayName, website, city, industry, employees: null, location_count: 1, roof_area_m2: null, annual_energy_kwh: null, pv_present: null, contact_name: contact || null, phone, email });
    setBusy(true); setError(null); setNotice(null);
    try {
      const insert = await supabase.from("energy_leads").insert({
        user_id: userId,
        customer_type: customerType,
        company_name: displayName,
        contact_name: contact || (isCommercial ? null : displayName),
        email,
        phone,
        website,
        city,
        postcode: String(form.get("postcode") || "").trim() || null,
        address: String(form.get("address") || "").trim() || null,
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
        status: scores.totalScore >= 75 ? "ready" : "research",
      }).select("id").single();
      if (insert.error) throw insert.error;
      setCreateOpen(false);
      setNotice(`${singular} wurde angelegt.`);
      await load();
      router.push(`/leads/${insert.data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lead konnte nicht angelegt werden.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className={styles.root}>
      <div className={styles.loaderTop}><span /></div>
      <div className={styles.heroSkeleton}><div/><div/><div/></div>
      <div className={styles.skeletonGrid}>{Array.from({ length: 8 }).map((_, i) => <div className={styles.skeletonRow} key={i} />)}</div>
    </div>;
  }

  return <div className={styles.root}>
    {busy ? <div className={styles.loaderTop}><span /></div> : null}
    <header className={styles.hero}>
      <div>
        <div className={styles.eyebrow}>Walkenhorst CRM · {isCommercial ? "B2B" : "B2C"}</div>
        <h1>{label}</h1>
        <p>{isCommercial ? "Unternehmen, Ansprechpartner und gewerbliche Energie-Opportunities zentral steuern." : "Private Interessenten, Haushalte und Energieoptimierungs-Anfragen sauber getrennt verwalten."}</p>
      </div>
      <button className={styles.primary} type="button" onClick={() => setCreateOpen(true)}>+ {singular}</button>
    </header>

    <section className={styles.commandSearch}>
      <span className={styles.searchIcon}>⌕</span>
      <div>
        <strong>Alles durchsuchen</strong>
        <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Unternehmen, Name, E-Mail, Telefon, Ort, Branche, Website, nächste Aktion …" />
      </div>
      {search ? <button type="button" onClick={() => setSearch("")} aria-label="Suche leeren">×</button> : <kbd>/</kbd>}
    </section>

    <section className={styles.kpis}>
      <div><span>Leads</span><strong>{rows.length}</strong><small>in diesem CRM</small></div>
      <div><span>Kontaktierbar</span><strong>{metrics.contactable}</strong><small>E-Mail oder Telefon</small></div>
      <div><span>Hot</span><strong>{metrics.hot}</strong><small>hoher Intent</small></div>
      <div><span>Aktion fällig</span><strong>{metrics.actionDue}</strong><small>heute / überfällig</small></div>
    </section>

    {error ? <div className={styles.error}>{error}</div> : null}
    {notice ? <div className={styles.notice}>{notice}</div> : null}

    <section className={styles.card}>
      <div className={styles.toolbar}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | LeadStatus)} aria-label="Status filtern">
          <option value="all">Alle Status</option>
          {STATUS_OPTIONS.map(([value, name]) => <option value={value} key={value}>{name}</option>)}
        </select>
        <span className={styles.resultCount}>{filtered.length} Ergebnisse</span>
        <div className={styles.toolbarSpacer}/>
        {deferredSearch !== search ? <span className={styles.searching}>Suche …</span> : <span className={styles.tableHint}>Lead anklicken für Schnellbearbeitung</span>}
      </div>

      {selected.size > 0 ? <div className={styles.bulkBar}>
        <div><strong>{selected.size}</strong><span> ausgewählt</span></div>
        <button type="button" onClick={() => setBulkOpen(true)}>Mehrfach bearbeiten</button>
        <button type="button" onClick={() => { setSelected(new Set()); }}>Auswahl aufheben</button>
        <button type="button" className={styles.danger} onClick={() => void deleteSelected()}>Löschen</button>
      </div> : null}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr>
            <th className={styles.checkCol}><input aria-label="Alle sichtbaren Leads auswählen" type="checkbox" checked={allVisibleSelected} onChange={toggleVisible}/></th>
            <th>{isCommercial ? "Unternehmen" : "Kontakt"}</th><th>Kontakt</th><th>Status</th><th>Opportunity</th><th>Nächster Schritt</th><th>Aktualisiert</th>
          </tr></thead>
          <tbody>{visibleRows.map((lead) => <tr key={lead.id} onClick={() => setQuickLeadId(lead.id)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setQuickLeadId(lead.id); } }}>
            <td className={styles.checkCol} onClick={(e) => e.stopPropagation()}><input aria-label={`${lead.company_name} auswählen`} type="checkbox" checked={selected.has(lead.id)} onChange={() => toggle(lead.id)}/></td>
            <td><div className={styles.identity}><span>{initials(lead.company_name)}</span><div><strong>{lead.company_name}</strong><small>{[isCommercial ? lead.contact_name : lead.city, lead.industry].filter(Boolean).join(" · ") || "Noch nicht angereichert"}</small></div></div></td>
            <td><div className={styles.contact}><strong>{lead.email || lead.phone || "—"}</strong><small>{lead.email && lead.phone ? lead.phone : [lead.postcode, lead.city].filter(Boolean).join(" ")}</small></div></td>
            <td><span className={`${styles.status} ${styles[`status_${lead.status}`] || ""}`}>{STATUS_LABEL[lead.status] || lead.status}</span></td>
            <td><div className={styles.score}><strong>{lead.total_score}</strong><span>/ 100</span></div></td>
            <td><div className={styles.next}><strong>{lead.next_action || "Noch offen"}</strong><small>{formatDate(lead.next_action_at)}</small></div></td>
            <td><span className={styles.date}>{formatDate(lead.updated_at)}</span></td>
          </tr>)}</tbody>
        </table>
        {!filtered.length ? <div className={styles.empty}><strong>Keine Leads gefunden.</strong><span>Passe Suche oder Filter an.</span></div> : null}
      </div>

      {filtered.length > 0 ? <footer className={styles.pagination}>
        <span>{rangeStart}–{rangeEnd} von {filtered.length}</span>
        <div>
          <button type="button" disabled={safePage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>← Zurück</button>
          <strong>{safePage + 1} / {pageCount}</strong>
          <button type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>Weiter →</button>
        </div>
      </footer> : null}
    </section>

    {quickLead ? <div className={styles.modalBackdrop} onMouseDown={() => setQuickLeadId(null)}><section className={`${styles.modal} ${styles.quickModal}`} onMouseDown={(e) => e.stopPropagation()} key={quickLead.id}>
      <div className={styles.quickHead}>
        <div className={styles.quickIdentity}><span>{initials(quickLead.company_name)}</span><div><small>Schnellbearbeitung</small><h2>{quickLead.company_name}</h2><p>{[quickLead.contact_name, quickLead.industry, quickLead.city].filter(Boolean).join(" · ") || "Noch nicht angereichert"}</p></div></div>
        <div className={styles.quickMeta}><span className={`${styles.status} ${styles[`status_${quickLead.status}`] || ""}`}>{STATUS_LABEL[quickLead.status]}</span><strong>{quickLead.total_score}<small>/100</small></strong><button type="button" onClick={() => setQuickLeadId(null)} aria-label="Schnellbearbeitung schließen">×</button></div>
      </div>
      <form onSubmit={quickEdit} className={styles.form}>
        <div className={styles.formGrid}><label><span>Status</span><select name="status" defaultValue={quickLead.status}>{STATUS_OPTIONS.map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></label><label><span>Ansprechpartner</span><input name="contact_name" defaultValue={quickLead.contact_name || ""} /></label></div>
        <div className={styles.formGrid}><label><span>E-Mail</span><input name="email" type="email" defaultValue={quickLead.email || ""} /></label><label><span>Telefon</span><input name="phone" defaultValue={quickLead.phone || ""} /></label></div>
        <div className={styles.formGrid}><label><span>Nächster Schritt</span><input name="next_action" defaultValue={quickLead.next_action || ""} placeholder="z. B. Rückruf, Angebot senden" /></label><label><span>Fällig am</span><input name="next_action_at" type="datetime-local" defaultValue={datetimeLocal(quickLead.next_action_at)} /></label></div>
        <div className={styles.formGrid}>{isCommercial ? <label><span>Branche</span><input name="industry" defaultValue={quickLead.industry || ""} /></label> : <label><span>Ort</span><input name="city" defaultValue={quickLead.city || ""} /></label>}<label><span>Kontakt</span><select name="do_not_contact" defaultValue={quickLead.do_not_contact ? "yes" : "no"}><option value="no">Kontakt erlaubt</option><option value="yes">Nicht kontaktieren</option></select></label></div>
        {isCommercial ? <label className={styles.compactCity}><span>Ort</span><input name="city" defaultValue={quickLead.city || ""} /></label> : null}
        <div className={styles.quickActions}>
          <button type="button" onClick={() => router.push(`/leads/${quickLead.id}`)}>Lead vollständig öffnen</button>
          <div className={styles.actionSpacer}/>
          <button type="button" onClick={() => setQuickLeadId(null)}>Abbrechen</button>
          <button className={styles.primary} disabled={busy}>{busy ? "Speichert …" : "Änderungen speichern"}</button>
        </div>
      </form>
    </section></div> : null}

    {bulkOpen ? <div className={styles.modalBackdrop} onMouseDown={() => setBulkOpen(false)}><section className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
      <div className={styles.modalHead}><div><span>Bulk Edit</span><h2>{selectedRows.length} Leads bearbeiten</h2></div><button type="button" onClick={() => setBulkOpen(false)}>×</button></div>
      <form onSubmit={bulkEdit} className={styles.form}>
        <label><span>Status ändern</span><select name="status" defaultValue=""><option value="">Unverändert</option>{STATUS_OPTIONS.map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></label>
        <label><span>CRM verschieben</span><select name="customer_type" defaultValue=""><option value="">Unverändert</option><option value="commercial">Gewerbekunden-CRM</option><option value="private">Privatkunden-CRM</option></select></label>
        <label><span>Branche setzen</span><input name="industry" placeholder="Leer = unverändert" /></label>
        <label><span>Nächste Aktion setzen</span><input name="next_action" placeholder="Leer = unverändert" /></label>
        <label><span>Kontaktstatus</span><select name="dnc" defaultValue=""><option value="">Unverändert</option><option value="no">Kontakt erlaubt</option><option value="yes">Nicht kontaktieren (DNC)</option></select></label>
        <div className={styles.modalActions}><button type="button" onClick={() => setBulkOpen(false)}>Abbrechen</button><button className={styles.primary} disabled={busy}>{busy ? "Speichert …" : "Änderungen anwenden"}</button></div>
      </form>
    </section></div> : null}

    {createOpen ? <div className={styles.modalBackdrop} onMouseDown={() => setCreateOpen(false)}><section className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
      <div className={styles.modalHead}><div><span>Neuer Datensatz</span><h2>{singular} anlegen</h2></div><button type="button" onClick={() => setCreateOpen(false)}>×</button></div>
      <form onSubmit={createLead} className={styles.form}>
        {isCommercial ? <label><span>Unternehmen *</span><input name="company_name" required autoFocus /></label> : null}
        <label><span>{isCommercial ? "Ansprechpartner" : "Vor- und Nachname *"}</span><input name="contact_name" required={!isCommercial} autoFocus={!isCommercial} /></label>
        <div className={styles.formGrid}><label><span>E-Mail</span><input name="email" type="email" /></label><label><span>Telefon</span><input name="phone" /></label></div>
        {isCommercial ? <div className={styles.formGrid}><label><span>Website</span><input name="website" /></label><label><span>Branche</span><input name="industry" /></label></div> : null}
        <label><span>Adresse</span><input name="address" /></label>
        <div className={styles.formGrid}><label><span>PLZ</span><input name="postcode" /></label><label><span>Ort</span><input name="city" /></label></div>
        <div className={styles.modalActions}><button type="button" onClick={() => setCreateOpen(false)}>Abbrechen</button><button className={styles.primary} disabled={busy}>{busy ? "Legt an …" : `${singular} anlegen`}</button></div>
      </form>
    </section></div> : null}
  </div>;
}
