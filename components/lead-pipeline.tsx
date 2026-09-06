"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import styles from "./lead-pipeline.module.css";

type CustomerType = "commercial" | "private";
type LeadStatus = "new" | "research" | "ready" | "contacted" | "engaged" | "qualified" | "meeting" | "proposal" | "nurture" | "won" | "lost";
type Lead = {id:string;company_name:string;contact_name:string|null;email:string|null;phone:string|null;city:string|null;status:LeadStatus;customer_type:CustomerType;total_score:number;intent_score:number;next_action:string|null;updated_at:string};
type Workflow = {lead_id:string;email_sent:boolean;email_opened:boolean;email_clicked:boolean;page_viewed:boolean;video_played:boolean;max_watch_percent:number;cta_clicked:boolean;replied:boolean;workflow_stage_label:string|null;recommended_action:string|null};
type Deal = {id:string;lead_id:string;stage:string;value_eur:number|null;probability:number};
type Row = Lead & {workflow?:Workflow;deal?:Deal};
type Stage = {id:string;label:string;statuses:LeadStatus[];writeStatus:LeadStatus};

const STAGES:Stage[] = [
  {id:"new",label:"Neu",statuses:["new","research","ready"],writeStatus:"research"},
  {id:"contacted",label:"Kontaktiert",statuses:["contacted"],writeStatus:"contacted"},
  {id:"engaged",label:"Reagiert",statuses:["engaged"],writeStatus:"engaged"},
  {id:"qualified",label:"Qualifiziert",statuses:["qualified"],writeStatus:"qualified"},
  {id:"meeting",label:"Termin",statuses:["meeting"],writeStatus:"meeting"},
  {id:"proposal",label:"Angebot",statuses:["proposal"],writeStatus:"proposal"},
  {id:"nurture",label:"Wiedervorlage",statuses:["nurture"],writeStatus:"nurture"},
  {id:"won",label:"Gewonnen",statuses:["won"],writeStatus:"won"},
  {id:"lost",label:"Verloren",statuses:["lost"],writeStatus:"lost"},
];

const PROBABILITY:Record<LeadStatus,number> = {new:10,research:10,ready:15,contacted:20,engaged:30,qualified:40,meeting:55,proposal:70,nurture:20,won:100,lost:0};
const DEAL_STAGE:Partial<Record<LeadStatus,string>> = {new:"new",research:"new",ready:"new",contacted:"new",engaged:"qualified",qualified:"qualified",meeting:"meeting",proposal:"proposal",nurture:"qualified",won:"won",lost:"lost"};

function watch(w?:Workflow){return Math.max(0,Math.min(100,Number(w?.max_watch_percent||0)))}
function hot(r:Row){const w=r.workflow;return Boolean(w?.replied||w?.cta_clicked||w?.email_clicked||watch(w)>=75||r.intent_score>=70)}
function fmtMoney(v:number|null|undefined){return v==null?null:new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(v)}
function signalList(w?:Workflow){if(!w)return[];const s:{label:string;hot?:boolean}[]=[];if(w.replied)s.push({label:"Antwort",hot:true});if(w.cta_clicked)s.push({label:"CTA",hot:true});if(w.email_clicked)s.push({label:"Link geklickt",hot:true});if(w.video_played)s.push({label:`Video ${watch(w)}%`,hot:watch(w)>=75});if(w.page_viewed)s.push({label:"Seite besucht"});if(w.email_opened)s.push({label:"Mail geöffnet"});else if(w.email_sent)s.push({label:"Mail gesendet"});return s.slice(0,4)}

export function LeadPipeline({customerType}:{customerType:CustomerType}){
  const router=useRouter();
  const supabase=useMemo(()=>createSupabaseBrowserClient(),[]);
  const [rows,setRows]=useState<Row[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [search,setSearch]=useState("");
  const [hotOnly,setHotOnly]=useState(false);

  const load=useCallback(async()=>{
    if(!supabase)return;
    setLoading(true);setError(null);
    try{
      const session=(await supabase.auth.getSession()).data.session;
      if(!session)throw new Error("Session abgelaufen.");
      const uid=session.user.id;
      const [lr,fr,dr]=await Promise.all([
        supabase.from("energy_leads").select("id,company_name,contact_name,email,phone,city,status,customer_type,total_score,intent_score,next_action,updated_at").eq("user_id",uid).eq("customer_type",customerType).order("updated_at",{ascending:false}).limit(4000),
        supabase.from("energy_crm_lead_workflow").select("lead_id,email_sent,email_opened,email_clicked,page_viewed,video_played,max_watch_percent,cta_clicked,replied,workflow_stage_label,recommended_action").eq("user_id",uid).limit(5000),
        supabase.from("energy_deals").select("id,lead_id,stage,value_eur,probability").eq("user_id",uid).limit(4000),
      ]);
      if(lr.error)throw lr.error;
      const fm=new Map<string,Workflow>();for(const x of (fr.data||[]) as Workflow[])fm.set(x.lead_id,x);
      const dm=new Map<string,Deal>();for(const x of (dr.data||[]) as Deal[])dm.set(x.lead_id,x);
      setRows(((lr.data||[]) as Lead[]).map(l=>({...l,workflow:fm.get(l.id),deal:dm.get(l.id)})));
    }catch(e){setError(e instanceof Error?e.message:"Pipeline konnte nicht geladen werden.")}finally{setLoading(false)}
  },[customerType,supabase]);
  useEffect(()=>{void load()},[load]);

  const filtered=useMemo(()=>{
    const q=search.trim().toLowerCase();
    return rows.filter(r=>(!hotOnly||hot(r))&&(!q||[r.company_name,r.contact_name,r.email,r.city,r.next_action].filter(Boolean).join(" ").toLowerCase().includes(q)));
  },[rows,search,hotOnly]);

  const metrics=useMemo(()=>({
    total:rows.length,
    reacted:rows.filter(r=>r.status==="engaged"||r.workflow?.email_clicked||r.workflow?.cta_clicked||r.workflow?.replied||watch(r.workflow)>=50).length,
    hot:rows.filter(hot).length,
    meetings:rows.filter(r=>r.status==="meeting").length,
    proposals:rows.filter(r=>r.status==="proposal").length,
    won:rows.filter(r=>r.status==="won").length,
  }),[rows]);

  async function moveLead(leadId:string,status:LeadStatus){
    if(!supabase||busy)return;
    const row=rows.find(r=>r.id===leadId);if(!row)return;
    setBusy(leadId);setError(null);
    try{
      const session=(await supabase.auth.getSession()).data.session;if(!session)throw new Error("Session abgelaufen.");
      const uid=session.user.id,now=new Date().toISOString();
      const up=await supabase.from("energy_leads").update({status,updated_at:now}).eq("id",leadId).eq("user_id",uid);if(up.error)throw up.error;
      const dealStage=DEAL_STAGE[status];
      if(dealStage&&(row.deal||["qualified","meeting","proposal","won","lost"].includes(status))){
        const payload:any={user_id:uid,lead_id:leadId,title:`${row.company_name} · Energieprojekt`,stage:dealStage,probability:PROBABILITY[status],updated_at:now};
        if(row.deal?.value_eur!=null)payload.value_eur=row.deal.value_eur;
        if(status==="won")payload.won_at=now;if(status==="lost")payload.lost_at=now;
        const d=await supabase.from("energy_deals").upsert(payload,{onConflict:"user_id,lead_id"});if(d.error)throw d.error;
      }
      await load();
    }catch(e){setError(e instanceof Error?e.message:"Stadium konnte nicht geändert werden.")}finally{setBusy(null)}
  }

  if(loading)return <div className={styles.loading}>Pipeline wird geladen …</div>;
  const commercial=customerType==="commercial";
  return <main className={styles.root}>
    <header className={styles.header}>
      <div><span>Sales Pipeline</span><h1>{commercial?"B2B · Gewerbe":"B2C · Privatkunden"}</h1><p>Jeder Lead steht in genau einem Stadium. Interaktionen und nächste Schritte sind direkt an der Karte sichtbar.</p></div>
      <div className={styles.switcher}><a className={commercial?styles.active:""} href="/pipeline/b2b">B2B</a><a className={!commercial?styles.active:""} href="/pipeline/b2c">B2C</a></div>
    </header>

    <section className={styles.metrics}>
      <article><small>Leads</small><strong>{metrics.total}</strong></article>
      <article><small>Reagiert</small><strong>{metrics.reacted}</strong></article>
      <article><small>Hot</small><strong>{metrics.hot}</strong></article>
      <article><small>Termine</small><strong>{metrics.meetings}</strong></article>
      <article><small>Angebote</small><strong>{metrics.proposals}</strong></article>
      <article><small>Gewonnen</small><strong>{metrics.won}</strong></article>
    </section>

    {error?<div className={styles.error}>{error}</div>:null}
    <div className={styles.toolbar}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder={commercial?"Firma, Ansprechpartner, E-Mail, Ort …":"Name, E-Mail, Ort …"}/><label><input type="checkbox" checked={hotOnly} onChange={e=>setHotOnly(e.target.checked)}/> Nur Leads mit Signal</label><strong>{filtered.length} sichtbar</strong></div>

    <section className={styles.board}>
      {STAGES.map(stage=>{const list=filtered.filter(r=>stage.statuses.includes(r.status));return <div className={styles.column} key={stage.id} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const id=e.dataTransfer.getData("text/lead");if(id)void moveLead(id,stage.writeStatus)}}>
        <div className={styles.columnHead}><strong>{stage.label}</strong><span>{list.length}</span></div>
        <div className={styles.cards}>{list.length?list.map(r=>{const signals=signalList(r.workflow);return <button className={`${styles.card} ${hot(r)?styles.cardHot:""}`} key={r.id} draggable onDragStart={e=>e.dataTransfer.setData("text/lead",r.id)} onClick={()=>router.push(`/leads/${r.id}`)} disabled={busy===r.id}>
          <div className={styles.cardTop}><div><strong>{r.company_name}</strong><small>{r.contact_name||"Ansprechpartner offen"}{r.city?` · ${r.city}`:""}</small></div><b>{r.intent_score}</b></div>
          {signals.length?<div className={styles.signals}>{signals.map(x=><span className={x.hot?styles.signalHot:""} key={x.label}>{x.label}</span>)}</div>:<div className={styles.noSignal}>Noch keine Interaktion</div>}
          <div className={styles.cardBottom}><span>{r.next_action||r.workflow?.recommended_action||"Nächsten Schritt prüfen"}</span>{r.deal?.value_eur!=null?<em>{fmtMoney(r.deal.value_eur)}</em>:null}</div>
        </button>}):<div className={styles.empty}>Keine Leads</div>}</div>
      </div>})}
    </section>
  </main>;
}
