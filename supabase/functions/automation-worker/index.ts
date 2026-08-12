import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const H={"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-headers":"authorization, content-type, x-worker-key"};
const out=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
function env(){const url=Deno.env.get("SUPABASE_URL")||"";const pubs=Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");const secs=Deno.env.get("SUPABASE_SECRET_KEYS");const publicKey=pubs?JSON.parse(pubs)?.default:Deno.env.get("SUPABASE_ANON_KEY");const secretKey=secs?JSON.parse(secs)?.default:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!publicKey||!secretKey)throw new Error("Backend configuration missing");return{url,publicKey,secretKey}}
function admin(){const e=env();return createClient(e.url,e.secretKey,{auth:{persistSession:false,autoRefreshToken:false}})}
async function user(req:Request){const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();if(!token)return null;const e=env();const c=createClient(e.url,e.publicKey,{auth:{persistSession:false,autoRefreshToken:false}});const {data,error}=await c.auth.getUser(token);return error?null:data.user}
async function authorized(req:Request,db:any){const u=await user(req);if(u)return{ok:true,userId:u.id};const supplied=req.headers.get("x-worker-key")||"";if(!supplied)return{ok:false,userId:null};const {data}=await db.rpc("energy_get_system_secret",{p_name:"energy_worker_key"});return{ok:Boolean(data&&data===supplied),userId:null}}
async function integration(db:any,userId:string){const {data}=await db.from("energy_integrations").select("*").eq("user_id",userId).eq("provider","activepieces").eq("status","ready").maybeSingle();if(!data)return null;const {data:s}=await db.rpc("energy_get_integration_secret",{p_integration_id:data.id,p_user_id:userId});return{row:data,secret:String(s||"")}}
function headers(secret:string,config:any){const h:Record<string,string>={"content-type":"application/json","user-agent":"Walkenhorst-Energy-Radar/1.0"};if(secret){const name=String(config?.auth_header||"Authorization");const scheme=String(config?.auth_scheme??"Bearer");h[name]=scheme?`${scheme} ${secret}`:secret}return h}

Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:H});if(req.method!=="POST")return out({error:"Method not allowed"},405);const db=admin();
 try{
  const auth=await authorized(req,db);if(!auth.ok)return out({error:"Nicht autorisiert"},401);const body=await req.json().catch(()=>({}));const limit=Math.max(1,Math.min(50,Number(body?.limit)||20));const now=new Date().toISOString();let q=db.from("energy_automation_outbox").select("*,energy_leads(id,company_name,email,phone,city,industry,total_score,intent_score,status)").in("status",["queued","failed"]).lte("next_attempt_at",now).lt("attempts",5).order("created_at").limit(limit);if(auth.userId)q=q.eq("user_id",auth.userId);const {data:jobs,error}=await q;if(error)throw error;
  const totals={processed:0,sent:0,failed:0,skipped:0};
  for(const job of jobs||[]){totals.processed++;const integ=await integration(db,job.user_id);if(!integ){await db.from("energy_automation_outbox").update({status:"skipped",last_error:"Activepieces nicht verbunden"}).eq("id",job.id);totals.skipped++;continue}
   await db.from("energy_automation_outbox").update({status:"sending",attempts:Number(job.attempts||0)+1}).eq("id",job.id);
   try{const response=await fetch(String(integ.row.base_url),{method:"POST",headers:headers(integ.secret,integ.row.config),body:JSON.stringify({event:job.event_type,lead:job.energy_leads,payload:job.payload,outbox_id:job.id,source:"walkenhorst-energy-radar",occurred_at:job.created_at})});if(!response.ok)throw new Error(`Activepieces HTTP ${response.status}`);await db.from("energy_automation_outbox").update({status:"sent",sent_at:new Date().toISOString(),last_error:null}).eq("id",job.id);totals.sent++}catch(e){const attempts=Number(job.attempts||0)+1;const delay=Math.min(60,Math.pow(2,attempts));await db.from("energy_automation_outbox").update({status:attempts>=5?"failed":"failed",next_attempt_at:new Date(Date.now()+delay*60000).toISOString(),last_error:e instanceof Error?e.message.slice(0,500):"Automation failed"}).eq("id",job.id);totals.failed++}
  }
  return out({ok:true,...totals});
 }catch(e){return out({error:e instanceof Error?e.message.slice(0,800):"Automation Worker Fehler"},500)}
});
