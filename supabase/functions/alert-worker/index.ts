import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const H={"content-type":"application/json","cache-control":"no-store"};
const out=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
function env(){const url=Deno.env.get("SUPABASE_URL")||"";const secs=Deno.env.get("SUPABASE_SECRET_KEYS");const key=secs?JSON.parse(secs)?.default:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)throw new Error("Backend configuration missing");return{url,key}}
function admin(){const e=env();return createClient(e.url,e.key,{auth:{persistSession:false,autoRefreshToken:false}})}
async function authorize(req:Request,db:ReturnType<typeof admin>){const supplied=req.headers.get("x-worker-key")||"";if(!supplied)return false;const{data}=await db.rpc("energy_get_system_secret",{p_name:"energy_worker_key"});return Boolean(data&&data===supplied)}
async function alert(db:any,userId:string,leadId:string|null,type:string,severity:string,title:string,detail:string,key:string,dueAt:string|null,metadata:any={}){const{error}=await db.rpc("energy_upsert_alert",{p_user_id:userId,p_lead_id:leadId,p_type:type,p_severity:severity,p_title:title,p_detail:detail,p_key:key,p_due_at:dueAt,p_metadata:metadata});if(error)throw error}

Deno.serve(async(req)=>{
 if(req.method!=="POST")return out({error:"Method not allowed"},405);const db=admin();
 try{
  if(!await authorize(req,db))return out({error:"Nicht autorisiert"},401);let created=0,failed=0;const now=new Date();const overdue=new Date(now.getTime()-15*60_000).toISOString();const since24=new Date(now.getTime()-24*3600_000).toISOString();const since7=new Date(now.getTime()-7*86400_000).toISOString();
  const[fups,mailboxes,integrations,outboxRows,calls,bounces]=await Promise.all([
    db.from("energy_followups").select("id,user_id,lead_id,title,due_at,priority,reason").eq("status","open").eq("priority","hot").lte("due_at",overdue).limit(1000),
    db.from("energy_mailboxes").select("id,user_id,email_address,status,last_error,last_bounce_error").or("status.eq.error,last_error.not.is.null,last_bounce_error.not.is.null").limit(1000),
    db.from("energy_integrations").select("id,user_id,provider,status,last_error").eq("status","error").limit(1000),
    db.from("energy_automation_outbox").select("id,user_id,lead_id,status,last_error,created_at").in("status",["failed","error"]).gte("created_at",since24).limit(1000),
    db.from("energy_calls").select("id,user_id,lead_id,external_call_id,reconciliation_error,ended_at").not("reconciliation_error","is",null).gte("ended_at",since7).limit(1000),
    db.from("energy_bounces").select("id,user_id,mailbox_id,bounce_type,created_at").eq("bounce_type","hard").gte("created_at",since24).limit(5000),
  ]);
  const work:Promise<void>[]=[];
  for(const f of fups.data||[])work.push(alert(db,f.user_id,f.lead_id,"hot_followup_overdue","critical",`${f.title}: SLA überfällig`,f.reason||"Hot Follow-up liegt länger als 15 Minuten unbearbeitet.",`followup:${f.id}:overdue`,new Date().toISOString(),{followup_id:f.id,due_at:f.due_at}).then(()=>{created++}).catch(()=>{failed++}));
  for(const m of mailboxes.data||[])work.push(alert(db,m.user_id,null,"mailbox_error","critical",`${m.email_address}: Mailbox prüfen`,m.last_bounce_error||m.last_error||`Status ${m.status}`,`mailbox:${m.id}:error`,new Date().toISOString(),{mailbox_id:m.id}).then(()=>{created++}).catch(()=>{failed++}));
  for(const i of integrations.data||[])work.push(alert(db,i.user_id,null,"integration_error","warn",`${i.provider}: Integration fehlerhaft`,i.last_error||"Provider meldet Status error.",`integration:${i.id}:error`,null,{integration_id:i.id,provider:i.provider}).then(()=>{created++}).catch(()=>{failed++}));
  for(const o of outboxRows.data||[])work.push(alert(db,o.user_id,o.lead_id,"automation_error","warn","Automation konnte nicht zugestellt werden",o.last_error||`Outbox ${o.id} fehlgeschlagen.`,`automation:${o.id}:failed`,null,{outbox_id:o.id}).then(()=>{created++}).catch(()=>{failed++}));
  for(const c of calls.data||[])work.push(alert(db,c.user_id,c.lead_id,"rinkel_reconcile_error","warn","Rinkel Call-Daten unvollständig",c.reconciliation_error||`Call ${c.external_call_id} konnte nicht vollständig nachgezogen werden.`,`rinkel:${c.id}:reconcile`,null,{call_id:c.id,external_call_id:c.external_call_id}).then(()=>{created++}).catch(()=>{failed++}));
  const bounceMap=new Map<string,{userId:string;mailboxId:string;count:number}>();for(const b of bounces.data||[]){const k=`${b.user_id}:${b.mailbox_id}`;const cur=bounceMap.get(k)||{userId:b.user_id,mailboxId:b.mailbox_id,count:0};cur.count++;bounceMap.set(k,cur)}for(const item of bounceMap.values()){if(item.count<3)continue;work.push(alert(db,item.userId,null,"hard_bounce_spike","hot","Hard-Bounce-Spike erkannt",`${item.count} Hard Bounces in den letzten 24 Stunden auf einer Mailbox. Versandgesundheit prüfen.`,`bounce:${item.mailboxId}:${new Date().toISOString().slice(0,10)}`,new Date().toISOString(),{mailbox_id:item.mailboxId,count_24h:item.count}).then(()=>{created++}).catch(()=>{failed++}))}
  await Promise.all(work);return out({ok:true,signals:work.length,alerts_upserted:created,failed});
 }catch(e){return out({error:e instanceof Error?e.message.slice(0,700):"Alert worker error"},500)}
});
