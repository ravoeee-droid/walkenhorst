"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type Deal={id:string;lead_id:string;title:string;stage:string;value_eur:number|null;probability:number;expected_close_date:string|null;lost_reason:string|null;won_at:string|null;lost_at:string|null;created_at:string;updated_at:string};
type StageEvent={id:number;deal_id:string;lead_id:string;from_stage:string|null;to_stage:string;value_eur:number|null;probability:number|null;created_at:string};
type Campaign={id:string;name:string;status:string;created_at:string;started_at:string|null};
type Message={id:string;campaign_id:string|null;lead_id:string;direction:string;status:string;sent_at:string|null;replied_at:string|null;created_at:string};
type Lead={id:string;company_name:string;status:string;total_score:number;intent_score:number;created_at:string;last_contact_at:string|null};
type Call={id:string;lead_id:string|null;direction:string;started_at:string|null;answered_at:string|null;ended_at:string|null;cause:string|null;sentiment:string|null;created_at:string};

const STAGES=[{id:"new",label:"Neu"},{id:"qualified",label:"Qualifiziert"},{id:"meeting",label:"Termin"},{id:"proposal",label:"Angebot"},{id:"negotiation",label:"Verhandlung"},{id:"won",label:"Gewonnen"},{id:"lost",label:"Verloren"}];
const money=(v:number)=>new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(v||0);
const pct=(a:number,b:number)=>b>0?Math.round((a/b)*100):0;
const days=(from:string,to:string)=>Math.max(0,(new Date(to).getTime()-new Date(from).getTime())/86400000);
const withinDays=(date:string|null|undefined,n:number)=>Boolean(date&&new Date(date).getTime()<=Date.now()+n*86400000&&new Date(date).getTime()>=Date.now()-86400000);

export function RevenueAnalytics({user}:{user:User}){
  const supabase=useMemo(()=>createSupabaseBrowserClient(),[]);
  const [deals,setDeals]=useState<Deal[]>([]);const [events,setEvents]=useState<StageEvent[]>([]);const [campaigns,setCampaigns]=useState<Campaign[]>([]);const [messages,setMessages]=useState<Message[]>([]);const [leads,setLeads]=useState<Lead[]>([]);const [calls,setCalls]=useState<Call[]>([]);const [error,setError]=useState<string|null>(null);
  const load=useCallback(async()=>{if(!supabase)return;const[d,e,c,m,l,callRows]=await Promise.all([
    supabase.from("energy_deals").select("id,lead_id,title,stage,value_eur,probability,expected_close_date,lost_reason,won_at,lost_at,created_at,updated_at").eq("user_id",user.id).order("updated_at",{ascending:false}).limit(5000),
    supabase.from("energy_deal_stage_events").select("id,deal_id,lead_id,from_stage,to_stage,value_eur,probability,created_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(15000),
    supabase.from("energy_campaigns").select("id,name,status,created_at,started_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(500),
    supabase.from("energy_messages").select("id,campaign_id,lead_id,direction,status,sent_at,replied_at,created_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(20000),
    supabase.from("energy_leads").select("id,company_name,status,total_score,intent_score,created_at,last_contact_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(10000),
    supabase.from("energy_calls").select("id,lead_id,direction,started_at,answered_at,ended_at,cause,sentiment,created_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(20000),
  ]);if(d.error){setError(d.error.message);return}setDeals((d.data||[]) as Deal[]);if(!e.error)setEvents((e.data||[]) as StageEvent[]);if(!c.error)setCampaigns((c.data||[]) as Campaign[]);if(!m.error)setMessages((m.data||[]) as Message[]);if(!l.error)setLeads((l.data||[]) as Lead[]);if(!callRows.error)setCalls((callRows.data||[]) as Call[])},[supabase,user.id]);
  useEffect(()=>{void load()},[load]);

  const active=deals.filter(d=>!["won","lost"].includes(d.stage));const wonDeals=deals.filter(d=>d.stage==="won");const lostDeals=deals.filter(d=>d.stage==="lost");
  const pipeline=active.reduce((s,d)=>s+Number(d.value_eur||0),0);const weighted=active.reduce((s,d)=>s+Number(d.value_eur||0)*(d.probability/100),0);const wonRevenue=wonDeals.reduce((s,d)=>s+Number(d.value_eur||0),0);const winRate=pct(wonDeals.length,wonDeals.length+lostDeals.length);
  const cycles=wonDeals.filter(d=>d.won_at).map(d=>days(d.created_at,d.won_at!));const avgCycle=cycles.length?Math.round(cycles.reduce((a,b)=>a+b,0)/cycles.length):0;
  const forecast30=active.filter(d=>withinDays(d.expected_close_date,30)).reduce((s,d)=>s+Number(d.value_eur||0)*(d.probability/100),0);const forecast60=active.filter(d=>withinDays(d.expected_close_date,60)).reduce((s,d)=>s+Number(d.value_eur||0)*(d.probability/100),0);const forecast90=active.filter(d=>withinDays(d.expected_close_date,90)).reduce((s,d)=>s+Number(d.value_eur||0)*(d.probability/100),0);

  const entered=(stage:string)=>new Set(events.filter(e=>e.to_stage===stage).map(e=>e.deal_id)).size;const enteredQualified=entered("qualified")||new Set(deals.map(d=>d.id)).size;const enteredMeeting=entered("meeting");const enteredProposal=entered("proposal");const enteredNegotiation=entered("negotiation");const enteredWon=entered("won");
  const funnel=[{label:"Qualifiziert",count:enteredQualified,rate:100},{label:"Termin",count:enteredMeeting,rate:pct(enteredMeeting,enteredQualified)},{label:"Angebot",count:enteredProposal,rate:pct(enteredProposal,enteredMeeting)},{label:"Verhandlung",count:enteredNegotiation,rate:pct(enteredNegotiation,enteredProposal)},{label:"Gewonnen",count:enteredWon,rate:pct(enteredWon,Math.max(enteredProposal,1))}];

  const lostReasons=useMemo(()=>{const map=new Map<string,number>();for(const d of lostDeals){const r=(d.lost_reason||"Nicht erfasst").trim()||"Nicht erfasst";map.set(r,(map.get(r)||0)+1)}return [...map.entries()].sort((a,b)=>b[1]-a[1])},[lostDeals]);
  const campaignRows=campaigns.map(c=>{const sent=messages.filter(m=>m.campaign_id===c.id&&m.direction==="outbound"&&!["queued","sending","failed","skipped"].includes(m.status)).length;const replies=new Set(messages.filter(m=>m.campaign_id===c.id&&m.direction==="inbound").map(m=>m.lead_id)).size;return{...c,sent,replies,rate:pct(replies,sent)}}).sort((a,b)=>b.sent-a.sent);
  const contacted=leads.filter(l=>l.last_contact_at).length;const engaged=leads.filter(l=>["engaged","qualified","meeting","proposal","won"].includes(l.status)).length;const meetings=leads.filter(l=>["meeting","proposal","won"].includes(l.status)).length;const proposals=leads.filter(l=>["proposal","won"].includes(l.status)).length;

  const outgoingCalls=calls.filter(c=>c.direction==="outgoing");
  const answeredCalls=outgoingCalls.filter(c=>c.answered_at||String(c.cause||"").toUpperCase()==="ANSWERED");
  const positiveCalls=calls.filter(c=>String(c.sentiment||"").toUpperCase()==="POSITIVE");
  const callLeadIds=new Set(calls.map(c=>c.lead_id).filter(Boolean) as string[]);
  const callLeadsMeetingPlus=leads.filter(l=>callLeadIds.has(l.id)&&["meeting","proposal","won"].includes(l.status)).length;
  const durations=answeredCalls.filter(c=>c.ended_at&&(c.answered_at||c.started_at)).map(c=>Math.max(0,(new Date(c.ended_at!).getTime()-new Date((c.answered_at||c.started_at)!).getTime())/1000));
  const avgCallMinutes=durations.length?Math.round((durations.reduce((a,b)=>a+b,0)/durations.length)/60):0;
  const answerRate=pct(answeredCalls.length,outgoingCalls.length);
  const callToMeeting=pct(callLeadsMeetingPlus,callLeadIds.size);
  const callKpis:Array<[string|number,string,string]>=[
    [outgoingCalls.length,"Ausgehende Calls","Rinkel"],
    [answeredCalls.length,"Beantwortet",`${answerRate}% Answer Rate`],
    [positiveCalls.length,"Positive Calls","AI Sentiment"],
    [`${avgCallMinutes} Min.`,"Ø Gespräch","beantwortete Calls"],
    [`${callToMeeting}%`,"Calls → Termin+",`${callLeadsMeetingPlus}/${callLeadIds.size} Call-Leads`],
  ];

  return <main className="os-root" style={{minHeight:"100vh"}}><div className="os-content" style={{maxWidth:1400,margin:"0 auto",paddingTop:28}}>
    <div className="os-section-head"><div><div className="os-kicker">Revenue Intelligence</div><h1 className="os-title">Was wird Umsatz – und wo verlieren wir ihn?</h1><p>Deal-History, Forecast, Conversion, Telefonie und Kampagnenleistung in einer Ansicht.</p></div><div className="os-toolbar"><a className="os-btn" href="/command">← Heute</a><a className="os-btn" href="/pipeline">Pipeline</a><button className="os-btn" onClick={()=>void load()}>↻ Aktualisieren</button></div></div>
    {error?<div className="os-error">{error}</div>:null}
    <div className="os-grid os-kpis" style={{marginTop:18}}>{[[money(pipeline),"Open Pipeline",`${active.length} Deals`],[money(weighted),"Weighted Forecast","Wahrscheinlichkeit gewichtet"],[money(wonRevenue),"Won Revenue",`${wonDeals.length} gewonnen`],[`${winRate}%`,"Win Rate",`${lostDeals.length} verloren`],[`${avgCycle} T`,"Sales Cycle","Ø bis Won"]].map(([v,l,s])=><div className="os-card os-kpi" key={String(l)}><div className="os-kpi-label">{l}</div><div className="os-kpi-value" style={{fontSize:String(v).length>10?22:undefined}}>{v}</div><div className="os-kpi-sub">{s}</div></div>)}</div>

    <div className="os-columns" style={{marginTop:18}}><section className="os-card os-section"><div className="os-kicker">Forecast</div><h2>Erwarteter Umsatz nach Close-Horizont</h2>{[[30,forecast30],[60,forecast60],[90,forecast90]].map(([n,v])=><div className="os-detail-row" key={n}><span>Nächste {n} Tage</span><strong>{money(Number(v))}</strong></div>)}</section><section className="os-card os-section"><div className="os-kicker">Lead Funnel</div><h2>Akquise → Abschluss</h2><div className="os-detail-row"><span>Leads</span><strong>{leads.length}</strong></div><div className="os-detail-row"><span>Kontaktiert</span><strong>{contacted} · {pct(contacted,leads.length)}%</strong></div><div className="os-detail-row"><span>Interessiert+</span><strong>{engaged} · {pct(engaged,contacted)}%</strong></div><div className="os-detail-row"><span>Termin+</span><strong>{meetings} · {pct(meetings,engaged)}%</strong></div><div className="os-detail-row"><span>Angebot+</span><strong>{proposals} · {pct(proposals,meetings)}%</strong></div></section></div>

    <section className="os-card os-section" style={{marginTop:18}}><div className="os-section-head"><div><div className="os-kicker">Rinkel Call Performance</div><h2>Anrufen → Gespräch → Termin</h2></div><a className="os-btn" href="/calls">Caller Queue →</a></div><div className="os-grid" style={{gridTemplateColumns:"repeat(5,minmax(0,1fr))",gap:10}}>{callKpis.map(([v,l,s])=><div className="os-callout" key={l}><small>{l}</small><strong style={{display:"block",fontSize:27,marginTop:6}}>{v}</strong><span style={{fontSize:9,color:"#8792a4"}}>{s}</span></div>)}</div></section>

    <section className="os-card os-section" style={{marginTop:18}}><div className="os-section-head"><div><div className="os-kicker">Deal Conversion</div><h2>Stage-to-Stage</h2></div><span className="os-pill">History-basiert</span></div><div className="os-grid" style={{gridTemplateColumns:"repeat(5,minmax(0,1fr))",gap:10}}>{funnel.map((f,i)=><div className="os-callout" key={f.label}><small>{i===0?"Basis":`Conversion aus Vorstufe`}</small><strong style={{display:"block",fontSize:28,marginTop:6}}>{f.count}</strong><span className={`os-pill ${f.rate>=50?"green":f.rate<25&&i>0?"hot":""}`}>{f.rate}%</span><div style={{marginTop:7,fontWeight:800}}>{f.label}</div></div>)}</div></section>

    <div className="os-columns" style={{marginTop:18}}><section className="os-card os-section"><div className="os-kicker">Verlustanalyse</div><h2>Warum Deals verloren gehen</h2>{lostReasons.length?lostReasons.map(([reason,count])=><div className="os-detail-row" key={reason}><span>{reason}</span><strong>{count} · {pct(count,lostDeals.length)}%</strong></div>):<div className="os-empty">Noch keine verlorenen Deals.</div>}</section><section className="os-card os-section"><div className="os-kicker">Pipeline Mix</div><h2>Aktueller Wert je Stufe</h2>{STAGES.filter(s=>!["won","lost"].includes(s.id)).map(s=>{const rows=deals.filter(d=>d.stage===s.id);const value=rows.reduce((a,d)=>a+Number(d.value_eur||0),0);return <div className="os-detail-row" key={s.id}><span>{s.label}</span><strong>{rows.length} · {money(value)}</strong></div>})}</section></div>

    <section className="os-card os-section" style={{marginTop:18}}><div className="os-section-head"><div><div className="os-kicker">Campaign Performance</div><h2>Versand → Reply</h2></div><a className="os-btn" href="/campaign-lab">Campaign Lab →</a></div><div className="os-tablewrap"><table className="os-table"><thead><tr><th>Kampagne</th><th>Status</th><th>Gesendet</th><th>Antwortende Leads</th><th>Reply Rate</th></tr></thead><tbody>{campaignRows.length?campaignRows.slice(0,50).map(c=><tr key={c.id}><td><strong>{c.name}</strong></td><td><span className={`os-pill ${c.status==="active"?"green":""}`}>{c.status}</span></td><td>{c.sent}</td><td>{c.replies}</td><td><strong>{c.rate}%</strong></td></tr>):<tr><td colSpan={5}><div className="os-empty">Noch keine Kampagnendaten.</div></td></tr>}</tbody></table></div></section>
  </div></main>;
}
