const identifier=/^[a-z][a-z0-9_]{0,62}$/;
export function field(name){if(!identifier.test(name))throw new Error('Invalid column');return `json_extract(row_json,'$.${name}')`;}
function value(raw){if(raw==='null')return null;if(raw==='true')return 1;if(raw==='false')return 0;return /^-?\d+(\.\d+)?$/.test(raw)?Number(raw):raw;}
export function compileQuery(params,owner,table){
  if(!identifier.test(table))throw new Error('Invalid table');
  const bind=[table,owner]; const where=['table_name=?','owner_id=?'];
  for(const [name,filter] of params){
    if(['select','order','limit','offset','on_conflict'].includes(name))continue;
    if(name==='or'||name==='and')throw new Error('Logical filters require migration');
    const dot=filter.indexOf('.');if(dot<0)throw new Error('Invalid filter');
    let op=filter.slice(0,dot),raw=filter.slice(dot+1),negated=false;
    if(op==='not'){negated=true;const next=raw.indexOf('.');op=raw.slice(0,next);raw=raw.slice(next+1);}
    const column=field(name);let sql;
    if(op==='is'&&raw==='null')sql=`${column} IS NULL`;
    else if(op==='in'){
      if(!raw.startsWith('(')||!raw.endsWith(')'))throw new Error('Invalid list');
      const values=raw.slice(1,-1).split(',').map(x=>value(x.replace(/^"|"$/g,'')));
      if(values.length>500)throw new Error('List too large');sql=`${column} IN (${values.map(()=>'?').join(',')})`;bind.push(...values);
    }else if(['eq','neq','gt','gte','lt','lte','like','ilike','is'].includes(op)){
      const operators={eq:'=',neq:'<>',gt:'>',gte:'>=',lt:'<',lte:'<=',like:'LIKE',ilike:'LIKE',is:'IS'};
      sql=`${column} ${operators[op]} ?`;bind.push(op==='like'||op==='ilike'?raw.replace(/\*/g,'%'):value(raw));
    }else throw new Error('Unsupported filter');
    where.push(negated?`NOT (${sql})`:sql);
  }
  const order=(params.get('order')||'').split(',').filter(Boolean).map(item=>{const [name,direction]=item.split('.');return `${field(name)} ${direction==='desc'?'DESC':'ASC'}`;});
  const limit=Math.min(10000,Math.max(0,Number(params.get('limit')||1000))),offset=Math.max(0,Number(params.get('offset')||0));
  if(!Number.isSafeInteger(limit)||!Number.isSafeInteger(offset))throw new Error('Invalid range');
  return{where:where.join(' AND '),bind,order:order.length?' ORDER BY '+order.join(','):'',limit,offset};
}
export function project(row,selection){
  if(!selection||selection==='*')return row;
  const result={};for(const item of selection.split(',')){const [alias,column]=item.includes(':')?item.split(':'):[item,item];field(column);result[alias]=row[column]??null;}return result;
}
