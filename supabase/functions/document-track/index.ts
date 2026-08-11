import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const H={"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-headers":"content-type, apikey"};
const out=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
function env(){const url=Deno.env.get("SUPABASE_URL")||"";const secs=Deno.env.get("SUPABASE_SECRET_KEYS");const key=secs?JSON.parse(secs)?.default:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)throw new Error("Backend configuration missing");return{url,key}}
function admin(){const e=env();return createClient(e.url,e.key,{auth:{persistSession:false,autoRefreshToken:false}})}
function isBot(agent:string){return /(bot|crawler|spider|scanner|linkcheck|proofpoint|mimecast|barracuda|safelinks|googleimageproxy|facebookexternalhit|slackbot|discordbot)/i.test(agent)}

Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:H});if(req.method!=="POST")return out({error:"Method not allowed"},405);
 try{
  const b=await req.json().catch(()=>({}));const token=String(b?.token||"").trim();if(!/^[0-9a-f-]{36}$/i.test(token))return out({error:"Ungültiger Link"},400);const agent=String(b?.userAgent||req.headers.get("user-agent")||"").slice(0,500);const db=admin();const{data:doc}=await db.from("energy_documents").select("id,user_id,lead_id,title,share_url,status,view_count,total_view_seconds,first_viewed_at").eq("tracking_token",token).neq("status","archived").maybeSingle();if(!doc)return out({error:"Dokument nicht gefunden"},404);const target=String(doc.share_url||"");if(!/^https?:\/\//i.test(target))return out({error:"Dokument-Ziel ist nicht verfügbar"},404);
  if(isBot(agent))return out({ok:true,target_url:target,tracked:false,reason:"automated_client"});
  const nextCount=Number(doc.view_count||0)+1;const weight=nextCount>=3?30:nextCount===2?15:20;const now=new Date().toISOString();await db.from("energy_documents").update({status:"viewed",view_count:nextCount,first_viewed_at:doc.first_viewed_at||now,last_viewed_at:now,updated_at:now}).eq("id",doc.id);
  const event=await db.from("energy_intent_events").insert({user_id:doc.user_id,lead_id:doc.lead_id,source:"proposal",event_type:nextCount>=3?"proposal_reopened_hot":"proposal_view",weight,external_id:`proposal:${doc.id}:view:${nextCount}`,url:target,metadata:{document_id:doc.id,title:doc.title,view_count:nextCount}});if(event.error&&event.error.code!=="23505")throw event.error;
  return out({ok:true,target_url:target,tracked:true,view_count:nextCount,weight});
 }catch(e){return out({error:e instanceof Error?e.message.slice(0,700):"Dokument-Tracking fehlgeschlagen"},500)}
});
