import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareUsable, sharingAuthority, validateShareAction, validateShareInvitation } from '../server/modules/student-sharing.js';
const input={email:'Family@Example.edu',categories:['fee_summary','programme_status'],days:30,requestKey:'sharing_request_12345'};
test('sharing invitations have explicit bounded scopes and normalized recipient email',() => {
  assert.deepEqual(validateShareInvitation(input),{...input,email:'family@example.edu'});
  for(const change of [{email:'bad'},{email:['family@example.edu']},{email:'family@example.edu\n'},{categories:[]},{categories:['medical']},{categories:['fee_summary','fee_summary']},{categories:[['fee_summary']]},{days:0},{days:367},{days:'30'},{requestKey:['sharing_request_12345']},{ownerId:'other'}])assert.throws(() => validateShareInvitation({...input,...change}));
});
test('sharing decisions require an actual revision and bounded request key',() => {
  assert.deepEqual(validateShareAction({revision:1,requestKey:input.requestKey}),{revision:1,requestKey:input.requestKey});
  for(const revision of [0,-1,1.5,'1',null])assert.throws(() => validateShareAction({revision,requestKey:input.requestKey}));
});
test('recipient identity category consent and expiry all gate shared reads',() => {
  const row={status:'accepted',recipientId:'parent',expiresAt:'2027-01-01T00:00:00Z',categories:['fee_summary']},now=new Date('2026-10-09T00:00:00Z');
  assert.equal(shareUsable(row,{accountId:'parent'},'fee_summary',now),true);
  for(const change of [{status:'pending'},{status:'revoked'},{status:'declined'},{recipientId:'other'},{expiresAt:now.toISOString()},{expiresAt:'bad'},{categories:['programme_status']}])assert.equal(shareUsable({...row,...change},{accountId:'parent'},'fee_summary',now),false);
  assert.equal(shareUsable(row,{accountId:'admin'},'fee_summary',now),false);
});
test('an unrelated global role cannot widen scoped sharing permission',() => {
  const actor={permissions:['sharing.read','admissions.apply'],roles:[{permissions:['sharing.read'],scope:{programmeCodes:['BSC'],intakeIds:['i1']}},{permissions:['admissions.apply'],scope:{}}]};
  assert.equal(sharingAuthority(actor,{programmeCode:'BSC',intakeId:'i1'}),true);
  assert.equal(sharingAuthority(actor,{programmeCode:'BSC',intakeId:'i2'}),false);
  assert.equal(sharingAuthority({...actor,permissions:[]},{programmeCode:'BSC',intakeId:'i1'}),false);
});
