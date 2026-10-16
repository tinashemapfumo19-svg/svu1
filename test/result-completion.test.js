import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {resultPeriodCompletion,resultsChecksum} from '../server/modules/results.js';

const roster = () => [{registrationId:'r1',courseId:'c1'},{registrationId:'r1',courseId:'c2'}];
const batch = (status='draft',rows=roster().map(row => ({...row,mark:75}))) => ({id:'b1',sourceRef:'SAMPLE',status,rows,rowCount:rows.length,markTotal:rows.reduce((sum,row) => sum+row.mark,0),checksum:resultsChecksum(rows)});
const official = (source=batch('published')) => source.rows.map(row => ({registrationId:row.registrationId,courseId:row.courseId,batchId:source.id,revision:0,snapshot:row}));

test('result completion partitions recording, review, publication and official custody without treating missing work as failure',() => {
  assert.deepEqual(resultPeriodCompletion(roster(),[],[]).counts,{expectedRecords:2,recordedRecords:0,awaitingRecording:2,awaitingReview:0,awaitingPublication:0,publishedRecords:0,outsideRosterRecords:0,rejectedBatches:0});
  for(const [status,field] of [['draft','awaitingReview'],['reviewed','awaitingPublication'],['published','publishedRecords']]) {
    const source=batch(status),value=resultPeriodCompletion(roster(),[source],status==='published'?official(source):[]);
    assert.equal(value.counts[field],2);assert.equal(value.counts.awaitingRecording,0);
    assert.equal(value.sourceCurrent,true);assert.ok(Object.values(value.controls).every(Boolean));
  }
});
test('result completion preserves rejected history and explicit empty periods',() => {
  const rejected=batch('rejected');
  assert.equal(resultPeriodCompletion(roster(),[rejected],[]).counts.awaitingRecording,2);
  assert.equal(resultPeriodCompletion(roster(),[rejected],[]).counts.rejectedBatches,1);
  const next={...batch(),id:'b2'};
  assert.equal(resultPeriodCompletion(roster(),[rejected,next],[]).counts.awaitingReview,2);
  assert.equal(resultPeriodCompletion([],[],[]).counts.expectedRecords,0);
});
test('changed current roster is workload, not a repair or discarded historical result',() => {
  const current=[roster()[0],{registrationId:'new',courseId:'c1'}];
  for(const status of ['draft','reviewed','published']) {
    const source=batch(status),value=resultPeriodCompletion(current,[source],status==='published'?official(source):[]);
    assert.equal(value.sourceCurrent,false);assert.equal(value.counts.awaitingRecording,1);
    assert.equal(value.counts.outsideRosterRecords,1);assert.equal(value.counts.recordedRecords,1);
    assert.ok(Object.values(value.controls).every(Boolean));
  }
});
test('malformed result sources refuse completion figures',() => {
  const source=batch('published');
  for(const sources of [
    [null,[],[]],[[...roster(),roster()[0]],[],[]],
    [roster(),[{...batch(),status:'unknown'}],[]],
    [roster(),[batch(),{...batch(),id:'b2'}],[]],
    [roster(),[{...batch(),checksum:'0'.repeat(64)}],[]],
    [roster(),[{...batch(),rowCount:1}],[]],
    [roster(),[{...batch(),markTotal:151}],[]],
    [roster(),[source],official(source).slice(0,1)],
    [roster(),[source],[...official(source),official(source)[0]]],
    [roster(),[source],official(source).map(row=>({...row,batchId:'wrong'}))],
    [roster(),[batch()],official(source)],
    [roster(),[source],official(source).map(row=>({...row,revision:-1}))],
    [roster(),[source],official(source).map(row=>({...row,snapshot:{...row.snapshot,registrationId:'wrong'}}))]
  ])assert.throws(()=>resultPeriodCompletion(...sources),{statusCode:409});
});
test('approved amendments do not turn official completion back into pending recording',() => {
  const source=batch('published'),rows=official(source);rows[0]={...rows[0],revision:1,snapshot:{...rows[0].snapshot,mark:80}};
  assert.equal(resultPeriodCompletion(roster(),[source],rows).counts.publishedRecords,2);
  assert.equal(source.rows[0].mark,75);
});
test('result completion UI renders counts without inventing figures for older responses',() => {
  const window={};runInNewContext(readFileSync(new URL('../src/registry-results.js',import.meta.url),'utf8'),{window});
  const period={id:'p1',name:'<Synthetic>'},entry={period,roster:roster(),batches:[],official:[]};
  const state={results:{periods:[entry],capabilities:{},policies:[]}};
  assert.doesNotMatch(window.registryResultsUI.render(state),/data-result-completion-count/);
  entry.completion=resultPeriodCompletion(roster(),[],[]);
  const html=window.registryResultsUI.render(state);
  assert.match(html,/data-result-completion-count="awaitingRecording">2/);
  assert.match(html,/data-result-completion-count="publishedRecords">0/);
  assert.match(html,/&lt;Synthetic&gt;/);
  const unavailable=window.registryResultsUI.render({results:null,resultsUnavailable:true});
  assert.match(unavailable,/data-results-refresh/);assert.doesNotMatch(unavailable,/data-result-completion-count/);
});
