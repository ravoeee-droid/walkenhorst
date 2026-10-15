import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import path from 'node:path';
import {api,database} from './cloud-api.mjs';
const manifest={},files=new Map();
const types={'.html':'text/html;charset=utf-8','.js':'application/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2','.json':'application/json'};
async function walk(dir,prefix=''){for(const item of await readdir(dir,{withFileTypes:true})){const relative=prefix+'/'+item.name,file=path.join(dir,item.name);if(item.isDirectory())await walk(file,relative);else{const bytes=await readFile(file),hash=createHash('md5').update(bytes).digest('hex');manifest[relative]={hash,size:bytes.length};files.set(hash,{bytes,name:item.name,type:types[path.extname(item.name)]||'application/octet-stream'});}}}
await walk('dist');
if(Object.keys(manifest).some(x=>/private|import\.sql|users\.json|\.map$/.test(x)))throw Error('Unsafe public asset');
const session=await api('/workers/scripts/walkenhorst/assets-upload-session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({manifest})});
let completion=session.jwt;
for(const bucket of session.buckets||[]){const form=new FormData();for(const hash of bucket){const file=files.get(hash);form.append(hash,new Blob([file.bytes.toString('base64')],{type:file.type}),hash)}const uploaded=await api('/workers/assets/upload?base64=true',{method:'POST',headers:{authorization:'Bearer '+session.jwt},body:form});if(uploaded.jwt)completion=uploaded.jwt;console.log('Asset batch uploaded: '+bucket.length);}
let secret;try{secret=await readFile('private/session-secret','utf8')}catch{secret=randomBytes(48).toString('base64url');await writeFile('private/session-secret',secret,{mode:0o600})}
const metadata={main_module:'worker.js',compatibility_date:'2026-10-14',compatibility_flags:['nodejs_compat'],bindings:[{type:'d1',name:'DB',id:database},{type:'assets',name:'ASSETS'},{type:'secret_text',name:'SESSION_SECRET',text:secret}],assets:{jwt:completion,config:{not_found_handling:'single-page-application',run_worker_first:['/auth/*','/rest/*','/functions/*','/storage/*','/api/*']}},observability:{enabled:true}};
const form=new FormData();form.append('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));form.append('worker.js',new Blob([await readFile('build-worker/worker.js')],{type:'application/javascript+module'}),'worker.js');
const deployed=await api('/workers/scripts/walkenhorst',{method:'PUT',body:form});
await api('/workers/scripts/walkenhorst/subdomain',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({enabled:true,previews_enabled:false})});
const subdomain={subdomain:'ravoeee'};
const result={version:deployed.deployment_id||deployed.id,url:'https://walkenhorst.'+subdomain.subdomain+'.workers.dev',assets:Object.keys(manifest).length};await writeFile('private/deployment.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));

