import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluationQuestions, minimumResponses, summariseEvaluation } from '../server/modules/course-evaluations.js';

const response = (ratings, wentWell = '', toChange = '') => ({ ratings, wentWell, toChange });

test('results stay hidden until the minimum number of responses', () => {
  const few = Array.from({ length: minimumResponses - 1 }, () => response([5, 5, 5, 5, 5], 'Great'));
  const summary = summariseEvaluation(few, 20);
  assert.equal(summary.visible, false);
  assert.equal(summary.responses, minimumResponses - 1);
  assert.equal('questions' in summary, false);
  assert.equal('wentWell' in summary, false);
});

test('visible results give averages, distributions and non-empty comments', () => {
  const rows = [response([5, 4, 3, 2, 1], 'Clear notes'), response([4, 4, 3, 2, 1]), response([3, 4, 3, 2, 2], '', 'More examples'), response([5, 4, 3, 2, 1]), response([4, 4, 3, 2, 1])];
  const summary = summariseEvaluation(rows, 10);
  assert.equal(summary.visible, true);
  assert.equal(summary.responseRate, 50);
  assert.equal(summary.questions.length, evaluationQuestions.length);
  assert.equal(summary.questions[0].average, 4.2);
  assert.deepEqual(summary.questions[0].distribution, [0, 0, 1, 2, 2]);
  assert.equal(summary.questions[4].average, 1.2);
  assert.deepEqual(summary.wentWell, ['Clear notes']);
  assert.deepEqual(summary.toChange, ['More examples']);
});
