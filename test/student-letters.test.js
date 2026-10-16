import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLetter, letterKinds } from '../server/modules/student-letters.js';
import { transcriptHash } from '../server/modules/transcripts.js';

const programme = { legalName: 'Tariro Moyo', studentNumber: 'S27000001', programmeCode: 'BSC-IS', programmeName: 'BSc Information Systems', faculty: 'Faculty of Technology', department: 'Computing', intakeLabel: 'February 2027', status: 'active' };

test('an enrolment letter states the student, programme, intake and date from the record only', () => {
  const letter = buildLetter({ kind: 'enrolment', programme, asOf: '2026-10-12' });
  assert.equal(letter.title, letterKinds.enrolment);
  assert.deepEqual(letter.student, { legalName: 'Tariro Moyo', studentNumber: 'S27000001' });
  assert.match(letter.statement, /Tariro Moyo, student number S27000001, .*BSc Information Systems programme \(February 2027 intake\), as of 2026-10-12/);
  assert.equal('courses' in letter, false);
});

test('a registration letter lists the confirmed courses and their total credits', () => {
  const letter = buildLetter({ kind: 'registration', programme, asOf: '2026-10-12', registration: { periodName: 'Semester 1 - 2028', startsOn: '2028-02-01', endsOn: '2028-06-30', referenceNumber: 'REG-1',
    courses: [{ code: 'COMP101', title: 'Programming', credits: 15, extra: 'x' }, { code: 'INFS101', title: 'Systems', credits: '15' }] } });
  assert.deepEqual(letter.courses, [{ code: 'COMP101', title: 'Programming', credits: 15 }, { code: 'INFS101', title: 'Systems', credits: 15 }]);
  assert.equal(letter.totalCredits, 30);
  assert.equal(letter.reference, 'REG-1');
  assert.match(letter.statement, /registered for Semester 1 - 2028/);
});

test('the same record on the same day gives the same fingerprint', () => {
  const one = buildLetter({ kind: 'enrolment', programme, asOf: '2026-10-12' });
  assert.equal(transcriptHash(one), transcriptHash(buildLetter({ kind: 'enrolment', programme, asOf: '2026-10-12' })));
  assert.notEqual(transcriptHash(one), transcriptHash(buildLetter({ kind: 'enrolment', programme, asOf: '2026-10-13' })));
});
