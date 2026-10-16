import test from 'node:test';
import assert from 'node:assert/strict';
import { assertGpaResults, assertGpaSamples, assertGpaRules, assertGradingScheme, runValidationSamples } from '../server/modules/grading.js';

const result={courseCode:'CS101',credits:3,mark:70};
const sample={name:'Passing example',results:[result],expectedGpa:3,expectedClassification:'Pass'};
test('worked examples bound nested input and reject ambiguous or duplicate attempts',()=>{
  assertGpaSamples([sample,{name:'Excluded',results:[{courseCode:'CS102',credits:3,grade:'W'}],expectedGpa:null,expectedClassification:null}]);
  for (const value of [null,{},Array(26).fill(sample),[{...sample,results:[]}],[{...sample,expectedGpa:'3'}],[{...sample,name:' '}],[{...sample,unexpected:true}]]) assert.throws(()=>assertGpaSamples(value),{statusCode:400});
  for (const value of [[null],[{...result,grade:'W'}],[{...result,credits:-1}],[{...result,mark:70.5}],[{...result,attempt:0}],[result,result],Array(101).fill(result)]) assert.throws(()=>assertGpaResults(value),{statusCode:400});
});
test('every independent example contributes to the publication outcome',()=>{
  const scheme={bands:[{minMark:0,maxMark:100,grade:'P',points:3,passing:true}],classifications:[{minGpa:0,label:'Pass'}]};
  const rules={creditWeighted:true,includeFailed:true,retakePolicy:'latest',excludeGrades:['W'],rounding:{mode:'half_up',decimals:2}};
  const samples=[sample,{name:'Excluded',results:[{courseCode:'CS102',credits:3,grade:'W'}],expectedGpa:null,expectedClassification:null},{...sample,name:'Incorrect',expectedGpa:2}];
  assert.deepEqual(runValidationSamples(samples,rules,scheme).map(r=>r.passed),[true,true,false]);
  assert.throws(()=>assertGpaRules(null),{statusCode:400});
  assert.throws(()=>assertGradingScheme({bands:[null],classifications:[]}),{statusCode:400});
  assert.throws(()=>assertGradingScheme({...scheme,bands:[{...scheme.bands[0],points:Infinity}]}),{statusCode:400});
});
