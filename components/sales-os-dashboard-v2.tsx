"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { scoreEnergyLead, slugifyCompany } from "@/lib/energy-score";

type Section = "overview" | "finder" | "leads" | "studio" | "campaigns" | "inbox" | "followups" | "templates" | "audit" | "seo" | "integrations";
type Lead = {
  id:string; user_id:string; company_name:string; website:string|null; city:string|null; industry:string|null;
  employees:number|null; location_count:number; roof_area_m2:number|null; annual_energy_kwh:number|null; pv_present:boolean|null;
  contact_name:string|null; phone:string|null; email:string|null; email_status:string|null; total_score:number; pv_score:number;
  energy_score:number; intent_score:number; contactability_score:number; summary:string|null; pitch:string|null; next_action:string|null;
  status:string; source:string|null; address:string|null; postcode:string|null; last_contact_at:string|null; last_replied_at:string|null;
  do_not_contact:boolean; research_context:Record<string,unknown>|null; enriched_at:string|null; email_verified_at:string|null;
  created_at:string; updated_at:string;
};
type Video = {id:string;lead_id:string;slug:string;company_name:string;status:string;created_at:string};
type VideoEvent = {video_page_id:string;event_type:string;watch_percent:number|null;created_at:string};
type Campaign = {id:string;name:string;status:string;daily_limit:number;subject_template:string|null;body_template:string|null;created_at:string;started_at:string|null};
type Message = {id:string;lead_id:string;campaign_id:string|null;direction:string;status:string;from_email:string|null;to_email:string|null;subject:string|null;body_text:string|null;sent_at:string|null;replied_at:string|null;created_at:string};
type Followup = {id:string;lead_id:string;title:string;due_at:string;priority:string;status:string;reason:string|null};
type Activity = {id:string;lead_id:string|null;activity_type:string;title:string;detail:string|null;created_at:string};
type Mailbox = {id:string;email_address:string;from_name:string|null;status:string;daily_limit:number;sent_today:number;smtp_host:string|null;smtp_port:number;smtp_secure:boolean;imap_host:string|null;last_tested_at:string|null;last_sync_at:string|null;last_error:string|null};
type Integration = {id:string;provider:string;label:string|null;base_url:string|null;status:string;config:Record<string,unknown>|null;last_tested_at:string|null;last_error:string|null;created_at:string;updated_at:string};
type FinderLead = {company_name:string;website:string|null;city:string|null;industry:string|null;address:string|null;postcode:string|null;phone:string|null;email:string|null;source:string;source_external_id:string;source_url:string|null;rating?:number|null;reviews?:number|null;lat?:number|null;lon?:number|null};
type AuditResult = {url:string;score:number;seo:number;conversion:number;trust:number;technical:number;summary:string;findings:Array<{severity:string;title:string;detail:string;recommendation:string}>};
type KeywordIdea = {keyword:string;intent:string;opportunity:number};

const NAV:Array<{id:Section;label:string;icon:string}> = [
  {id:"overview",label:"Übersicht",icon:"⌂"},{id:"finder",label:"Lead Finder",icon:"◎"},{id:"leads",label:"Leads",icon:"◉"},
  {id:"studio",label:"Studio",icon:"▶"},{id:"campaigns",label:"Kampagnen",icon:"↗"},{id:"inbox",label:"Inbox",icon:"✉"},
  {id:"followups",label:"Follow-ups",icon:"✓"},{id:"templates",label:"Vorlagen",icon:"▤"},{id:"audit",label:"Website Analyse",icon:"◇"},
  {id:"seo",label:"SEO Radar",icon:"⌁"},{id:"integrations",label:"Integrationen",icon:"⌘"},
];
const STATUS_LABEL:Record<string,string> = {new:"Neu",research:"Research",ready:"Bereit",contacted:"Kontaktiert",engaged:"Interessiert",qualified:"Qualifiziert",meeting:"Termin",proposal:"Angebot",won:"Gewonnen",lost:"Verloren",nurture:"Wiedervorlage"};
const DEFAULT_SUBJECT = "{{firstname}}, kurze Energie-Analyse für {{company}}";
const DEFAULT_BODY = "Guten Tag {{firstname}},\n\nich habe mir {{company}} in {{city}} kurz angesehen. {{reason}}\n\nDazu habe ich Ihnen eine kurze persönliche Analyse vorbereitet:\n{{video_url}}\n\nWenn das für Sie relevant ist, können wir die Zahlen gern einmal unverbindlich konkretisieren.\n\nViele Grüße\nWalkenhorst Energie";
const FOLLOWUP_BODY = "Guten Tag {{firstname}},\n\nich wollte nur kurz nachhaken, ob Sie meine Analyse für {{company}} bereits ansehen konnten. Wenn das Thema gerade nicht relevant ist, reicht mir auch eine kurze Rückmeldung.\n\nViele Grüße\nWalkenhorst Energie";

function initials(name:string){return name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()).join("")||"WH"}
function fmt(value:string|null|undefined){if(!value)return"—";try{return new Intl.DateTimeFormat("de-DE",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(value))}catch{return"—"}}
function videoStats(events:VideoEvent[],videoId:string){const rows=events.filter(e=>e.video_page_id===videoId);return{views:rows.filter(e=>e.event_type==="view").length,watch:rows.reduce((m,e)=>Math.max(m,e.watch_percent||0),0),clicks:rows.filter(e=>e.event_type==="cta_click").length}}
function sleep(ms:number){return new Promise(resolve=>setTimeout(resolve,ms))}

export function SalesOsDashboardV2({user}:{user:User}){
  const supabase = useMemo(()=>createSupabaseBrowserClient(),[]);
  const [section,setSection] = useState<Section>("overview");
  const [mobile,setMobile] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string|null>(null);
  const [message,setMessage] = useState<string|null>(null);
  const [search,setSearch] = useState("");
  const [leads,setLeads] = useState<Lead[]>([]);
  const [videos,setVideos] = useState<Video[]>([]);
  const [videoEvents,setVideoEvents] = useState<VideoEvent[]>([]);
  const [campaigns,setCampaigns] = useState<Campaign[]>([]);
  const [messages,setMessages] = useState<Message[]>([]);
  const [followups,setFollowups] = useState<Followup[]>([]);
  const [activities,setActivities] = useState<Activity[]>([]);
  const [mailboxes,setMailboxes] = useState<Mailbox[]>([]);
  const [integrations,setIntegrations] = useState<Integration[]>([]);
  const [selectedId,setSelectedId] = useState<string|null>(null);
  const [finderResults,setFinderResults] = useState<FinderLead[]>([]);
  const [finderSelected,setFinderSelected] = useState<Set<number>>(new Set());
  const [finderAttribution,setFinderAttribution] = useState("");
  const [activeGoogleSearch,setActiveGoogleSearch] = useState<string|null>(null);
  const [audit,setAudit] = useState<AuditResult|null>(null);
  const [keywords,setKeywords] = useState<KeywordIdea[]>([]);

  const selected = leads.find(l=>l.id===selectedId)??leads[0]??null;
  const selectedVideo = selected ? videos.find(v=>v.lead_id===selected.id&&v.status!=="archived")??null : null;
  const integrationFor = useCallback((provider:string)=>integrations.find(i=>i.provider===provider),[integrations]);

  const load = useCallback(async()=>{
    if(!supabase)return;
    const {data:s}=await supabase.auth.getSession();
    if(!s.session?.user)return;
    const uid=s.session.user.id;
    const [l,v,ve,c,m,f,a,mb,ig] = await Promise.all([
      supabase.from("energy_leads").select("*").eq("user_id",uid).order("created_at",{ascending:false}).limit(3000),
      supabase.from("energy_video_pages").select("id,lead_id,slug,company_name,status,created_at").eq("user_id",uid).order("created_at",{ascending:false}).limit(3000),
      supabase.from("energy_video_events").select("video_page_id,event_type,watch_percent,created_at").order("created_at",{ascending:false}).limit(10000),
      supabase.from("energy_campaigns").select("id,name,status,daily_limit,subject_template,body_template,created_at,started_at").eq("user_id",uid).order("created_at",{ascending:false}).limit(200),
      supabase.from("energy_messages").select("id,lead_id,campaign_id,direction,status,from_email,to_email,subject,body_text,sent_at,replied_at,created_at").eq("user_id",uid).order("created_at",{ascending:false}).limit(3000),
      supabase.from("energy_followups").select("id,lead_id,title,due_at,priority,status,reason").eq("user_id",uid).order("due_at",{ascending:true}).limit(1000),
      supabase.from("energy_activities").select("id,lead_id,activity_type,title,detail,created_at").eq("user_id",uid).order("created_at",{ascending:false}).limit(3000),
      supabase.from("energy_mailboxes").select("id,email_address,from_name,status,daily_limit,sent_today,smtp_host,smtp_port,smtp_secure,imap_host,last_tested_at,last_sync_at,last_error").eq("user_id",uid).order("created_at"),
      supabase.from("energy_integrations").select("id,provider,label,base_url,status,config,last_tested_at,last_error,created_at,updated_at").eq("user_id",uid).order("provider"),
    ]);
    if(l.error){setError(l.error.message);return}
    setLeads((l.data||[]) as Lead[]);
    if(!selectedId&&l.data?.length)setSelectedId(String(l.data[0].id));
    if(!v.error)setVideos((v.data||[]) as Video[]);
    if(!ve.error)setVideoEvents((ve.data||[]) as VideoEvent[]);
    if(!c.error)setCampaigns((c.data||[]) as Campaign[]);
    if(!m.error)setMessages((m.data||[]) as Message[]);
    if(!f.error)setFollowups((f.data||[]) as Followup[]);
    if(!a.error)setActivities((a.data||[]) as Activity[]);
    if(!mb.error)setMailboxes((mb.data||[]) as Mailbox[]);
    if(!ig.error)setIntegrations((ig.data||[]) as Integration[]);
  },[supabase,selectedId]);

  useEffect(()=>{void load()},[load]);

  async function sessionId(){
    if(!supabase)return null;
    const {data}=await supabase.auth.getSession();
    if(!data.session?.user){setError("Deine Sitzung ist abgelaufen. Bitte neu anmelden.");return null}
    return data.session.user.id;
  }

  async function addLead(input:Partial<FinderLead>&{company_name:string}){
    if(!supabase)return null;
    const uid=await sessionId();if(!uid)return null;
    const scores=scoreEnergyLead({company_name:input.company_name,website:input.website||null,city:input.city||null,industry:input.industry||null,employees:null,location_count:1,roof_area_m2:null,annual_energy_kwh:null,pv_present:null,contact_name:null,phone:input.phone||null,email:input.email||null});
    const metadata={rating:input.rating??null,reviews:input.reviews??null,lat:input.lat??null,lon:input.lon??null};
    const {data,error:e}=await supabase.from("energy_leads").insert({
      user_id:uid,company_name:input.company_name,website:input.website||null,city:input.city||null,industry:input.industry||null,
      phone:input.phone||null,email:input.email||null,address:input.address||null,postcode:input.postcode||null,source:input.source||"manual",
      source_external_id:input.source_external_id||null,source_url:input.source_url||null,metadata,
      pv_score:scores.pvScore,energy_score:scores.energyScore,intent_score:scores.intentScore,contactability_score:scores.contactabilityScore,total_score:scores.totalScore,
      summary:scores.summary,pitch:scores.pitch,next_action:scores.nextAction,status:scores.totalScore>=75?"ready":"research",
    }).select("*").single();
    if(e){if(e.code==="23505")return null;throw e}
    return data as Lead;
  }

  async function createManualLead(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setError(null);
    try{
      const f=new FormData(e.currentTarget);
      const row=await addLead({company_name:String(f.get("company")||"").trim(),website:String(f.get("website")||"").trim()||null,city:String(f.get("city")||"").trim()||null,industry:String(f.get("industry")||"").trim()||null,email:String(f.get("email")||"").trim()||null,phone:String(f.get("phone")||"").trim()||null,source:"manual",source_external_id:"",source_url:null,address:null,postcode:null});
      if(row){setSelectedId(row.id);setMessage(`${row.company_name} wurde angelegt.`);e.currentTarget.reset();await load()}
    }catch(x){setError(x instanceof Error?x.message:"Lead konnte nicht gespeichert werden")}finally{setBusy(false)}
  }

  async function pollGoogleMaps(searchId:string,quiet=false){
    if(!supabase)return;
    for(let attempt=0;attempt<30;attempt++){
      const {data,error:e}=await supabase.functions.invoke("intelligence-hub",{body:{action:"google_maps_poll",searchId}});
      if(e||data?.error)throw new Error(data?.error||e?.message||"Google Maps Job fehlgeschlagen");
      if(data?.status==="completed"){
        const results=(data.results||[]) as FinderLead[];
        setFinderResults(results);setFinderSelected(new Set(results.map((_,i)=>i)));setFinderAttribution("Google Maps Scraper · self-hosted");setActiveGoogleSearch(null);setMessage(`${results.length} Google-Maps-Unternehmen gefunden.`);return;
      }
      if(data?.status==="failed")throw new Error(data?.error||"Google Maps Job fehlgeschlagen");
      if(quiet)return;
      await sleep(1800);
    }
    setMessage("Google-Maps-Suche läuft im Hintergrund weiter. Klicke auf „Ergebnisse aktualisieren“.");
  }

  async function findLeads(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setError(null);setFinderResults([]);
    try{
      const f=new FormData(e.currentTarget);
      const source=String(f.get("source")||"auto");
      const googleReady=integrationFor("google_maps")?.status==="ready";
      const useGoogle=source==="google_maps"||(source==="auto"&&googleReady);
      const payload={query:f.get("query"),industry:f.get("industry"),location:f.get("location"),radiusKm:f.get("radius"),limit:f.get("limit")};
      if(useGoogle){
        if(!googleReady)throw new Error("Google Maps Scraper ist noch nicht unter Integrationen verbunden und getestet.");
        const {data,error:e2}=await supabase!.functions.invoke("intelligence-hub",{body:{action:"google_maps_start",...payload}});
        if(e2||data?.error)throw new Error(data?.error||e2?.message||"Google Maps Start fehlgeschlagen");
        setActiveGoogleSearch(data.search_id);setFinderAttribution("Google Maps Scraper · Job läuft …");setMessage("Google-Maps-Suche gestartet. Ergebnisse werden automatisch geladen …");
        await pollGoogleMaps(data.search_id);
      }else{
        const res=await fetch("/api/lead-finder",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
        const data=await res.json();if(!res.ok)throw new Error(data.error||"Suche fehlgeschlagen");
        setFinderResults(data.results||[]);setFinderSelected(new Set((data.results||[]).map((_:unknown,i:number)=>i)));setFinderAttribution(data.attribution||"OpenStreetMap");setMessage(`${data.count||0} Unternehmen gefunden.`);
      }
    }catch(x){setError(x instanceof Error?x.message:"Lead Finder fehlgeschlagen")}finally{setBusy(false)}
  }

  async function importFinder(){
    setBusy(true);setError(null);let imported=0;
    try{
      for(const i of finderSelected){const item=finderResults[i];if(!item)continue;const row=await addLead(item);if(row)imported++}
      setMessage(`${imported} neue Leads importiert; Dubletten wurden übersprungen.`);await load();setSection("leads");
    }catch(x){setError(x instanceof Error?x.message:"Import fehlgeschlagen")}finally{setBusy(false)}
  }

  async function enrichLead(lead:Lead){
    if(!supabase)return;setBusy(true);setError(null);
    try{
      const {data,error:e}=await supabase.functions.invoke("intelligence-hub",{body:{action:"enrich_lead",leadId:lead.id}});
      if(e||data?.error)throw new Error(data?.error||e?.message||"Enrichment fehlgeschlagen");
      setMessage(`Website angereichert · ${data?.research?.emails?.length||0} E-Mail(s) · ${data?.research?.signals?.length||0} Signal(e).`);await load();
    }catch(x){setError(x instanceof Error?x.message:"Website-Enrichment fehlgeschlagen")}finally{setBusy(false)}
  }

  async function verifyEmail(lead:Lead){
    if(!supabase)return;setBusy(true);setError(null);
    try{
      const {data,error:e}=await supabase.functions.invoke("intelligence-hub",{body:{action:"verify_email",leadId:lead.id}});
      if(e||data?.error)throw new Error(data?.error||e?.message||"E-Mail-Prüfung fehlgeschlagen");
      setMessage(`${lead.email}: ${data.status}.`);await load();
    }catch(x){setError(x instanceof Error?x.message:"E-Mail-Verifizierung fehlgeschlagen")}finally{setBusy(false)}
  }

  async function createVideo(lead:Lead){
    if(!supabase)return null;const uid=await sessionId();if(!uid)return null;
    const old=videos.find(v=>v.lead_id===lead.id&&v.status!=="archived");if(old)return old;
    const slug=slugifyCompany(lead.company_name);
    const research=(lead.research_context?.firecrawl as {signals?:string[]} | undefined)?.signals||[];
    const bullets=[`${lead.pv_score}/100 PV-Potenzial`,`${lead.energy_score}/100 Energieeffizienz-Potenzial`,...(research.slice(0,2)),lead.summary||"Individueller Energie-Potenzialcheck"].slice(0,4);
    const {data,error:e}=await supabase.from("energy_video_pages").insert({user_id:uid,lead_id:lead.id,slug,company_name:lead.company_name,prospect_name:lead.contact_name,website_url:lead.website,headline:`Kurze Energie-Analyse für ${lead.company_name}`,intro_text:lead.summary,bullets,cta_label:"Kostenlosen Potenzialcheck vereinbaren",cta_url:"https://www.walkenhorst-eko.de/",duration_seconds:97,status:"ready",is_public:true}).select("id,lead_id,slug,company_name,status,created_at").single();
    if(e)throw e;
    await supabase.from("energy_activities").insert({user_id:uid,lead_id:lead.id,activity_type:"video_created",title:"Personalisierte Video-Seite erstellt",detail:`/v/${slug}`});
    return data as Video;
  }

  async function createSelectedVideo(){if(!selected)return;setBusy(true);setError(null);try{const v=await createVideo(selected);if(v){setMessage("Fake-Loom-Seite ist bereit.");await load();setSection("studio")}}catch(x){setError(x instanceof Error?x.message:"Video konnte nicht erstellt werden")}finally{setBusy(false)}}

  async function createCampaign(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!supabase)return;setBusy(true);setError(null);
    try{
      const uid=await sessionId();if(!uid)return;const f=new FormData(e.currentTarget);const minScore=Number(f.get("minScore")||65);const verifiedOnly=f.get("verifiedOnly")==="on";
      const candidates=leads.filter(l=>l.email&&!l.do_not_contact&&l.email_status!=="invalid"&&(!verifiedOnly||l.email_status==="valid")&&l.total_score>=minScore);
      const ready=mailboxes.filter(m=>m.status==="ready");
      if(!ready.length)throw new Error("Bitte zuerst mindestens eine Mailbox unter Integrationen verbinden und erfolgreich testen.");
      if(!candidates.length)throw new Error(verifiedOnly?"Keine verifizierten Leads für diese Kampagne.":"Keine passenden Leads mit sendbarer E-Mail-Adresse für diese Kampagne.");
      const name=String(f.get("name")||"Walkenhorst Outbound").trim();const subject=String(f.get("subject")||DEFAULT_SUBJECT);const body=String(f.get("body")||DEFAULT_BODY);
      const {data:campaign,error:ce}=await supabase.from("energy_campaigns").insert({user_id:uid,name,status:"active",subject_template:subject,body_template:body,daily_limit:Math.min(150,Number(f.get("dailyLimit")||30),ready.reduce((s,m)=>s+m.daily_limit,0)),tracking_base_url:window.location.origin,include_video:f.get("video")==="on",auto_personalize:true,reply_stops_sequence:true,started_at:new Date().toISOString()}).select("*").single();if(ce)throw ce;
      const steps=[{campaign_id:campaign.id,step_order:1,step_type:f.get("video")==="on"?"video_email":"email",delay_hours:0,subject_template:subject,body_template:body,include_video:f.get("video")==="on"},{campaign_id:campaign.id,step_order:2,step_type:"email",delay_hours:72,subject_template:"Kurze Rückfrage zu {{company}}",body_template:FOLLOWUP_BODY,include_video:false},{campaign_id:campaign.id,step_order:3,step_type:"manual_call",delay_hours:72,include_video:false}];
      const {error:se}=await supabase.from("energy_campaign_steps").insert(steps);if(se)throw se;
      const {error:me}=await supabase.from("energy_campaign_members").insert(candidates.map(l=>({campaign_id:campaign.id,lead_id:l.id,status:"queued",current_step:1,next_step_at:new Date().toISOString()})));if(me)throw me;
      await supabase.from("energy_activities").insert({user_id:uid,campaign_id:campaign.id,activity_type:"campaign_started",title:`Kampagne gestartet: ${name}`,detail:`${candidates.length} Leads`});
      const worker=await supabase.functions.invoke("campaign-worker",{body:{limit:25,baseUrl:window.location.origin}});
      if(worker.error)setMessage(`Kampagne läuft mit ${candidates.length} Leads. Worker startet automatisch.`);else setMessage(`Kampagne gestartet · ${candidates.length} Leads · ${worker.data?.sent||0} sofort versendet.`);
      e.currentTarget.reset();await load();
    }catch(x){setError(x instanceof Error?x.message:"Kampagne konnte nicht gestartet werden")}finally{setBusy(false)}
  }

  async function runWorker(){if(!supabase)return;setBusy(true);try{const {data,error:e}=await supabase.functions.invoke("campaign-worker",{body:{limit:25,baseUrl:window.location.origin}});if(e)throw e;setMessage(`Worker: ${data?.sent||0} gesendet, ${data?.manual||0} Call-Aufgaben, ${data?.failed||0} Fehler.`);await load()}catch(x){setError(x instanceof Error?x.message:"Worker fehlgeschlagen")}finally{setBusy(false)}}

  async function saveMailbox(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!supabase)return;setBusy(true);setError(null);
    try{
      const f=new FormData(e.currentTarget);const payload={action:"save",emailAddress:f.get("email"),fromName:f.get("fromName"),dailyLimit:f.get("dailyLimit"),smtpHost:f.get("smtpHost"),smtpPort:f.get("smtpPort"),smtpSecure:f.get("smtpSecure")==="on",smtpUsername:f.get("smtpUsername"),smtpPassword:f.get("smtpPassword"),imapHost:f.get("imapHost"),imapPort:f.get("imapPort"),imapSecure:true,imapUsername:f.get("imapUsername"),imapPassword:f.get("imapPassword")};
      const {data,error:e2}=await supabase.functions.invoke("mailbox-admin",{body:payload});if(e2||data?.error)throw new Error(data?.error||e2?.message);setMessage("Mailbox sicher gespeichert. Passwort liegt verschlüsselt im Vault.");e.currentTarget.reset();await load();
    }catch(x){setError(x instanceof Error?x.message:"Mailbox konnte nicht gespeichert werden")}finally{setBusy(false)}
  }
  async function mailboxAction(id:string,action:"test"|"sync"){if(!supabase)return;setBusy(true);setError(null);try{const {data,error:e}=await supabase.functions.invoke("mailbox-admin",{body:{action,id}});if(e||data?.error)throw new Error(data?.error||e?.message);setMessage(action==="test"?(data?.message||"Verbindung erfolgreich"):`${data?.synced||0} neue Antworten synchronisiert.`);await load()}catch(x){setError(x instanceof Error?x.message:"Mailbox-Aktion fehlgeschlagen")}finally{setBusy(false)}}

  async function saveIntegration(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!supabase)return;setBusy(true);setError(null);
    try{
      const f=new FormData(e.currentTarget);const provider=String(f.get("provider")||"");
      const config:Record<string,string>={};const authHeader=String(f.get("authHeader")||"").trim();const authScheme=String(f.get("authScheme")||"").trim();if(authHeader)config.auth_header=authHeader;if(f.has("authScheme"))config.auth_scheme=authScheme;
      const {data,error:e2}=await supabase.functions.invoke("integration-admin",{body:{action:"save",provider,label:f.get("label"),baseUrl:f.get("baseUrl"),secret:f.get("secret"),config}});
      if(e2||data?.error)throw new Error(data?.error||e2?.message||"Integration konnte nicht gespeichert werden");setMessage(`${provider} gespeichert. Secret liegt ausschließlich serverseitig im Vault.`);e.currentTarget.reset();await load();
    }catch(x){setError(x instanceof Error?x.message:"Integration konnte nicht gespeichert werden")}finally{setBusy(false)}
  }
  async function testIntegration(provider:string){if(!supabase)return;setBusy(true);setError(null);try{const {data,error:e}=await supabase.functions.invoke("integration-admin",{body:{action:"test",provider}});if(e||data?.error)throw new Error(data?.error||e?.message||"Verbindung fehlgeschlagen");setMessage(`${provider}: ${data.message||"erreichbar"}`);await load()}catch(x){setError(x instanceof Error?x.message:"Integrationstest fehlgeschlagen")}finally{setBusy(false)}}

  async function completeFollowup(id:string){if(!supabase)return;await supabase.from("energy_followups").update({status:"done",completed_at:new Date().toISOString()}).eq("id",id);await load()}
  async function updateLeadStatus(status:string){if(!supabase||!selected)return;await supabase.from("energy_leads").update({status,updated_at:new Date().toISOString()}).eq("id",selected.id);await load()}
  async function runAudit(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setAudit(null);try{const f=new FormData(e.currentTarget);const r=await fetch("/api/website-audit",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url:f.get("url")})});const d=await r.json();if(!r.ok)throw new Error(d.error);setAudit(d)}catch(x){setError(x instanceof Error?x.message:"Audit fehlgeschlagen")}finally{setBusy(false)}}
  async function runSeo(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);try{const f=new FormData(e.currentTarget);const r=await fetch("/api/keyword-research",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({keyword:f.get("keyword"),country:"DE",language:"de"})});const d=await r.json();if(!r.ok)throw new Error(d.error);setKeywords(d.ideas||[])}catch(x){setError(x instanceof Error?x.message:"SEO-Recherche fehlgeschlagen")}finally{setBusy(false)}}

  const filtered=leads.filter(l=>`${l.company_name} ${l.contact_name||""} ${l.city||""}`.toLowerCase().includes(search.toLowerCase()));
  const inbound=messages.filter(m=>m.direction==="inbound");const openFollowups=followups.filter(f=>f.status==="open");const views=videoEvents.filter(e=>e.event_type==="view").length;
  const hotLeads=leads.filter(l=>l.intent_score>=70||l.status==="engaged").length;const meetings=leads.filter(l=>["meeting","proposal","won"].includes(l.status)).length;const readyMailboxes=mailboxes.filter(m=>m.status==="ready");
  const activeCampaign=campaigns.find(c=>c.status==="active")||campaigns[0];
  function go(id:Section){setSection(id);setMobile(false);setError(null)}

  return <div className="os-root"><div className="os-layout">
    <aside className={`os-sidebar ${mobile?"open":""}`}><div className="os-brand"><div className="os-brandmark">WE</div><div>WALKENHORST<small>ENERGY SALES OS</small></div></div><nav className="os-nav">{NAV.map(n=><button key={n.id} className={`os-navbtn ${section===n.id?"active":""}`} onClick={()=>go(n.id)}><span className="os-navicon">{n.icon}</span>{n.label}{n.id==="followups"&&openFollowups.length>0?<span className="os-navcount">{openFollowups.length}</span>:null}{n.id==="inbox"&&inbound.length>0?<span className="os-navcount">{inbound.length}</span>:null}</button>)}</nav><div className="os-spacer"/><div className="os-side-status"><strong><span className="os-online"/>System versandbereit</strong>{readyMailboxes.length} Mailboxen bereit · {leads.filter(l=>l.email&&l.email_status!=="invalid").length} Leads kontaktierbar</div><div className="os-user"><div className="os-avatar">RH</div><div><strong>Raphael Hermann</strong><div style={{color:"#78889d",fontSize:9}}>{user.email}</div></div></div></aside>
    <main className="os-main"><header className="os-topbar"><div><div className="os-kicker">Outbound Revenue Engine</div><h1 className="os-title">{section==="overview"?"Guten Tag, Raphael.":NAV.find(n=>n.id===section)?.label}</h1></div><div className="os-actions"><button className="os-btn os-mobile-menu" onClick={()=>setMobile(!mobile)}>☰</button>{["overview","leads"].includes(section)?<input className="os-search" placeholder="Leads durchsuchen" value={search} onChange={e=>setSearch(e.target.value)}/>:null}<button className="os-btn" onClick={()=>go("finder")}>Lead Finder</button><button className="os-btn primary" onClick={()=>go("leads")}>+ Neuer Lead</button></div></header>
    <div className="os-content">{error?<div className="os-error">{error}</div>:null}{message?<div className="os-success">{message}</div>:null}

    {section==="overview"&&<><div className="os-grid os-kpis">{[[leads.length,"Leads gesamt",`${leads.filter(l=>l.email&&l.email_status!=="invalid").length} kontaktierbar`],[leads.filter(l=>l.total_score>=75).length,"A-Leads","Opportunity ≥ 75"],[videos.length,"Videos bereit",`${views} Aufrufe`],[hotLeads,"Heiße Leads",`${inbound.length} Antworten`],[meetings,"Termine+","Pipeline aktiv"]].map(([v,l,s])=><div className="os-card os-kpi" key={String(l)}><div className="os-kpi-label">{l}</div><div className="os-kpi-value">{v}</div><div className="os-kpi-sub">{s}</div></div>)}</div>
      <section className="os-card os-section"><div className="os-section-head"><div><div className="os-kicker">Aktive Kampagne</div><h2>{activeCampaign?.name||"Noch keine Kampagne"}</h2></div><div className="os-toolbar"><span className={`os-pill ${activeCampaign?.status==="active"?"green":""}`}>{activeCampaign?.status||"bereit"}</span><button className="os-btn small" onClick={()=>go("campaigns")}>Kampagne öffnen →</button></div></div><div className="os-pipeline">{[[leads.length,"Leads"],[leads.filter(l=>l.email&&l.email_status!=="invalid").length,"Kontaktierbar"],[messages.filter(m=>m.direction==="outbound"&&m.status!=="queued").length,"Versendet"],[views,"Angesehen"],[inbound.length,"Antworten"],[meetings,"Termin"]].map(([v,l])=><div className={`os-pipe ${Number(v)>0?"done":""}`} key={String(l)}><div className="os-pipe-dot">{Number(v)>0?"✓":"0"}</div><strong>{v}</strong><span>{l}</span></div>)}</div></section>
      <section className="os-card"><div className="os-section" style={{marginBottom:0}}><div className="os-section-head"><div><div className="os-kicker">Live-Aktivität</div><h2>Letzte Leads</h2></div><button className="os-btn" onClick={()=>go("leads")}>Alle Leads ansehen</button></div></div><LeadTable rows={filtered.slice(0,8)} videos={videos} events={videoEvents} onSelect={id=>{setSelectedId(id);go("leads")}}/></section></>}

    {section==="finder"&&<div className="os-columns"><section className="os-card os-section"><div className="os-section-head"><div><div className="os-kicker">Lead Radar</div><h2>Unternehmen automatisch finden</h2><p>Auto nutzt Google Maps, wenn die Engine bereit ist; sonst fällt das System sauber auf OpenStreetMap zurück.</p></div></div><form className="os-form" onSubmit={findLeads}><div className="os-formgrid"><div className="os-field"><label>Datenquelle</label><select name="source" defaultValue="auto"><option value="auto">Auto · beste verfügbare Quelle</option><option value="google_maps">Google Maps Scraper</option><option value="openstreetmap">OpenStreetMap kostenlos</option></select></div><div className="os-field"><label>Zielgruppe / Suchbegriff</label><input name="query" placeholder="z. B. Logistik, Produktion, Hotel"/></div><div className="os-field"><label>Branche</label><select name="industry" defaultValue="Logistik"><option>Logistik</option><option>Produktion</option><option>Industrie</option><option>Hotel</option><option>Pflege</option><option>Autohaus</option><option>Fitness</option><option>Supermarkt</option><option>Landwirtschaft</option></select></div><div className="os-field"><label>Ort / Region *</label><input name="location" required placeholder="z. B. Stuttgart"/></div><div className="os-field"><label>Radius</label><select name="radius" defaultValue="25"><option value="10">10 km</option><option value="25">25 km</option><option value="50">50 km</option><option value="100">100 km</option></select></div><div className="os-field"><label>Max. Ergebnisse</label><select name="limit" defaultValue="100"><option>25</option><option>50</option><option>100</option><option>250</option><option>500</option><option>1000</option></select></div></div><div className="os-toolbar"><button className="os-btn primary" disabled={busy}>{busy?"Suche läuft…":"Leads finden"}</button>{activeGoogleSearch?<button type="button" className="os-btn" disabled={busy} onClick={()=>{setBusy(true);void pollGoogleMaps(activeGoogleSearch,true).catch(x=>setError(x.message)).finally(()=>setBusy(false))}}>Ergebnisse aktualisieren</button>:null}</div></form><div className="os-source">{finderAttribution||`Google Maps: ${integrationFor("google_maps")?.status||"nicht verbunden"} · OSM-Fallback aktiv`}</div></section><section className="os-card os-section"><div className="os-section-head"><div><div className="os-kicker">Ergebnisse</div><h2>{finderResults.length} Unternehmen</h2></div>{finderResults.length?<button className="os-btn primary" disabled={busy||!finderSelected.size} onClick={importFinder}>{finderSelected.size} importieren</button>:null}</div><div className="os-finder-results">{finderResults.length?finderResults.map((r,i)=><label className="os-checkrow" key={`${r.source_external_id}-${i}`}><input type="checkbox" checked={finderSelected.has(i)} onChange={e=>{const n=new Set(finderSelected);e.target.checked?n.add(i):n.delete(i);setFinderSelected(n)}}/><div><strong>{r.company_name}</strong><small>{[r.city,r.industry,r.website,r.email,r.rating?`${r.rating}★`:null].filter(Boolean).join(" · ")||"Basisdaten gefunden"}</small></div><span className="os-pill">{r.email?"E-Mail ✓":r.phone?"Telefon ✓":"Research"}</span></label>):<div className="os-empty">Suche links starten.</div>}</div></section></div>}

    {section==="leads"&&<div className="os-columns"><section className="os-card"><div className="os-section" style={{marginBottom:0}}><div className="os-section-head"><div><div className="os-kicker">Sales CRM</div><h2>Leads & Opportunity</h2></div><span className="os-pill">{filtered.length} Datensätze</span></div></div><LeadTable rows={filtered} videos={videos} events={videoEvents} onSelect={setSelectedId}/></section><aside className="os-grid"><section className="os-card os-section"><div className="os-kicker">Neuer Lead</div><form className="os-form" onSubmit={createManualLead}><div className="os-field"><label>Unternehmen *</label><input name="company" required/></div><div className="os-formgrid"><div className="os-field"><label>Ort</label><input name="city"/></div><div className="os-field"><label>Branche</label><input name="industry"/></div><div className="os-field"><label>Website</label><input name="website"/></div><div className="os-field"><label>E-Mail</label><input type="email" name="email"/></div><div className="os-field"><label>Telefon</label><input name="phone"/></div></div><button className="os-btn primary" disabled={busy}>Lead speichern</button></form></section>{selected?<section className="os-card os-section"><div className="os-section-head"><div><div className="os-kicker">Lead Intelligence</div><h2>{selected.company_name}</h2></div><div className="os-score">{selected.total_score}</div></div><div className="os-detail"><div className="os-detail-row"><span>Status</span><select value={selected.status} onChange={e=>void updateLeadStatus(e.target.value)}>{Object.entries(STATUS_LABEL).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div><div className="os-detail-row"><span>Kontakt</span><div>{selected.contact_name||"—"}<br/>{selected.email||selected.phone||"Noch anreichern"}{selected.email?<><br/><span className={`os-pill ${selected.email_status==="valid"?"green":selected.email_status==="invalid"?"hot":""}`}>{selected.email_status||"unknown"}</span></>:null}</div></div><div className="os-detail-row"><span>Research</span><strong>{selected.enriched_at?"Firecrawl ✓":"Noch offen"}</strong></div><div className="os-detail-row"><span>PV / Energie</span><strong>{selected.pv_score} / {selected.energy_score}</strong></div><div className="os-detail-row"><span>Sales Angle</span><div>{selected.summary||selected.pitch||"Daten anreichern"}</div></div></div><div className="os-toolbar" style={{marginTop:13}}><button className="os-btn" disabled={busy||!selected.website} onClick={()=>void enrichLead(selected)}>Website anreichern</button><button className="os-btn" disabled={busy||!selected.email} onClick={()=>void verifyEmail(selected)}>E-Mail prüfen</button><button className="os-btn primary" disabled={busy} onClick={createSelectedVideo}>{selectedVideo?"Video öffnen":"Fake Loom erstellen"}</button>{selectedVideo?<a className="os-btn" target="_blank" href={`/v/${selectedVideo.slug}`}>Vorschau ↗</a>:null}</div><div className="os-tabs"><button className="os-tab active">Timeline</button></div><div className="os-timeline">{activities.filter(a=>a.lead_id===selected.id).slice(0,10).map(a=><div className="os-event" key={a.id}><strong>{a.title}</strong>{a.detail?<div>{a.detail}</div>:null}<small>{fmt(a.created_at)}</small></div>)}{!activities.some(a=>a.lead_id===selected.id)?<div className="os-empty">Noch keine Aktivität.</div>:null}</div></section>:null}</aside></div>}

    {section==="studio"&&<section className="os-card os-section"><div className="os-section-head"><div><div className="os-kicker">Fake Loom Engine</div><h2>Personalisierte Video-Landingpages</h2><p>Website, Ansprechpartner, individuelle Findings, CTA und Watchtime-Tracking pro Lead.</p></div></div><div className="os-grid" style={{gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))"}}>{leads.slice(0,50).map(l=>{const v=videos.find(x=>x.lead_id===l.id&&x.status!=="archived");const st=v?videoStats(videoEvents,v.id):null;return <div className="os-video-card" key={l.id}><div className="os-video-preview">▶</div><strong>{l.company_name}</strong><div style={{fontSize:10,color:"#8792a4",margin:"4px 0 10px"}}>{v?`${st?.views||0} Views · ${st?.watch||0}% max. Watchtime`:"Noch nicht erstellt"}</div>{v?<div className="os-toolbar"><a className="os-btn small" target="_blank" href={`/v/${v.slug}`}>Landingpage ↗</a><span className={`os-pill ${(st?.watch||0)>=75?"hot":""}`}>{st?.watch||0}%</span></div>:<button className="os-btn small primary" disabled={busy} onClick={async()=>{setBusy(true);try{await createVideo(l);await load()}catch(x){setError(x instanceof Error?x.message:"Fehler")}finally{setBusy(false)}}}>Video erstellen</button>}</div>})}</div></section>}

    {section==="campaigns"&&<div className="os-columns"><section className="os-card os-section"><div className="os-section-head"><div><div className="os-kicker">Instantly-artige Engine</div><h2>Neue personalisierte Kampagne</h2><p>Mailbox-Rotation, Limits, Follow-up-Sequenz, Reply-Stop und Fake-Loom auf Knopfdruck.</p></div></div><form className="os-form" onSubmit={createCampaign}><div className="os-formgrid"><div className="os-field"><label>Kampagnenname</label><input name="name" required defaultValue="Gewerbe Energie · DACH"/></div><div className="os-field"><label>Mind. Opportunity Score</label><select name="minScore" defaultValue="65"><option>50</option><option>65</option><option>75</option><option>85</option></select></div><div className="os-field"><label>Tageslimit gesamt</label><input name="dailyLimit" type="number" min="1" max="150" defaultValue="30"/></div><div className="os-field"><label><input type="checkbox" name="video" defaultChecked/> Fake-Loom automatisch erstellen</label></div><div className="os-field"><label><input type="checkbox" name="verifiedOnly"/> Nur Reacher-valid E-Mails</label></div></div><div className="os-field"><label>Betreff</label><input name="subject" defaultValue={DEFAULT_SUBJECT}/></div><div className="os-field"><label>E-Mail 1</label><textarea name="body" defaultValue={DEFAULT_BODY}/></div><div className="os-callout"><strong>Automatische Sequenz:</strong> E-Mail/Video jetzt → Follow-up nach 72h → Call-Aufgabe nach weiteren 72h. Antwort stoppt die Sequenz automatisch. Als ungültig verifizierte E-Mails werden immer ausgeschlossen.</div><button className="os-btn primary" disabled={busy}>Kampagne starten</button></form></section><section className="os-card os-section"><div className="os-section-head"><div><div className="os-kicker">Kampagnen</div><h2>Aktiv & Historie</h2></div><button className="os-btn" disabled={busy} onClick={runWorker}>Worker jetzt ausführen</button></div>{campaigns.length?campaigns.map(c=><div className="os-checkrow" key={c.id}><span className={`os-pill ${c.status==="active"?"green":""}`}>{c.status}</span><div><strong>{c.name}</strong><small>{c.daily_limit}/Tag · Start {fmt(c.started_at||c.created_at)}</small></div><span>{messages.filter(m=>m.campaign_id===c.id&&m.direction==="outbound").length} Mails</span></div>):<div className="os-empty">Noch keine Kampagne.</div>}</section></div>}

    {section==="inbox"&&<section className="os-card"><div className="os-section"><div className="os-section-head"><div><div className="os-kicker">Unified Inbox</div><h2>Antworten</h2></div><div className="os-toolbar">{mailboxes.map(m=><button key={m.id} className="os-btn small" disabled={busy||!m.imap_host} onClick={()=>mailboxAction(m.id,"sync")}>↻ {m.email_address}</button>)}</div></div></div>{inbound.length?<table className="os-table"><thead><tr><th>Von</th><th>Betreff</th><th>Lead</th><th>Zeit</th></tr></thead><tbody>{inbound.map(m=><tr key={m.id}><td>{m.from_email}</td><td><strong>{m.subject||"Antwort"}</strong></td><td>{leads.find(l=>l.id===m.lead_id)?.company_name||"—"}</td><td>{fmt(m.sent_at||m.created_at)}</td></tr>)}</tbody></table>:<div className="os-empty">Noch keine Antworten. IMAP-Mailbox verbinden und synchronisieren.</div>}</section>}

    {section==="followups"&&<section className="os-card os-section"><div className="os-section-head"><div><div className="os-kicker">Next Best Action</div><h2>Follow-ups & Hot Leads</h2></div><span className="os-pill hot">{openFollowups.length} offen</span></div>{openFollowups.length?openFollowups.map(f=><div className="os-checkrow" key={f.id}><span className={`os-pill ${f.priority==="hot"?"hot":""}`}>{f.priority}</span><div><strong>{f.title}</strong><small>{f.reason||leads.find(l=>l.id===f.lead_id)?.company_name||""} · fällig {fmt(f.due_at)}</small></div><button className="os-btn small" onClick={()=>completeFollowup(f.id)}>Erledigt ✓</button></div>):<div className="os-empty">Keine offenen Follow-ups.</div>}</section>}

    {section==="templates"&&<section className="os-card os-section"><div className="os-section-head"><div><div className="os-kicker">Vorlagen</div><h2>Personalisierungs-Tokens</h2></div></div><div className="os-columns"><div className="os-callout"><strong>E-Mail + Video Analyse</strong><pre className="os-code">{DEFAULT_SUBJECT+"\n\n"+DEFAULT_BODY}</pre></div><div className="os-callout"><strong>Verfügbare Tokens</strong><div className="os-code">{"{{firstname}}\n{{company}}\n{{city}}\n{{industry}}\n{{opportunity}}\n{{reason}}\n{{video_url}}"}</div></div></div></section>}

    {section==="integrations"&&<div className="os-grid" style={{gap:18}}><section className="os-card os-section"><div className="os-section-head"><div><div className="os-kicker">Intelligence Engines</div><h2>Lead- & Research-Integrationen</h2><p>API-Keys/Secrets werden ausschließlich serverseitig im Supabase Vault gespeichert.</p></div></div><div className="os-grid" style={{gridTemplateColumns:"repeat(auto-fit,minmax(290px,1fr))"}}><IntegrationCard provider="google_maps" title="Google Maps Scraper" description="Self-hosted gosom Engine für große lokale Firmenlisten." current={integrationFor("google_maps")} busy={busy} onSave={saveIntegration} onTest={testIntegration} placeholder="https://maps-scraper.deine-domain.de"/><IntegrationCard provider="firecrawl" title="Firecrawl" description="Website-Crawl für echte Firmen-, Entscheider- und Signalsuche." current={integrationFor("firecrawl")} busy={busy} onSave={saveIntegration} onTest={testIntegration} placeholder="https://api.firecrawl.dev" secretLabel="API Key (bei Cloud)"/><IntegrationCard provider="reacher" title="Reacher" description="E-Mail-Verifizierung vor Versand. Proprietärer Einsatz benötigt passende Lizenz." current={integrationFor("reacher")} busy={busy} onSave={saveIntegration} onTest={testIntegration} placeholder="https://reacher.deine-domain.de"/></div></section><div className="os-columns"><section className="os-card os-section"><div className="os-section-head"><div><div className="os-kicker">Mailbox hinzufügen</div><h2>SMTP + IMAP sicher verbinden</h2><p>Passwörter werden serverseitig verschlüsselt gespeichert und nie an den Browser zurückgegeben.</p></div></div><form className="os-form" onSubmit={saveMailbox}><div className="os-formgrid"><div className="os-field"><label>Absender E-Mail *</label><input name="email" type="email" required/></div><div className="os-field"><label>Absendername</label><input name="fromName" defaultValue="Walkenhorst Energie"/></div><div className="os-field"><label>SMTP Host *</label><input name="smtpHost" required placeholder="smtp.provider.de"/></div><div className="os-field"><label>SMTP Port</label><input name="smtpPort" type="number" defaultValue="587"/></div><div className="os-field"><label>SMTP Benutzer</label><input name="smtpUsername"/></div><div className="os-field"><label>SMTP Passwort *</label><input name="smtpPassword" type="password" required/></div><div className="os-field"><label><input name="smtpSecure" type="checkbox"/> SSL/TLS direkt (meist Port 465)</label></div><div className="os-field"><label>Tageslimit</label><input name="dailyLimit" type="number" min="1" max="50" defaultValue="30"/></div><div className="os-field"><label>IMAP Host</label><input name="imapHost" placeholder="imap.provider.de"/></div><div className="os-field"><label>IMAP Port</label><input name="imapPort" type="number" defaultValue="993"/></div><div className="os-field"><label>IMAP Benutzer</label><input name="imapUsername"/></div><div className="os-field"><label>IMAP Passwort</label><input name="imapPassword" type="password"/></div></div><button className="os-btn primary" disabled={busy}>Mailbox sicher speichern</button></form></section><section className="os-card os-section"><div className="os-section-head"><div><div className="os-kicker">Sending Health</div><h2>{mailboxes.length} Mailboxen</h2></div></div>{mailboxes.length?mailboxes.map(m=><div className="os-checkrow" key={m.id}><span className={`os-pill ${m.status==="ready"?"green":m.status==="error"?"hot":""}`}>{m.status}</span><div><strong>{m.email_address}</strong><small>{m.sent_today}/{m.daily_limit} heute · {m.smtp_host||"SMTP fehlt"}{m.last_error?` · ${m.last_error}`:""}</small></div><div className="os-toolbar"><button className="os-btn small" disabled={busy} onClick={()=>mailboxAction(m.id,"test")}>Test</button><button className="os-btn small" disabled={busy||!m.imap_host} onClick={()=>mailboxAction(m.id,"sync")}>Sync</button></div></div>):<div className="os-empty">Noch keine Mailbox verbunden.</div>}</section></div></div>}

    {section==="audit"&&<div className="os-columns"><section className="os-card os-section"><div className="os-kicker">Website Intelligence</div><h2>High-End Website Analyse</h2><form className="os-form" onSubmit={runAudit}><div className="os-field"><label>URL</label><input name="url" type="url" required defaultValue={selected?.website||""}/></div><button className="os-btn primary" disabled={busy}>Analyse starten</button></form></section><section className="os-card os-section">{audit?<><div className="os-section-head"><div><div className="os-kicker">Audit Score</div><h2>{audit.url}</h2></div><div className="os-score">{audit.score}</div></div><p style={{fontSize:12}}>{audit.summary}</p>{audit.findings?.slice(0,8).map((f,i)=><div className="os-checkrow" key={i}><span className="os-pill hot">{f.severity}</span><div><strong>{f.title}</strong><small>{f.recommendation}</small></div></div>)}</>:<div className="os-empty">URL analysieren, um Findings zu sehen.</div>}</section></div>}

    {section==="seo"&&<div className="os-columns"><section className="os-card os-section"><div className="os-kicker">SEO Radar</div><h2>Keyword Opportunities</h2><form className="os-form" onSubmit={runSeo}><div className="os-field"><label>Keyword</label><input name="keyword" required placeholder="Photovoltaik Gewerbe"/></div><button className="os-btn primary" disabled={busy}>Keywords finden</button></form></section><section className="os-card os-section">{keywords.length?keywords.map((k,i)=><div className="os-checkrow" key={i}><span className="os-score">{k.opportunity}</span><div><strong>{k.keyword}</strong><small>{k.intent}</small></div></div>):<div className="os-empty">Keyword eingeben.</div>}</section></div>}
    </div></main></div></div>;
}

function IntegrationCard({provider,title,description,current,busy,onSave,onTest,placeholder,secretLabel="Secret / API Key"}:{provider:string;title:string;description:string;current:Integration|undefined;busy:boolean;onSave:(e:FormEvent<HTMLFormElement>)=>Promise<void>;onTest:(provider:string)=>Promise<void>;placeholder:string;secretLabel?:string}){
  return <div className="os-callout"><div className="os-section-head"><div><strong>{title}</strong><p style={{fontSize:10,margin:"5px 0"}}>{description}</p></div><span className={`os-pill ${current?.status==="ready"?"green":current?.status==="error"?"hot":""}`}>{current?.status||"setup"}</span></div><form className="os-form" onSubmit={onSave}><input type="hidden" name="provider" value={provider}/><input type="hidden" name="label" value={title}/><div className="os-field"><label>Base URL</label><input name="baseUrl" required defaultValue={current?.base_url||""} placeholder={placeholder}/></div><div className="os-field"><label>{secretLabel}</label><input name="secret" type="password" placeholder={current?"Leer lassen = vorhandenes Secret behalten":"Optional bei offenem Self-Host"}/></div>{provider==="firecrawl"?<><input type="hidden" name="authHeader" value="Authorization"/><input type="hidden" name="authScheme" value="Bearer"/></>:null}<div className="os-toolbar"><button className="os-btn primary small" disabled={busy}>Speichern</button>{current?<button type="button" className="os-btn small" disabled={busy} onClick={()=>void onTest(provider)}>Verbindung testen</button>:null}</div></form>{current?.last_error?<div className="os-error" style={{marginTop:8}}>{current.last_error}</div>:null}{current?.last_tested_at?<small>Zuletzt getestet: {fmt(current.last_tested_at)}</small>:null}</div>;
}

function LeadTable({rows,videos,events,onSelect}:{rows:Lead[];videos:Video[];events:VideoEvent[];onSelect:(id:string)=>void}){
  return rows.length?<div className="os-tablewrap"><table className="os-table"><thead><tr><th>Unternehmen</th><th>Score</th><th>Status</th><th>Kontakt</th><th>Research</th><th>Video</th><th>Watchtime</th><th>Aktualisiert</th></tr></thead><tbody>{rows.map(l=>{const v=videos.find(x=>x.lead_id===l.id&&x.status!=="archived");const st=v?videoStats(events,v.id):null;return <tr key={l.id} onClick={()=>onSelect(l.id)} style={{cursor:"pointer"}}><td><div className="os-company"><div className="os-initials">{initials(l.company_name)}</div><div><strong>{l.company_name}</strong><small>{l.contact_name||l.city||l.website||"Noch nicht angereichert"}</small></div></div></td><td><div className="os-score">{l.total_score}</div></td><td><span className={`os-pill ${l.status==="engaged"?"hot":""}`}>{STATUS_LABEL[l.status]||l.status}</span></td><td>{l.email?<span className={`os-pill ${l.email_status==="valid"?"green":l.email_status==="invalid"?"hot":""}`}>E-Mail · {l.email_status||"unknown"}</span>:l.phone?<span className="os-pill">Telefon ✓</span>:"—"}</td><td>{l.enriched_at?<span className="os-pill green">Firecrawl ✓</span>:"—"}</td><td>{v?<span className="os-pill green">Bereit</span>:"—"}</td><td>{v?`${st?.watch||0}%`:"—"}</td><td>{fmt(l.updated_at)}</td></tr>})}</tbody></table></div>:<div className="os-empty">Noch keine Leads. Lead Finder starten.</div>;
}
