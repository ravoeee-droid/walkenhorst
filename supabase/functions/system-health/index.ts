import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const H={"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-headers":"authorization, content-type"};
const out=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:H});

function env(){
  const url=Deno.env.get("SUPABASE_URL")||"";
  const pubs=Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  const secs=Deno.env.get("SUPABASE_SECRET_KEYS");
  const publicKey=pubs?JSON.parse(pubs)?.default:Deno.env.get("SUPABASE_ANON_KEY");
  const secretKey=secs?JSON.parse(secs)?.default:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!publicKey||!secretKey)throw new Error("Backend configuration missing");
  return{url,publicKey,secretKey};
}

async function authenticated(req:Request){
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token)return false;
  const e=env();
  const client=createClient(e.url,e.publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await client.auth.getUser(token);
  return Boolean(!error&&data.user);
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:H});
  if(req.method!=="POST")return out({error:"Method not allowed"},405);
  try{
    if(!await authenticated(req))return out({error:"Nicht autorisiert"},401);
    const e=env();
    const admin=createClient(e.url,e.secretKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await admin.rpc("energy_system_health");
    if(error)throw error;
    return out(data||{});
  }catch(error){
    return out({error:error instanceof Error?error.message.slice(0,700):"Health Check fehlgeschlagen"},500);
  }
});
