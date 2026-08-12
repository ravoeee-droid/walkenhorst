"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type VideoPage = {
  id:string;
  company_name:string;
  prospect_name:string|null;
  website_url:string|null;
  presenter_video_url:string|null;
  headline:string;
  intro_text:string|null;
  bullets:string[];
  cta_label:string;
  cta_url:string|null;
  duration_seconds:number;
  status:string;
};

export function VideoLanding({slug}:{slug:string}){
  const supabase=useMemo(()=>createSupabaseBrowserClient(),[]);
  const [page,setPage]=useState<VideoPage|null>(null);
  const [loading,setLoading]=useState(true);
  const [playing,setPlaying]=useState(false);
  const [elapsed,setElapsed]=useState(0);
  const [qualificationDone,setQualificationDone]=useState(false);
  const [qualificationError,setQualificationError]=useState<string|null>(null);
  const [qualificationBusy,setQualificationBusy]=useState(false);
  const sentMarks=useRef(new Set<number>());
  const sessionRef=useRef<string>("");

  function sessionId(){
    if(!sessionRef.current)sessionRef.current=crypto.randomUUID();
    return sessionRef.current;
  }

  useEffect(()=>{
    if(!supabase){setLoading(false);return;}
    void supabase.from("energy_video_pages").select("id,company_name,prospect_name,website_url,presenter_video_url,headline,intro_text,bullets,cta_label,cta_url,duration_seconds,status").eq("slug",slug).eq("is_public",true).single().then(async({data,error})=>{
      if(!error&&data){
        setPage(data as VideoPage);
        await supabase.from("energy_video_events").insert({video_page_id:data.id,event_type:"view",session_id:sessionId()});
      }
      setLoading(false);
    });
  },[slug,supabase]);

  useEffect(()=>{
    if(!playing||!page)return;
    const timer=window.setInterval(()=>setElapsed(v=>Math.min(page.duration_seconds,v+1)),1000);
    return()=>window.clearInterval(timer);
  },[page,playing]);

  useEffect(()=>{
    if(!page||elapsed<=0)return;
    const percent=Math.min(100,Math.round((elapsed/page.duration_seconds)*100));
    for(const mark of [25,50,75,90,100]){
      if(percent>=mark&&!sentMarks.current.has(mark)){
        sentMarks.current.add(mark);
        void supabase?.from("energy_video_events").insert({video_page_id:page.id,event_type:"progress",watch_percent:mark,session_id:sessionId()});
      }
    }
    if(percent>=100)setPlaying(false);
  },[elapsed,page,supabase]);

  async function play(){
    if(!page)return;
    setPlaying(true);
    if(elapsed>=page.duration_seconds){setElapsed(0);sentMarks.current.clear()}
    await supabase?.from("energy_video_events").insert({video_page_id:page.id,event_type:"play",watch_percent:Math.round((elapsed/page.duration_seconds)*100),session_id:sessionId()});
  }

  async function cta(){
    if(!page)return;
    await supabase?.from("energy_video_events").insert({video_page_id:page.id,event_type:"cta_click",watch_percent:Math.round((elapsed/page.duration_seconds)*100),session_id:sessionId()});
    if(page.cta_url)window.location.href=page.cta_url;
  }

  async function qualify(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!supabase)return;
    setQualificationBusy(true);setQualificationError(null);
    try{
      const f=new FormData(event.currentTarget);
      const {data,error}=await supabase.functions.invoke("qualification-submit",{body:{
        slug,sessionId:sessionId(),interest:f.get("interest"),timeline:f.get("timeline"),contactName:f.get("contactName"),email:f.get("email"),phone:f.get("phone"),notes:f.get("notes"),
      }});
      if(error||data?.error)throw new Error(data?.error||error?.message||"Übermittlung fehlgeschlagen");
      setQualificationDone(true);
    }catch(e){setQualificationError(e instanceof Error?e.message:"Übermittlung fehlgeschlagen")}finally{setQualificationBusy(false)}
  }

  if(loading)return <main className="video-shell"><div className="video-page"><section className="card">Analyse wird geladen …</section></div></main>;
  if(!page)return <main className="video-shell"><div className="video-page"><section className="card"><h1>Analyse nicht verfügbar</h1><p className="muted">Dieser Link ist nicht mehr aktiv.</p></section></div></main>;
  const pct=Math.min(100,Math.round((elapsed/page.duration_seconds)*100));
  let domain="Unternehmenswebsite";
  try{if(page.website_url)domain=new URL(page.website_url.startsWith("http")?page.website_url:`https://${page.website_url}`).hostname}catch{domain=page.company_name}

  return <main className="video-shell"><div className="video-page">
    <header className="topbar"><div className="brand"><div className="logo">W</div><div><div className="eyebrow">Walkenhorst Energie</div><strong>Persönliche Potenzialanalyse</strong></div></div><span className="badge"><span className="dot"/>für {page.company_name}</span></header>
    <section className="card hero"><div className="eyebrow">{page.prospect_name?`Für ${page.prospect_name}`:"Kurze Video-Analyse"}</div><h1>{page.headline}</h1><p className="muted">{page.intro_text}</p></section>
    <section className="video-stage" style={{marginTop:18}}>
      <div className="video-site"><div className="fake-browser"><div className="browser-bar"><span className="browser-dot"/><span className="browser-dot"/><span className="browser-dot"/><span style={{marginLeft:10,fontSize:12,color:"#5b6862"}}>{domain}</span></div><div className="site-content"><div className="eyebrow" style={{color:"#247653"}}>Unternehmensanalyse</div><h3>{page.company_name}</h3><p>Wir haben Website, Unternehmensprofil und relevante Energie-Signale für einen ersten Potenzialcheck zusammengeführt.</p><div className="site-block"/><div className="site-block" style={{height:140}}/><div className="site-block"/><h3 style={{fontSize:25}}>Energiepotenzial sichtbar machen</h3><div className="site-block" style={{height:125}}/></div></div></div>
      <div className="video-overlay">{playing?`Analyse läuft · ${pct}%`:`${Math.floor(page.duration_seconds/60)}:${String(page.duration_seconds%60).padStart(2,"0")} Min.`}</div>
      <div className="presenter">{page.presenter_video_url?<video src={page.presenter_video_url} autoPlay={playing} muted playsInline loop/>:"W"}</div>
      {!playing&&<button className="play" onClick={()=>void play()} aria-label="Video starten">▶</button>}
      <div className="video-progress"><span style={{width:`${pct}%`}}/></div>
    </section>
    <section className="video-info"><article className="card"><div className="eyebrow">Was wir gefunden haben</div><h2 style={{marginTop:7}}>Drei relevante Ansatzpunkte</h2>{(page.bullets??[]).map((b,i)=><div className="bullet" key={`${b}-${i}`}><span className="tick">✓</span><div>{b}</div></div>)}</article><aside className="card"><div className="eyebrow">Nächster Schritt</div><h2 style={{marginTop:7}}>Potenzial konkret prüfen</h2><p className="muted">In einem kurzen Gespräch können die entscheidenden Daten wie Verbrauch, Lastprofil, Dachfläche und bestehende Energielösungen verifiziert werden.</p><button className="button primary" onClick={()=>void cta()}>{page.cta_label}</button></aside></section>

    <section className="card" style={{marginTop:18}}>
      <div className="eyebrow">60-Sekunden-Potenzialcheck</div>
      <h2 style={{marginTop:7}}>Was ist für {page.company_name} gerade am interessantesten?</h2>
      {qualificationDone?<div className="success"><strong>Vielen Dank.</strong><br/>Ihre Angaben sind angekommen. Walkenhorst kann sich jetzt gezielt mit einer konkreten Einschätzung melden.</div>:<form className="form" onSubmit={qualify}>
        <div className="form-grid">
          <div className="field"><label>Größtes Interesse *</label><select name="interest" required defaultValue=""><option value="" disabled>Bitte wählen</option><option value="stromkosten">Stromkosten senken</option><option value="photovoltaik">Photovoltaik / Eigenverbrauch</option><option value="energieeffizienz">Energieeffizienz</option><option value="foerderung">Förderung / Finanzierung</option><option value="analyse">Erst einmal Potenzial prüfen</option></select></div>
          <div className="field"><label>Wann soll das Thema geprüft werden?</label><select name="timeline" defaultValue="1-3-monate"><option value="sofort">So schnell wie möglich</option><option value="1-3-monate">In den nächsten 1–3 Monaten</option><option value="3-6-monate">In 3–6 Monaten</option><option value="spaeter">Später / noch offen</option></select></div>
          <div className="field"><label>Ansprechpartner</label><input name="contactName" placeholder="Vor- und Nachname"/></div>
          <div className="field"><label>E-Mail</label><input name="email" type="email" placeholder="name@unternehmen.de"/></div>
          <div className="field"><label>Telefon</label><input name="phone" placeholder="Telefonnummer"/></div>
          <div className="field"><label>Kurzer Hinweis</label><input name="notes" placeholder="z. B. 2 Standorte, hoher Tagesverbrauch"/></div>
        </div>
        {qualificationError?<div className="error">{qualificationError}</div>:null}
        <button className="button primary" disabled={qualificationBusy}>{qualificationBusy?"Wird übermittelt …":"Potenzialcheck absenden"}</button>
      </form>}
    </section>
  </div></main>;
}
