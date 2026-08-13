import { createClient } from "@supabase/supabase-js";

function config(){const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;if(!url||!key)throw new Error("Supabase-Konfiguration fehlt.");return{url,key}}
export async function studioApiUser(request:Request){const auth=request.headers.get("authorization")||"";const token=auth.toLowerCase().startsWith("bearer ")?auth.slice(7).trim():"";if(!token)return null;const{url,key}=config();const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});const result=await supabase.auth.getUser(token);return result.error?null:result.data.user}
