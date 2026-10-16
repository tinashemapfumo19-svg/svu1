import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function fixture(permissions = []) {
  let authenticated = true;
  const granted = new Set(permissions);
  const document = { addEventListener() {}, querySelector() { return null; } };
  const window = { addEventListener() {}, svuSession: {
    get: () => authenticated ? { token: 'test' } : null,
    cached: () => authenticated ? { permissions: [...granted] } : null,
    can: code => granted.has(code),
    canAny: codes => codes.some(code => granted.has(code) || code.endsWith('.*') && [...granted].some(value => value.startsWith(code.slice(0, -1)))),
    onChange() {}
  }, studentUI: { spaceLink: space => space === 'study' ? '#study/today' : '#office/overview', searchItems: () => [{ title: 'Results', detail: 'Study', href: '#study/results' }] } };
  vm.runInNewContext(readFileSync('src/shell.js', 'utf8'), { window, document });
  return { shell: window.svuShell, granted, logout: () => { authenticated = false; } };
}
test('staff command destinations reflect current permissions and do not expose ungranted work areas', () => {
  const f = fixture(['registry.view']);
  let items = f.shell.commandItems();
  assert.ok(items.some(item => item.href === '#registry/students'));
  assert.ok(!items.some(item => item.href === '#registry/finance'));
  assert.ok(!items.some(item => item.href === '#admissions'));
  f.granted.add('finance.view');
  assert.ok(f.shell.commandItems().some(item => item.href === '#registry/finance'));
  f.granted.delete('registry.view');
  assert.ok(!f.shell.commandItems().some(item => item.href === '#registry/students'));
  f.logout();
  assert.equal(f.shell.commandItems().length, 0);
});
test('student command destinations include their academic pages without staff or system destinations', () => {
  const f = fixture(['registry.self']);
  const items = f.shell.commandItems();
  assert.ok(items.some(item => item.href === '#study/results'));
  assert.ok(!items.some(item => item.href.startsWith('#registry/')));
  assert.ok(!items.some(item => item.href === '#foundation'));
  assert.equal(new Set(items.map(item => item.href)).size, items.length);
});
test('generated shared icons are local, bounded and decorative', () => {
  const window = {};
  vm.runInNewContext(readFileSync('src/ui-icons.js', 'utf8'), { window });
  assert.ok(Object.isFrozen(window.svuIcons));
  for (const value of Object.values(window.svuIcons)) {
    assert.match(value, /class="lucide /);
    assert.match(value, /aria-hidden="true"/);
    assert.match(value, /focusable="false"/);
    assert.doesNotMatch(value, /script|https?:|onclick/);
  }
  assert.notEqual(window.svuIcons.inbox, window.svuIcons.support);
  assert.notEqual(window.svuIcons.wallet, window.svuIcons.bank);
});
