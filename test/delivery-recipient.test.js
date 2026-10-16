import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryRecipientMatches } from '../server/delivery-recipient.js';

test('delivery eligibility retains account ID while recognizing equivalent preserved and frozen mailboxes',async()=>{
  const calls=[],db={async query(sql,args){calls.push({sql,args});return {rows:[{id:'original'}]};}};
  const destination='RECIPIENT@EXAMPLE.EDU';
  assert.equal(await deliveryRecipientMatches(db,'original',{status:'active',email:' recipient@example.edu '},destination),true);
  assert.equal(destination,'RECIPIENT@EXAMPLE.EDU');
  assert.deepEqual(calls,[{sql:'select id from accounts where lower(btrim(email))=$1 limit 2',args:['recipient@example.edu']}]);
});

test('delivery refuses absent, inactive, changed, ambiguous or rebound accounts and malformed frozen destinations',async()=>{
  for(const rows of [[],[{id:'replacement'}],[{id:'original'},{id:'inactive'}]]) {
    assert.equal(await deliveryRecipientMatches({async query(){return {rows};}},'original',{status:'active',email:' recipient@example.edu '},'RECIPIENT@EXAMPLE.EDU'),false);
  }
  const db={query(){assert.fail('Ineligible destination must stop before lookup');}};
  for(const account of [null,{status:'suspended',email:'recipient@example.edu'},{status:'active',email:'changed@example.edu'},{status:'active',email:'recipient@example.edu\t'}])assert.equal(await deliveryRecipientMatches(db,'original',account,'recipient@example.edu'),false);
  for(const destination of [' recipient@example.edu ','recipient@example.edu\r\nBcc: other@example.edu',undefined])assert.equal(await deliveryRecipientMatches(db,'original',{status:'active',email:'recipient@example.edu'},destination),false);
});
