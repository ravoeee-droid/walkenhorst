"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type Job={jobname:string;schedule:string;active:boolean;last_status:string|null;last_started_at:string|null;last_finished_at:string|null;last_message:string|null};
type Health={checked_at:string;jobs:Job[];failed_cron_runs_24h:number;http_ok_24h:number;http_errors_24h:number};
type Integration={id:string;provider:string;label:string|null;status:string;last_tested_at:string|null;last_error:string|null;base_url:string|null};
type Mailbox={id:string;email_address:string;status:string;daily_limit:number;sent_today:number;imap_host:string|null;last_tested_at:string|null;last_sync_at:string|null;last_error:string|null};

function fmt(v:string|null|undefined){if(!v)return"—";try{return new Intl.DateTimeFormat("de-DE",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(new Date(v))}catch{return"—"}}

export function SystemHealthCenter({user}:{user:User}){
  const supabase=useMemo(()=>createSupabaseBrowserClient(),[]);
  const [health,setHealth]=useState<Health|null>(null);
  const [integrations,setIntegrations]=useState<Integration[]>([]);
  const [mailboxes,setMailboxes]=useState<Mailbox[]>([]);
  const [stats,setStats]=useState({failedMessages:0,pendingAutomation:0,failedAutomation:0,activeCampaigns:0,leads:0});
  const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const [notice,setNotice]=useState<string|null>(null);

  const load=useCallback(async()=>{
    if(!supabase)return;setError(null);
    const since=new Date(Date.now()-24*60*60*1000).toISOString();
    const [h,i,m,fm,pa,fa,ac,l]=await Promise.all([
      supabase.functions.invoke("system-health",{body:{}}),
      supabase.from("energy_integrations").select("id,provider,label,status,last_tested_at,last_error,base_url").eq("user_id",user.id).order("provider"),
      supabase.from("energy_mailboxes").select("id,email_address,status,daily_limit,sent_today,imap_host,last_tested_at,last_sync_at,last_error").eq("user_id",user.id).order("email_address"),
      supabase.from("energy_messages").select("id",{count:"exact",head:true}).eq("user_id",user.id).eq("status","failed").gte("created_at",since),
      supabase.from("energy_automation_outbox").select("id",{count:"exact",head:true}).eq("user_id",user.id).in("status",["queued","sending"]),
      supabase.from("energy_automation_outbox").select("id",{count:"exact",head:true}).eq("user_id",user.id).eq("status","failed"),
      supabase.from("energy_campaigns").select("id",{count:"exact",head:true}).eq("user_id",user.id).eq("status","active"),
      supabase.from("energy_leads").select("id",{count:"exact",head:true}).eq("user_id",user.id),
    ]);
    if(h.error){setError(h.error.message);return}setHealth(h.data as Health);
    if(!i.error)setIntegrations((i.data||[]) as Integration[]);if(!m.error)setMailboxes((m.data||[]) as Mailbox[]);
    setStats({failedMessages:fm.count||0,pendingAutomation:pa.count||0,failedAutomation:fa.count||0,activeCampaigns:ac.count||0,leads:l.count||0});
  },[supabase,user.id]);
  useEffect(()=>{void load()},[load]);

  const jobHealthy=(j:Job)=>j.active&&(!j.last_status||j.last_status==="succeeded");
  const requiredJobs=["walkenhorst-outbound-worker","walkenhorst-inbox-worker","walkenhorst-automation-worker"];
  const missingJobs=requiredJobs.filter(name=>!health?.jobs?.some(j=>j.jobname===name&&j.active));
  const readyMailboxes=mailboxes.filter(m=>m.status==="ready");
  const errorIntegrations=integrations.filter(i=>i.status==="error");
  let score=100;
  score-=missingJobs.length*18;
  score-=Math.min(25,(health?.failed_cron_runs_24h||0)*5);
  if(mailboxes.length&&!readyMailboxes.length)score-=20;
  score-=Math.min(15,stats.failedMessages*3);
  score-=Math.min(15,stats.failedAutomation*5);
  score-=Math.min(15,errorIntegrations.length*5);
  score=Math.max(0,score);
  const overall=score>=90?"Operational":score>=70?"Beobachten":"Handlungsbedarf";

  async function runOutbound(){if(!supabase)return;setBusy(true);setError(null);try{const {data,error:e}=await supabase.functions.invoke("campaign-worker",{body:{limit:25,baseUrl:window.location.origin}});if(e||data?.error)throw new Error(data?.error||e?.message);setNotice(`Outbound Worker: ${data?.sent||0} gesendet · ${data?.manual||0} Call-Tasks · ${data?.failed||0} Fehler.`);await load()}catch(x){setError(x instanceof Error?x.message:"Worker fehlgeschlagen")}finally{setBusy(false)}}

  async function testIntegrations(){if(!supabase)return;setBusy(true);setError(null);let ok=0,fail=0;try{for(const i of integrations.filter(x=>x.status!=="disabled")){const {data,error:e}=await supabase.functions.invoke("integration-admin",{body:{action:"test",provider:i.provider}});if(e||!data?.ok)fail++;else ok++}setNotice(`Integrationstest: ${ok} erreichbar · ${fail} mit Fehler.`);await load()}finally{setBusy(false)}}

  async function syncInbox(){if(!supabase)return;setBusy(true);setError(null);let total=0,fail=0;try{for(const m of readyMailboxes.filter(x=>x.imap_host)){const {data,error:e}=await supabase.functions.invoke("mailbox-admin",{body:{action:"sync",id:m.id}});if(e||data?.error)fail++;else total+=Number(data?.synced||0)}setNotice(`Inbox Sync: ${total} neue Antworten · ${fail} Mailbox-Fehler.`);await load()}finally{setBusy(false)}}

  return <main className="os-root" style={{minHeight:"100vh"}}><div className="os-content" style={{maxWidth:1320,margin:"0 auto",paddingTop:28}}>
    <div className="os-section-head"><div><div className="os-kicker">Operations & Reliability</div><h1 className="os-title">System Health Center</h1><p>Live-Zustand von Versand, Inbox, Automation, Integrationen und Queue.</p></div><div className="os-toolbar"><a className="os-btn" href="/dashboard">← Dashboard</a><button className="os-btn" disabled={busy} onClick={()=>void load()}>↻ Aktualisieren</button></div></div>
    {error?<div className="os-error">{error}</div>:null}{notice?<div className="os-success">{notice}</div>:null}
    <div className="os-grid os-kpis" style={{marginTop:18}}>
      <div className="os-card os-kpi"><div className="os-kpi-label">Health Score</div><div className="os-kpi-value">{score}</div><div className="os-kpi-sub">{overall}</div></div>
      <div className="os-card os-kpi"><div className="os-kpi-label">Cron Fehler 24h</div><div className="os-kpi-value">{health?.failed_cron_runs_24h??"—"}</div><div className="os-kpi-sub">3 Kernjobs erwartet</div></div>
      <div className="os-card os-kpi"><div className="os-kpi-label">HTTP Worker 24h</div><div className="os-kpi-value">{health?.http_ok_24h??"—"}</div><div className="os-kpi-sub">{health?.http_errors_24h??0} Fehler</div></div>
      <div className="os-card os-kpi"><div className="os-kpi-label">Automation Queue</div><div className="os-kpi-value">{stats.pendingAutomation}</div><div className="os-kpi-sub">{stats.failedAutomation} dauerhaft fehlgeschlagen</div></div>
      <div className="os-card os-kpi"><div className="os-kpi-label">Sending</div><div className="os-kpi-value">{readyMailboxes.length}</div><div className="os-kpi-sub">Mailboxen bereit · {stats.failedMessages} Mailfehler/24h</div></div>
    </div>

    <div className="os-columns" style={{marginTop:18}}>
      <section className="os-card os-section"><div className="os-section-head"><div><div className="os-kicker">Core Workers</div><h2>Automatische Hintergrundjobs</h2></div><span className={`os-pill ${missingJobs.length?"hot":"green"}`}>{missingJobs.length?`${missingJobs.length} fehlt`:"vollständig"}</span></div>
        {(health?.jobs||[]).map(j=><div className="os-checkrow" key={j.jobname}><span className={`os-pill ${jobHealthy(j)?"green":"hot"}`}>{j.last_status||"noch kein Lauf"}</span><div><strong>{j.jobname}</strong><small>{j.schedule} · zuletzt {fmt(j.last_started_at)}{j.last_message?` · ${j.last_message}`:""}</small></div><span>{j.active?"aktiv":"aus"}</span></div>)}
        {missingJobs.length?<div className="os-error" style={{marginTop:10}}>Fehlende Jobs: {missingJobs.join(", ")}</div>:null}
        <div className="os-toolbar" style={{marginTop:14}}><button className="os-btn primary" disabled={busy} onClick={()=>void runOutbound()}>Outbound jetzt ausführen</button><button className="os-btn" disabled={busy||!readyMailboxes.some(m=>m.imap_host)} onClick={()=>void syncInbox()}>Inbox jetzt synchronisieren</button></div>
      </section>

      <section className="os-card os-section"><div className="os-section-head"><div><div className="os-kicker">System Load</div><h2>Aktueller Betrieb</h2></div></div>
        {[[stats.leads,"Leads im CRM"],[stats.activeCampaigns,"Aktive Kampagnen"],[stats.pendingAutomation,"Automation Jobs offen"],[stats.failedAutomation,"Automation dauerhaft fehlgeschlagen"],[stats.failedMessages,"E-Mail-Fehler letzte 24h"]].map(([v,l])=><div className="os-detail-row" key={String(l)}><span>{l}</span><strong>{v}</strong></div>)}
      </section>
    </div>

    <div className="os-columns" style={{marginTop:18}}>
      <section className="os-card os-section"><div className="os-section-head"><div><div className="os-kicker">Integrationen</div><h2>{integrations.length} Provider konfiguriert</h2></div><button className="os-btn" disabled={busy||!integrations.length} onClick={()=>void testIntegrations()}>Alle testen</button></div>
        {integrations.length?integrations.map(i=><div className="os-checkrow" key={i.id}><span className={`os-pill ${i.status==="ready"?"green":i.status==="error"?"hot":""}`}>{i.status}</span><div><strong>{i.label||i.provider}</strong><small>{i.base_url||"keine URL"} · Test {fmt(i.last_tested_at)}{i.last_error?` · ${i.last_error}`:""}</small></div></div>):<div className="os-empty">Noch keine externen Provider verbunden.</div>}
      </section>

      <section className="os-card os-section"><div className="os-section-head"><div><div className="os-kicker">Mailboxen</div><h2>{mailboxes.length} Absender</h2></div></div>
        {mailboxes.length?mailboxes.map(m=><div className="os-checkrow" key={m.id}><span className={`os-pill ${m.status==="ready"?"green":m.status==="error"?"hot":""}`}>{m.status}</span><div><strong>{m.email_address}</strong><small>{m.sent_today}/{m.daily_limit} heute · Test {fmt(m.last_tested_at)} · Inbox {fmt(m.last_sync_at)}{m.last_error?` · ${m.last_error}`:""}</small></div></div>):<div className="os-empty">Noch keine Mailbox eingerichtet.</div>}
      </section>
    </div>
    <div className="os-source" style={{marginTop:14}}>Letzter Health-Check: {fmt(health?.checked_at)} · Nutzer: {user.email}</div>
  </div></main>;
}
