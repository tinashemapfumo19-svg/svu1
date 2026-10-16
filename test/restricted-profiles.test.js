import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restrictedAuthority, restrictedConsentActive, restrictedGlobalAuthority, validateRestrictedPolicy, validateRestrictedSubmission } from '../server/modules/restricted-profiles.js';
const policy={group:'medical',purposeCode:'STUDENT_CARE',title:'Student care',purpose:'Optional care contact',owner:'Institutional policy owner',policyReference:'Reviewed policy reference',retentionRule:'Retained pending authorized review',consentDays:30,requestKey:'restricted_policy_12345'};
test('restricted policies require explicit owner purpose retention and bounded duration',() => {
  assert.deepEqual(validateRestrictedPolicy(policy),policy);
  for (const change of [{group:'health'},{group:['medical']},{group:'__proto__'},{purposeCode:'care'},{purpose:''},{owner:''},{policyReference:''},{retentionRule:''},{consentDays:0},{consentDays:367},{consentDays:1.5},{requestKey:['restricted_policy_12345']},{status:'published'}]) assert.throws(() => validateRestrictedPolicy({...policy,...change}));
});
test('restricted submissions are category isolated explicit consent and canonicalized',() => {
  const input={revision:0,policyId:'p1',consent:true,values:{provider:' Example '},requestKey:'restricted_save_12345'};
  assert.equal(validateRestrictedSubmission('medical',input).values.provider,'Example');
  assert.equal(validateRestrictedSubmission('medical',input).values.physicianContact,'');
  for (const change of [{consent:false},{consent:'true'},{revision:-1},{revision:'0'},{values:{religion:'Other'}},{values:[]},{values:{}},{values:{provider:4}},{values:{provider:'line\nbreak'}},{values:{provider:'x'.repeat(161)}},{requestKey:['restricted_save_12345']}]) assert.throws(() => validateRestrictedSubmission('medical',{...input,...change}));
  assert.throws(() => validateRestrictedSubmission('__proto__',input));
  assert.throws(() => validateRestrictedSubmission(['medical'],input));
  assert.throws(() => validateRestrictedSubmission('medical',{...input,values:{provider:null}}));
  assert.deepEqual(validateRestrictedSubmission('medical',Object.fromEntries(Object.entries(input).reverse())),validateRestrictedSubmission('medical',input));
});
test('only the category permission bearing role can lend its scope',() => {
  const actor={permissions:['restricted.medical.read','staff.manage'],roles:[{code:'student_medical_officer',permissions:['restricted.medical.read'],scope:{programmeCodes:['BSC'],intakeIds:['i1']}},{code:'hr_officer',permissions:['staff.manage'],scope:{}}]};
  assert.equal(restrictedAuthority(actor,'medical',{programmeCode:'BSC',intakeId:'i1'}),true);
  assert.equal(restrictedAuthority(actor,'medical',{programmeCode:'BSC',intakeId:'i2'}),false);
  assert.equal(restrictedAuthority(actor,'medical',{programmeCode:'OTHER',intakeId:'i1'}),false);
  assert.equal(restrictedAuthority(actor,'religion',{programmeCode:'BSC',intakeId:'i1'}),false);
  assert.equal(restrictedAuthority({permissions:[],roles:[{code:'system_administrator',permissions:[],scope:{}}]},'medical',{}),false);
});
test('staff reads require matching unexpired consent and an active published policy',() => {
  const row={status:'consented',policyId:'p1',expiresAt:'2026-10-10T00:00:00Z'},approved={id:'p1',status:'published'},now=new Date('2026-10-09T00:00:00Z');
  assert.equal(restrictedConsentActive(row,approved,now),true);
  for (const change of [{status:'withdrawn'},{expiresAt:'2026-10-09T00:00:00Z'},{expiresAt:'bad'},{policyId:'p2'}]) assert.equal(restrictedConsentActive({...row,...change},approved,now),false);
  assert.equal(restrictedConsentActive(row,{...approved,status:'retired'},now),false);
  assert.equal(restrictedConsentActive(undefined,approved,now),false);
});
test('policy governance distinguishes scoped management from global approval',() => {
  const actor={permissions:['restricted.policy.manage','restricted.policy.approve'],roles:[{permissions:['restricted.policy.manage'],scope:{programmeCodes:['BSC']}},{permissions:['restricted.policy.approve'],scope:{}}]};
  assert.equal(restrictedGlobalAuthority(actor,'restricted.policy.manage'),false);
  assert.equal(restrictedGlobalAuthority(actor,'restricted.policy.approve'),true);
});
