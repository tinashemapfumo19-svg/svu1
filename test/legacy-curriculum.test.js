import test from 'node:test';
import assert from 'node:assert/strict';
import {curriculumProblems} from '../server/modules/curriculum.js';

test('source curriculum links retain structure without approving missing academic data',()=>{
 const entry={courseId:'legacy-module',code:'COMP101',yearOfStudy:1,term:'S1',status:'draft',prerequisites:[],legacySourceRef:'svu_course_codes:1',credits:null,requirementType:null,effectiveFrom:null};
 const problems=curriculumProblems([entry]);
 assert.ok(problems.some(p=>p.problem.includes('credits')));
 assert.ok(problems.some(p=>p.problem.includes('classification')));
 assert.ok(problems.some(p=>p.problem.includes('effective date')));
 assert.ok(problems.some(p=>p.problem.includes('completion')));
 assert.deepEqual(curriculumProblems([{...entry,credits:15,requirementType:'core',effectiveFrom:'2026-01-01',status:'active'}]),[]);
});
