import {api,database} from './cloud-api.mjs';
const id='4bc823cf-8fc2-4a0a-8e81-7eb92872d5b4',name='WALKENHORST MIGRATION TEST 20261015';
const result=await api('/d1/database/'+database+'/query',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sql:"DELETE FROM wh_records WHERE table_name='energy_leads' AND id=? AND json_extract(row_json,'$.company_name')=? AND json_extract(row_json,'$.source')='manual' RETURNING id",params:[id,name]})});
if(result[0].results.length!==1)throw Error('Test cleanup did not match exactly one test record');console.log('Only the isolated migration test lead removed.');
