import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { ImapFlow } from "npm:imapflow@1";

const H={"content-type":"application/json","cache-control":"no-store"};
const out=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:H});

function env(){const url=Deno.env.get("SUPABASE_URL")||"";const secs=Deno.env.get("SUPABASE_SECRET_KEYS");const key=secs?JSON.parse(secs)?.default:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)throw new Error("Backend configuration missing");return{url,key}}
function admin(){const e=env();return createClient(e.url,e.key,{auth:{persistSession:false,autoRefreshToken:false}})}
function port(v:unknown,f:number){const n=Number(v);return Number.isInteger(n)&&n>0&&n<65536?n:f}
async function authorize(req:Request,db:ReturnType<typeof admin>){const supplied=req.headers.get("x-worker-key")||"";if(!supplied)return false;const{data}=await db.rpc("energy_get_system_secret",{p_name:"energy_worker_key"});return Boolean(data&&data===supplied)}
async function mailboxSecret(db:ReturnType<typeof admin>,mailbox:any){const{data,error}=await db.rpc("energy_get_mailbox_secrets",{p_mailbox_id:mailbox.id,p_user_id:mailbox.user_id});if(error)throw error;const row=Array.isArray(data)?data[0]:data;return row?.imap_password||row?.smtp_password||""}
function normalizeEmail(v:unknown){return String(v||"").trim().toLowerCase()}
function extractEmails(text:string){const matches=text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[];return [...new Set(matches.map(normalizeEmail))]}
function candidateBounce(from:string,subject:string,source:string){return /(mailer-daemon|mail-daemon|postmaster|delivery[-_. ]?status)/i.test(from)||/(undeliver|delivery status notification|delivery failure|returned mail|mail delivery|unzustellbar|zustellung fehlgeschlagen|failure notice|recipient address rejected)/i.test(subject)||/(final-recipient:|original-recipient:|diagnostic-code:|x-failed-recipients:)/i.test(source)}
function classify(source:string){const s=source.toLowerCase();if(/(^|\D)5\.[0-9]\.[0-9](\D|$)|(^|\D)5[0-9]{2}(\D|$)|user unknown|unknown user|no such user|does not exist|recipient address rejected|mailbox unavailable|invalid recipient|address not found/.test(s))return"hard" as const;if(/(^|\D)4\.[0-9]\.[0-9](\D|$)|(^|\D)4[0-9]{2}(\D|$)|mailbox full|over quota|temporar|try again|rate limit|greylist/.test(s))return"soft" as const;return"unknown" as const}
function diagnostic(source:string,subject:string){const lines=source.split(/\r?\n/);const found=lines.filter(line=>/^(diagnostic-code|status|action|final-recipient|x-failed-recipients):/i.test(line.trim())).slice(0,8).join(" · ");return (found||subject||"Delivery failure").slice(0,1000)}
function decodeSource(value:unknown){if(!value)return"";try{return new TextDecoder().decode(value as Uint8Array)}catch{return String(value||"")}}

async function syncMailbox(db:ReturnType<typeof admin>,mailbox:any){
 if(!mailbox.imap_host||!mailbox.imap_username)return{scanned:0,bounces:0,hard:0,soft:0};
 const password=await mailboxSecret(db,mailbox);if(!password)throw new Error(`IMAP-Passwort fehlt: ${mailbox.email_address}`);
 const sinceSent=new Date(Date.now()-30*86400_000).toISOString();
 const{data:sent,error:sentError}=await db.from("energy_messages").select("id,lead_id,campaign_id,campaign_member_id,to_email,status,created_at").eq("user_id",mailbox.user_id).eq("mailbox_id",mailbox.id).eq("direction","outbound").gte("created_at",sinceSent).not("to_email","is",null).order("created_at",{ascending:false}).limit(10000);if(sentError)throw sentError;
 const sentByEmail=new Map<string,any>();for(const row of sent||[]){const email=normalizeEmail(row.to_email);if(email&&!sentByEmail.has(email))sentByEmail.set(email,row)}
 if(!sentByEmail.size){await db.from("energy_mailboxes").update({last_bounce_sync_at:new Date().toISOString(),last_bounce_error:null,updated_at:new Date().toISOString()}).eq("id",mailbox.id);return{scanned:0,bounces:0,hard:0,soft:0}}
 const client=new ImapFlow({host:mailbox.imap_host,port:port(mailbox.imap_port,993),secure:mailbox.imap_secure!==false,auth:{user:mailbox.imap_username,pass:password},logger:false});
 let scanned=0,bounces=0,hard=0,soft=0;
 try{
  await client.connect();const lock=await client.getMailboxLock("INBOX");
  try{
   const since=mailbox.last_bounce_sync_at?new Date(new Date(mailbox.last_bounce_sync_at).getTime()-3600_000):new Date(Date.now()-7*86400_000);const ids=await client.search({since});
   for await(const msg of client.fetch(ids.slice(-500),{envelope:true,uid:true,source:true})){
    scanned++;const providerId=msg.envelope?.messageId||`imap-bounce-${mailbox.id}-${msg.uid}`;const from=normalizeEmail(msg.envelope?.from?.[0]?.address);const subject=String(msg.envelope?.subject||"");const source=decodeSource(msg.source);
    if(!candidateBounce(from,subject,source))continue;
    const{data:exists}=await db.from("energy_bounces").select("id").eq("mailbox_id",mailbox.id).eq("provider_message_id",providerId).maybeSingle();if(exists)continue;
    const addresses=extractEmails(source);const bouncedEmail=addresses.find(email=>sentByEmail.has(email));if(!bouncedEmail)continue;
    const outbound=sentByEmail.get(bouncedEmail);const bounceType=classify(source);const diag=diagnostic(source,subject);const occurred=msg.envelope?.date?.toISOString()||new Date().toISOString();
    const{error:insertError}=await db.from("energy_bounces").insert({user_id:mailbox.user_id,mailbox_id:mailbox.id,lead_id:outbound.lead_id||null,message_id:outbound.id,campaign_id:outbound.campaign_id||null,campaign_member_id:outbound.campaign_member_id||null,provider_message_id:providerId,bounced_email:bouncedEmail,bounce_type:bounceType,diagnostic:diag,occurred_at:occurred,metadata:{imap_uid:msg.uid,from,subject}});if(insertError){if(insertError.code==="23505")continue;throw insertError}
    bounces++;if(bounceType==="hard")hard++;if(bounceType==="soft")soft++;
    await db.from("energy_messages").update({status:"bounced",error:diag,updated_at:new Date().toISOString()}).eq("id",outbound.id).eq("user_id",mailbox.user_id);
    if(outbound.campaign_member_id)await db.from("energy_campaign_members").update({status:"stopped",stopped_reason:`${bounceType}_bounce`,updated_at:new Date().toISOString()}).eq("id",outbound.campaign_member_id);
    if(outbound.lead_id){
      if(bounceType==="hard"){
        await db.from("energy_leads").update({email_status:"invalid",updated_at:new Date().toISOString()}).eq("id",outbound.lead_id).eq("user_id",mailbox.user_id);
        await db.from("energy_campaign_members").update({status:"stopped",stopped_reason:"hard_bounce",updated_at:new Date().toISOString()}).eq("lead_id",outbound.lead_id).eq("status","queued");
      }
      await db.from("energy_activities").insert({user_id:mailbox.user_id,lead_id:outbound.lead_id,campaign_id:outbound.campaign_id||null,activity_type:"email_bounce",title:bounceType==="hard"?"Hard Bounce erkannt":bounceType==="soft"?"Soft Bounce erkannt":"E-Mail Bounce erkannt",detail:`${bouncedEmail} · ${diag}`.slice(0,1500),metadata:{bounce_type:bounceType,message_id:outbound.id,mailbox:mailbox.email_address}});
    }
   }
  }finally{lock.release()}
  await db.from("energy_mailboxes").update({last_bounce_sync_at:new Date().toISOString(),last_bounce_error:null,updated_at:new Date().toISOString()}).eq("id",mailbox.id);
 }finally{await client.logout().catch(()=>undefined)}
 return{scanned,bounces,hard,soft};
}

Deno.serve(async(req)=>{
 if(req.method!=="POST")return out({error:"Method not allowed"},405);const db=admin();
 try{
  if(!await authorize(req,db))return out({error:"Nicht autorisiert"},401);const{data:mailboxes,error}=await db.from("energy_mailboxes").select("*").eq("status","ready").not("imap_host","is",null);if(error)throw error;
  let scanned=0,bounces=0,hard=0,soft=0,failed=0;for(const mailbox of mailboxes||[]){try{const r=await syncMailbox(db,mailbox);scanned+=r.scanned;bounces+=r.bounces;hard+=r.hard;soft+=r.soft}catch(e){failed++;await db.from("energy_mailboxes").update({last_bounce_error:e instanceof Error?e.message.slice(0,500):"Bounce sync failed",updated_at:new Date().toISOString()}).eq("id",mailbox.id)}}
  return out({ok:true,mailboxes:(mailboxes||[]).length,scanned,bounces,hard,soft,failed});
 }catch(e){return out({error:e instanceof Error?e.message.slice(0,700):"Bounce worker error"},500)}
});
