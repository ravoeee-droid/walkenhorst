import {readFile} from 'node:fs/promises';
export const account='a8f679cc3531e121c635b5da28c7cba6';
export const database='366f5ce7-f566-45b3-ac71-c6c9ca127a9f';
export async function api(route,init={}){
 const config=await readFile(new URL('../private/wrangler-config/.wrangler/config/default.toml',import.meta.url),'utf8');
 const token=config.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];if(!token)throw Error('Cloudflare login required');
 const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+route,{...init,headers:{authorization:'Bearer '+token,...init.headers}});
 const data=await response.json();if(!response.ok||data.success===false)throw Error('Cloudflare '+response.status+': '+JSON.stringify(data.errors));return data.result;
}
if(process.argv[2]==='status'){
 try{const list=await api('/workers/scripts');console.log(JSON.stringify({workerAccess:true,scripts:list.map(x=>x.id)}))}catch(e){console.error(e.message);process.exitCode=1}
}
