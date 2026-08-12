import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const H={"content-type":"application/json","cache-control":"no-store"};
const out=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:H});

function env(){const url=Deno.env.get("SUPABASE_URL")||"";const secs=Deno.env.get("SUPABASE_SECRET_KEYS");const key=secs?JSON.parse(secs)?.default:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)throw new Error("Backend configuration missing");return{url,key}}
function admin(){const e=env();return createClient(e.url,e.key,{auth:{persistSession:false,autoRefreshToken:false}})}
async function authorize(req:Request,db:ReturnType<typeof admin>){const supplied=req.headers.get("x-worker-key")||"";if(!supplied)return false;const {data}=await db.rpc("energy_get_system_secret",{p_name:"energy_worker_key"});return Boolean(data&&data===supplied)}
async function fetchTimeout(url:string,headers:Record<string,string>,ms=12000){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),ms);try{return await fetch(url,{method:"GET",headers,signal:controller.signal})}finally{clearTimeout(timer)}}
function safeJson(text:string){try{return JSON.parse(text)}catch{return text}}

Deno.serve(async(req)=>{
 if(req.method!=="POST")return out({error:"Method not allowed"},405);
 const db=admin();
 try{
  if(!await authorize(req,db))return out({error:"Nicht autorisiert"},401);
  const body=await req.json().catch(()=>({}));const limit=Math.max(1,Math.min(50,Number(body?.limit)||20));
  const {data:calls,error}=await db.from("energy_calls").select("id,user_id,lead_id,external_call_id,raw_metadata,cdr_synced_at,transcript_synced_at").eq("provider","rinkel").not("ended_at","is",null).or("cdr_synced_at.is.null,transcript_synced_at.is.null").order("ended_at",{ascending:true}).limit(limit);
  if(error)throw error;
  let processed=0,cdrSynced=0,transcripts=0,pending=0,failed=0;
  const integrations=new Map<string,{base:string;secret:string}>();

  for(const call of calls||[]){
   processed++;
   try{
    let integration=integrations.get(call.user_id);
    if(!integration){
      const {data:i}=await db.from("energy_integrations").select("id,base_url,status").eq("user_id",call.user_id).eq("provider","rinkel").in("status",["ready","setup"]).limit(1).maybeSingle();
      if(!i?.base_url){await db.from("energy_calls").update({reconciliation_error:"Rinkel Integration nicht bereit",updated_at:new Date().toISOString()}).eq("id",call.id);failed++;continue}
      const {data:secret}=await db.rpc("energy_get_integration_secret",{p_integration_id:i.id,p_user_id:call.user_id});
      if(!secret){await db.from("energy_calls").update({reconciliation_error:"Rinkel API-Key fehlt",updated_at:new Date().toISOString()}).eq("id",call.id);failed++;continue}
      integration={base:String(i.base_url).replace(/\/$/,""),secret:String(secret)};integrations.set(call.user_id,integration);
    }
    const headers={"x-rinkel-api-key":integration.secret,"accept":"application/json","user-agent":"Walkenhorst-Energy-Radar/1.0"};
    let errorText:string|null=null;

    if(!call.cdr_synced_at){
      const response=await fetchTimeout(`${integration.base}/call-detail-records/by-call-id/${encodeURIComponent(call.external_call_id)}`,headers);
      if(response.ok){
        const text=await response.text();const parsed=safeJson(text);const metadata={...(call.raw_metadata||{}),cdr:parsed,cdr_fetched_at:new Date().toISOString()};
        const {error:updateError}=await db.from("energy_calls").update({raw_metadata:metadata,cdr_synced_at:new Date().toISOString(),reconciliation_error:null,updated_at:new Date().toISOString()}).eq("id",call.id);if(updateError)throw updateError;cdrSynced++;
      }else if(response.status===404||response.status===204){pending++;errorText=`CDR noch nicht verfügbar (${response.status})`}
      else throw new Error(`Rinkel CDR HTTP ${response.status}`);
    }

    if(!call.transcript_synced_at){
      const response=await fetchTimeout(`${integration.base}/call-detail-records/${encodeURIComponent(call.external_call_id)}/transcription`,headers);
      if(response.status===204){
        const {error:updateError}=await db.from("energy_calls").update({transcript_raw:null,transcript_synced_at:new Date().toISOString(),reconciliation_error:errorText,updated_at:new Date().toISOString()}).eq("id",call.id);if(updateError)throw updateError;transcripts++;
      }else if(response.ok){
        const text=(await response.text()).slice(0,250000);const {error:updateError}=await db.from("energy_calls").update({transcript_raw:text||null,transcript_synced_at:new Date().toISOString(),reconciliation_error:errorText,updated_at:new Date().toISOString()}).eq("id",call.id);if(updateError)throw updateError;transcripts++;
      }else if(response.status===404){pending++;errorText=errorText||"Transcription noch nicht verfügbar (404)"}
      else throw new Error(`Rinkel Transcription HTTP ${response.status}`);
    }

    if(errorText)await db.from("energy_calls").update({reconciliation_error:errorText,updated_at:new Date().toISOString()}).eq("id",call.id);
   }catch(e){failed++;await db.from("energy_calls").update({reconciliation_error:e instanceof Error?e.message.slice(0,500):"Rinkel reconciliation failed",updated_at:new Date().toISOString()}).eq("id",call.id)}
  }
  return out({ok:true,processed,cdr_synced:cdrSynced,transcripts_synced:transcripts,pending,failed});
 }catch(e){return out({error:e instanceof Error?e.message.slice(0,700):"Rinkel reconciliation worker error"},500)}
});
