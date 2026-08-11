import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { ImapFlow } from "npm:imapflow@1";

const H={"content-type":"application/json","cache-control":"no-store"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
function keys(){const url=Deno.env.get("SUPABASE_URL");const sec=Deno.env.get("SUPABASE_SECRET_KEYS");const key=sec?JSON.parse(sec)?.default:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)throw new Error("Backend configuration missing");return{url,key}}
function admin(){const{url,key}=keys();return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})}
function port(v:unknown,f:number){const n=Number(v);return Number.isInteger(n)&&n>0&&n<65536?n:f}
async function authorize(req:Request,db:ReturnType<typeof admin>){const supplied=req.headers.get("x-worker-key")||"";if(!supplied)return false;const{data}=await db.rpc("energy_get_system_secret",{p_name:"energy_worker_key"});return Boolean(data&&data===supplied)}
async function secrets(db:ReturnType<typeof admin>,mailbox:any){const{data,error}=await db.rpc("energy_get_mailbox_secrets",{p_mailbox_id:mailbox.id,p_user_id:mailbox.user_id});if(error)throw error;const row=Array.isArray(data)?data[0]:data;return row?.imap_password||row?.smtp_password||""}

async function syncMailbox(db:ReturnType<typeof admin>,mailbox:any){
 if(!mailbox.imap_host||!mailbox.imap_username)return{synced:0};const password=await secrets(db,mailbox);if(!password)throw new Error(`IMAP-Passwort fehlt: ${mailbox.email_address}`);
 const client=new ImapFlow({host:mailbox.imap_host,port:port(mailbox.imap_port,993),secure:mailbox.imap_secure!==false,auth:{user:mailbox.imap_username,pass:password},logger:false});let synced=0;
 try{
  await client.connect();const lock=await client.getMailboxLock("INBOX");
  try{
   const since=mailbox.last_sync_at?new Date(new Date(mailbox.last_sync_at).getTime()-3600000):new Date(Date.now()-7*86400000);const ids=await client.search({since});
   for await(const msg of client.fetch(ids.slice(-250),{envelope:true,uid:true})){
    const providerId=msg.envelope?.messageId||`imap-${mailbox.id}-${msg.uid}`;const from=msg.envelope?.from?.[0]?.address?.toLowerCase();if(!from)continue;
    const{data:exists}=await db.from("energy_messages").select("id").eq("user_id",mailbox.user_id).eq("provider_message_id",providerId).maybeSingle();if(exists)continue;
    const{data:lead}=await db.from("energy_leads").select("id,company_name,status,email").eq("user_id",mailbox.user_id).ilike("email",from).maybeSingle();if(!lead)continue;
    const{data:outbound}=await db.from("energy_messages").select("id,campaign_id,campaign_member_id,metadata").eq("user_id",mailbox.user_id).eq("lead_id",lead.id).eq("direction","outbound").order("created_at",{ascending:false}).limit(1).maybeSingle();
    const subject=msg.envelope?.subject||"Antwort";const now=new Date().toISOString();
    const inbound=await db.from("energy_messages").insert({user_id:mailbox.user_id,lead_id:lead.id,campaign_id:outbound?.campaign_id||null,campaign_member_id:outbound?.campaign_member_id||null,mailbox_id:mailbox.id,direction:"inbound",status:"replied",from_email:from,to_email:mailbox.email_address,subject,provider_message_id:providerId,replied_at:now,sent_at:msg.envelope?.date?.toISOString()||now,metadata:{imap_uid:msg.uid,automatic_sync:true}});if(inbound.error)throw inbound.error;
    if(outbound?.id)await db.from("energy_messages").update({status:"replied",replied_at:now,updated_at:now}).eq("id",outbound.id);
    if(outbound?.campaign_member_id)await db.from("energy_campaign_members").update({status:"stopped",stopped_reason:"reply",reply_status:"replied",updated_at:now}).eq("id",outbound.campaign_member_id);
    await db.from("energy_leads").update({status:"engaged",last_replied_at:now,updated_at:now}).eq("id",lead.id).eq("user_id",mailbox.user_id);
    const intent=await db.from("energy_intent_events").insert({user_id:mailbox.user_id,lead_id:lead.id,source:"email",event_type:"email_reply",weight:35,external_id:`email_reply:${providerId}`,metadata:{subject,mailbox_id:mailbox.id,campaign_id:outbound?.campaign_id||null}});if(intent.error&&intent.error.code!=="23505")throw intent.error;
    const variantId=outbound?.metadata?.variant_id;if(variantId)await db.rpc("energy_increment_variant_metric",{p_variant_id:variantId,p_metric:"replied"});
    await db.from("energy_activities").insert({user_id:mailbox.user_id,lead_id:lead.id,campaign_id:outbound?.campaign_id||null,activity_type:"email_reply",title:"E-Mail-Antwort automatisch erkannt",detail:subject});synced++;
   }
  }finally{lock.release()}
  await db.from("energy_mailboxes").update({last_sync_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()}).eq("id",mailbox.id);
 }finally{await client.logout().catch(()=>undefined)}
 return{synced};
}

Deno.serve(async(req)=>{if(req.method!=="POST")return json({error:"Method not allowed"},405);const db=admin();try{if(!await authorize(req,db))return json({error:"Nicht autorisiert"},401);const{data:mailboxes,error}=await db.from("energy_mailboxes").select("*").eq("status","ready").not("imap_host","is",null);if(error)throw error;let synced=0,failed=0;for(const mailbox of mailboxes||[]){try{synced+=(await syncMailbox(db,mailbox)).synced}catch(e){failed++;await db.from("energy_mailboxes").update({last_error:e instanceof Error?e.message.slice(0,500):"IMAP sync failed",updated_at:new Date().toISOString()}).eq("id",mailbox.id)}}return json({ok:true,mailboxes:(mailboxes||[]).length,synced,failed})}catch(e){return json({error:e instanceof Error?e.message:"Inbox worker error"},500)}});
