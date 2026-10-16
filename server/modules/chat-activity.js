import {createHmac,timingSafeEqual} from 'node:crypto';
import {requestError} from '../support.js';

const maximum=9223372036854775807n,lifetime=30*60*1000;
const position=value=>typeof value==='string' && /^(?:0|[1-9]\d{0,18})$/.test(value) && BigInt(value)<=maximum;
const secureKey=key=>{if(!Buffer.isBuffer(key) || key.length!==32)throw requestError(503,'Chat activity key is unavailable.');};
const digest=(key,domain,value)=>{
  secureKey(key);
  return createHmac('sha256',key).update(`${domain}\0${value}`).digest('base64url');
};
export const activityEpoch=(value,key)=>digest(key,'chat-activity-epoch',JSON.stringify(value));
export async function activityGrants(db,ids,permission) {
  // Row versions also detect disable/re-enable cycles that retain the same grant IDs.
  return (await db.query(`select a.id as "accountId",ra.id as "assignmentId",ra.role_code as "roleCode",
    a.xmin::text as "accountVersion",ra.xmin::text as "assignmentVersion",r.xmin::text as "roleVersion",rp.xmin::text as "permissionVersion"
    from accounts a join role_assignments ra on ra.account_id=a.id join roles r on r.code=ra.role_code and r.active
    join role_permissions rp on rp.role_code=r.code where a.id=any($1::text[]) and a.status='active'
    and ra.ended_at is null and ra.effective_from<=current_date and (ra.effective_to is null or ra.effective_to>=current_date)
    and rp.permission_code=$2 order by a.id,ra.id,ra.role_code`,[ids,permission])).rows;
}
export function activityCursor(input,actor,scope,key) {
  secureKey(key);
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(name=>name!=='cursor'))throw requestError(400,'Unsupported chat activity fields.');
  if(input.cursor===undefined || input.cursor==='')return null;
  const token=input.cursor;
  if(typeof token!=='string' || token.length>1200 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token))throw requestError(400,'Invalid chat activity cursor.');
  const [encoded,signature]=token.split('.'),expected=digest(key,'chat-activity-cursor',encoded);
  if(!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw requestError(400,'Invalid chat activity cursor.');
  let value;try{value=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));}catch{throw requestError(400,'Invalid chat activity cursor.');}
  if(!value || Array.isArray(value) || Object.keys(value).sort().join(',')!=='a,e,p,s,t,v' || value.v!==1 || value.a!==actor.accountId || value.s!==scope || !position(value.p)
    || typeof value.e!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(value.e) || !Number.isSafeInteger(value.t) || value.t<0)throw requestError(400,'Invalid chat activity cursor.');
  return value;
}
export function activityAfter(previous,epoch,now=Date.now()) {
  return previous && previous.e===epoch && now>=previous.t && now-previous.t<=lifetime ? previous.p : null;
}
export function activityResult(snapshot,after,epoch,actor,scope,key,now=Date.now()) {
  if(!snapshot || ![snapshot.latest,snapshot.own,snapshot.others].every(position) || BigInt(snapshot.own)+BigInt(snapshot.others)>BigInt(snapshot.latest))throw requestError(409,'Chat activity requires secure reconciliation.');
  const reset=after===null || BigInt(snapshot.latest)<BigInt(after);
  const encoded=Buffer.from(JSON.stringify({v:1,a:actor.accountId,s:scope,p:snapshot.latest,e:epoch,t:now})).toString('base64url');
  return {cursor:`${encoded}.${digest(key,'chat-activity-cursor',encoded)}`,reset,own:reset?'0':snapshot.own,others:reset?'0':snapshot.others};
}
