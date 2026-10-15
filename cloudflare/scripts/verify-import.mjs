import {readFile,writeFile} from 'node:fs/promises';
import {api,database} from './cloud-api.mjs';
export async function query(sql,params=[]){return (await api('/d1/database/'+database+'/query',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sql,params})}))[0].results}
const manifest=JSON.parse(await readFile('private/manifest.json','utf8'));
const counts=await query('SELECT table_name,count(*) AS n FROM wh_records GROUP BY table_name');
for(const [table,n] of Object.entries(manifest.counts)){const actual=counts.find(x=>x.table_name===table)?.n||0;const expected=n+(table==='energy_leads'?Number(process.argv.includes('--test-present')):0);if(actual!==expected)throw Error('Count mismatch: '+table+' '+actual+'/'+expected)}
const test=await query("SELECT id,json_extract(row_json,'$.city') AS city FROM wh_records WHERE table_name='energy_leads' AND id=?",['4bc823cf-8fc2-4a0a-8e81-7eb92872d5b4']);
console.log(JSON.stringify({verifiedTables:Object.keys(manifest.counts).length,test}));
await writeFile('private/import-verification.json',JSON.stringify({verifiedAt:new Date().toISOString(),counts,test},null,2));
