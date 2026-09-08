"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import styles from "./lead-email-history.module.css";

type MessageRow={
  id:string;user_id:string;lead_id:string|null;campaign_id:string|null;campaign_member_id:string|null;mailbox_id:string|null;
  direction:string;status:string;to_email:string|null;from_email:string|null;subject:string|null;body_text:string|null;body_html:string|null;
  provider_message_id:string|null;tracking_token:string;scheduled_at:string;sent_at:string|null;opened_at:string|null;clicked_at:string|null;
  replied_at:string|null;error:string|null;metadata:Record<string,unknown>|null;created_at:string;updated_at:string;step_order:number|null;
};
type EmailEvent={id:number;message_id:string;event_type:string;url:string|null;created_at:string};
type Campaign={id:string;name:string;status:string};
type Mailbox={id:string;email_address:string;from_name:string|null};

function fmt(value:string|null|undefined){if(!value)return"—";try{return new Intl.DateTimeFormat("de-DE",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value))}catch{return"—"}}
function stripHtml(value:string|null){if(!value)return"";return value.replace(/<style[\s\S]*?<\/style>/gi,"").replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<br\s*\/?\s*>/gi,"\n").replace(/<\/p>/gi,"\n\n").replace(/<[^>]+>/g,"").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim()}
function bodyFor(m:MessageRow){return (m.body_text||"").trim()||stripHtml(m.body_html)||"Kein Nachrichtentext gespeichert."}
function eventLabel(type:string){const map:Record<string,string>={open:"Geöffnet",opened:"Geöffnet",click:"Link geklickt",clicked:"Link geklickt",reply:"Antwort",replied:"Antwort",bounce:"Bounce",bounced:"Bounce",delivered:"Zugestellt"};return map[type]||type.replaceAll("_"," ")}
function messageTime(m:MessageRow){return m.replied_at||m.clicked_at||m.opened_at||m.sent_at||m.created_at}

export function LeadEmailHistory(){
  const params=useParams<{id:string}>();
  const leadId=Array.isArray(params.id)?params.id[0]:params.id;
  const supabase=useMemo(()=>createSupabaseBrowserClient(),[]);
  const[messages,setMessages]=useState<MessageRow[]>([]);
  const[events,setEvents]=useState<EmailEvent[]>([]);
  const[campaigns,setCampaigns]=useState<Campaign[]>([]);
  const[mailboxes,setMailboxes]=useState<Mailbox[]>([]);
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState<string|null>(null);
  const[expanded,setExpanded]=useState<Record<string,boolean>>({});

  const load=useCallback(async()=>{
    if(!supabase||!leadId)return;
    setLoading(true);setError(null);
    try{
      const session=(await supabase.auth.getSession()).data.session;
      if(!session)throw new Error("Session abgelaufen.");
      const uid=session.user.id;
      const result=await supabase.from("energy_messages").select("id,user_id,lead_id,campaign_id,campaign_member_id,mailbox_id,direction,status,to_email,from_email,subject,body_text,body_html,provider_message_id,tracking_token,scheduled_at,sent_at,opened_at,clicked_at,replied_at,error,metadata,created_at,updated_at,step_order").eq("lead_id",leadId).eq("user_id",uid).order("created_at",{ascending:false}).limit(500);
      if(result.error)throw result.error;
      const rows=(result.data||[]) as MessageRow[];
      setMessages(rows);
      const messageIds=rows.map(m=>m.id);
      const campaignIds=[...new Set(rows.map(m=>m.campaign_id).filter(Boolean))] as string[];
      const mailboxIds=[...new Set(rows.map(m=>m.mailbox_id).filter(Boolean))] as string[];
      const [eventResult,campaignResult,mailboxResult]=await Promise.all([
        messageIds.length?supabase.from("energy_email_events").select("id,message_id,event_type,url,created_at").in("message_id",messageIds).order("created_at",{ascending:true}).limit(3000):Promise.resolve({data:[],error:null}),
        campaignIds.length?supabase.from("energy_campaigns").select("id,name,status").eq("user_id",uid).in("id",campaignIds):Promise.resolve({data:[],error:null}),
        mailboxIds.length?supabase.from("energy_mailboxes").select("id,email_address,from_name").eq("user_id",uid).in("id",mailboxIds):Promise.resolve({data:[],error:null}),
      ]);
      if(eventResult.error)throw eventResult.error;
      setEvents((eventResult.data||[]) as EmailEvent[]);
      if(!campaignResult.error)setCampaigns((campaignResult.data||[]) as Campaign[]);
      if(!mailboxResult.error)setMailboxes((mailboxResult.data||[]) as Mailbox[]);
      if(rows[0])setExpanded(v=>Object.keys(v).length?v:{[rows[0].id]:true});
    }catch(e){setError(e instanceof Error?e.message:"E-Mail-Verlauf konnte nicht geladen werden.")}finally{setLoading(false)}
  },[supabase,leadId]);

  useEffect(()=>{void load()},[load]);
  useEffect(()=>{
    if(!supabase||!leadId)return;
    const channel=supabase.channel(`lead-mail-history:${leadId}`).on("postgres_changes",{event:"*",schema:"public",table:"energy_messages",filter:`lead_id=eq.${leadId}`},()=>void load()).subscribe();
    return()=>{void supabase.removeChannel(channel)};
  },[supabase,leadId,load]);

  const eventMap=useMemo(()=>{const map=new Map<string,EmailEvent[]>();for(const e of events){const list=map.get(e.message_id)||[];list.push(e);map.set(e.message_id,list)}return map},[events]);
  const campaignMap=useMemo(()=>new Map(campaigns.map(c=>[c.id,c])),[campaigns]);
  const mailboxMap=useMemo(()=>new Map(mailboxes.map(m=>[m.id,m])),[mailboxes]);
  const totals=useMemo(()=>({
    outbound:messages.filter(m=>m.direction==="outbound").length,
    inbound:messages.filter(m=>m.direction==="inbound").length,
    opened:messages.filter(m=>Boolean(m.opened_at)).length,
    clicked:messages.filter(m=>Boolean(m.clicked_at)).length,
    replied:messages.filter(m=>Boolean(m.replied_at)||m.direction==="inbound").length,
    bounced:messages.filter(m=>m.status==="bounced"||Boolean(m.error)).length,
  }),[messages]);

  return <section className={styles.shell} id="email-verlauf">
    <div className={styles.header}>
      <div><span>Kommunikationsakte</span><h2>Kompletter E-Mail-Verlauf</h2><p>Was exakt gesendet wurde – inklusive Inhalt, Absender, Sequenzschritt und Reaktionen.</p></div>
      <button onClick={()=>void load()} disabled={loading}>↻ Aktualisieren</button>
    </div>
    <div className={styles.kpis}>{[[totals.outbound,"Gesendet"],[totals.inbound,"Eingang"],[totals.opened,"Geöffnet"],[totals.clicked,"Geklickt"],[totals.replied,"Antworten"],[totals.bounced,"Fehler/Bounce"]].map(([v,l])=><div key={String(l)}><strong>{v}</strong><span>{l}</span></div>)}</div>
    {error?<div className={styles.error}>{error}</div>:null}
    {loading&&!messages.length?<div className={styles.empty}>E-Mail-Verlauf wird geladen …</div>:null}
    {!loading&&!messages.length?<div className={styles.empty}>Für diesen Lead wurden noch keine E-Mails gespeichert.</div>:null}
    <div className={styles.list}>{messages.map(m=>{
      const messageEvents=eventMap.get(m.id)||[];
      const opens=messageEvents.filter(e=>e.event_type==="open"||e.event_type==="opened");
      const clicks=messageEvents.filter(e=>e.event_type==="click"||e.event_type==="clicked");
      const campaign=m.campaign_id?campaignMap.get(m.campaign_id):null;
      const mailbox=m.mailbox_id?mailboxMap.get(m.mailbox_id):null;
      const isOpen=Boolean(expanded[m.id]);
      return <article key={m.id} className={`${styles.message} ${m.direction==="inbound"?styles.inbound:styles.outbound}`}>
        <button className={styles.summary} onClick={()=>setExpanded(v=>({...v,[m.id]:!isOpen}))}>
          <div className={styles.direction}>{m.direction==="inbound"?"IN":"OUT"}</div>
          <div className={styles.subject}><strong>{m.subject||"Ohne Betreff"}</strong><span>{m.direction==="inbound"?`Von ${m.from_email||"unbekannt"}`:`Von ${m.from_email||mailbox?.email_address||"unbekannt"} → ${m.to_email||"unbekannt"}`}</span></div>
          <div className={styles.signals}>
            {m.sent_at?<span>✓ Gesendet</span>:null}{m.opened_at?<span>◉ {opens.length||1}× geöffnet</span>:null}{m.clicked_at?<span>↗ {clicks.length||1}× Klick</span>:null}{m.replied_at||m.direction==="inbound"?<span className={styles.hot}>↩ Antwort</span>:null}{m.status==="bounced"?<span className={styles.bad}>Bounce</span>:null}{m.error?<span className={styles.bad}>Fehler</span>:null}
          </div>
          <time>{fmt(messageTime(m))}</time><b>{isOpen?"−":"+"}</b>
        </button>
        {isOpen?<div className={styles.detail}>
          <div className={styles.metaGrid}>
            <div><span>Absender</span><strong>{mailbox?.from_name?`${mailbox.from_name} <${m.from_email||mailbox.email_address}>`:m.from_email||mailbox?.email_address||"—"}</strong></div>
            <div><span>Empfänger</span><strong>{m.to_email||"—"}</strong></div>
            <div><span>Kampagne</span><strong>{campaign?.name||"Manuell / keine Kampagne"}</strong></div>
            <div><span>Sequenz</span><strong>{m.step_order?`Schritt ${m.step_order}`:"—"}</strong></div>
            <div><span>Status</span><strong>{m.status}</strong></div>
            <div><span>Geplant</span><strong>{fmt(m.scheduled_at)}</strong></div>
            <div><span>Versendet</span><strong>{fmt(m.sent_at)}</strong></div>
            <div><span>Geöffnet</span><strong>{fmt(m.opened_at)}</strong></div>
            <div><span>Geklickt</span><strong>{fmt(m.clicked_at)}</strong></div>
            <div><span>Antwort</span><strong>{fmt(m.replied_at)}</strong></div>
          </div>
          <div className={styles.body}><span>Nachrichteninhalt</span><pre>{bodyFor(m)}</pre></div>
          {m.error?<div className={styles.messageError}><strong>Versandfehler</strong><span>{m.error}</span></div>:null}
          <div className={styles.eventBlock}><div className={styles.eventTitle}><strong>Tracking & Reaktionen</strong><span>{messageEvents.length} Events</span></div>{messageEvents.length?<div className={styles.events}>{messageEvents.map(e=><div key={e.id}><i/><section><strong>{eventLabel(e.event_type)}</strong>{e.url?<code>{e.url}</code>:null}<small>{fmt(e.created_at)}</small></section></div>)}</div>:<div className={styles.noEvents}>Noch keine einzelnen Tracking-Events gespeichert.</div>}</div>
          <details className={styles.technical}><summary>Technische Details</summary><div><span>Message ID</span><code>{m.id}</code><span>Provider ID</span><code>{m.provider_message_id||"—"}</code><span>Tracking Token</span><code>{m.tracking_token}</code><span>Campaign Member</span><code>{m.campaign_member_id||"—"}</code></div></details>
        </div>:null}
      </article>
    })}</div>
  </section>
}
