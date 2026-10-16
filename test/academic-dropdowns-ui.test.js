import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/academic-setup.js', import.meta.url), 'utf8');
function render(tab, data = {}, extra = {}) {
  const window = {svuSession: {can: () => true}};
  vm.runInNewContext(source, {window});
  return window.academicSetupUI.render({academicSetup: {
    tab, selected: null, versions: [], history: [],
    data: {organization: [], programmes: [], courses: [], periods: [], intakes: [], grading: [], gpa: [], ...data},
    ...extra,
  }});
}
function field(html, name) {
  return html.match(new RegExp(`<select[^>]*name="${name}"[^>]*>([\\s\\S]*?)</select>`))[1];
}

test('intake programme choices display legacy names, escape text, and keep every option', () => {
  const html = field(render('intakes', {programmes: [
    {id: 'p1', code: 'BSC', name: 'Bachelor of Science in Information & Communication Technology'},
    {id: 'p2', name: 'Legacy programme without code'},
    {id: 'p3', label: 'Certificate', name: 'Certificate'},
    {id: 'p4'},
  ]}), 'programmeId');
  assert.match(html, /BSC - Bachelor of Science in Information &amp; Communication Technology/);
  assert.match(html, />Legacy programme without code<\/option>/);
  assert.match(html, />Certificate<\/option>/);
  assert.match(html, />p4<\/option>/);
  assert.equal((html.match(/<option /g) || []).length, 5);
});

test('academic dropdowns explain empty lists and distinguish optional choices', () => {
  assert.match(field(render('intakes'), 'programmeId'), /No programme options available/);
  assert.match(field(render('gpa'), 'gradingSchemeId'), /No grading scheme options available/);
  const html = render('organization', {organization: [{id: 'f1', code: 'SCI', name: 'Science', unitType: 'faculty', status: 'active'}]});
  assert.match(field(html, 'parentId'), /<option value="">None<\/option>/);
});

test('editing a programme preserves its selected department', () => {
  const programme = {id: 'p1', code: 'BSC', name: 'Science', departmentId: 'd2', status: 'active'};
  const html = render('programmes', {programmes: [programme], organization: [
    {id: 'd1', code: 'A', name: 'First department', unitType: 'department', status: 'active'},
    {id: 'd2', code: 'B', name: 'Second department', unitType: 'department', status: 'active'},
  ]}, {selected: 'p1'});
  assert.match(field(html, 'departmentId'), /value="d2" selected>B - Second department/);
});
