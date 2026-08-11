import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const H={"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-headers":"authorization, content-type"};
const out=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
function env(){const url=Deno.env.get("SUPABASE_URL")||"";const pubs=Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");const secs=Deno.env.get("SUPABASE_SECRET_KEYS");const publicKey=pubs?JSON.parse(pubs)?.default:Deno.env.get("SUPABASE_ANON_KEY");const secretKey=secs?JSON.parse(secs)?.default:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!publicKey||!secretKey)throw new Error("Backend configuration missing");return{url,publicKey,secretKey}}
function admin(){const e=env();return createClient(e.url,e.secretKey,{auth:{persistSession:false,autoRefreshToken:false}})}
async function user(req:Request){const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();if(!token)return null;const e=env();const c=createClient(e.url,e.publicKey,{auth:{persistSession:false,autoRefreshToken:false}});const {data,error}=await c.auth.getUser(token);return error?null:data.user}
async function sha256(value:string){const bytes=new TextEncoder().encode(value);const digest=await crypto.subtle.digest("SHA-256",bytes);return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("")}

Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:H});if(req.method!=="POST")return out({error:"Method not allowed"},405);
 try{
  const u=await user(req);if(!u)return out({error:"Nicht autorisiert"},401);const b=await req.json().catch(()=>({}));const provider=String(b?.provider||"").trim().toLowerCase();if(!provider)return out({error:"Provider fehlt"},400);
  const token=`wh_${crypto.randomUUID().replaceAll("-","")}_${crypto.randomUUID().slice(0,12)}`;const hash=await sha256(token);const db=admin();
  const {error}=await db.from("energy_webhook_tokens").upsert({user_id:u.id,provider,token_hash:hash,active:true,rotated_at:new Date().toISOString()},{onConflict:"user_id,provider"});if(error)throw error;
  const {url}=env();const webhookUrl=`${url}/functions/v1/intent-webhook?provider=${encodeURIComponent(provider)}&token=${encodeURIComponent(token)}`;
  return out({ok:true,provider,webhook_url:webhookUrl,notice:"Webhook-Token wird nur jetzt vollständig angezeigt. Bei Rotation ändert sich die URL."});
 }catch(e){return out({error:e instanceof Error?e.message.slice(0,700):"Webhook Setup fehlgeschlagen"},500)}
});
