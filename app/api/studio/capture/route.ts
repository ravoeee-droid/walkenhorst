import { createClient } from "@supabase/supabase-js";
import { captureStudioWebsite } from "@/lib/studio-website-capture";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;

function backendClient(){const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;if(!url||!key)throw new Error("Supabase-Konfiguration fehlt.");return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})}

export async function POST(request:Request){
  try{
    const authorization=request.headers.get("authorization")||"";const token=authorization.toLowerCase().startsWith("bearer ")?authorization.slice(7).trim():"";if(!token)return Response.json({error:"Nicht autorisiert."},{status:401});
    const supabase=backendClient();const auth=await supabase.auth.getUser(token);if(auth.error||!auth.data.user)return Response.json({error:"Session ungültig oder abgelaufen."},{status:401});
    const body=await request.json().catch(()=>({}));const url=typeof body?.url==="string"?body.url.trim():"";if(!url||url.length>2048)return Response.json({error:"Bitte eine gültige Website-Adresse angeben."},{status:400});
    const result=await captureStudioWebsite(url);return new Response(new Uint8Array(result.buffer),{status:200,headers:{"content-type":"image/webp","cache-control":"no-store","x-capture-height":String(result.height)}});
  }catch(error){return Response.json({error:error instanceof Error?error.message.slice(0,500):"Website-Aufnahme fehlgeschlagen."},{status:500})}
}
