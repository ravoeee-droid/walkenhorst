import {createInterface} from 'node:readline';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('private/records');await mkdir(root,{recursive:true});
if(process.stdin.isTTY)process.stdin.setRawMode(true);
console.log('Private migration writer ready.');
for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity,terminal:false})){
  try{const message=JSON.parse(line);if(!/^energy_[a-z0-9_]+$/.test(message.table)||!Number.isSafeInteger(message.offset)||!Array.isArray(message.rows))throw new Error('Invalid export envelope');
    await writeFile(path.join(root,message.table+'-'+message.offset+'.json'),JSON.stringify(message.rows));
    console.log(JSON.stringify({saved:message.table,offset:message.offset,rows:message.rows.length}));
  }catch{console.log(JSON.stringify({error:'Invalid export data; no file written'}));}
}
