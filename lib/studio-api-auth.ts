import { createClient } from "@supabase/supabase-js";

function config(){const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;if(!url||!key)throw new Error("Supabase-Konfiguration fehlt.");return{url,key}}
function bearer(request:Request){const auth=request.headers.get("authorization")||"";return auth.toLowerCase().startsWith("bearer ")?auth.slice(7).trim():""}
function workspaceUser<T extends {id:string;app_metadata?:Record<string,unknown>}|null>(user:T):T{if(!user)return user;const owner=typeof user.app_metadata?.workspace_owner_id==="string"?user.app_metadata.workspace_owner_id.trim():"";if(!owner||owner===user.id)return user;return{...user,id:owner,app_metadata:{...(user.app_metadata||{}),login_user_id:user.id}} as T}
export function studioApiClient(request:Request){const token=bearer(request);if(!token)return null;const{url,key}=config();return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}})}
export async function studioApiUser(request:Request){const token=bearer(request);if(!token)return null;const client=studioApiClient(request);if(!client)return null;const result=await client.auth.getUser(token);return result.error?null:workspaceUser(result.data.user)}
