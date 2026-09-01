import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";

const H={"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-headers":"authorization, content-type","access-control-allow-methods":"POST, OPTIONS"};
const out=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
const REPOSITORY="ravoeee-droid/walkenhorst";
const ISSUER="https://token.actions.githubusercontent.com";
const AUDIENCE="walkenhorst-render";
const JWKS=createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));

function admin(){
  const url=Deno.env.get("SUPABASE_URL")!;
  const secrets=Deno.env.get("SUPABASE_SECRET_KEYS");
  const key=secrets?JSON.parse(secrets)?.default:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)throw new Error("Backend configuration missing");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
async function sha256(value:string){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,"0")).join("")}
async function authorize(req:Request){
  const header=req.headers.get("authorization")||"";
  const token=header.toLowerCase().startsWith("bearer ")?header.slice(7).trim():"";
  if(!token)throw new Error("GitHub OIDC token fehlt");
  const{payload}=await jwtVerify(token,JWKS,{issuer:ISSUER,audience:AUDIENCE});
  if(String(payload.repository||"")!==REPOSITORY)throw new Error("Falsches GitHub Repository");
  if(String(payload.ref||"")!=="refs/heads/main")throw new Error("Render ist nur von main erlaubt");
  return payload;
}
async function issue(db:ReturnType<typeof admin>,job:any){
  if(!job?.id)throw new Error("Render-Job fehlt");
  if(String(job.status)==="completed")return{jobId:job.id,status:"completed",token:null};
  const token=`${crypto.randomUUID()}.${crypto.randomUUID()}`;
  const hash=await sha256(token);
  const expires=new Date(Date.now()+45*60*1000).toISOString();
  const now=new Date().toISOString();
  const metadata={...(job.metadata&&typeof job.metadata==="object"?job.metadata:{}),render_token_hash:hash,render_token_expires_at:expires,render_ticket_source:"github_oidc",render_ticket_issued_at:now,render_mode:"final_mp4_only"};
  const{error}=await db.from("energy_render_jobs").update({status:"queued",progress:0,error:null,render_engine:"github-actions-headless-mp4",metadata,updated_at:now}).eq("id",job.id);
  if(error)throw error;
  return{jobId:job.id,status:"queued",token,expiresAt:expires};
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:H});
  if(req.method!=="POST")return out({error:"Method not allowed"},405);
  try{
    const claims=await authorize(req);
    const body=await req.json().catch(()=>({}));
    const action=String(body?.action||"claim");
    const db=admin();
    if(action==="ticket"){
      const jobId=String(body?.jobId||"").trim();
      if(!jobId)return out({error:"jobId fehlt"},400);
      const{data:job,error}=await db.from("energy_render_jobs").select("id,status,metadata,lead_id,video_page_id").eq("id",jobId).maybeSingle();
      if(error||!job)throw error||new Error("Render-Job nicht gefunden");
      return out({ok:true,...await issue(db,job),repository:claims.repository});
    }
    if(action==="claim"){
      const{data:job,error}=await db.from("energy_render_jobs").select("id,status,metadata,lead_id,video_page_id,created_at").eq("status","queued").order("created_at",{ascending:true}).limit(1).maybeSingle();
      if(error)throw error;
      if(!job)return out({ok:true,status:"empty"});
      return out({ok:true,...await issue(db,job),leadId:job.lead_id,videoPageId:job.video_page_id,repository:claims.repository});
    }
    return out({error:"Unbekannte Aktion"},400);
  }catch(error){return out({error:error instanceof Error?error.message.slice(0,700):"GitHub render auth failed"},403)}
});