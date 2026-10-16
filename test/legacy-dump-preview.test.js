import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { previewLegacyDump } from '../scripts/legacy-dump-reader.js';

const schema = 'CREATE TABLE IF NOT EXISTS `records` (`id` int(11) NOT NULL, `body` longtext, PRIMARY KEY (`id`), KEY `body_prefix` (`body`(10))) ENGINE=InnoDB;';
const preview = (sql) => previewLegacyDump(Buffer.from(sql));

test('literal dump preview counts rows, multiple inserts and subset columns without retaining values', () => {
  const bytes = Buffer.from(`-- archive\nSET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";\n${schema}
    INSERT INTO records (id,body) VALUES (1,'PRIVATE_VALUE; (,\\\'quote\\\')'),(2,'another ''quote''');
    INSERT INTO records (id) VALUES (-3);
    CREATE TABLE empty_records (id int, value decimal(10,2));`);
  const report = previewLegacyDump(bytes);
  assert.deepEqual(report.totals, { tables: 2, columns: 4, rows: 3, insertStatements: 2, statements: 5, settings: 1 });
  assert.equal(report.applied, false); assert.equal(report.valuesIncluded, false);
  assert.equal(report.source.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(report.source.bytes, bytes.length);
  assert.deepEqual(report.tables.find((table) => table.name === 'records'), {
    name: 'records', columns: [{name:'id',type:'int'},{name:'body',type:'longtext'}], primaryKey:['id'], rows:3, insertStatements:2
  });
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_VALUE|another|quote/);
});

test('quoted delimiters, multiline values, backslash escapes, nulls and hex values do not inflate totals', () => {
  const report = preview(`${schema} INSERT INTO records VALUES (1,'line\n-- comment; (2,3)\\\\'),(+2,0xABCDEF),(3,NULL),(4,_binary 'bytes'),(5,1.5e-2); # trailing comment\n`);
  assert.equal(report.totals.rows, 5);
  assert.equal(report.totals.insertStatements, 1);
  assert.equal(preview(`${schema} INSERT INTO records VALUES (1,"doubled ""quotation"" ; ( )");`).totals.rows, 1);
});

test('unsupported statements, executable commands and quoting modes fail closed', () => {
  for (const sql of [
    `${schema} DELETE FROM records;`, `${schema} UPDATE records SET body='PRIVATE_VALUE';`,
    `${schema} INSERT INTO records SELECT id,body FROM other;`,
    `${schema} INSERT IGNORE INTO records VALUES (1,'PRIVATE_VALUE');`,
    `${schema} INSERT INTO records VALUES (1,concat('PRIVATE_VALUE','x'));`,
    `${schema} INSERT INTO records VALUES (1,'PRIVATE_VALUE') ON DUPLICATE KEY UPDATE body='x';`,
    'CREATE TABLE records (id int) AS SELECT 1;',
    '/*!99999 INSERT INTO records VALUES (1,2) */;',
    `${schema} SET SQL_MODE='NO_BACKSLASH_ESCAPES';`,
    `${schema} SET SQL_MODE='ANSI_QUOTES';`,
    `${schema} SET SQL_MODE='${'X'.repeat(300)},ANSI_QUOTES';`,
    `${schema} SET SQL_MODE='NO_BACKSLASH_\\ESCAPES';`,
    `${schema} SET SQL_MODE=0x414e53495f51554f544553;`,
    `${schema} /*!40101 SET SQL_MODE='ANSI_QUOTES' */;`
  ]) assert.throws(() => preview(sql), (error) => !error.message.includes('PRIVATE_VALUE') && /No SQL was executed/.test(error.message));
});

test('supplied archives retain fingerprints and distinguish historical readable data from damaged primary data', async () => {
  const oldPath = '_legacy_php_system/southval_db -old.sql', primaryPath = '_legacy_php_system/southval_db2.sql';
  const old = await readFile(oldPath), primary = await readFile(primaryPath);
  const report = previewLegacyDump(old);
  assert.equal(report.source.sha256, 'dd5f04aa5fd2dd12f0db91c621b974bbe5d3a728ee29fca4e9ab1b0012ae3572');
  assert.deepEqual(report.totals, {tables:65,columns:505,rows:6439,insertStatements:75,statements:142,settings:2});
  assert.equal(createHash('sha256').update(primary).digest('hex'), '4c1151c68d98693e70aff65f437aaffea767e695fa8a1ff8ca62e642a47bc20c');
  assert.throws(() => previewLegacyDump(primary), (error) => error.byteOffset === 229379 && /line 873/.test(error.message));
  assert.deepEqual(await readFile(oldPath), old); assert.deepEqual(await readFile(primaryPath), primary);
});

test('malformed rows, unknown columns, missing schemas and truncated files cannot produce a report', () => {
  for (const sql of [
    `${schema} INSERT INTO records VALUES (1);`, `${schema} INSERT INTO records VALUES (1,'x',2);`,
    `${schema} INSERT INTO records (id,id) VALUES (1,2);`, `${schema} INSERT INTO records (missing) VALUES (1);`,
    'INSERT INTO records VALUES (1,2);', `${schema} INSERT INTO records VALUES (1,'unterminated`,
    `${schema} INSERT INTO records VALUES (1,'x')`, `${schema} INSERT INTO records VALUES (1,'x'),;`,
    `${schema} INSERT INTO records VALUES ;`, `${schema} ${schema}`, '/* truncated', '-- no tables'
  ]) assert.throws(() => preview(sql), /Legacy dump preview/);
});

test('binary corruption reports only location, never a partial success or record contents', () => {
  const sql = `${schema}\nINSERT INTO records VALUES (1,0xABCDEF${String.fromCharCode(3)}PRIVATE_VALUE);`;
  assert.throws(() => preview(sql), (error) => {
    assert.equal(error.byteOffset, Buffer.from(sql).indexOf(3));
    assert.match(error.message, /line 2/); assert.doesNotMatch(error.message, /PRIVATE_VALUE/); return true;
  });
});

test('CLI has no apply mode, preserves input bytes and emits only a value-free report', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'svu-legacy-preview-'));
  try {
    const file = join(dir, 'archive.sql'), input = Buffer.from(`${schema} INSERT INTO records VALUES (1,'PRIVATE_VALUE');`);
    await writeFile(file, input);
    const result = spawnSync(process.execPath, ['scripts/legacy-dump-preview.js',file], {encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).totals.rows, 1);
    assert.doesNotMatch(result.stdout, /PRIVATE_VALUE/);
    const apply = spawnSync(process.execPath, ['scripts/legacy-dump-preview.js',file,'--apply'], {encoding:'utf8'});
    assert.notEqual(apply.status, 0); assert.equal(apply.stdout, '');
    assert.deepEqual(await readFile(file), input);
  } finally { await rm(dir, {recursive:true,force:true}); }
});
