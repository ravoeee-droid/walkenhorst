import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const H={"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-headers":"authorization, content-type"};
const out=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
const PROVIDERS=new Set(["google_maps","firecrawl","reacher","chatwoot","activepieces","papermark","dub","openreplay","typebot","twenty","warmbly","denshees"]);

function env(){
 const url=Deno.env.get("SUPABASE_URL")||"";
 const pubs=Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
 const secs=Deno.env.get("SUPABASE_SECRET_KEYS");
 const publicKey=pubs?JSON.parse(pubs)?.default:Deno.env.get("SUPABASE_ANON_KEY");
 const secretKey=secs?JSON.parse(secs)?.default:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!publicKey||!secretKey)throw new Error("Backend configuration missing");
 return{url,publicKey,secretKey};
}
function admin(){const e=env();return createClient(e.url,e.secretKey,{auth:{persistSession:false,autoRefreshToken:false}})}
async function user(req:Request){
 const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();if(!token)return null;
 const e=env();const c=createClient(e.url,e.publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await c.auth.getUser(token);return error?null:data.user;
}
function cleanUrl(v:unknown){
 const raw=String(v||"").trim();if(!raw)return null;const u=new URL(/^https?:\/\//i.test(raw)?raw:`https://${raw}`);
 if(!["http:","https:"].includes(u.protocol)||u.username||u.password)throw new Error("Ungültige Integration-URL");
 return u.toString().replace(/\/$/,"");
}
function headersFor(secret:string,config:any){
 const h:Record<string,string>={"content-type":"application/json","user-agent":"Walkenhorst-Energy-Radar/1.0"};
 if(secret){const name=String(config?.auth_header||"Authorization");const scheme=String(config?.auth_scheme??"Bearer");h[name]=scheme?`${scheme} ${secret}`:secret;}
 return h;
}
async function fetchTimeout(url:string,init:RequestInit={},ms=12000){const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);try{return await fetch(url,{...init,signal:c.signal})}finally{clearTimeout(t)}}

Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:H});
 if(req.method!=="POST")return out({error:"Method not allowed"},405);
 try{
  const u=await user(req);if(!u)return out({error:"Nicht autorisiert"},401);
  const body=await req.json().catch(()=>({}));const action=String(body?.action||"");const db=admin();
  if(action==="save"){
   const provider=String(body?.provider||"");if(!PROVIDERS.has(provider))return out({error:"Unbekannter Provider"},400);
   const baseUrl=cleanUrl(body?.baseUrl);const config=(body?.config&&typeof body.config==="object")?body.config:{};
   const values={user_id:u.id,provider,label:String(body?.label||provider),base_url:baseUrl,status:"setup",config,last_error:null,updated_at:new Date().toISOString()};
   const {data,error}=await db.from("energy_integrations").upsert(values,{onConflict:"user_id,provider"}).select("*").single();if(error)throw error;
   const secret=String(body?.secret||"");if(secret){const r=await db.rpc("energy_store_integration_secret",{p_integration_id:data.id,p_user_id:u.id,p_secret:secret});if(r.error)throw r.error;}
   return out({ok:true,integration:{...data,secret_id:undefined,has_secret:Boolean(secret||data.secret_id)}});
  }
  if(action==="test"){
   const provider=String(body?.provider||"");const {data:i}=await db.from("energy_integrations").select("*").eq("user_id",u.id).eq("provider",provider).maybeSingle();if(!i)return out({error:"Integration nicht gefunden"},404);
   const {data:s}=await db.rpc("energy_get_integration_secret",{p_integration_id:i.id,p_user_id:u.id});const secret=String(s||"");const base=String(i.base_url||"").replace(/\/$/,"");if(!base)return out({error:"Base URL fehlt"},400);
   let res:Response;
   if(provider==="google_maps")res=await fetchTimeout(`${base}/api/v1/health`,{headers:headersFor(secret,i.config)});
   else if(provider==="chatwoot")res=await fetchTimeout(`${base}/api/v1/profile`,{headers:{...headersFor(secret,{auth_header:"api_access_token",auth_scheme:""}),"content-type":"application/json"}});
   else res=await fetchTimeout(base,{method:"GET",headers:headersFor(secret,i.config)});
   const ok=res.ok||(provider!=="google_maps"&&res.status<500);
   await db.from("energy_integrations").update({status:ok?"ready":"error",last_tested_at:new Date().toISOString(),last_error:ok?null:`HTTP ${res.status}`,updated_at:new Date().toISOString()}).eq("id",i.id).eq("user_id",u.id);
   return out({ok,status:res.status,message:ok?"Verbindung erreichbar":`Verbindung fehlgeschlagen (${res.status})`},ok?200:422);
  }
  if(action==="disable"){
   const provider=String(body?.provider||"");const {error}=await db.from("energy_integrations").update({status:"disabled",updated_at:new Date().toISOString()}).eq("user_id",u.id).eq("provider",provider);if(error)throw error;return out({ok:true});
  }
  return out({error:"Unbekannte Aktion"},400);
 }catch(e){return out({error:e instanceof Error?e.message.slice(0,700):"Interner Fehler"},500)}
});
