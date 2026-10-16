import {createHmac} from 'node:crypto';
import {requestError,withTransaction} from '../support.js';

const permissions=['messages.self','rooms.self','rooms.manage','rooms.approve','rooms.triage'];
const identifier=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const version=value=>typeof value==='string' && /^(?:0|[1-9]\d{0,9})$/.test(value) && BigInt(value)<=4294967295n;
const secureKey=key=>{if(!Buffer.isBuffer(key) || key.length!==32)throw requestError(503,'Message authority key is unavailable.');};

export function commandAuthorityEpoch(account,grants,key) {
  secureKey(key);
  if(!account || !identifier(account.accountId) || !identifier(account.sessionId) || !version(account.accountVersion) || !version(account.sessionVersion)
    || !['password','mfa'].includes(account.assurance) || typeof account.authorizationDate!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(account.authorizationDate)
    || !Array.isArray(grants) || grants.length>4096)throw requestError(409,'Message authority requires secure reconciliation.');
  const rows=grants.map(row=>{
    if(!row || !identifier(row.assignmentId) || !identifier(row.roleCode) || !permissions.includes(row.permission)
      || ![row.assignmentVersion,row.roleVersion,row.permissionVersion].every(version))throw requestError(409,'Message authority requires secure reconciliation.');
    return [row.assignmentId,row.roleCode,row.permission,row.assignmentVersion,row.roleVersion,row.permissionVersion];
  }).sort((a,b)=>{const left=JSON.stringify(a),right=JSON.stringify(b);return left<right?-1:left>right?1:0;});
  if(new Set(rows.map(row=>JSON.stringify(row.slice(0,3)))).size!==rows.length)throw requestError(409,'Message authority requires secure reconciliation.');
  const snapshot={v:1,account:account.accountId,session:account.sessionId,accountVersion:account.accountVersion,sessionVersion:account.sessionVersion,
    assurance:account.assurance,date:account.authorizationDate,grants:rows};
  return createHmac('sha256',key).update('chat-command-context\0').update(JSON.stringify(snapshot)).digest('base64url');
}

export async function readCommandAuthority(db,actor,dataEncryptionKey) {
  if(!identifier(actor?.accountId) || !identifier(actor?.sessionId))throw requestError(403,'Current message identity is required.');
  secureKey(dataEncryptionKey);
  const account=(await db.query(`select a.id as "accountId",a.xmin::text as "accountVersion",s.id as "sessionId",s.xmin::text as "sessionVersion",s.assurance,
    current_date::text as "authorizationDate" from accounts a join sessions s on s.account_id=a.id
    where a.id=$1 and a.status='active' and s.id=$2 and s.status='active' and s.expires_at>now() for share of a,s`,[actor.accountId,actor.sessionId])).rows[0];
  if(!account || account.accountId!==actor.accountId || account.sessionId!==actor.sessionId)throw requestError(403,'Current message identity is required.');
  // Row versions detect retained-ID revoke/regrant cycles even between client refreshes.
  const grants=(await db.query(`select ra.id as "assignmentId",ra.role_code as "roleCode",rp.permission_code as permission,
    ra.xmin::text as "assignmentVersion",r.xmin::text as "roleVersion",rp.xmin::text as "permissionVersion"
    from role_assignments ra join roles r on r.code=ra.role_code and r.active join role_permissions rp on rp.role_code=r.code
    where ra.account_id=$1 and ra.ended_at is null and ra.effective_from<=current_date and (ra.effective_to is null or ra.effective_to>=current_date)
    and rp.permission_code=any($2::text[]) and (rp.permission_code in ('messages.self','rooms.self') or ra.scope='{}'::jsonb)
    order by ra.id,r.code,rp.permission_code limit 4097 for share of ra,r,rp`,[actor.accountId,permissions])).rows;
  return {accountId:account.accountId,epoch:commandAuthorityEpoch(account,grants,dataEncryptionKey)};
}

export function createChatCommandContextModule(pool,{dataEncryptionKey}={}) {
  return {
    async chatCommandContext(input,actor) {
      if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).length)throw requestError(400,'Unsupported message authority fields.');
      if(!identifier(actor?.accountId) || !identifier(actor?.sessionId))throw requestError(403,'Current message identity is required.');
      secureKey(dataEncryptionKey);
      try {return await withTransaction(pool,async db=>{
        await db.query('set transaction isolation level repeatable read');
        return readCommandAuthority(db,actor,dataEncryptionKey);
      });}catch(error){if(['40001','40P01'].includes(error.code))throw requestError(409,'Message authority changed. Refresh before recalling.');throw error;}
    }
  };
}
