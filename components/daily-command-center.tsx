"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type Lead={id:string;company_name:string;contact_name:string|null;phone:string|null;email:string|null;status:string;total_score:number;intent_score:number;next_action:string|null;last_contact_at:string|null;last_replied_at:string|null;updated_at:string};
type Followup={id:string;lead_id:string;title:string;due_at:string;priority:string;status:string;reason:string|null;created_at:string};
type Message={id:string;lead_id:string;direction:string;status:string;subject:string|null;created_at:string;sent_at:string|null;replied_at:string|null};
type Video={id:string;lead_id:string;slug:string;status:string};
type VideoEvent={video_page_id:string;event_type:string;watch_percent:number|null;created_at:string};
type Document={id:string;lead_id:string;title:string;status:string;view_count:number;last_viewed_at:string|null;tracking_token:string};
type Qualification={id:string;lead_id:string;interest:string;timeline:string|null;created_at:string};
type Campaign={id:string;name:string;status:string;created_at:string};
type Mailbox={id:string;email_address:string;status:string;last_error:string|null};
type Action={id:string;leadId:string|null;score:number;kind:string;title:string;company:string;reason:string;href:string;cta:string;dueAt:string|null;tone:"hot"|"high"|"normal"};

function fmt(v:string|null|undefined){if(!v)return"—";try{return new Intl.DateTimeFormat("de-DE",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(v))}catch{return"—"}}
function ageHours(v:string|null|undefined){if(!v)return 99999;return Math.max(0,(Date.now()-new Date(v).getTime())/3600000)}

export function DailyCommandCenter({user}:{user:User}){
  const supabase=useMemo(()=>createSupabaseBrowserClient(),[]);
  const [leads,setLeads]=useState<Lead[]>([]);const [followups,setFollowups]=useState<Followup[]>([]);const [messages,setMessages]=useState<Message[]>([]);const [videos,setVideos]=useState<Video[]>([]);const [videoEvents,setVideoEvents]=useState<VideoEvent[]>([]);const [documents,setDocuments]=useState<Document[]>([]);const [qualifications,setQualifications]=useState<Qualification[]>([]);const [campaigns,setCampaigns]=useState<Campaign[]>([]);const [mailboxes,setMailboxes]=useState<Mailbox[]>([]);
  const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const [notice,setNotice]=useState<string|null>(null);const [showAll,setShowAll]=useState(false);

  const load=useCallback(async()=>{
    if(!supabase)return;setError(null);
    const [l,f,m,v,ve,d,q,c,mb]=await Promise.all([
      supabase.from("energy_leads").select("id,company_name,contact_name,phone,email,status,total_score,intent_score,next_action,last_contact_at,last_replied_at,updated_at").eq("user_id",user.id).order("updated_at",{ascending:false}).limit(3000),
      supabase.from("energy_followups").select("id,lead_id,title,due_at,priority,status,reason,created_at").eq("user_id",user.id).eq("status","open").order("due_at",{ascending:true}).limit(2000),
      supabase.from("energy_messages").select("id,lead_id,direction,status,subject,created_at,sent_at,replied_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(5000),
      supabase.from("energy_video_pages").select("id,lead_id,slug,status").eq("user_id",user.id).neq("status","archived").limit(3000),
      supabase.from("energy_video_events").select("video_page_id,event_type,watch_percent,created_at").order("created_at",{ascending:false}).limit(10000),
      supabase.from("energy_documents").select("id,lead_id,title,status,view_count,last_viewed_at,tracking_token").eq("user_id",user.id).neq("status","archived").order("updated_at",{ascending:false}).limit(3000),
      supabase.from("energy_qualifications").select("id,lead_id,interest,timeline,created_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(3000),
      supabase.from("energy_campaigns").select("id,name,status,created_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(300),
      supabase.from("energy_mailboxes").select("id,email_address,status,last_error").eq("user_id",user.id).order("email_address"),
    ]);
    if(l.error){setError(l.error.message);return}setLeads((l.data||[]) as Lead[]);if(!f.error)setFollowups((f.data||[]) as Followup[]);if(!m.error)setMessages((m.data||[]) as Message[]);if(!v.error)setVideos((v.data||[]) as Video[]);if(!ve.error)setVideoEvents((ve.data||[]) as VideoEvent[]);if(!d.error)setDocuments((d.data||[]) as Document[]);if(!q.error)setQualifications((q.data||[]) as Qualification[]);if(!c.error)setCampaigns((c.data||[]) as Campaign[]);if(!mb.error)setMailboxes((mb.data||[]) as Mailbox[]);
  },[supabase,user.id]);
  useEffect(()=>{void load()},[load]);

  const actions=useMemo(()=>{
    const result:Action[]=[];const leadById=new Map(leads.map(l=>[l.id,l]));
    const latestInbound=new Map<string,Message>();const latestOutbound=new Map<string,Message>();
    for(const m of messages){if(m.direction==="inbound"&&!latestInbound.has(m.lead_id))latestInbound.set(m.lead_id,m);if(m.direction==="outbound"&&!latestOutbound.has(m.lead_id))latestOutbound.set(m.lead_id,m)}

    for(const [leadId,inbound] of latestInbound){const l=leadById.get(leadId);if(!l||["lost","won"].includes(l.status))continue;const outbound=latestOutbound.get(leadId);if(!outbound||new Date(outbound.created_at)<new Date(inbound.created_at))result.push({id:`reply-${inbound.id}`,leadId,score:1800+Math.max(l.intent_score,70),kind:"Antwort",title:"Jetzt auf Antwort reagieren",company:l.company_name,reason:inbound.subject||"Neue E-Mail-Antwort ist noch unbeantwortet.",href:l.phone?"/calls":"/dashboard",cta:l.phone?"Kontakt öffnen":"CRM öffnen",dueAt:inbound.created_at,tone:"hot"})}

    for(const q of qualifications){const l=leadById.get(q.lead_id);if(!l||["meeting","proposal","won","lost"].includes(l.status)||ageHours(q.created_at)>336)continue;result.push({id:`qual-${q.id}`,leadId:l.id,score:1700+l.intent_score,kind:"Qualifiziert",title:"Qualifizierten Interessenten kontaktieren",company:l.company_name,reason:`Interesse: ${q.interest}${q.timeline?` · Zeitraum: ${q.timeline}`:""}`,href:l.phone?"/calls":"/pipeline",cta:l.phone?"Jetzt anrufen":"Pipeline öffnen",dueAt:q.created_at,tone:"hot"})}

    for(const d of documents){const l=leadById.get(d.lead_id);if(!l||["won","lost"].includes(l.status))continue;if(d.view_count>=3)result.push({id:`doc-${d.id}`,leadId:l.id,score:1650+d.view_count*30+l.intent_score,kind:"Angebot",title:"Angebot mehrfach geöffnet",company:l.company_name,reason:`${d.title} wurde ${d.view_count}× geöffnet. Das ist ein starkes Kaufsignal.`,href:l.phone?"/calls":"/proposals",cta:l.phone?"Jetzt anrufen":"Angebote öffnen",dueAt:d.last_viewed_at,tone:"hot"})}

    const maxWatch=new Map<string,{watch:number;at:string}>();
    for(const v of videos){const rows=videoEvents.filter(e=>e.video_page_id===v.id);const watch=rows.reduce((max,e)=>Math.max(max,e.watch_percent||0),0);const last=rows[0]?.created_at;if(watch>=75&&last){const old=maxWatch.get(v.lead_id);if(!old||watch>old.watch)maxWatch.set(v.lead_id,{watch,at:last})}}
    for(const [leadId,w] of maxWatch){const l=leadById.get(leadId);if(!l||["meeting","proposal","won","lost"].includes(l.status)||ageHours(w.at)>168)continue;result.push({id:`video-${leadId}`,leadId,score:1350+w.watch+l.intent_score,kind:"Video",title:"Video intensiv angesehen",company:l.company_name,reason:`${w.watch}% Watchtime – innerhalb der letzten 7 Tage.`,href:l.phone?"/calls":"/dashboard",cta:l.phone?"Jetzt anrufen":"Lead öffnen",dueAt:w.at,tone:w.watch>=90?"hot":"high"})}

    for(const f of followups){const l=leadById.get(f.lead_id);if(!l||["won","lost"].includes(l.status))continue;const overdue=new Date(f.due_at).getTime()<=Date.now();result.push({id:`followup-${f.id}`,leadId:l.id,score:1100+(f.priority==="hot"?350:f.priority==="high"?180:50)+(overdue?300:0)+l.intent_score,kind:"Follow-up",title:f.title,company:l.company_name,reason:f.reason||l.next_action||"Offene Wiedervorlage",href:l.phone?"/calls":"/dashboard",cta:l.phone?"Bearbeiten / anrufen":"CRM öffnen",dueAt:f.due_at,tone:f.priority==="hot"||overdue?"hot":f.priority==="high"?"high":"normal"})}

    for(const l of leads){if(["won","lost","meeting","proposal"].includes(l.status))continue;const hasExisting=result.some(a=>a.leadId===l.id);if(hasExisting)continue;if(l.status==="engaged"&&ageHours(l.last_contact_at)>24)result.push({id:`engaged-${l.id}`,leadId:l.id,score:1050+l.intent_score+l.total_score,kind:"Hot Lead",title:"Interessierten Lead nachfassen",company:l.company_name,reason:l.next_action||`Intent ${l.intent_score}/100`,href:l.phone?"/calls":"/dashboard",cta:l.phone?"Jetzt anrufen":"CRM öffnen",dueAt:l.last_contact_at,tone:"hot"});else if(["ready","research","new"].includes(l.status)&&l.total_score>=75&&!l.last_contact_at)result.push({id:`alead-${l.id}`,leadId:l.id,score:800+l.total_score+l.intent_score,kind:"A-Lead",title:"A-Lead erstmals kontaktieren",company:l.company_name,reason:l.next_action||`Opportunity ${l.total_score}/100`,href:l.phone?"/calls":"/prep",cta:l.phone?"Jetzt anrufen":"Lead vorbereiten",dueAt:null,tone:"high"})}

    return result.sort((a,b)=>b.score-a.score);
  },[leads,followups,messages,videos,videoEvents,documents,qualifications]);

  const displayed=showAll?actions:actions.slice(0,10);const hot=actions.filter(a=>a.tone==="hot").length;const overdue=followups.filter(f=>new Date(f.due_at).getTime()<=Date.now()).length;const inboundOpen=actions.filter(a=>a.kind==="Antwort").length;const proposalHot=actions.filter(a=>a.kind==="Angebot").length;const unhealthyMailboxes=mailboxes.filter(m=>m.status==="error"||m.last_error).length;

  async function completeFollowup(action:Action){if(!supabase||!action.id.startsWith("followup-"))return;setBusy(true);setError(null);try{const id=action.id.replace("followup-","");const {error:e}=await supabase.from("energy_followups").update({status:"done",completed_at:new Date().toISOString()}).eq("id",id);if(e)throw e;setNotice(`${action.company}: Follow-up erledigt.`);await load()}catch(x){setError(x instanceof Error?x.message:"Follow-up konnte nicht abgeschlossen werden")}finally{setBusy(false)}}

  return <main className="os-root" style={{minHeight:"100vh"}}><div className="os-content" style={{maxWidth:1360,margin:"0 auto",paddingTop:28}}>
    <div className="os-section-head"><div><div className="os-kicker">Next Best Action Engine</div><h1 className="os-title">Heute zählt nur das hier.</h1><p>Antworten, Kaufsignale und überfällige Aktionen werden automatisch nach Umsatznähe sortiert.</p></div><div className="os-toolbar"><a className="os-btn" href="/dashboard">← Dashboard</a><a className="os-btn primary" href="/calls">☎ Caller Queue</a><button className="os-btn" disabled={busy} onClick={()=>void load()}>↻ Aktualisieren</button></div></div>
    {error?<div className="os-error">{error}</div>:null}{notice?<div className="os-success">{notice}</div>:null}
    <div className="os-grid os-kpis" style={{marginTop:18}}>{[[actions.length,"Offene Aktionen","priorisiert"],[hot,"Hot Actions","sofort"],[inboundOpen,"Antworten offen","noch unbeantwortet"],[proposalHot,"Heiße Angebote","3+ Öffnungen"],[overdue,"Überfällige Follow-ups","jetzt erledigen"]].map(([v,l,s])=><div className="os-card os-kpi" key={String(l)}><div className="os-kpi-label">{l}</div><div className="os-kpi-value">{v}</div><div className="os-kpi-sub">{s}</div></div>)}</div>

    <div className="os-columns" style={{gridTemplateColumns:"minmax(0,1.55fr) minmax(320px,.6fr)",marginTop:18}}>
      <section className="os-card os-section"><div className="os-section-head"><div><div className="os-kicker">Priorität</div><h2>{showAll?"Alle Aktionen":"Top 10 für heute"}</h2></div><button className="os-btn" onClick={()=>setShowAll(v=>!v)}>{showAll?"Nur Top 10":"Alle anzeigen"}</button></div>
        <div className="os-grid" style={{gap:9}}>{displayed.length?displayed.map((a,index)=><div className="os-checkrow" key={a.id} style={{alignItems:"center"}}><div className="os-score">{index+1}</div><span className={`os-pill ${a.tone==="hot"?"hot":a.tone==="high"?"green":""}`}>{a.kind}</span><div style={{minWidth:0,flex:1}}><strong>{a.title} · {a.company}</strong><small>{a.reason}{a.dueAt?` · ${fmt(a.dueAt)}`:""}</small></div><div className="os-toolbar"><a className={`os-btn small ${a.tone==="hot"?"primary":""}`} href={a.href}>{a.cta}</a>{a.id.startsWith("followup-")?<button className="os-btn small" disabled={busy} onClick={()=>void completeFollowup(a)}>✓ Erledigt</button>:null}</div></div>):<div className="os-empty">Keine dringenden Aktionen. Lead Prep starten oder neue Leads suchen.</div>}</div>
      </section>

      <aside className="os-grid" style={{alignSelf:"start"}}>
        <section className="os-card os-section"><div className="os-kicker">Execution Flow</div><h2>Empfohlene Reihenfolge</h2><div className="os-detail"><div className="os-detail-row"><span>1</span><strong>Antworten</strong></div><div className="os-detail-row"><span>2</span><strong>Angebots-Kaufsignale</strong></div><div className="os-detail-row"><span>3</span><strong>Qualifizierte Interessenten</strong></div><div className="os-detail-row"><span>4</span><strong>Hot Follow-ups</strong></div><div className="os-detail-row"><span>5</span><strong>A-Leads</strong></div></div><div className="os-toolbar" style={{marginTop:14}}><a className="os-btn primary" href="/calls">Caller Queue</a><a className="os-btn" href="/prep">Lead Prep</a></div></section>
        <section className="os-card os-section"><div className="os-kicker">System Readiness</div><h2>Outbound bereit?</h2><div className="os-detail-row"><span>Aktive Kampagnen</span><strong>{campaigns.filter(c=>c.status==="active").length}</strong></div><div className="os-detail-row"><span>Mailbox Fehler</span><strong>{unhealthyMailboxes}</strong></div><div className="os-detail-row"><span>Leads im CRM</span><strong>{leads.length}</strong></div><div className="os-toolbar" style={{marginTop:14}}><a className="os-btn" href="/health">System Health →</a></div></section>
      </aside>
    </div>
  </div></main>;
}
