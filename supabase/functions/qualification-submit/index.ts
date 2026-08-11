import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const H={"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-headers":"content-type, authorization"};
const out=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
function env(){const url=Deno.env.get("SUPABASE_URL")||"";const secs=Deno.env.get("SUPABASE_SECRET_KEYS");const key=secs?JSON.parse(secs)?.default:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)throw new Error("Backend configuration missing");return{url,key}}
function admin(){const e=env();return createClient(e.url,e.key,{auth:{persistSession:false,autoRefreshToken:false}})}
const clean=(v:unknown,max=500)=>String(v||"").trim().slice(0,max);

Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:H});if(req.method!=="POST")return out({error:"Method not allowed"},405);
 try{
  const b=await req.json().catch(()=>({}));const slug=clean(b?.slug,160);const interest=clean(b?.interest,120);if(!slug||!interest)return out({error:"Analyse und Interesse sind erforderlich"},400);const db=admin();
  const {data:p}=await db.from("energy_video_pages").select("id,user_id,lead_id,is_public,status").eq("slug",slug).eq("is_public",true).in("status",["ready","sent"]).maybeSingle();if(!p)return out({error:"Analyse nicht verfügbar"},404);
  const sessionId=clean(b?.sessionId,120)||crypto.randomUUID();const email=clean(b?.email,200).toLowerCase();const phone=clean(b?.phone,80);const contactName=clean(b?.contactName,160);const timeline=clean(b?.timeline,100);const notes=clean(b?.notes,1000);
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return out({error:"Bitte eine gültige E-Mail eingeben"},400);
  const {data:q,error}=await db.from("energy_qualifications").insert({user_id:p.user_id,lead_id:p.lead_id,video_page_id:p.id,session_id:sessionId,interest,timeline:timeline||null,contact_name:contactName||null,email:email||null,phone:phone||null,notes:notes||null}).select("id").single();if(error)throw error;
  const {data:lead}=await db.from("energy_leads").select("contact_name,email,phone").eq("id",p.lead_id).eq("user_id",p.user_id).maybeSingle();if(lead){const updates:any={updated_at:new Date().toISOString()};if(contactName&&!lead.contact_name)updates.contact_name=contactName;if(email&&!lead.email){updates.email=email;updates.email_status="unknown"}if(phone&&!lead.phone)updates.phone=phone;await db.from("energy_leads").update(updates).eq("id",p.lead_id).eq("user_id",p.user_id)}
  await db.from("energy_intent_events").insert({user_id:p.user_id,lead_id:p.lead_id,source:"qualification",event_type:"qualification_submitted",weight:40,external_id:`qualification:${q.id}`,session_id:sessionId,metadata:{interest,timeline,email:Boolean(email),phone:Boolean(phone)}});
  return out({ok:true,qualification_id:q.id,message:"Vielen Dank. Wir melden uns mit einer konkreten Einschätzung."});
 }catch(e){return out({error:e instanceof Error?e.message.slice(0,700):"Qualifizierung fehlgeschlagen"},500)}
});
