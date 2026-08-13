import { rasterizeStudioAsset } from "@/lib/studio-brand-scan";
import { studioApiUser } from "@/lib/studio-api-auth";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;

export async function POST(request:Request){try{const user=await studioApiUser(request);if(!user)return Response.json({error:"Nicht autorisiert."},{status:401});const body=await request.json().catch(()=>({}));const url=typeof body?.url==="string"?body.url.trim():"";if(!url||url.length>2048)return Response.json({error:"Bitte eine gültige öffentliche Bild-URL angeben."},{status:400});const image=await rasterizeStudioAsset(url);return new Response(new Uint8Array(image),{status:200,headers:{"content-type":"image/png","cache-control":"no-store"}})}catch(error){return Response.json({error:error instanceof Error?error.message.slice(0,600):"Asset konnte nicht importiert werden."},{status:500})}}
