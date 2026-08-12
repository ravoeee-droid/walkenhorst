"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { scoreEnergyLead, slugifyCompany } from "@/lib/energy-score";

type Lead={
  id:string;company_name:string;website:string|null;city:string|null;industry:string|null;employees:number|null;location_count:number;
  roof_area_m2:number|null;annual_energy_kwh:number|null;pv_present:boolean|null;contact_name:string|null;phone:string|null;email:string|null;
  email_status:string|null;total_score:number;pv_score:number;energy_score:number;intent_score:number;contactability_score:number;summary:string|null;
  pitch:string|null;next_action:string|null;status:string;research_context:Record<string,unknown>|null;enriched_at:string|null;email_verified_at:string|null;updated_at:string;
};
type Integration={provider:string;status:string};
type Video={id:string;lead_id:string;slug:string;status:string};
type PrepState={status:"idle"|"running"|"done"|"error";step:string;warnings:string[]};

function clamp(n:number){return Math.max(0,Math.min(100,Math.round(n)))}
function fmt(value:string|null|undefined){if(!value)return"—";try{return new Intl.DateTimeFormat("de-DE",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(value))}catch{return"—"}}

export function LeadPrepCenter({user}:{user:User}){
  const supabase=useMemo(()=>createSupabaseBrowserClient(),[]);
  const [leads,setLeads]=useState<Lead[]>([]);
  const [videos,setVideos]=useState<Video[]>([]);
  const [integrations,setIntegrations]=useState<Integration[]>([]);
  const [states,setStates]=useState<Record<string,PrepState>>({});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const [search,setSearch]=useState("");

  const load=useCallback(async()=>{
    if(!supabase)return;
    const [l,v,i]=await Promise.all([
      supabase.from("energy_leads").select("id,company_name,website,city,industry,employees,location_count,roof_area_m2,annual_energy_kwh,pv_present,contact_name,phone,email,email_status,total_score,pv_score,energy_score,intent_score,contactability_score,summary,pitch,next_action,status,research_context,enriched_at,email_verified_at,updated_at").eq("user_id",user.id).order("total_score",{ascending:false}).limit(1000),
      supabase.from("energy_video_pages").select("id,lead_id,slug,status").eq("user_id",user.id).neq("status","archived").limit(3000),
      supabase.from("energy_integrations").select("provider,status").eq("user_id",user.id),
    ]);
    if(l.error){setError(l.error.message);return}
    setLeads((l.data||[]) as Lead[]);if(!v.error)setVideos((v.data||[]) as Video[]);if(!i.error)setIntegrations((i.data||[]) as Integration[]);
  },[supabase,user.id]);

  useEffect(()=>{void load()},[load]);
  const ready=(provider:string)=>integrations.some(i=>i.provider===provider&&i.status==="ready");
  const filtered=leads.filter(l=>`${l.company_name} ${l.city||""} ${l.industry||""}`.toLowerCase().includes(search.toLowerCase()));
  const prepared=leads.filter(l=>l.status==="ready"&&videos.some(v=>v.lead_id===l.id)).length;

  function mark(id:string,status:PrepState["status"],step:string,warnings:string[]=[]){setStates(s=>({...s,[id]:{status,step,warnings}}))}

  async function freshLead(id:string){
    if(!supabase)throw new Error("Supabase nicht verbunden");
    const {data,error:e}=await supabase.from("energy_leads").select("*").eq("id",id).eq("user_id",user.id).single();
    if(e||!data)throw new Error(e?.message||"Lead nicht gefunden");return data as Lead;
  }

  async function ensureVideo(lead:Lead){
    if(!supabase)throw new Error("Supabase nicht verbunden");
    const {data:old}=await supabase.from("energy_video_pages").select("id,lead_id,slug,status").eq("user_id",user.id).eq("lead_id",lead.id).neq("status","archived").limit(1).maybeSingle();
    if(old)return old as Video;
    const research=(lead.research_context?.firecrawl as {signals?:string[]} | undefined)?.signals||[];
    const bullets=[`${lead.pv_score}/100 PV-Potenzial`,`${lead.energy_score}/100 Energieeffizienz-Potenzial`,...research.slice(0,2),lead.summary||"Individueller Energie-Potenzialcheck"].slice(0,4);
    const {data,error:e}=await supabase.from("energy_video_pages").insert({
      user_id:user.id,lead_id:lead.id,slug:slugifyCompany(lead.company_name),company_name:lead.company_name,prospect_name:lead.contact_name,
      website_url:lead.website,headline:`Kurze Energie-Analyse für ${lead.company_name}`,intro_text:lead.summary,bullets,
      cta_label:"Kostenlosen Potenzialcheck vereinbaren",cta_url:"https://www.walkenhorst-eko.de/",duration_seconds:97,status:"ready",is_public:true,
    }).select("id,lead_id,slug,status").single();
    if(e||!data)throw new Error(e?.message||"Video konnte nicht erstellt werden");return data as Video;
  }

  async function prepareLead(input:Lead){
    if(!supabase)return false;
    const warnings:string[]=[];mark(input.id,"running","Research starten …",warnings);
    try{
      let lead=await freshLead(input.id);

      if(lead.website&&!lead.enriched_at){
        if(ready("firecrawl")){
          mark(lead.id,"running","Website & Entscheider analysieren …",warnings);
          const {data,error:e}=await supabase.functions.invoke("intelligence-hub",{body:{action:"enrich_lead",leadId:lead.id}});
          if(e||data?.error)warnings.push(`Firecrawl: ${data?.error||e?.message||"fehlgeschlagen"}`);
          lead=await freshLead(lead.id);
        }else warnings.push("Firecrawl nicht verbunden");
      }

      if(lead.email&&!["valid","invalid"].includes(String(lead.email_status||""))){
        if(ready("reacher")){
          mark(lead.id,"running","E-Mail verifizieren …",warnings);
          const {data,error:e}=await supabase.functions.invoke("intelligence-hub",{body:{action:"verify_email",leadId:lead.id}});
          if(e||data?.error)warnings.push(`Reacher: ${data?.error||e?.message||"fehlgeschlagen"}`);
          lead=await freshLead(lead.id);
        }else warnings.push("Reacher nicht verbunden");
      }

      mark(lead.id,"running","Opportunity neu berechnen …",warnings);
      const scored=scoreEnergyLead({company_name:lead.company_name,website:lead.website,city:lead.city,industry:lead.industry,employees:lead.employees,location_count:lead.location_count,roof_area_m2:lead.roof_area_m2,annual_energy_kwh:lead.annual_energy_kwh,pv_present:lead.pv_present,contact_name:lead.contact_name,phone:lead.phone,email:lead.email});
      const intent=Math.max(Number(lead.intent_score||0),scored.intentScore);
      const total=clamp(scored.pvScore*.38+scored.energyScore*.29+intent*.18+scored.contactabilityScore*.15);
      const canContact=Boolean(lead.phone||(lead.email&&lead.email_status!=="invalid"));
      const status=canContact&&total>=60?"ready":"research";
      const {error:updateError}=await supabase.from("energy_leads").update({pv_score:scored.pvScore,energy_score:scored.energyScore,intent_score:intent,contactability_score:scored.contactabilityScore,total_score:total,summary:scored.summary,pitch:scored.pitch,next_action:scored.nextAction,status,updated_at:new Date().toISOString()}).eq("id",lead.id).eq("user_id",user.id);
      if(updateError)throw updateError;
      lead=await freshLead(lead.id);

      mark(lead.id,"running","Personalisierte Analyse erstellen …",warnings);
      const video=await ensureVideo(lead);
      await supabase.from("energy_activities").insert({user_id:user.id,lead_id:lead.id,activity_type:"lead_prepared",title:"Lead automatisch vorbereitet",detail:`Score ${lead.total_score} · ${lead.email_status||"E-Mail offen"} · /v/${video.slug}`,metadata:{warnings}});
      mark(lead.id,"done",warnings.length?`Bereit · ${warnings.length} Hinweis(e)`:"Komplett bereit",warnings);
      return true;
    }catch(x){mark(input.id,"error",x instanceof Error?x.message:"Vorbereitung fehlgeschlagen",warnings);return false}
  }

  async function prepareOne(lead:Lead){setBusy(true);setError(null);setNotice(null);try{const ok=await prepareLead(lead);setNotice(ok?`${lead.company_name} ist vorbereitet.`:`${lead.company_name}: Vorbereitung nicht vollständig.`);await load()}finally{setBusy(false)}}

  async function prepareTop(){
    setBusy(true);setError(null);setNotice("Top-Leads werden nacheinander vorbereitet …");
    try{
      const candidates=[...leads].filter(l=>l.status!=="won"&&l.status!=="lost"&&Boolean(l.website||l.email||l.phone)).sort((a,b)=>b.total_score-a.total_score).slice(0,10);
      let ok=0;for(const lead of candidates){if(await prepareLead(lead))ok++}
      setNotice(`${ok}/${candidates.length} Top-Leads vorbereitet.`);await load();
    }finally{setBusy(false)}
  }

  return <main className="os-root" style={{minHeight:"100vh"}}><div className="os-content" style={{maxWidth:1320,margin:"0 auto",paddingTop:28}}>
    <div className="os-section-head"><div><div className="os-kicker">Revenue Preparation Engine</div><h1 className="os-title">Lead Prep Center</h1><p>Research → Verifizierung → Re-Score → persönliche Analyse. Ein Klick statt fünf manueller Schritte.</p></div><div className="os-toolbar"><a className="os-btn" href="/dashboard">← Dashboard</a><button className="os-btn primary" disabled={busy||!leads.length} onClick={()=>void prepareTop()}>{busy?"Vorbereitung läuft …":"Top 10 vorbereiten"}</button></div></div>
    {error?<div className="os-error">{error}</div>:null}{notice?<div className="os-success">{notice}</div>:null}
    <div className="os-grid os-kpis" style={{marginTop:18}}>{[[leads.length,"Leads","gesamt"],[prepared,"Komplett bereit","inkl. Video"],[leads.filter(l=>l.enriched_at).length,"Research","Firecrawl"],[leads.filter(l=>l.email_status==="valid").length,"Valid E-Mails","Reacher"],[leads.filter(l=>l.total_score>=75).length,"A-Leads","Score ≥ 75"]].map(([v,l,s])=><div className="os-card os-kpi" key={String(l)}><div className="os-kpi-label">{l}</div><div className="os-kpi-value">{v}</div><div className="os-kpi-sub">{s}</div></div>)}</div>
    <section className="os-card os-section"><div className="os-section-head"><div><div className="os-kicker">Queue</div><h2>Leads vorbereiten</h2></div><input className="os-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Unternehmen suchen"/></div>
      <div className="os-tablewrap"><table className="os-table"><thead><tr><th>Unternehmen</th><th>Score</th><th>Research</th><th>E-Mail</th><th>Video</th><th>Prep Status</th><th></th></tr></thead><tbody>{filtered.slice(0,250).map(l=>{const st=states[l.id]||{status:"idle",step:"Noch nicht gestartet",warnings:[]};const video=videos.find(v=>v.lead_id===l.id);return <tr key={l.id}><td><strong>{l.company_name}</strong><small style={{display:"block"}}>{[l.city,l.industry].filter(Boolean).join(" · ")}</small></td><td><div className="os-score">{l.total_score}</div></td><td>{l.enriched_at?<span className="os-pill green">✓ {fmt(l.enriched_at)}</span>:l.website?<span className="os-pill">offen</span>:<span className="os-pill hot">keine Website</span>}</td><td>{l.email?<span className={`os-pill ${l.email_status==="valid"?"green":l.email_status==="invalid"?"hot":""}`}>{l.email_status||"unknown"}</span>:<span className="os-pill">noch keine</span>}</td><td>{video?<a className="os-pill green" href={`/v/${video.slug}`} target="_blank">bereit ↗</a>:<span className="os-pill">offen</span>}</td><td><span className={`os-pill ${st.status==="done"?"green":st.status==="error"?"hot":""}`}>{st.status==="running"?"läuft":st.status}</span><small style={{display:"block",marginTop:5}}>{st.step}</small>{st.warnings.length?<small style={{display:"block",marginTop:4,color:"#b7791f"}}>{st.warnings.join(" · ")}</small>:null}</td><td><button className="os-btn small primary" disabled={busy||st.status==="running"} onClick={()=>void prepareOne(l)}>Vorbereiten</button></td></tr>})}</tbody></table></div>
    </section>
  </div></main>;
}
