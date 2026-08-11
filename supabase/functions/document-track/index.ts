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
  const b=await req.json().catch(()=>({}));const token=String(b?.token||"").trim();if(!/^[0-9a-f-]{36}$/i.test(token))return out({error:"Ungültiger Link"},400);const agent=String(b?.userAgent||req.headers.get("user-agent")||"").slice(0,500);const db=admin();
  const{data:doc}=await db.from("energy_documents").select("share_url,status").eq("tracking_token",token).neq("status","archived").maybeSingle();if(!doc)return out({error:"Dokument nicht gefunden"},404);const target=String(doc.share_url||"");if(!/^https?:\/\//i.test(target))return out({error:"Dokument-Ziel ist nicht verfügbar"},404);
  if(isBot(agent))return out({ok:true,target_url:target,tracked:false,reason:"automated_client"});
  const{data,error}=await db.rpc("energy_record_document_view",{p_token:token});if(error)throw error;const row=Array.isArray(data)?data[0]:data;if(!row?.target_url)return out({error:"Dokument nicht verfügbar"},404);
  return out({ok:true,target_url:row.target_url,tracked:true,view_count:row.new_view_count,weight:row.intent_weight});
 }catch(e){return out({error:e instanceof Error?e.message.slice(0,700):"Dokument-Tracking fehlgeschlagen"},500)}
});
