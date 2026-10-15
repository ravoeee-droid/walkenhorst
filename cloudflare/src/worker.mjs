import bcrypt from 'bcryptjs';
import {compileQuery,project} from './query.mjs';
const encoder=new TextEncoder();
const noStore={'cache-control':'no-store','x-content-type-options':'nosniff'};
function json(data,status=200,headers={}){return Response.json(data,{status,headers:{...noStore,...headers}});}
function error(message,status=400,code='REQUEST_ERROR'){return json({message,error:message,code},status);}
function b64(bytes){return btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');}
async function digest(value){return b64(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))));}
async function hmac(secret,value){const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(value))));}
const random=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
const now=()=>Math.floor(Date.now()/1000);
async function body(request){if(Number(request.headers.get('content-length')||0)>1000000)throw new Error('Request too large');const text=await request.text();if(encoder.encode(text).length>1000000)throw new Error('Request too large');return JSON.parse(text||'{}');}
function publicUser(row){return JSON.parse(row.user_json);}
async function session(request,env){
  const token=(request.headers.get('authorization')||'').replace(/^Bearer /i,'');if(!token)return null;
  return env.DB.prepare('SELECT u.* FROM wh_sessions s JOIN wh_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0').bind(await digest(token),now()).first();
}
async function newSession(user,env){
  if(!env.SESSION_SECRET)throw new Error('Auth configuration missing');
  await env.DB.prepare('DELETE FROM wh_sessions WHERE refresh_expires_at<=?').bind(now()).run();
  const active=await env.DB.prepare('SELECT count(*) AS n FROM wh_sessions WHERE user_id=?').bind(user.id).first();
  if(active.n>=100)return {error:'Zu viele aktive Sitzungen. Bitte zuerst abmelden.'};
  const expires=now()+3600;
  const jwtBody=b64(encoder.encode(JSON.stringify({sub:user.id,role:'authenticated',aud:'authenticated',email:user.email,exp:expires,iat:now(),jti:random()})));
  const unsigned=b64(encoder.encode(JSON.stringify({alg:'HS256',typ:'JWT'})))+'.'+jwtBody;
  const access=unsigned+'.'+await hmac(env.SESSION_SECRET,unsigned),refresh=random();
  await env.DB.prepare('INSERT INTO wh_sessions VALUES(?,?,?,?,?)').bind(await digest(access),await digest(refresh),user.id,expires,now()+604800).run();
  return {access_token:access,token_type:'bearer',expires_in:3600,expires_at:expires,refresh_token:refresh,user:publicUser(user)};
}
async function verifyPassword(password,hash){
  if(hash.startsWith('pbkdf2:')){
    const [,iterations,salt,expected]=hash.split(':');
    const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
    const calculated=b64(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encoder.encode(salt),iterations:Number(iterations)},key,256)));
    let different=calculated.length^expected.length;for(let i=0;i<calculated.length;i++)different|=calculated.charCodeAt(i)^(expected.charCodeAt(i)||0);return different===0;
  }
  return bcrypt.compare(password,hash);
}
async function auth(request,env,url){
  if(url.pathname==='/auth/v1/token'&&request.method==='POST'){
    const input=await body(request);
    if(url.searchParams.get('grant_type')==='refresh_token'){
      const old=await env.DB.prepare('SELECT u.*,s.refresh_hash FROM wh_sessions s JOIN wh_users u ON u.id=s.user_id WHERE s.refresh_hash=? AND s.refresh_expires_at>? AND u.disabled=0').bind(await digest(String(input.refresh_token||'')),now()).first();
      if(!old)return error('Session abgelaufen.',401,'refresh_token_not_found');
      await env.DB.prepare('DELETE FROM wh_sessions WHERE refresh_hash=?').bind(old.refresh_hash).run();return json(await newSession(old,env));
    }
    const email=String(input.email||'').trim().toLowerCase(),password=String(input.password||'');
    if(password.length>1024||email.length>254)return error('Ungültige Zugangsdaten.',400,'invalid_credentials');
    await env.DB.prepare('DELETE FROM wh_login_limits WHERE window_start<?').bind(now()-900).run();
    const limitKey=await digest(request.headers.get('cf-connecting-ip')||'local');
    await env.DB.prepare('INSERT INTO wh_login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_start<? THEN 1 ELSE attempts+1 END,window_start=CASE WHEN window_start<? THEN excluded.window_start ELSE window_start END').bind(limitKey,now(),now()-900,now()-900).run();
    const limited=await env.DB.prepare('SELECT attempts FROM wh_login_limits WHERE key=?').bind(limitKey).first();if(limited.attempts>10)return error('Zu viele Versuche. Bitte 15 Minuten warten.',429,'over_request_rate_limit');
    const user=await env.DB.prepare('SELECT * FROM wh_users WHERE email=? AND disabled=0').bind(email).first();
    if(!user||!await verifyPassword(password,user.password_hash))return error('E-Mail oder Passwort falsch.',400,'invalid_credentials');
    await env.DB.prepare('DELETE FROM wh_login_limits WHERE key=?').bind(limitKey).run();return json(await newSession(user,env));
  }
  if(url.pathname==='/auth/v1/user'&&request.method==='GET'){const user=await session(request,env);return user?json(publicUser(user)):error('Anmeldung erforderlich.',401);}
  if(url.pathname==='/auth/v1/logout'&&request.method==='POST'){
    const user=await session(request,env);if(user)await env.DB.prepare('DELETE FROM wh_sessions WHERE user_id=?').bind(user.id).run();return new Response(null,{status:204,headers:noStore});
  }
  return error('Account-Verwaltung während der Übernahme gesperrt.',403);
}
const blockedTables=new Set(['energy_media_assets','energy_asset_upload_chunks','energy_studio_configs','energy_studio_versions','energy_render_jobs','energy_production_slides']);
const privateTables=new Set(['energy_webhook_tokens','energy_automation_outbox','energy_workspace_members']);
async function rest(request,env,url,user){
  const table=decodeURIComponent(url.pathname.slice('/rest/v1/'.length));if(table.startsWith('rpc/'))return error('Diese Datenbankfunktion ist noch nicht auf Cloudflare übertragen.',503,'MIGRATION_PENDING');
  if(privateTables.has(table))return error('Kein Zugriff auf Systemdaten.',403);
  const allowed=await env.DB.prepare('SELECT writable FROM wh_tables WHERE name=?').bind(table).first();if(!allowed)return error('Tabelle nicht verfügbar.',404);
  const owner=publicUser(user).app_metadata?.workspace_owner_id||user.id;
  const q=compileQuery(url.searchParams,owner,table);
  if(request.method==='GET'||request.method==='HEAD'){
    const range=request.headers.get('range');if(range&&/^\d+-\d+$/.test(range)){const [a,b]=range.split('-').map(Number);q.offset=a;q.limit=Math.min(10000,b-a+1);}
    const result=await env.DB.prepare(`SELECT row_json FROM wh_records WHERE ${q.where}${q.order} LIMIT ? OFFSET ?`).bind(...q.bind,q.limit,q.offset).all();
    const rows=result.results.map(x=>project(JSON.parse(x.row_json),url.searchParams.get('select')));
    const count=await env.DB.prepare(`SELECT count(*) AS n FROM wh_records WHERE ${q.where}`).bind(...q.bind).first();
    const headers={'content-range':`${q.offset}-${q.offset+Math.max(0,rows.length-1)}/${count.n}`};
    if(request.method==='HEAD')return new Response(null,{status:200,headers:{...noStore,...headers}});
    if(request.headers.get('accept')?.includes('vnd.pgrst.object')){if(rows.length!==1)return json({code:'PGRST116',message:'Expected one row',details:`The result contains ${rows.length} rows`},406);return json(rows[0],200,headers);}
    return json(rows,200,headers);
  }
  if(!allowed.writable||blockedTables.has(table))return error('Video- und Systemschreibzugriffe sind gesperrt.',403,'MEDIA_WRITES_DISABLED');
  if(request.method==='DELETE')return error('Dauerhaftes Löschen während der Übernahme gesperrt.',403);
  const input=await body(request),existing=request.method==='PATCH'?await env.DB.prepare(`SELECT id,row_json FROM wh_records WHERE ${q.where} LIMIT 500`).bind(...q.bind).all():null;
  const rows=request.method==='PATCH'?existing.results.map(x=>({...JSON.parse(x.row_json),...input,id:x.id})):Array.isArray(input)?input:[input];
  if(rows.length>500)return error('Zu viele Datensätze.',413);
  const statements=[],saved=[];
  for(const row of rows){
    if(row.user_id&&row.user_id!==owner)return error('Kein Zugriff auf fremde Daten.',403);
    const record={...row,user_id:owner,id:row.id||crypto.randomUUID(),updated_at:new Date().toISOString()};record.created_at=record.created_at||record.updated_at;
    const encoded=JSON.stringify(record);if(encoder.encode(encoded).length>128000)return error('Datensatz zu groß.',413);
    if(request.method==='PATCH')statements.push(env.DB.prepare('UPDATE wh_records SET row_json=? WHERE table_name=? AND id=? AND owner_id=?').bind(encoded,table,record.id,owner));
    else{
      if(request.headers.get('prefer')?.includes('resolution=merge-duplicates'))return error('Upsert benötigt die vollständige Schlüsselprüfung.',503,'MIGRATION_PENDING');
      statements.push(env.DB.prepare('INSERT INTO wh_records VALUES(?,?,?,?)').bind(table,record.id,owner,encoded));
    }
    saved.push(project(record,url.searchParams.get('select')));
  }
  if(statements.length)await env.DB.batch(statements);
  if(!request.headers.get('prefer')?.includes('return=representation'))return new Response(null,{status:request.method==='POST'?201:204,headers:noStore});
  return json(request.headers.get('accept')?.includes('vnd.pgrst.object')?saved[0]:saved,request.method==='POST'?201:200);
}
async function ownedRows(env,owner,table,key,value){
  const clause=key?` AND json_extract(row_json,'$.${key}')=?`:'';
  const query=env.DB.prepare(`SELECT row_json FROM wh_records WHERE table_name=? AND owner_id=?${clause} LIMIT 1000`);
  const result=await query.bind(...(key?[table,owner,value]:[table,owner])).all();return result.results.map(row=>JSON.parse(row.row_json));
}
async function functions(request,env,url,user){
  const owner=publicUser(user).app_metadata?.workspace_owner_id||user.id;
  const name=url.pathname.slice('/functions/v1/'.length),input=await body(request);
  if(name==='crm-lead-workflow'&&input.action==='status'){
    const leadId=String(input.leadId||'');const leads=await ownedRows(env,owner,'energy_leads','id',leadId);
    if(!leads.length)return error('Lead nicht gefunden.',404);
    const [workflow,contacts,pages,messages]=await Promise.all([
      ownedRows(env,owner,'energy_crm_lead_workflow','lead_id',leadId),ownedRows(env,owner,'energy_lead_contacts','lead_id',leadId),
      ownedRows(env,owner,'energy_video_pages','lead_id',leadId),ownedRows(env,owner,'energy_messages','lead_id',leadId)]);
    return json({workflow:workflow[0]||null,contacts,page:pages[0]||null,draft:messages.filter(x=>x.direction==='outbound'&&x.status==='draft').at(-1)||null,gates:{checks:[{key:'migration',label:'Versand ist während der Migration gesperrt',ok:false}],allPassed:false,sendPassed:false}});
  }
  return error('Diese Automation wird noch auf Cloudflare übertragen.',503,'MIGRATION_PENDING');
}
export default{async fetch(request,env){
  const url=new URL(request.url);
  try{
    if(!['GET','HEAD','OPTIONS'].includes(request.method)&&request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return error('Fremder Ursprung nicht erlaubt.',403);
    if(url.pathname.startsWith('/auth/'))return await auth(request,env,url);
    if(url.pathname.startsWith('/storage/'))return error('Medien-Speicherung ist zum Schutz von Login und CRM gesperrt.',403,'MEDIA_WRITES_DISABLED');
    if(url.pathname.startsWith('/rest/')||url.pathname.startsWith('/functions/')||url.pathname.startsWith('/api/')){
      const user=await session(request,env);if(!user)return error('Anmeldung erforderlich.',401);
      if(url.pathname.startsWith('/rest/'))return await rest(request,env,url,user);
      if(url.pathname.startsWith('/functions/'))return await functions(request,env,url,user);
      if(url.pathname==='/api/health')return json({ok:true,backend:'cloudflare',mediaWrites:false});
      return error('Diese Automation wird noch auf Cloudflare übertragen.',503,'MIGRATION_PENDING');
    }
    const response=await env.ASSETS.fetch(request);const headers=new Headers(response.headers);headers.set('x-content-type-options','nosniff');headers.set('referrer-policy','strict-origin-when-cross-origin');headers.set('x-frame-options','DENY');return new Response(response.body,{status:response.status,headers});
  }catch(exception){console.error('request failed',exception?.message);return error('Anfrage fehlgeschlagen. Bitte erneut versuchen.',500);}
}};
