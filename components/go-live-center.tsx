"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type Mailbox={id:string;email_address:string;status:string;last_error:string|null;last_bounce_error:string|null};
type Integration={id:string;provider:string;status:string;last_error:string|null};
type Lead={id:string;phone:string|null;email:string|null;email_status:string;metadata:Record<string,unknown>;do_not_contact:boolean;status:string};
type Alert={id:string;severity:string;status:string;due_at:string|null};
type Bounce={id:number;bounce_type:string;created_at:string};
type Message={id:string;status:string;direction:string;created_at:string};
const WORKERS=["walkenhorst-outbound-worker","walkenhorst-inbox-worker","walkenhorst-automation-worker","walkenhorst-rinkel-reconcile","walkenhorst-bounce-worker","walkenhorst-alert-worker"];

export function GoLiveCenter({user}:{user:User}){
 const supabase=useMemo(()=>createSupabaseBrowserClient(),[]);const[mailboxes,setMailboxes]=useState<Mailbox[]>([]);const[integrations,setIntegrations]=useState<Integration[]>([]);const[leads,setLeads]=useState<Lead[]>([]);const[alerts,setAlerts]=useState<Alert[]>([]);const[bounces,setBounces]=useState<Bounce[]>([]);const[messages,setMessages]=useState<Message[]>([]);const[duplicates,setDuplicates]=useState<number>(0);const[health,setHealth]=useState<any>(null);const[publicBaseUrl,setPublicBaseUrl]=useState<string|null>(null);const[busy,setBusy]=useState(false);const[error,setError]=useState<string|null>(null);
 const load=useCallback(async()=>{if(!supabase)return;setBusy(true);setError(null);try{const since=new Date(Date.now()-7*86400_000).toISOString();const[mb,i,l,a,b,m,d,h,r]=await Promise.all([
  supabase.from("energy_mailboxes").select("id,email_address,status,last_error,last_bounce_error").eq("user_id",user.id),
  supabase.from("energy_integrations").select("id,provider,status,last_error").eq("user_id",user.id),
  supabase.from("energy_leads").select("id,phone,email,email_status,metadata,do_not_contact,status").eq("user_id",user.id).limit(20000),
  supabase.from("energy_alerts").select("id,severity,status,due_at").eq("user_id",user.id).neq("status","done").limit(5000),
  supabase.from("energy_bounces").select("id,bounce_type,created_at").eq("user_id",user.id).gte("created_at",since).limit(5000),
  supabase.from("energy_messages").select("id,status,direction,created_at").eq("user_id",user.id).eq("direction","outbound").gte("created_at",since).limit(20000),
  supabase.rpc("energy_find_duplicate_leads",{p_limit:500}),
  supabase.functions.invoke("system-health",{body:{}}),
  supabase.from("energy_runtime_settings").select("public_base_url").eq("user_id",user.id).maybeSingle(),
 ]);if(mb.error)throw mb.error;setMailboxes((mb.data||[]) as Mailbox[]);if(!i.error)setIntegrations((i.data||[]) as Integration[]);if(!l.error)setLeads((l.data||[]) as Lead[]);if(!a.error)setAlerts((a.data||[]) as Alert[]);if(!b.error)setBounces((b.data||[]) as Bounce[]);if(!m.error)setMessages((m.data||[]) as Message[]);if(!d.error)setDuplicates(((d.data||[]) as Array<{confidence:number}>).filter(x=>x.confidence>=80).length);if(!h.error)setHealth(h.data);if(!r.error)setPublicBaseUrl(r.data?.public_base_url||null)}catch(x){setError(x instanceof Error?x.message:"Readiness konnte nicht geladen werden")}finally{setBusy(false)}},[supabase,user.id]);useEffect(()=>{void load()},[load]);
 const readyMail=mailboxes.filter(m=>m.status==="ready"&&!m.last_error&&!m.last_bounce_error).length;const rinkel=integrations.some(i=>i.provider==="rinkel"&&i.status==="ready");const optional=integrations.filter(i=>["firecrawl","reacher","googlemaps","chatwoot","activepieces"].includes(i.provider)&&i.status==="ready").length;const contactable=leads.filter(l=>!l.do_not_contact&&l.status!=="won"&&l.status!=="lost"&&((l.phone&&String((l.metadata as any)?.phone_status||"")!=="invalid")||(l.email&&l.email_status!=="invalid"))).length;const critical=alerts.filter(a=>a.status==="open"&&a.severity==="critical").length;const sent=messages.filter(m=>!["queued","sending","failed","skipped"].includes(m.status)).length;const hard=bounces.filter(b=>b.bounce_type==="hard").length;const bounceRate=sent?Math.round((bounces.length/sent)*1000)/10:0;
 const canonicalReady=Boolean(publicBaseUrl&&/^https:\/\//i.test(publicBaseUrl));
 const jobsRaw=Array.isArray(health?.jobs)?health.jobs:Array.isArray(health?.cron_jobs)?health.cron_jobs:Array.isArray(health?.crons)?health.crons:[];const jobs=jobsRaw.map((j:any)=>({name:String(j.jobname||j.name||""),active:j.active!==false}));const activeJobs=WORKERS.filter(n=>jobs.some((j:any)=>j.name===n&&j.active)).length;
 const checks=[
  {ok:canonicalReady,required:true,title:"Kanonische öffentliche App-URL",detail:canonicalReady?String(publicBaseUrl):"noch nicht gespeichert",href:"/settings"},
  {ok:readyMail>=1,required:true,title:"Mindestens 1 gesunde Mailbox",detail:`${readyMail}/${mailboxes.length} bereit`,href:"/integrations"},
  {ok:activeJobs===6,required:true,title:"6 Hintergrundworker aktiv",detail:`${activeJobs}/6 erkannt`,href:"/health-v2"},
  {ok:contactable>0,required:true,title:"Kontaktierbare Leads vorhanden",detail:`${contactable} aktuell nutzbar`,href:"/opportunities"},
  {ok:critical===0,required:true,title:"Keine offenen Critical Alerts",detail:`${critical} offen`,href:"/alerts"},
  {ok:bounceRate<5,required:true,title:"Bounce-Risiko unter internem Stop-Level",detail:`${bounceRate}% · ${hard} hard / 7 Tage`,href:"/deliverability"},
  {ok:duplicates===0,required:false,title:"Keine High-Confidence Dubletten",detail:`${duplicates} Review-Paare`,href:"/data-hygiene"},
  {ok:rinkel,required:false,title:"Rinkel verbunden",detail:rinkel?"Telefonie bereit":"für Calling noch verbinden",href:"/integrations"},
  {ok:optional>=2,required:false,title:"Intelligence Provider",detail:`${optional}/5 optionale Provider ready`,href:"/integrations"},
 ];
 const required=checks.filter(c=>c.required);const requiredOk=required.filter(c=>c.ok).length;const optionalChecks=checks.filter(c=>!c.required);const optionalOk=optionalChecks.filter(c=>c.ok).length;const score=Math.round((requiredOk/required.length)*80+(optionalOk/optionalChecks.length)*20);const state=requiredOk===required.length?"Go-Live bereit":"Noch nicht freigeben";
 return <main className="os-root" style={{minHeight:"100vh"}}><div className="os-content" style={{maxWidth:1400,margin:"0 auto",paddingTop:28}}>
  <div className="os-section-head"><div><div className="os-kicker">Launch Control</div><h1 className="os-title">Walkenhorst Go-Live Center</h1><p>Ein operativer Readiness-Check statt Bauchgefühl.</p></div><div className="os-toolbar"><a className="os-btn" href="/command">← Sales OS</a><a className="os-btn" href="/settings">⚙ Einstellungen</a><button className="os-btn primary" disabled={busy} onClick={()=>void load()}>↻ Vollcheck</button></div></div>{error?<div className="os-error">{error}</div>:null}
  <div className="os-grid os-kpis" style={{marginTop:18}}><div className="os-card os-kpi"><div className="os-kpi-label">Readiness</div><div className="os-kpi-value">{score}%</div><div className="os-kpi-sub">{state}</div></div><div className="os-card os-kpi"><div className="os-kpi-label">Pflichtchecks</div><div className="os-kpi-value">{requiredOk}/{required.length}</div><div className="os-kpi-sub">müssen grün sein</div></div><div className="os-card os-kpi"><div className="os-kpi-label">Mailboxen</div><div className="os-kpi-value">{readyMail}</div><div className="os-kpi-sub">gesund & bereit</div></div><div className="os-card os-kpi"><div className="os-kpi-label">Leads</div><div className="os-kpi-value">{contactable}</div><div className="os-kpi-sub">kontaktierbar</div></div><div className="os-card os-kpi"><div className="os-kpi-label">Critical Alerts</div><div className="os-kpi-value">{critical}</div><div className="os-kpi-sub">offen</div></div></div>
  <section className="os-grid" style={{gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:12,marginTop:18}}>{checks.map(c=><a className="os-card os-section" href={c.href} key={c.title} style={{display:"block",textDecoration:"none",borderColor:c.ok?"#cdebdc":c.required?"#f1c2c2":undefined}}><div className="os-section-head"><div><div className="os-kicker">{c.required?"Pflicht":"Optional"}</div><h2>{c.title}</h2></div><span className={`os-pill ${c.ok?"green":"hot"}`}>{c.ok?"bereit":"prüfen"}</span></div><p style={{fontSize:11,color:"#6f7d90",marginBottom:0}}>{c.detail}</p></a>)}</section>
  <section className="os-card os-section" style={{marginTop:18}}><div className="os-kicker">Schnellstart</div><h2>Empfohlene Arbeitsreihenfolge</h2><div className="os-grid" style={{gridTemplateColumns:"repeat(4,minmax(0,1fr))",gap:10}}>{[["1","/opportunities","Opportunities","Top-Leads priorisieren"],["2","/sales-brief","Sales Brief","Opener & Fragen"],["3","/calls","Caller Queue","persönlich kontaktieren"],["4","/alerts","Alerts","Hot Signals sofort abarbeiten"]].map(([n,href,title,text])=><a href={href} className="os-callout" key={href} style={{textDecoration:"none"}}><span className="os-pill">{n}</span><strong style={{display:"block",marginTop:8}}>{title}</strong><small>{text}</small></a>)}</div></section>
  <div className="os-callout" style={{marginTop:16}}><strong>Go-Live-Regel:</strong> Readiness ist ein interner Betriebscheck. Er ersetzt keine rechtliche Prüfung der Kontaktstrategie oder technische PV-Planung.</div><div className="os-source" style={{marginTop:10}}>Nutzer: {user.email}</div>
 </div></main>;
}
