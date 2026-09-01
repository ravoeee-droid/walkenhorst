import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const H={"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-headers":"authorization, apikey, content-type, x-client-info","access-control-allow-methods":"POST, OPTIONS"};
const out=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
function env(){const url=Deno.env.get("SUPABASE_URL")!;const pubs=Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");const secs=Deno.env.get("SUPABASE_SECRET_KEYS");const pub=pubs?JSON.parse(pubs)?.default:Deno.env.get("SUPABASE_ANON_KEY");const secret=secs?JSON.parse(secs)?.default:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!pub||!secret)throw new Error("Backend configuration missing");return{url,pub,secret}}
function admin(){const{url,secret}=env();return createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})}
async function actor(req:Request){const auth=req.headers.get("authorization")||"";const token=auth.toLowerCase().startsWith("bearer ")?auth.slice(7).trim():"";if(!token)return null;const{url,pub}=env();const scoped=createClient(url,pub,{auth:{persistSession:false,autoRefreshToken:false}});const{data,error}=await scoped.auth.getUser(token);if(error||!data.user)return null;const owner=typeof data.user.app_metadata?.workspace_owner_id==="string"?data.user.app_metadata.workspace_owner_id.trim():"";return{id:owner||data.user.id,token}}
async function sha256(value:string){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,"0")).join("")}
function appBase(){return String(Deno.env.get("WALKENHORST_APP_URL")||"https://walkenhorst.vercel.app").replace(/\/$/,"")}

async function startHeadless(db:any,job:any){
  const token=`${crypto.randomUUID()}.${crypto.randomUUID()}`;
  const hash=await sha256(token);
  const expires=new Date(Date.now()+30*60*1000).toISOString();
  const metadata={...(job.metadata&&typeof job.metadata==="object"?job.metadata:{}),render_token_hash:hash,render_token_expires_at:expires,render_triggered_at:new Date().toISOString(),render_mode:"final_mp4_only"};
  const{error:updateError}=await db.from("energy_render_jobs").update({metadata,render_engine:"vercel-headless-mp4",status:"queued",error:null,updated_at:new Date().toISOString()}).eq("id",job.id);
  if(updateError)throw updateError;
  const response=await fetch(`${appBase()}/api/internal/render/${encodeURIComponent(job.id)}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token}),signal:AbortSignal.timeout(15000)}).catch(()=>null);
  if(!response||!response.ok){
    const detail=response?await response.text().catch(()=>""):"Render-Endpoint nicht erreichbar";
    await db.from("energy_render_jobs").update({error:`Render-Start fehlgeschlagen: ${detail||response?.status||"network"}`.slice(0,700),updated_at:new Date().toISOString()}).eq("id",job.id);
    return{started:false,status:response?.status||0};
  }
  return{started:true,status:response.status};
}

async function ensurePage(db:any,userId:string,leadId:string,token:string,templateKey:string){
  let{data:page}=await db.from("energy_video_pages").select("id,lead_id,slug,status,is_public,template_key,timeline_v3,rendered_video_url,updated_at").eq("user_id",userId).eq("lead_id",leadId).neq("status","archived").order("updated_at",{ascending:false}).limit(1).maybeSingle();
  if(!page?.id||!page?.is_public||String(page.template_key||"")!==templateKey){
    const r=await fetch(`${env().url}/functions/v1/crm-video-publish`,{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${token}`},body:JSON.stringify({leadId,templateKey})});
    const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(String(data?.error||`Landingpage konnte nicht vorbereitet werden (${r.status})`));
    const q=await db.from("energy_video_pages").select("id,lead_id,slug,status,is_public,template_key,timeline_v3,rendered_video_url,updated_at").eq("user_id",userId).eq("lead_id",leadId).neq("status","archived").order("updated_at",{ascending:false}).limit(1).maybeSingle();page=q.data;
  }
  if(!page?.id)throw new Error("Keine Landingpage für den Lead vorhanden");
  if(String(page.template_key||"")!==templateKey)throw new Error(`Falscher Video-Master auf Landingpage: ${page.template_key||"unbekannt"}`);
  return page;
}

async function queueOne(db:any,userId:string,leadId:string,token:string,force=false,overrideTemplate?:string){
  const{data:lead,error:leadError}=await db.from("energy_leads").select("id,company_name,contact_name,email,website,do_not_contact,video_template_key").eq("user_id",userId).eq("id",leadId).maybeSingle();if(leadError||!lead)throw new Error("Lead nicht gefunden");
  const templateKey=String(overrideTemplate||lead.video_template_key||"energiekosten").trim()||"energiekosten";
  const page=await ensurePage(db,userId,leadId,token,templateKey);
  if(page.rendered_video_url&&!force)return{leadId,company:lead.company_name,status:"already_completed",pageId:page.id,slug:page.slug,templateKey};
  const active=await db.from("energy_render_jobs").select("id,status,progress,created_at,metadata").eq("user_id",userId).eq("lead_id",leadId).in("status",["queued","preparing","rendering","encoding","uploading"]).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(active.data){const trigger=await startHeadless(db,active.data);return{leadId,company:lead.company_name,status:"already_queued",job:active.data,templateKey,trigger}}
  let config=await db.from("energy_studio_configs").select("id,config,template_key").eq("user_id",userId).eq("lead_id",leadId).eq("scope","lead").eq("template_key",templateKey).order("updated_at",{ascending:false}).limit(1).maybeSingle();
  if(!config.data){config=await db.from("energy_studio_configs").select("id,config,template_key").eq("user_id",userId).is("lead_id",null).eq("scope","global").eq("template_key",templateKey).order("updated_at",{ascending:false}).limit(1).maybeSingle()}
  if(!config.data?.id)throw new Error(`Studio-Konfiguration für ${templateKey} fehlt`);
  const timeline=(page.timeline_v3&&typeof page.timeline_v3==="object"?page.timeline_v3:(config.data.config as any)?.timeline)||{};
  const width=Math.max(320,Math.min(1920,Number((timeline as any).width)||1920));const height=Math.max(320,Math.min(1080,Number((timeline as any).height)||1080));const fps=Math.max(20,Math.min(30,Number((timeline as any).fps)||25));const aspect=String((timeline as any).aspectRatio||"16:9");const now=new Date().toISOString();
  const{data:job,error}=await db.from("energy_render_jobs").insert({user_id:userId,studio_config_id:config.data.id,lead_id:leadId,video_page_id:page.id,format:"mp4",aspect_ratio:aspect,width,height,fps,status:"queued",progress:0,render_engine:"vercel-headless-mp4",metadata:{source:"crm_v3_headless",company_name:lead.company_name,slug:page.slug,template_key:templateKey,queued_at:now,force:Boolean(force),render_mode:"final_mp4_only"}}).select("id,status,progress,lead_id,video_page_id,created_at,metadata").single();
  if(error){if(String(error.code)==="23505"){const existing=await db.from("energy_render_jobs").select("id,status,progress,lead_id,video_page_id,created_at,metadata").eq("user_id",userId).eq("lead_id",leadId).in("status",["queued","preparing","rendering","encoding","uploading"]).order("created_at",{ascending:false}).limit(1).maybeSingle();if(existing.data){const trigger=await startHeadless(db,existing.data);return{leadId,company:lead.company_name,status:"already_queued",job:existing.data,templateKey,trigger}}}throw error}
  await db.from("energy_activities").insert({user_id:userId,lead_id:leadId,activity_type:"render_queued",title:"Finaler MP4-Render eingeplant",detail:`Das Video wird automatisch serverseitig mit Master ${templateKey} gerendert.`,metadata:{render_job_id:job.id,template_key:templateKey}});
  const trigger=await startHeadless(db,job);
  return{leadId,company:lead.company_name,status:"queued",job,templateKey,trigger};
}

Deno.serve(async req=>{if(req.method==="OPTIONS")return new Response(null,{status:204,headers:H});if(req.method!=="POST")return out({error:"Method not allowed"},405);const a=await actor(req);if(!a)return out({error:"Nicht autorisiert"},401);const db=admin();try{const body=await req.json().catch(()=>({}));const action=String(body?.action||"queue");const templateOverride=String(body?.templateKey||"").trim()||undefined;
  if(action==="queue"){const leadId=String(body?.leadId||"").trim();if(!leadId)return out({error:"leadId fehlt"},400);return out({ok:true,result:await queueOne(db,a.id,leadId,a.token,Boolean(body?.force),templateOverride)})}
  if(action==="bulk_queue"){const ids=Array.isArray(body?.leadIds)?Array.from(new Set(body.leadIds.map((v:any)=>String(v||"").trim()).filter(Boolean))).slice(0,100):[];if(!ids.length)return out({error:"leadIds fehlen"},400);const results=[] as any[];for(const leadId of ids){try{results.push(await queueOne(db,a.id,leadId,a.token,Boolean(body?.force),templateOverride))}catch(e){results.push({leadId,status:"failed",error:e instanceof Error?e.message:"Queue fehlgeschlagen"})}}return out({ok:true,results,queued:results.filter(x=>x.status==="queued").length,skipped:results.filter(x=>x.status==="already_completed"||x.status==="already_queued").length,failed:results.filter(x=>x.status==="failed").length})}
  if(action==="cancel"){const id=String(body?.jobId||"").trim();if(!id)return out({error:"jobId fehlt"},400);const{data,error}=await db.from("energy_render_jobs").update({status:"cancelled",completed_at:new Date().toISOString(),error:"Vom Benutzer abgebrochen"}).eq("id",id).eq("user_id",a.id).in("status",["queued","preparing","rendering","encoding","uploading"]).select("id,status").maybeSingle();if(error)throw error;return out({ok:true,job:data})}
  if(action==="status"){const{data,error}=await db.from("energy_render_jobs").select("id,lead_id,video_page_id,status,progress,error,output_url,created_at,started_at,completed_at,metadata").eq("user_id",a.id).order("created_at",{ascending:false}).limit(100);if(error)throw error;return out({ok:true,jobs:data||[]})}
  return out({error:"Unbekannte Aktion"},400)}catch(e){return out({error:e instanceof Error?e.message.slice(0,700):"Render queue error"},500)}});