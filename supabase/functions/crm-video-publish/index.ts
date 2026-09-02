import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const H={"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-headers":"authorization, apikey, content-type, x-client-info","access-control-allow-methods":"POST, OPTIONS"};
const out=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:H});
function env(){const url=Deno.env.get("SUPABASE_URL")!;const pubs=Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");const secs=Deno.env.get("SUPABASE_SECRET_KEYS");const pub=pubs?JSON.parse(pubs)?.default:Deno.env.get("SUPABASE_ANON_KEY");const secret=secs?JSON.parse(secs)?.default:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!pub||!secret)throw new Error("Backend configuration missing");return{url,pub,secret}}

Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:H});
 if(req.method!=="POST")return out({error:"Method not allowed"},405);
 try{
  const auth=req.headers.get("authorization")||"",token=auth.toLowerCase().startsWith("bearer ")?auth.slice(7).trim():"";
  if(!token)return out({error:"Nicht autorisiert"},401);
  const body=await req.json().catch(()=>({})),leadId=String(body?.leadId||"").trim();if(!leadId)return out({error:"leadId fehlt"},400);
  const {url,pub,secret}=env();const scoped=createClient(url,pub,{auth:{persistSession:false,autoRefreshToken:false}});const ur=await scoped.auth.getUser(token);if(ur.error||!ur.data.user)return out({error:"Nicht autorisiert"},401);
  const owner=typeof ur.data.user.app_metadata?.workspace_owner_id==="string"?ur.data.user.app_metadata.workspace_owner_id.trim():"",userId=owner||ur.data.user.id;
  const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});const lr=await admin.from("energy_leads").select("video_template_key,customer_type").eq("id",leadId).eq("user_id",userId).maybeSingle();if(lr.error||!lr.data)return out({error:"Lead nicht gefunden"},404);
  const locked=lr.data.customer_type==="private"?"pv-privat":"energiekosten";const requested=String(body?.templateKey||"").trim();const templateKey=requested===locked?requested:locked;
  const r=await fetch(`${url}/functions/v1/lead-publish`,{method:"POST",headers:{"content-type":"application/json","authorization":auth},body:JSON.stringify({action:"prepare_lead",leadId,templateKey,baseUrl:String(body?.baseUrl||"https://walkenhorst.vercel.app").replace(/\/$/,"")})});
  const data=await r.json().catch(()=>({error:`Publish HTTP ${r.status}`}));if(!r.ok)return out(data,r.status);
  return out({ok:true,...data,templateKey,renderMode:"live_timeline_v3",nextAction:"review",message:"Persönlicher Loom ist live und versandbereit."});
 }catch(e){return out({error:e instanceof Error?e.message:"Loom konnte nicht erstellt werden"},500)}
});