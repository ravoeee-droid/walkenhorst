"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type Lead={id:string;company_name:string;contact_name:string|null;phone:string|null;email:string|null;city:string|null;industry:string|null;total_score:number;intent_score:number;pitch:string|null;next_action:string|null;status:string;last_contact_at:string|null;metadata:Record<string,unknown>|null;updated_at:string};
type Followup={id:string;lead_id:string;title:string;due_at:string;priority:string;status:string;reason:string|null};
type Activity={id:string;lead_id:string|null;activity_type:string;title:string;detail:string|null;metadata:Record<string,unknown>|null;created_at:string};
type Video={lead_id:string;slug:string;status:string};

type Outcome="no_answer"|"reached"|"interested"|"meeting"|"callback"|"not_interested"|"wrong_number";
const OUTCOMES:Array<{id:Outcome;label:string;className?:string}>=[
  {id:"no_answer",label:"Nicht erreicht"},{id:"reached",label:"Erreicht"},{id:"interested",label:"Interesse",className:"primary"},
  {id:"meeting",label:"Termin ✓",className:"primary"},{id:"callback",label:"Rückruf"},{id:"not_interested",label:"Kein Interesse"},{id:"wrong_number",label:"Falsche Nummer"},
];
function fmt(v:string|null|undefined){if(!v)return"—";try{return new Intl.DateTimeFormat("de-DE",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(v))}catch{return"—"}}
function due(f:Followup|undefined){return Boolean(f&&new Date(f.due_at).getTime()<=Date.now())}

export function CallerQueue({user}:{user:User}){
  const supabase=useMemo(()=>createSupabaseBrowserClient(),[]);
  const [leads,setLeads]=useState<Lead[]>([]);const [followups,setFollowups]=useState<Followup[]>([]);const [activities,setActivities]=useState<Activity[]>([]);const [videos,setVideos]=useState<Video[]>([]);
  const [selectedId,setSelectedId]=useState<string|null>(null);const [note,setNote]=useState("");const [callbackAt,setCallbackAt]=useState("");const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const [notice,setNotice]=useState<string|null>(null);

  const load=useCallback(async()=>{
    if(!supabase)return;
    const today=new Date();today.setHours(0,0,0,0);
    const [l,f,a,v]=await Promise.all([
      supabase.from("energy_leads").select("id,company_name,contact_name,phone,email,city,industry,total_score,intent_score,pitch,next_action,status,last_contact_at,metadata,updated_at").eq("user_id",user.id).not("phone","is",null).limit(2000),
      supabase.from("energy_followups").select("id,lead_id,title,due_at,priority,status,reason").eq("user_id",user.id).eq("status","open").order("due_at",{ascending:true}).limit(2000),
      supabase.from("energy_activities").select("id,lead_id,activity_type,title,detail,metadata,created_at").eq("user_id",user.id).gte("created_at",today.toISOString()).order("created_at",{ascending:false}).limit(1500),
      supabase.from("energy_video_pages").select("lead_id,slug,status").eq("user_id",user.id).neq("status","archived").limit(3000),
    ]);
    if(l.error){setError(l.error.message);return}setLeads((l.data||[]) as Lead[]);if(!f.error)setFollowups((f.data||[]) as Followup[]);if(!a.error)setActivities((a.data||[]) as Activity[]);if(!v.error)setVideos((v.data||[]) as Video[]);
  },[supabase,user.id]);
  useEffect(()=>{void load()},[load]);

  const queue=useMemo(()=>{
    return leads.filter(l=>!["won","lost"].includes(l.status)&&l.phone&&(l.metadata as any)?.phone_status!=="invalid").map(l=>{
      const f=followups.find(x=>x.lead_id===l.id);
      let priority=l.intent_score*3+l.total_score*2;
      if(l.status==="engaged")priority+=350;if(l.status==="meeting")priority+=500;if(f?.priority==="hot")priority+=450;if(due(f))priority+=500;if(!l.last_contact_at)priority+=80;
      const reason=f?.reason||f?.title||(l.intent_score>=70?`Intent ${l.intent_score}/100`:l.total_score>=75?`A-Lead ${l.total_score}/100`:l.next_action||"Outbound bereit");
      return{lead:l,followup:f,priority,reason};
    }).sort((a,b)=>b.priority-a.priority);
  },[leads,followups]);

  useEffect(()=>{if(!selectedId&&queue.length)setSelectedId(queue[0].lead.id);if(selectedId&&!queue.some(q=>q.lead.id===selectedId))setSelectedId(queue[0]?.lead.id||null)},[queue,selectedId]);
  const selected=queue.find(q=>q.lead.id===selectedId)||queue[0]||null;
  const callsToday=activities.filter(a=>a.activity_type==="call_outcome").length;
  const meetingsToday=activities.filter(a=>a.activity_type==="call_outcome"&&(a.metadata as any)?.outcome==="meeting").length;
  const interestedToday=activities.filter(a=>a.activity_type==="call_outcome"&&["interested","meeting"].includes(String((a.metadata as any)?.outcome||""))).length;
  const hot=queue.filter(q=>q.lead.intent_score>=70||q.followup?.priority==="hot").length;

  async function record(outcome:Outcome){
    if(!supabase||!selected)return;setBusy(true);setError(null);setNotice(null);
    try{
      if(outcome==="callback"&&!callbackAt)throw new Error("Bitte für den Rückruf zuerst Datum und Uhrzeit wählen.");
      const {data,error:e}=await supabase.rpc("energy_record_call_outcome",{p_lead_id:selected.lead.id,p_outcome:outcome,p_note:note.trim()||null,p_callback_at:outcome==="callback"?new Date(callbackAt).toISOString():null});
      if(e)throw e;setNotice(`${selected.lead.company_name}: ${OUTCOMES.find(x=>x.id===outcome)?.label} gespeichert.`);setNote("");setCallbackAt("");
      const currentIndex=queue.findIndex(q=>q.lead.id===selected.lead.id);const next=queue[currentIndex+1]||queue[0];await load();setSelectedId(next?.lead.id===selected.lead.id?null:next?.lead.id||null);
      return data;
    }catch(x){setError(x instanceof Error?x.message:"Call-Outcome konnte nicht gespeichert werden")}finally{setBusy(false)}
  }

  return <main className="os-root" style={{minHeight:"100vh"}}><div className="os-content" style={{maxWidth:1400,margin:"0 auto",paddingTop:28}}>
    <div className="os-section-head"><div><div className="os-kicker">Sales Execution</div><h1 className="os-title">Caller Queue</h1><p>Die stärksten Leads zuerst. Anrufen → Ergebnis klicken → nächster Lead.</p></div><div className="os-toolbar"><a className="os-btn" href="/dashboard">← Dashboard</a><button className="os-btn" disabled={busy} onClick={()=>void load()}>↻ Queue aktualisieren</button></div></div>
    {error?<div className="os-error">{error}</div>:null}{notice?<div className="os-success">{notice}</div>:null}
    <div className="os-grid os-kpis" style={{marginTop:18}}>{[[queue.length,"Call Queue","offene Kontakte"],[hot,"Hot Leads","Intent / Follow-up"],[callsToday,"Calls heute","gespeichert"],[interestedToday,"Interesse heute","inkl. Termine"],[meetingsToday,"Termine heute","Call Outcome"]].map(([v,l,s])=><div className="os-card os-kpi" key={String(l)}><div className="os-kpi-label">{l}</div><div className="os-kpi-value">{v}</div><div className="os-kpi-sub">{s}</div></div>)}</div>

    <div className="os-columns" style={{gridTemplateColumns:"minmax(0,1.1fr) minmax(390px,.8fr)",marginTop:18}}>
      <section className="os-card"><div className="os-section" style={{marginBottom:0}}><div className="os-section-head"><div><div className="os-kicker">Priorisiert</div><h2>Nächste Anrufe</h2></div><span className="os-pill hot">{queue.length}</span></div></div>
        <div className="os-tablewrap"><table className="os-table"><thead><tr><th>Unternehmen</th><th>Score</th><th>Intent</th><th>Warum jetzt?</th><th>Letzter Call</th></tr></thead><tbody>{queue.slice(0,150).map(q=><tr key={q.lead.id} onClick={()=>setSelectedId(q.lead.id)} style={{cursor:"pointer",background:selected?.lead.id===q.lead.id?"rgba(255,107,22,.05)":undefined}}><td><strong>{q.lead.company_name}</strong><small style={{display:"block"}}>{q.lead.contact_name||q.lead.city||q.lead.industry||""}</small></td><td><div className="os-score">{q.lead.total_score}</div></td><td><span className={`os-pill ${q.lead.intent_score>=70?"hot":""}`}>{q.lead.intent_score}</span></td><td><strong>{q.reason}</strong>{q.followup?<small style={{display:"block"}}>fällig {fmt(q.followup.due_at)}</small>:null}</td><td>{fmt(q.lead.last_contact_at)}</td></tr>)}</tbody></table></div>
      </section>

      <aside className="os-grid" style={{alignSelf:"start",position:"sticky",top:18}}>{selected?<section className="os-card os-section">
        <div className="os-section-head"><div><div className="os-kicker">Jetzt anrufen</div><h2>{selected.lead.company_name}</h2><p>{[selected.lead.contact_name,selected.lead.city,selected.lead.industry].filter(Boolean).join(" · ")}</p></div><div className="os-score">{selected.lead.total_score}</div></div>
        <div className="os-callout"><strong>Warum jetzt?</strong><p style={{margin:"7px 0 0"}}>{selected.reason}</p></div>
        <div className="os-detail" style={{marginTop:12}}><div className="os-detail-row"><span>Telefon</span><strong>{selected.lead.phone}</strong></div><div className="os-detail-row"><span>Intent</span><strong>{selected.lead.intent_score}/100</strong></div><div className="os-detail-row"><span>Status</span><strong>{selected.lead.status}</strong></div><div className="os-detail-row"><span>Next Action</span><div>{selected.lead.next_action||"Anrufen"}</div></div></div>
        <div className="os-callout" style={{marginTop:12}}><strong>Call Opener</strong><p style={{margin:"7px 0 0",lineHeight:1.55}}>{selected.lead.pitch||`Guten Tag, ich habe mir ${selected.lead.company_name} kurz angesehen und dabei einen möglichen Hebel bei Energie/PV gefunden. Passt es gerade für zwei Minuten?`}</p></div>
        <div className="os-toolbar" style={{marginTop:14}}><a className="os-btn primary" style={{flex:1}} href={`tel:${selected.lead.phone}`}>📞 Jetzt anrufen</a>{videos.find(v=>v.lead_id===selected.lead.id)?<a className="os-btn" target="_blank" href={`/v/${videos.find(v=>v.lead_id===selected.lead.id)?.slug}`}>Video ↗</a>:null}</div>
        <div className="os-field"><label>Call Notiz</label><textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Einwand, Bedarf, Verbrauch, Zeitpunkt …"/></div>
        <div className="os-field"><label>Rückrufzeit</label><input type="datetime-local" value={callbackAt} onChange={e=>setCallbackAt(e.target.value)}/></div>
        <div className="os-grid" style={{gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:8,marginTop:12}}>{OUTCOMES.map(o=><button key={o.id} className={`os-btn ${o.className||""}`} disabled={busy} onClick={()=>void record(o.id)}>{o.label}</button>)}</div>
        <div className="os-tabs"><button className="os-tab active">Heute</button></div><div className="os-timeline">{activities.filter(a=>a.lead_id===selected.lead.id).slice(0,8).map(a=><div className="os-event" key={a.id}><strong>{a.title}</strong>{a.detail?<div>{a.detail}</div>:null}<small>{fmt(a.created_at)}</small></div>)}{!activities.some(a=>a.lead_id===selected.lead.id)?<div className="os-empty">Heute noch keine Aktivität.</div>:null}</div>
      </section>:<section className="os-card os-empty">Keine Leads mit gültiger Telefonnummer in der Queue.</section>}</aside>
    </div>
  </div></main>;
}
