import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const root=new URL('../private/',import.meta.url),records=[],exportedTables=new Set();
for(const file of (await readdir(new URL('records/',root))).sort()){if(!/^energy_[a-z0-9_]+-\d+\.json$/.test(file))continue;const table=file.replace(/-\d+\.json$/,'');exportedTables.add(table);for(const row of JSON.parse(await readFile(new URL('records/'+file,root),'utf8')))records.push({table,row})}
const leads=records.filter(x=>x.table==='energy_leads');if(leads.length!==1254||new Set(leads.map(x=>x.row.id)).size!==1254)throw Error('Lead inventory incomplete');
const users=JSON.parse(await readFile(new URL('users.json',root),'utf8'));
const owners=new Set(users.map(x=>x.raw_app_meta_data?.workspace_owner_id||x.id));if(owners.size!==1)throw Error('Unexpected workspace ownership');const owner=[...owners][0];
const leadOwners=new Map(leads.map(x=>[x.row.id,x.row.user_id]));
const tables=[...exportedTables];
const readOnly=new Set(['energy_webhook_tokens','energy_automation_outbox','energy_workspace_members','energy_runtime_settings']);
const statements=[],counts={},identities=new Set();let bytes=0;
for(const table of tables)statements.push(`INSERT INTO wh_tables(name,writable) VALUES(${q(table)},${table.includes('summary')||table.includes('_crm_')||table.endsWith('_v')||readOnly.has(table)?0:1});`);
for(const {table,row} of records){const encoded=JSON.stringify(row),id=row.id||row.lead_id||row.campaign_id||createHash('sha256').update(encoded).digest('hex');const identity=table+':'+id;if(identities.has(identity))throw Error('Duplicate source identity in '+table);identities.add(identity);const rowOwner=table=== 'energy_workspace_members'?row.workspace_owner_id:row.user_id||leadOwners.get(row.lead_id)||owner;if(!owners.has(rowOwner))throw Error('Unmapped owner in '+table);bytes+=Buffer.byteLength(encoded);statements.push(`INSERT INTO wh_records(table_name,id,owner_id,row_json) VALUES(${q(table)},${q(id)},${q(rowOwner)},${q(encoded)});`);counts[table]=(counts[table]||0)+1;}
if(bytes>180000000)throw Error('Export exceeds migration budget');
for(const table of ['energy_media_assets','energy_asset_upload_chunks','energy_studio_configs','energy_studio_versions','energy_render_jobs','energy_production_slides','energy_brand_kits'])if(!tables.includes(table))statements.push(`INSERT INTO wh_tables(name,writable) VALUES(${q(table)},0);`);
for(const source of users){const user={id:source.id,aud:'authenticated',role:'authenticated',email:source.email,email_confirmed_at:source.email_confirmed_at,confirmed_at:source.email_confirmed_at,created_at:source.created_at,updated_at:source.updated_at,app_metadata:source.raw_app_meta_data||{},user_metadata:source.raw_user_meta_data||{},identities:[]};statements.push(`INSERT INTO wh_users(id,email,password_hash,user_json,disabled) VALUES(${q(user.id)},${q(user.email)},${q(source.migration_password_hash||source.encrypted_password)},${q(JSON.stringify(user))},${source.email_confirmed_at?0:1});`)}
await writeFile(new URL('import.sql',root),statements.join('\n')+'\n');
await writeFile(new URL('manifest.json',root),JSON.stringify({sourceProject:'jiahshldcusphxtbqxpv',destinationDatabase:'366f5ce7-f566-45b3-ac71-c6c9ca127a9f',users:users.length,counts,bytes,rows:records.length,sha256:createHash('sha256').update(statements.join('\n')).digest('hex')},null,2));
console.log(JSON.stringify({prepared:true,users:users.length,counts,bytes}));

