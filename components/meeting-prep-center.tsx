"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type Lead={id:string;company_name:string;contact_name:string|null;contact_title:string|null;phone:string|null;email:string|null;city:string|null;industry:string|null;employees:number|null;location_count:number;roof_area_m2:number|null;annual_energy_kwh:number|null;pv_present:boolean|null;total_score:number;pv_score:number;energy_score:number;intent_score:number;summary:string|null;pitch:string|null;next_action:string|null;status:string;research_context:Record<string,unknown>|null;last_contact_at:string|null;last_replied_at:string|null;updated_at:string};
type Qualification={id:string;lead_id:string;interest:string;timeline:string|null;contact_name:string|null;email:string|null;phone:string|null;notes:string|null;created_at:string};
type Message={id:string;lead_id:string;direction:string;subject:string|null;body_text:string|null;created_at:string};
type Document={id:string;lead_id:string;title:string;status:string;view_count:number;last_viewed_at:string|null};
type Deal={id:string;lead_id:string;title:string;stage:string;value_eur:number|null;probability:number;notes:string|null;updated_at:string};
type Video={id:string;lead_id:string;slug:string};
type VideoEvent={video_page_id:string;event_type:string;watch_percent:number|null;created_at:string};

function fmt(v:string|null|undefined){if(!v)return"—";try{return new Intl.DateTimeFormat("de-DE",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(v))}catch{return"—"}}
function num(v:number|null|undefined,suffix=""){return Number.isFinite(Number(v))?`${new Intl.NumberFormat("de-DE").format(Number(v))}${suffix}`:"—"}
function researchSignals(lead:Lead){const fc=lead.research_context?.firecrawl as {signals?:string[];services?:string[];summary?:string}|undefined;return{signals:fc?.signals||[],services:fc?.services||[],summary:fc?.summary||""}}

export function MeetingPrepCenter({user}:{user:User}){
  const supabase=useMemo(()=>createSupabaseBrowserClient(),[]);
  const [leads,setLeads]=useState<Lead[]>([]);const [quals,setQuals]=useState<Qualification[]>([]);const [messages,setMessages]=useState<Message[]>([]);const [documents,setDocuments]=useState<Document[]>([]);const [deals,setDeals]=useState<Deal[]>([]);const [videos,setVideos]=useState<Video[]>([]);const [events,setEvents]=useState<VideoEvent[]>([]);
  const [selectedId,setSelectedId]=useState<string|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const [notice,setNotice]=useState<string|null>(null);

  const load=useCallback(async()=>{
    if(!supabase)return;
    const [l,q,m,d,de,v,e]=await Promise.all([
      supabase.from("energy_leads").select("id,company_name,contact_name,contact_title,phone,email,city,industry,employees,location_count,roof_area_m2,annual_energy_kwh,pv_present,total_score,pv_score,energy_score,intent_score,summary,pitch,next_action,status,research_context,last_contact_at,last_replied_at,updated_at").eq("user_id",user.id).in("status",["meeting","proposal","engaged","qualified"]).order("intent_score",{ascending:false}).limit(1000),
      supabase.from("energy_qualifications").select("id,lead_id,interest,timeline,contact_name,email,phone,notes,created_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(3000),
      supabase.from("energy_messages").select("id,lead_id,direction,subject,body_text,created_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(5000),
      supabase.from("energy_documents").select("id,lead_id,title,status,view_count,last_viewed_at").eq("user_id",user.id).neq("status","archived").order("updated_at",{ascending:false}).limit(3000),
      supabase.from("energy_deals").select("id,lead_id,title,stage,value_eur,probability,notes,updated_at").eq("user_id",user.id).order("updated_at",{ascending:false}).limit(3000),
      supabase.from("energy_video_pages").select("id,lead_id,slug").eq("user_id",user.id).neq("status","archived").limit(3000),
      supabase.from("energy_video_events").select("video_page_id,event_type,watch_percent,created_at").order("created_at",{ascending:false}).limit(10000),
    ]);
    if(l.error){setError(l.error.message);return}setLeads((l.data||[]) as Lead[]);if(!q.error)setQuals((q.data||[]) as Qualification[]);if(!m.error)setMessages((m.data||[]) as Message[]);if(!d.error)setDocuments((d.data||[]) as Document[]);if(!de.error)setDeals((de.data||[]) as Deal[]);if(!v.error)setVideos((v.data||[]) as Video[]);if(!e.error)setEvents((e.data||[]) as VideoEvent[]);
  },[supabase,user.id]);
  useEffect(()=>{void load()},[load]);
  useEffect(()=>{if(!selectedId&&leads.length)setSelectedId(leads[0].id);if(selectedId&&!leads.some(l=>l.id===selectedId))setSelectedId(leads[0]?.id||null)},[leads,selectedId]);

  const selected=leads.find(l=>l.id===selectedId)||leads[0]||null;
  const qual=selected?quals.find(q=>q.lead_id===selected.id):undefined;
  const inbound=selected?messages.find(m=>m.lead_id===selected.id&&m.direction==="inbound"):undefined;
  const docs=selected?documents.filter(d=>d.lead_id===selected.id):[];
  const deal=selected?deals.find(d=>d.lead_id===selected.id):undefined;
  const video=selected?videos.find(v=>v.lead_id===selected.id):undefined;
  const watch=video?events.filter(e=>e.video_page_id===video.id).reduce((max,e)=>Math.max(max,e.watch_percent||0),0):0;
  const research=selected?researchSignals(selected):{signals:[],services:[],summary:""};
  const meetings=leads.filter(l=>l.status==="meeting").length;const proposals=leads.filter(l=>l.status==="proposal").length;const highIntent=leads.filter(l=>l.intent_score>=70).length;

  const questions=selected?[
    selected.annual_energy_kwh?`Wie hat sich der Stromverbrauch von rund ${num(selected.annual_energy_kwh," kWh/Jahr")} in den letzten 12 Monaten entwickelt?`:"Wie hoch ist der jährliche Stromverbrauch und liegt ein aktuelles Lastprofil vor?",
    selected.roof_area_m2?`Welche Teile der vorhandenen Dachfläche von etwa ${num(selected.roof_area_m2," m²")} sind statisch und technisch nutzbar?`:"Welche Dach- oder Freiflächen stehen zur Verfügung und wem gehören sie?",
    selected.pv_present===true?"Wie groß ist die bestehende PV-Anlage, wie wird der Strom genutzt und wo bestehen Erweiterungsmöglichkeiten?":"Gibt es bereits PV, Speicher, Wärmepumpe, Ladeinfrastruktur oder andere Eigenstromlösungen?",
    "Zu welchen Tageszeiten entstehen die höchsten Lastspitzen und welche Betriebszeiten gelten?",
    "Soll die Lösung primär Eigenstromkosten senken, Versorgungssicherheit erhöhen oder Nachhaltigkeitsziele erfüllen?",
    "Wie läuft die Investitionsentscheidung intern: Wer entscheidet mit, welches Budgetmodell ist bevorzugt und bis wann soll eine Lösung stehen?",
  ]:[];

  function briefText(){if(!selected)return"";return [`MEETING BRIEF · ${selected.company_name}`,`Ansprechpartner: ${selected.contact_name||"offen"}${selected.contact_title?` · ${selected.contact_title}`:""}`,`Opportunity: ${selected.total_score}/100 · Intent: ${selected.intent_score}/100 · PV: ${selected.pv_score}/100 · Energie: ${selected.energy_score}/100`,`Ausgangslage: ${selected.summary||"noch nicht vollständig"}`,qual?`Qualifizierung: ${qual.interest}${qual.timeline?` · ${qual.timeline}`:""}${qual.notes?` · ${qual.notes}`:""}`:"Qualifizierung: noch keine",inbound?`Letzte Antwort: ${inbound.subject||inbound.body_text?.slice(0,300)||"Antwort erhalten"}`:"Letzte Antwort: keine",`Video: ${watch}% maximale Watchtime`,`Angebot: ${docs.length?`${docs[0].title} · ${docs[0].view_count} Views`:"noch keines"}`,`Research-Signale: ${research.signals.join(", ")||"noch keine"}`,"",...questions.map((q,i)=>`${i+1}. ${q}`),"",`Nächster Schritt: ${selected.next_action||"Business Case konkretisieren und Entscheider/Timing sichern."}`].join("\n")}

  async function copyBrief(){try{await navigator.clipboard.writeText(briefText());setNotice("Meeting Brief kopiert.")}catch{setError("Brief konnte nicht in die Zwischenablage kopiert werden.")}}

  async function moveToProposal(){if(!supabase||!selected)return;setBusy(true);setError(null);try{
    const now=new Date().toISOString();const {error:leadError}=await supabase.from("energy_leads").update({status:"proposal",next_action:"Angebot konkretisieren, senden und Angebots-Tracking aktivieren.",updated_at:now}).eq("id",selected.id).eq("user_id",user.id);if(leadError)throw leadError;
    const existing=deals.find(d=>d.lead_id===selected.id);
    if(existing){const {error:e}=await supabase.from("energy_deals").update({stage:"proposal",probability:Math.max(existing.probability||0,60),updated_at:now}).eq("id",existing.id).eq("user_id",user.id);if(e)throw e}else{const {error:e}=await supabase.from("energy_deals").insert({user_id:user.id,lead_id:selected.id,title:`Energieprojekt · ${selected.company_name}`,stage:"proposal",probability:60});if(e)throw e}
    await supabase.from("energy_activities").insert({user_id:user.id,lead_id:selected.id,activity_type:"meeting_handoff",title:"Termin → Angebot",detail:"Lead wurde nach dem Gespräch in die Angebotsphase überführt."});setNotice(`${selected.company_name} ist jetzt in der Angebotsphase.`);await load();
  }catch(x){setError(x instanceof Error?x.message:"Übergabe in Angebot fehlgeschlagen")}finally{setBusy(false)}}

  return <main className="os-root" style={{minHeight:"100vh"}}><div className="os-content" style={{maxWidth:1400,margin:"0 auto",paddingTop:28}}>
    <div className="os-section-head"><div><div className="os-kicker">Meeting Intelligence</div><h1 className="os-title">Termin vorbereitet. Abschluss im Fokus.</h1><p>Alle bekannten Signale und die wichtigsten Discovery-Fragen in einer Ansicht.</p></div><div className="os-toolbar"><a className="os-btn" href="/command">← Heute</a><a className="os-btn" href="/pipeline">Pipeline</a></div></div>
    {error?<div className="os-error">{error}</div>:null}{notice?<div className="os-success">{notice}</div>:null}
    <div className="os-grid os-kpis" style={{marginTop:18}}>{[[meetings,"Termine","im CRM"],[proposals,"Angebote","aktive Phase"],[highIntent,"High Intent","≥ 70"],[leads.length,"Meeting-Pool","engaged+"],[documents.reduce((s,d)=>s+d.view_count,0),"Angebots-Views","gesamt"]].map(([v,l,s])=><div className="os-card os-kpi" key={String(l)}><div className="os-kpi-label">{l}</div><div className="os-kpi-value">{v}</div><div className="os-kpi-sub">{s}</div></div>)}</div>

    <div className="os-columns" style={{gridTemplateColumns:"330px minmax(0,1fr)",marginTop:18}}>
      <section className="os-card os-section" style={{alignSelf:"start"}}><div className="os-kicker">Termine & Chancen</div><h2>Auswählen</h2><div className="os-grid" style={{gap:8}}>{leads.length?leads.map(l=><button key={l.id} className={`os-checkrow ${selected?.id===l.id?"selected":""}`} style={{textAlign:"left",width:"100%"}} onClick={()=>setSelectedId(l.id)}><span className={`os-pill ${l.status==="meeting"?"green":l.status==="proposal"?"hot":""}`}>{l.status}</span><div><strong>{l.company_name}</strong><small>{l.contact_name||l.city||""} · Intent {l.intent_score}</small></div></button>):<div className="os-empty">Noch keine qualifizierten Leads oder Termine.</div>}</div></section>

      {selected?<div className="os-grid" style={{gap:14}}>
        <section className="os-card os-section"><div className="os-section-head"><div><div className="os-kicker">Meeting Brief</div><h2>{selected.company_name}</h2><p>{[selected.contact_name,selected.contact_title,selected.city].filter(Boolean).join(" · ")}</p></div><div className="os-score">{selected.total_score}</div></div>
          <div className="os-grid" style={{gridTemplateColumns:"repeat(4,minmax(0,1fr))",gap:8}}>{[[selected.intent_score,"Intent"],[selected.pv_score,"PV"],[selected.energy_score,"Energie"],[watch,"Watchtime"]].map(([v,l])=><div className="os-callout" key={String(l)}><small>{l}</small><strong style={{display:"block",fontSize:20,marginTop:4}}>{v}{l==="Watchtime"?"%":""}</strong></div>)}</div>
          <div className="os-columns" style={{marginTop:14}}><div><h3>Ausgangslage</h3><p className="os-copy">{selected.summary||research.summary||"Research noch nicht vollständig."}</p><h3>Research-Signale</h3>{research.signals.length?research.signals.map((s,i)=><div className="os-checkrow" key={i}><span className="os-pill green">Signal</span><strong>{s}</strong></div>):<div className="os-empty">Noch keine Website-Signale.</div>}</div><div><h3>Qualifizierung</h3><div className="os-detail"><div className="os-detail-row"><span>Interesse</span><strong>{qual?.interest||"—"}</strong></div><div className="os-detail-row"><span>Zeitraum</span><strong>{qual?.timeline||"—"}</strong></div><div className="os-detail-row"><span>Letzte Antwort</span><div>{inbound?.subject||"—"}<small style={{display:"block"}}>{fmt(inbound?.created_at)}</small></div></div><div className="os-detail-row"><span>Angebot</span><strong>{docs.length?`${docs[0].view_count} Views`:"noch keines"}</strong></div></div></div></div>
        </section>

        <section className="os-card os-section"><div className="os-section-head"><div><div className="os-kicker">Discovery</div><h2>Diese Fragen müssen beantwortet werden</h2></div><button className="os-btn" onClick={()=>void copyBrief()}>Brief kopieren</button></div>{questions.map((q,i)=><div className="os-checkrow" key={i}><div className="os-score">{i+1}</div><strong>{q}</strong></div>)}</section>

        <section className="os-card os-section"><div className="os-section-head"><div><div className="os-kicker">Closing Path</div><h2>Nächster Schritt sichern</h2></div></div><div className="os-callout"><strong>Ziel des Termins</strong><p style={{margin:"7px 0 0"}}>Verbrauch + Lastprofil + nutzbare Fläche + bestehende Technik + Entscheider + Investitionsmodell + konkreten Zeitplan sichern. Der Termin endet nicht mit „wir melden uns“, sondern mit einem definierten nächsten Schritt.</p></div><div className="os-toolbar" style={{marginTop:14}}>{selected.phone?<a className="os-btn" href={`tel:${selected.phone}`}>📞 Kontakt anrufen</a>:null}{video?<a className="os-btn" target="_blank" href={`/v/${video.slug}`}>Video ↗</a>:null}<button className="os-btn primary" disabled={busy||selected.status==="proposal"} onClick={()=>void moveToProposal()}>{selected.status==="proposal"?"Bereits Angebot":"Termin abgeschlossen → Angebot"}</button><a className="os-btn" href="/proposals">Angebot erstellen →</a></div>{deal?<div className="os-source" style={{marginTop:10}}>Deal: {deal.stage} · Wahrscheinlichkeit {deal.probability}% · Wert {deal.value_eur?`${num(deal.value_eur," €")}`:"noch offen"}</div>:null}</section>
      </div>:null}
    </div>
  </div></main>;
}
