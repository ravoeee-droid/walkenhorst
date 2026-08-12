"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

const ZONES=["Europe/Berlin","Europe/Vienna","Europe/Zurich","UTC"];

function normalizeUrl(value:string){return value.trim().replace(/\/+$/g,"")}

export function RuntimeSettingsCenter({user}:{user:User}){
  const supabase=useMemo(()=>createSupabaseBrowserClient(),[]);
  const [baseUrl,setBaseUrl]=useState("");
  const [timezone,setTimezone]=useState("Europe/Berlin");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);

  const load=useCallback(async()=>{
    if(!supabase)return;
    const {data,error:e}=await supabase.from("energy_runtime_settings").select("public_base_url,default_timezone").eq("user_id",user.id).maybeSingle();
    if(e){setError(e.message);return}
    if(data?.public_base_url)setBaseUrl(data.public_base_url);
    if(data?.default_timezone)setTimezone(data.default_timezone);
  },[supabase,user.id]);
  useEffect(()=>{void load()},[load]);

  async function save(){
    if(!supabase)return;
    setError(null);setNotice(null);
    const url=normalizeUrl(baseUrl);
    try{
      const parsed=new URL(url);
      if(parsed.protocol!=="https:")throw new Error("Die öffentliche App-URL muss mit https:// beginnen.");
      if(["localhost","127.0.0.1"].includes(parsed.hostname))throw new Error("Localhost darf nicht als öffentliche App-URL verwendet werden.");
    }catch(e){setError(e instanceof Error?e.message:"Ungültige URL");return}
    setBusy(true);
    const {error:e}=await supabase.from("energy_runtime_settings").upsert({user_id:user.id,public_base_url:url,default_timezone:timezone,updated_at:new Date().toISOString()},{onConflict:"user_id"});
    setBusy(false);
    if(e){setError(e.message);return}
    setBaseUrl(url);setNotice("Gespeichert. Neue und aktualisierte Kampagnen verwenden ab jetzt automatisch diese öffentliche URL.");
  }

  const detected=typeof window!=="undefined"?window.location.origin:"";
  return <main className="os-root" style={{minHeight:"100vh"}}><div className="os-content" style={{maxWidth:980,margin:"0 auto",paddingTop:28}}>
    <div className="os-section-head"><div><div className="os-kicker">System Configuration</div><h1 className="os-title">Produktions-Einstellungen</h1><p>Eine kanonische URL für Video, Tracking, Klicks und Abmeldungen – unabhängig davon, von welcher Preview das CRM geöffnet wird.</p></div><div className="os-toolbar"><a className="os-btn" href="/launch">← Go-Live</a><a className="os-btn" href="/health">System Health</a></div></div>
    {error?<div className="os-error">{error}</div>:null}{notice?<div className="os-success">{notice}</div>:null}
    <section className="os-card os-section" style={{marginTop:18}}>
      <div className="os-kicker">Canonical URL</div><h2>Öffentliche App-URL</h2>
      <p>Hier gehört die endgültige Walkenhorst-Radar-Domain hinein. Kampagnen überschreiben danach automatisch Preview-/Test-Origins mit dieser URL.</p>
      <div className="os-field"><label>HTTPS Produktions-URL</label><input value={baseUrl} onChange={e=>setBaseUrl(e.target.value)} placeholder="https://radar.walkenhorst-eko.de" autoCapitalize="none" autoCorrect="off"/></div>
      <div className="os-callout"><small>Aktuell geöffnete Origin</small><strong style={{display:"block",marginTop:5}}>{detected||"—"}</strong><p style={{margin:"5px 0 0"}}>Diese wird nicht automatisch als Produktions-URL gespeichert.</p></div>
      <div className="os-field" style={{marginTop:14}}><label>Standard-Zeitzone für Kampagnen</label><select value={timezone} onChange={e=>setTimezone(e.target.value)}>{ZONES.map(z=><option key={z} value={z}>{z}</option>)}</select></div>
      <div className="os-toolbar" style={{marginTop:16}}><button className="os-btn primary" disabled={busy} onClick={()=>void save()}>{busy?"Speichere …":"Einstellungen speichern"}</button></div>
    </section>
    <section className="os-card os-section" style={{marginTop:18}}><div className="os-kicker">Sicherheitslogik</div><h2>Was danach automatisch passiert</h2>
      <div className="os-checkrow"><span className="os-pill green">✓</span><div><strong>Tracking-Links</strong><small>Open, Click und Unsubscribe verwenden dieselbe kanonische Domain.</small></div></div>
      <div className="os-checkrow"><span className="os-pill green">✓</span><div><strong>Video-Seiten</strong><small>Personalisierte Video-URLs werden auf dieser Domain erzeugt.</small></div></div>
      <div className="os-checkrow"><span className="os-pill green">✓</span><div><strong>Preview-Schutz</strong><small>Die DB setzt die gespeicherte URL bei Kampagnen serverseitig durch.</small></div></div>
      <div className="os-checkrow"><span className="os-pill green">✓</span><div><strong>Aktivierungs-Guard</strong><small>Eine Kampagne ohne gültige HTTPS-Tracking-Basis kann nicht aktiv werden.</small></div></div>
    </section>
  </div></main>;
}
