import { createClient } from "@supabase/supabase-js";
import { captureStudioWebsite } from "@/lib/studio-website-capture";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;
function client(){const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;if(!url||!key)throw new Error("Supabase-Konfiguration fehlt.");return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})}
export async function GET(_request:Request,{params}:{params:Promise<{slug:string}>}){try{const{slug}=await params;if(!slug||slug.length>180)return Response.json({error:"Ungültiger Link."},{status:400});const supabase=client();const{data,error}=await supabase.from("energy_video_pages").select("website_url,status,is_public,updated_at").eq("slug",slug).eq("is_public",true).in("status",["ready","sent"]).maybeSingle();if(error||!data?.website_url)return Response.json({error:"Website-Capture nicht verfügbar."},{status:404});const capture=await captureStudioWebsite(data.website_url);return new Response(new Uint8Array(capture.buffer),{status:200,headers:{"content-type":"image/webp","cache-control":"public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800","x-capture-width":String(capture.width),"x-capture-height":String(capture.height),"x-content-type-options":"nosniff"}})}catch(error){return Response.json({error:error instanceof Error?error.message.slice(0,500):"Website-Capture fehlgeschlagen."},{status:500})}}
