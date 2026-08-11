"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type Lead={id:string;company_name:string;contact_name:string|null;email:string|null;phone:string|null;total_score:number;research_context:Record<string,unknown>|null};

export function ChatwootLeadSync({user}:{user:User}){
 const supabase=useMemo(()=>createSupabaseBrowserClient(),[]);const[leads,setLeads]=useState<Lead[]>([]);const[selected,setSelected]=useState("");const[busy,setBusy]=useState(false);const[message,setMessage]=useState<string|null>(null);const[error,setError]=useState<string|null>(null);
 const load=useCallback(async()=>{if(!supabase)return;const{data,error}=await supabase.from("energy_leads").select("id,company_name,contact_name,email,phone,total_score,research_context").eq("user_id",user.id).or("email.not.is.null,phone.not.is.null").order("total_score",{ascending:false}).limit(1000);if(error)setError(error.message);else setLeads((data||[]) as Lead[])},[supabase,user.id]);useEffect(()=>{void load()},[load]);
 async function sync(id:string){if(!supabase)return;setBusy(true);setError(null);try{const{data,error}=await supabase.functions.invoke("channel-hub",{body:{action:"sync_lead",leadId:id}});if(error||data?.error)throw new Error(data?.error||error?.message);setMessage(`Chatwoot Kontakt ${data.contact_id||""} synchronisiert.`);await load()}catch(x){setError(x instanceof Error?x.message:"Chatwoot Sync fehlgeschlagen")}finally{setBusy(false)}}
 async function bulk(){setBusy(true);setError(null);let ok=0;let failed=0;try{for(const lead of leads.filter(l=>l.total_score>=75).slice(0,50)){try{await sync(lead.id);ok++}catch{failed++}}setMessage(`${ok} A-Leads mit Chatwoot synchronisiert${failed?`, ${failed} Fehler`:""}.`)}finally{setBusy(false)}}
 return <section className="os-card os-section" style={{marginTop:16}}><div className="os-section-head"><div><div className="os-kicker">Chatwoot Sync</div><h2>CRM Lead → Omnichannel Contact</h2><p>Überträgt E-Mail, Telefon, Firma sowie Walkenhorst Lead-ID und Scores als Custom Attributes.</p></div><button className="os-btn" disabled={busy||!leads.some(l=>l.total_score>=75)} onClick={()=>void bulk()}>Top A-Leads syncen</button></div>{error?<div className="os-error">{error}</div>:null}{message?<div className="os-success">{message}</div>:null}<div className="os-toolbar"><select value={selected} onChange={e=>setSelected(e.target.value)} style={{minWidth:320}}><option value="">Lead auswählen</option>{leads.map(l=><option key={l.id} value={l.id}>{l.company_name} · Score {l.total_score}{(l.research_context as any)?.chatwoot?.contact_id?" · synchronisiert":""}</option>)}</select><button className="os-btn primary" disabled={busy||!selected} onClick={()=>void sync(selected)}>Mit Chatwoot synchronisieren</button></div></section>
}
