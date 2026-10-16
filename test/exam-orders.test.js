import test from 'node:test';
import assert from 'node:assert/strict';
import { assertOrderMatchesSitting, validateExamOrder } from '../server/modules/exam-orders.js';

const input = {paper:' Paper 1 ',durationMinutes:180,paperReference:' VAULT-2026-1 ',materialsAllowed:' Non-programmable calculator ',requirements:' 30 printed copies ',reason:' Module examination '};

test('exam orders require explicit paper custody reference, allowed materials, and bounded durations',() => {
  const order = validateExamOrder(input);
  assert.equal(order.paper,'Paper 1');
  assert.equal(order.paperReference,'VAULT-2026-1');
  assert.equal(order.materialsAllowed,'Non-programmable calculator');
  assert.equal(order.requirements,'30 printed copies');
  assert.equal(validateExamOrder({...input,requirements:undefined}).requirements,'');
  for (const changes of [{paper:''},{durationMinutes:0},{durationMinutes:481},{durationMinutes:100},{paperReference:''},{materialsAllowed:''},{requirements:42},{requirements:'x'.repeat(1001)},{unknown:true}]) {
    assert.throws(() => validateExamOrder({...input,...changes}),{statusCode:400});
  }
});

test('an approved exam order pins the course, paper and duration of linked sittings',() => {
  const order = {...validateExamOrder(input),courseId:'course1',status:'approved'};
  assert.doesNotThrow(() => assertOrderMatchesSitting(order,'course1',{paper:'Paper 1',durationMinutes:180}));
  for (const changes of [{status:'submitted'},{status:'returned'},{courseId:'course2'},{paper:'Paper 2'},{durationMinutes:120}]) {
    assert.throws(() => assertOrderMatchesSitting({...order,...changes},'course1',{paper:'Paper 1',durationMinutes:180}),{statusCode:409});
  }
});
