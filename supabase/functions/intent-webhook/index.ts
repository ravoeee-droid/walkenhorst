import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const H={"content-type":"application/json","cache-control":"no-store"};
const out=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
function env(){const url=Deno.env.get("SUPABASE_URL")||"";const secs=Deno.env.get("SUPABASE_SECRET_KEYS");const secretKey=secs?JSON.parse(secs)?.default:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!secretKey)throw new Error("Backend configuration missing");return{url,secretKey}}
function admin(){const e=env();return createClient(e.url,e.secretKey,{auth:{persistSession:false,autoRefreshToken:false}})}
async function sha256(value:string){const bytes=new TextEncoder().encode(value);const digest=await crypto.subtle.digest("SHA-256",bytes);return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("")}
function text(v:unknown){return typeof v==="string"?v.trim():""}
function eventName(body:any){return text(body?.event)||text(body?.event_type)||text(body?.type)||text(body?.data?.event)||text(body?.data?.type)||"event"}
function recursiveEmails(value:any,depth=0,found=new Set<string>()){if(depth>5||found.size>=10)return found;if(typeof value==="string"){const m=value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[];m.forEach(x=>found.add(x.toLowerCase()))}else if(Array.isArray(value)){for(const x of value)recursiveEmails(x,depth+1,found)}else if(value&&typeof value==="object"){for(const x of Object.values(value))recursiveEmails(x,depth+1,found)}return found}
function directLeadId(b:any){const ids=[b?.lead_id,b?.leadId,b?.metadata?.lead_id,b?.metadata?.leadId,b?.data?.lead_id,b?.data?.leadId,b?.custom_attributes?.lead_id,b?.conversation?.custom_attributes?.lead_id,b?.conversation?.custom_attributes?.walkenhorst_lead_id];for(const x of ids){const s=text(x);if(/^[0-9a-f-]{36}$/i.test(s))return s}return null}
function externalId(provider:string,event:string,b:any){const raw=b?.event_id??b?.eventId??b?.id??b?.data?.id??b?.data?.event_id??b?.visit?.id??b?.session?.id??b?.conversation?.id??null;return raw==null?null:`${provider}:${event}:${String(raw).slice(0,200)}`}
function weight(provider:string,event:string,b:any){const e=event.toLowerCase();if(provider==="activepieces"&&Number.isFinite(Number(b?.weight)))return Math.max(-100,Math.min(100,Math.round(Number(b.weight))));if(provider==="papermark"){if(/download|complete|finished/.test(e))return 35;if(/view|visit|open/.test(e))return 25;if(/page|link_click|click/.test(e))return 12}if(provider==="dub"){if(/conversion|sale|lead/.test(e))return 35;if(/click/.test(e))return 15}if(provider==="openreplay"){if(/calendar|booking|pricing|cta|conversion/.test(e))return 30;if(/session|visit/.test(e))return 8}if(provider==="typebot"){if(/complete|submitted|finished|qualified/.test(e))return 35;if(/email|phone|contact/.test(e))return 25;if(/start|visit/.test(e))return 10}if(provider==="chatwoot"){const messageType=text(b?.message_type||b?.data?.message_type).toLowerCase();if(/message_created|message/.test(e)&&(!messageType||messageType==="incoming"))return 30;if(/conversation_created|conversation_opened/.test(e))return 15}if(/reply|meeting|book|conversion|qualified|proposal_view/.test(e))return 30;if(/click|view|open|visit/.test(e))return 12;return 5}
function findNested(value:any,keys:string[],depth=0):string|null{if(depth>5||value==null)return null;if(typeof value!=="object")return null;for(const key of keys){if(key in value){const v=(value as any)[key];if(v!=null&&typeof v!=="object")return String(v)}}for(const child of Object.values(value)){if(child&&typeof child==="object"){const hit=findNested(child,keys,depth+1);if(hit)return hit}}return null}

Deno.serve(async(req)=>{
 if(req.method!=="POST")return out({error:"Method not allowed"},405);
 try{
  const url=new URL(req.url);const provider=text(url.searchParams.get("provider")).toLowerCase();const token=text(url.searchParams.get("token"));if(!provider||!token)return out({error:"Webhook credentials missing"},401);
  const db=admin();const hash=await sha256(token);const {data:t}=await db.from("energy_webhook_tokens").select("user_id,provider").eq("provider",provider).eq("token_hash",hash).eq("active",true).maybeSingle();if(!t)return out({error:"Invalid webhook token"},401);
  const raw=await req.text();if(raw.length>250000)return out({error:"Payload too large"},413);let body:any={};try{body=raw?JSON.parse(raw):{}}catch{return out({error:"Invalid JSON"},400)}
  const event=eventName(body);let leadId=directLeadId(body);
  if(leadId){const {data:l}=await db.from("energy_leads").select("id").eq("id",leadId).eq("user_id",t.user_id).maybeSingle();if(!l)leadId=null}
  if(!leadId){for(const email of recursiveEmails(body)){const {data:l}=await db.from("energy_leads").select("id").eq("user_id",t.user_id).ilike("email",email).limit(1).maybeSingle();if(l){leadId=l.id;break}}}
  if(!leadId)return out({ok:true,ignored:true,reason:"no_matching_lead"},202);
  const w=weight(provider,event,body);const ext=externalId(provider,event,body);const sessionId=findNested(body,["session_id","sessionId","session"]);const visitUrl=findNested(body,["url","link","href","share_url"]);
  const insert=await db.from("energy_intent_events").insert({user_id:t.user_id,lead_id:leadId,source:provider,event_type:event,weight:w,external_id:ext,session_id:sessionId,url:visitUrl,metadata:{payload:body}}).select("id").single();
  if(insert.error){if(insert.error.code==="23505")return out({ok:true,duplicate:true});throw insert.error}
  if(provider==="papermark"){
    const documentId=findNested(body,["document_id","documentId"]);const linkId=findNested(body,["link_id","linkId"]);const title=findNested(body,["document_name","documentName","title","name"])||"Angebot / Dokument";
    if(documentId||linkId){const {data:existing}=await db.from("energy_documents").select("id,view_count,total_view_seconds").eq("user_id",t.user_id).eq("lead_id",leadId).eq("provider","papermark").or([documentId?`external_document_id.eq.${documentId}`:null,linkId?`external_link_id.eq.${linkId}`:null].filter(Boolean).join(",")).limit(1).maybeSingle();const seconds=Number(findNested(body,["duration","view_seconds","total_view_seconds"])||0)||0;if(existing){await db.from("energy_documents").update({status:/view|visit|open/i.test(event)?"viewed":undefined,last_viewed_at:new Date().toISOString(),first_viewed_at:undefined,view_count:Number(existing.view_count||0)+1,total_view_seconds:Number(existing.total_view_seconds||0)+seconds,updated_at:new Date().toISOString()}).eq("id",existing.id)}else{await db.from("energy_documents").insert({user_id:t.user_id,lead_id:leadId,provider:"papermark",external_document_id:documentId,external_link_id:linkId,title,share_url:visitUrl,status:"viewed",first_viewed_at:new Date().toISOString(),last_viewed_at:new Date().toISOString(),view_count:1,total_view_seconds:seconds})}}
  }
  return out({ok:true,intent_event_id:insert.data.id,lead_id:leadId,event_type:event,weight:w});
 }catch(e){return out({error:e instanceof Error?e.message.slice(0,800):"Webhook processing failed"},500)}
});
