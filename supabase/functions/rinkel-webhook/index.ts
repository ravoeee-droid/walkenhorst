import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const H={"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-headers":"content-type"};
const out=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:H});

function env(){const url=Deno.env.get("SUPABASE_URL")||"";const secs=Deno.env.get("SUPABASE_SECRET_KEYS");const key=secs?JSON.parse(secs)?.default:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)throw new Error("Backend configuration missing");return{url,key}}
function admin(){const e=env();return createClient(e.url,e.key,{auth:{persistSession:false,autoRefreshToken:false}})}
async function sha256(value:string){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("")}
function phone(value:unknown){const raw=String(value||"").trim();const digits=raw.replace(/\D/g,"");if(!digits)return null;if(raw.startsWith("+"))return `+${digits}`;if(digits.startsWith("00"))return `+${digits.slice(2)}`;if(digits.startsWith("0"))return `+49${digits.slice(1)}`;return `+${digits}`}
function date(value:unknown){const raw=String(value||"").trim();if(!raw)return new Date().toISOString();const d=new Date(raw);return Number.isNaN(d.getTime())?new Date().toISOString():d.toISOString()}
function eventType(p:any){if(p?.sentiment!==undefined||p?.topics!==undefined||p?.summary!==undefined)return"insights";if(p?.cause!==undefined||p?.callRecordingUrl!==undefined)return"end";if(p?.answeredBy!==undefined||p?.choice!==undefined)return"start";if(p?.to!==undefined&&p?.from!==undefined&&p?.userId!==undefined)return"outgoing";if(p?.to!==undefined&&p?.from!==undefined)return"incoming";return"unknown"}
async function matchLead(db:any,userId:string,type:string,p:any){const counterpart=type==="outgoing"?phone(p?.to):type==="incoming"?phone(p?.from):null;if(!counterpart)return null;const {data}=await db.from("energy_leads").select("id").eq("user_id",userId).eq("phone_e164",counterpart).limit(1).maybeSingle();return data?.id||null}

async function processEvent(db:any,userId:string,p:any){
 const externalId=String(p?.id||"").trim();if(!externalId)return;
 const type=eventType(p);const occurred=date(p?.datetime);let {data:call}=await db.from("energy_calls").select("*").eq("user_id",userId).eq("provider","rinkel").eq("external_call_id",externalId).maybeSingle();
 let leadId=call?.lead_id||null;
 if(!leadId&&(type==="incoming"||type==="outgoing"))leadId=await matchLead(db,userId,type,p);
 if(!call){
   const direction=type==="outgoing"?"outgoing":type==="incoming"?"incoming":"unknown";
   const inserted=await db.from("energy_calls").insert({user_id:userId,lead_id:leadId,provider:"rinkel",external_call_id:externalId,direction,from_phone:phone(p?.from),to_phone:phone(p?.to),rinkel_user_id:p?.userId?String(p.userId):null,started_at:["incoming","outgoing"].includes(type)?occurred:null,raw_metadata:{first_event:type}}).select("*").single();if(inserted.error)throw inserted.error;call=inserted.data;
 }
 const eventInsert=await db.from("energy_call_events").insert({user_id:userId,call_id:call.id,provider:"rinkel",external_call_id:externalId,event_type:type,occurred_at:occurred,payload:p}).select("id").single();
 if(eventInsert.error){if(eventInsert.error.code==="23505")return;throw eventInsert.error}
 const updates:any={updated_at:new Date().toISOString(),raw_metadata:{...(call.raw_metadata||{}),last_event:type}};
 if(leadId&&!call.lead_id)updates.lead_id=leadId;
 if(type==="incoming"||type==="outgoing"){updates.direction=type;updates.from_phone=phone(p?.from);updates.to_phone=phone(p?.to);updates.rinkel_user_id=p?.userId?String(p.userId):call.rinkel_user_id;updates.started_at=occurred}
 if(type==="start"){updates.answered_at=occurred;updates.answered_by=p?.answeredBy?String(p.answeredBy):null;updates.rinkel_user_id=p?.userId?String(p.userId):call.rinkel_user_id}
 if(type==="end"){updates.ended_at=occurred;updates.cause=p?.cause?String(p.cause):null;updates.recording_url=p?.callRecordingUrl?String(p.callRecordingUrl):null}
 if(type==="insights"){updates.sentiment=p?.sentiment?String(p.sentiment):null;updates.topics=Array.isArray(p?.topics)?p.topics.map((x:unknown)=>String(x)).slice(0,8):[];updates.ai_summary=p?.summary?String(p.summary).slice(0,5000):null}
 await db.from("energy_calls").update(updates).eq("id",call.id).eq("user_id",userId);
 if(leadId){
   const titles:Record<string,string>={incoming:"Rinkel: eingehender Anruf",outgoing:"Rinkel: ausgehender Anruf",start:"Rinkel: Gespräch angenommen",end:"Rinkel: Gespräch beendet",insights:"Rinkel AI Insights",unknown:"Rinkel Call Event"};
   const detail=type==="end"?`${String(p?.cause||"ENDED")}${p?.callRecordingUrl?" · Recording verfügbar":""}`:type==="insights"?String(p?.summary||p?.sentiment||"AI Insights verfügbar").slice(0,1000):null;
   await db.from("energy_activities").insert({user_id:userId,lead_id:leadId,activity_type:`rinkel_${type}`,title:titles[type],detail,metadata:{call_id:externalId,rinkel_event:type,sentiment:p?.sentiment||null,topics:p?.topics||null,recording_url:p?.callRecordingUrl||null}});
   if(type==="outgoing"){
     const {data:lead}=await db.from("energy_leads").select("status").eq("id",leadId).eq("user_id",userId).single();const leadUpdate:any={last_contact_at:occurred,updated_at:new Date().toISOString()};if(["new","research","ready"].includes(String(lead?.status||"")))leadUpdate.status="contacted";await db.from("energy_leads").update(leadUpdate).eq("id",leadId).eq("user_id",userId);
   }
   if(type==="insights"&&String(p?.sentiment||"").toUpperCase()==="POSITIVE"){
     const intent=await db.from("energy_intent_events").insert({user_id:userId,lead_id:leadId,source:"rinkel",event_type:"positive_call_sentiment",weight:15,external_id:`rinkel:${externalId}:insights`,metadata:{summary:p?.summary||null,topics:p?.topics||[]}});if(intent.error&&intent.error.code!=="23505")console.error("rinkel intent",intent.error);
   }
 }
}

Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:H});if(req.method!=="POST")return out({error:"Method not allowed"},405);
 try{
   const u=new URL(req.url);const token=String(u.searchParams.get("token")||"").trim();if(!token)return out({error:"Token fehlt"},401);const hash=await sha256(token);const db=admin();const {data:t}=await db.from("energy_webhook_tokens").select("user_id").eq("provider","rinkel").eq("token_hash",hash).eq("active",true).maybeSingle();if(!t)return out({error:"Ungültiger Token"},401);
   const payload=await req.json().catch(()=>({}));if(!payload?.id)return out({ok:true,test:true});
   const work=processEvent(db,String(t.user_id),payload).catch((e)=>console.error("rinkel webhook processing",e));const runtime=(globalThis as any).EdgeRuntime;if(runtime?.waitUntil){runtime.waitUntil(work);return out({ok:true,accepted:true})}await work;return out({ok:true,accepted:true});
 }catch(e){console.error(e);return out({error:"Webhook konnte nicht verarbeitet werden"},500)}
});
