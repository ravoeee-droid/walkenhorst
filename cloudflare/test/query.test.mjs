import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compileQuery,project} from '../src/query.mjs';
test('ownership cannot be replaced by a client filter',()=>{const q=compileQuery(new URLSearchParams('user_id=eq.other&status=eq.ready'),'owner','energy_leads');assert.deepEqual(q.bind,['energy_leads','owner','other','ready']);assert.match(q.where,/owner_id=\?/)});
test('SQL identifiers are validated and values remain bound',()=>{assert.throws(()=>compileQuery(new URLSearchParams("bad';DROP TABLE users=eq.x"),'u','energy_leads'));const q=compileQuery(new URLSearchParams("company_name=eq.' OR 1=1 --"),'u','energy_leads');assert.ok(!q.where.includes('OR 1=1'));assert.equal(q.bind[2],"' OR 1=1 --")});
test('pagination is bounded and sort injection rejected',()=>{assert.equal(compileQuery(new URLSearchParams('limit=999999'),'u','energy_leads').limit,10000);assert.throws(()=>compileQuery(new URLSearchParams('order=x);drop'), 'u','energy_leads'))});
test('projection does not leak unrequested fields',()=>{assert.deepEqual(project({id:'1',private_key:'secret'},'id'),{id:'1'})});
