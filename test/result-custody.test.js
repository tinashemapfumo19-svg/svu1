import test from 'node:test';
import assert from 'node:assert/strict';
import {assertResultSourceCustody,assertResultReviewCustody,resultsChecksum} from '../server/modules/results.js';

function fixture() {
  const policy={rule:{id:'gpa',code:'SAMPLE',version:1,gradingSchemeId:'scheme',rules:{creditWeighted:true,retakePolicy:'latest'}},scheme:{id:'scheme',code:'SAMPLE',version:1,bands:[{minMark:0,maxMark:100,grade:'P',points:4,passing:true}],classifications:[{minGpa:2,label:'Pass'}]}};
  const roster=[{registrationId:'r1',courseId:'c1',studentNumber:'S33000001',programmeId:'sp1',courseSnapshot:{code:'C1',title:'Synthetic course',credits:'15'}}];
  const rows=[{registrationId:'r1',courseId:'c1',mark:75,studentNumber:'S33000001',programmeId:'sp1',code:'C1',title:'Synthetic course',credits:15,grade:'P',points:4,passing:true}];
  const batch={id:'b1',periodId:'p1',sourceRef:'SAMPLE',rows,policy:structuredClone(policy),rowCount:1,markTotal:75,checksum:resultsChecksum(rows),createdBy:'maker',importReason:'Source',reviewedBy:'checker',reviewReason:'Review',evidenceRef:'Evidence'};
  const origin={actorId:'maker',reason:' Source ',timeMatches:true,metadata:{periodId:'p1',sourceRef:'SAMPLE',rowCount:1,markTotal:75,checksum:batch.checksum}};
  const review={actorId:'checker',reason:' Review ',timeMatches:true,metadata:{evidenceRef:'Evidence',checksum:batch.checksum}};
  return {batch,roster,policy,origin,review};
}
const verify = value => assertResultSourceCustody(value.batch,value.roster,value.policy,value.origin);

test('native result source custody reproduces retained course/grade snapshots and matches import receipt without depending on row order',() => {
  const value=fixture();assert.doesNotThrow(()=>verify(value));
  const row={...value.batch.rows[0],registrationId:'r2'},enrolled={...value.roster[0],registrationId:'r2'};
  value.batch.rows.push(row);value.roster.unshift(enrolled);value.batch.rowCount=2;value.batch.markTotal=150;value.batch.checksum=resultsChecksum(value.batch.rows);
  Object.assign(value.origin.metadata,{rowCount:2,markTotal:150,checksum:value.batch.checksum});
  assert.doesNotThrow(()=>verify(value));
});
test('result approval refuses bad counts, totals, checksums, marks and roster bindings',() => {
  for(const edit of [v=>v.batch.rowCount++,v=>v.batch.markTotal++,v=>v.batch.checksum='0'.repeat(64),v=>v.batch.rows[0].mark=100.1,v=>v.roster=[],v=>v.batch.rows=null]) {
    const value=fixture();edit(value);assert.throws(()=>verify(value),{statusCode:409});
  }
});
test('recomputing tampered source controls cannot replace the native import receipt',() => {
  const value=fixture();value.batch.rows[0].mark=80;value.batch.markTotal=80;value.batch.checksum=resultsChecksum(value.batch.rows);
  assert.throws(()=>verify(value),{statusCode:409});
  for(const edit of [v=>v.origin=null,v=>v.origin.actorId='other',v=>v.origin.timeMatches=false,v=>v.origin.metadata.periodId='other',v=>v.origin.metadata.sourceRef='other',v=>v.origin.reason='Changed']) {
    const value=fixture();edit(value);assert.throws(()=>verify(value),{statusCode:409});
  }
});
test('checksum-neutral changes to student/course/grade enrichment cannot be approved',() => {
  for(const change of [{studentNumber:'other'},{programmeId:'other'},{code:'other'},{title:'other'},{credits:30},{grade:'F'},{points:0},{passing:false},{unexpected:'value'}]) {
    const value=fixture();Object.assign(value.batch.rows[0],change);assert.equal(resultsChecksum(value.batch.rows),value.batch.checksum);
    assert.throws(()=>verify(value),{statusCode:409});
  }
});
test('policy identities, rules and grading bands must match the effective published pinned policy',() => {
  for(const edit of [v=>v.batch.policy.rule.id='other',v=>v.batch.policy.rule.version++,v=>v.batch.policy.rule.rules.retakePolicy='best',v=>v.batch.policy.scheme.bands[0].grade='F',v=>v.batch.policy.scheme.classifications[0].label='Other',v=>v.policy.rule.gradingSchemeId='other',v=>v.batch.policy=null]) {
    const value=fixture();edit(value);assert.throws(()=>verify(value),{statusCode:409});
  }
  const value=fixture();value.policy.rule.status='superseded';value.batch.policy.rule.status='published';
  assert.doesNotThrow(()=>verify(value)); // Policy validity is checked by the native policy reader, not metadata equality.
});
test('publication requires the actual independent review receipt, checksum, evidence, reason and timestamp binding',() => {
  const value=fixture();assert.doesNotThrow(()=>assertResultReviewCustody(value.batch,value.review));
  for(const edit of [v=>v.review=null,v=>v.batch.reviewedBy='maker',v=>v.review.actorId='other',v=>v.review.timeMatches=false,v=>v.review.metadata.checksum='0'.repeat(64),v=>v.review.metadata.evidenceRef='other',v=>v.review.reason='Other',v=>v.batch.evidenceRef='']) {
    const value=fixture();edit(value);assert.throws(()=>assertResultReviewCustody(value.batch,value.review),{statusCode:409});
  }
});
