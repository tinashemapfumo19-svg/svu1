import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryTarget,schemaDigest,captureRecoveryTables,captureRecoveryTableDefinitions,compareRecoveryTables,withOwnedRecoveryDatabase } from '../scripts/recovery-verification.js';

test('recovery targets cannot name source/system/unsafe databases and default names are unique',() => {
  for (const name of ['svu_rebuild','postgres','template0','template1','svu_restore_x;drop database postgres','svu_restore_'+ 'x'.repeat(60)]) assert.throws(() => recoveryTarget('svu_rebuild',name));
  assert.throws(() => recoveryTarget('svu_restore_source','svu_restore_source'));
  assert.equal(recoveryTarget('svu_rebuild','svu_restore_control'),'svu_restore_control');
  assert.notEqual(recoveryTarget('svu_rebuild'),recoveryTarget('svu_rebuild'));
});

test('create-only recovery never drops a pre-existing target and cleans up success or failed restore',async () => {
  const calls=[];
  await assert.rejects(withOwnedRecoveryDatabase({query:async sql => {calls.push(sql);throw new Error('already exists');}},'svu_restore_existing',() => assert.fail('must not restore')));
  assert.equal(calls.length,1);assert.match(calls[0],/^create database/);
  for (const fails of [false,true]) {
    calls.length=0;const client={query:async sql => calls.push(sql)};
    const job=withOwnedRecoveryDatabase(client,'svu_restore_owned',async () => {if(fails)throw new Error('restore failed');return 42;});
    if(fails)await assert.rejects(job,/restore failed/);else assert.equal(await job,42);
    assert.deepEqual(calls,['create database "svu_restore_owned" template template0','drop database "svu_restore_owned" with (force)']);
  }
});

test('schema fingerprints ignore restriction randomness but preserve definition changes',() => {
  assert.equal(schemaDigest('\\restrict ABC\ncreate table t(id int);\n\\unrestrict ABC\n'),schemaDigest('\\restrict XYZ\ncreate table t(id int);\n\\unrestrict XYZ\n'));
  assert.notEqual(schemaDigest('create table t(id int);'),schemaDigest('create table t(id text);'));
});

test('schema checks use structured table definitions without weakening columns, defaults or other objects',() => {
  const header='--\n-- Name: t; Type: TABLE; Schema: public; Owner: postgres\n';
  const table={schema:'public',name:'t',owner:'postgres',columns:[{name:'id',type:'integer',notNull:true}],checks:[{name:'a',definition:'CHECK (id > 0)'},{name:'b',definition:'CHECK (id < 10)'}]};
  const first=header+'CREATE TABLE t (id integer, CONSTRAINT a CHECK (id > 0), CONSTRAINT b CHECK (id < 10));\n';
  const restored=header+'CREATE TABLE t (id integer, CONSTRAINT b CHECK (id < 10), CONSTRAINT a CHECK (id > 0));\n';
  assert.equal(schemaDigest(first,[table]),schemaDigest(restored,[table]));
  assert.notEqual(schemaDigest(first,[table]),schemaDigest(restored,[{...table,columns:[{name:'id',type:'text'}]}]));
  assert.notEqual(schemaDigest(first,[table]),schemaDigest(restored,[{...table,checks:[{name:'a',definition:'CHECK (id > 1)'}]}]));
  assert.notEqual(schemaDigest(first+'--\n-- Name: f; Type: FUNCTION; Schema: public; Owner: postgres\nFUNCTION first',[table]),schemaDigest(restored+'--\n-- Name: f; Type: FUNCTION; Schema: public; Owner: postgres\nFUNCTION changed',[table]));
});

test('content comparison detects missing/extra/changed rows and empty-schema differences',() => {
  const row={schema:'public',name:'schema_migrations',kind:'r',count:0,digest:'abc'};
  assert.equal(compareRecoveryTables([row],[{...row}]).status,'passed');
  for(const next of [[],[{...row,count:1}],[{...row,digest:'changed'}],[{...row,kind:'m'}],[row,{...row,name:'extra'}]])assert.equal(compareRecoveryTables([row],next).status,'failed');
});

test('table capture streams bounded cursor batches, quotes identifiers, and rejects unsupported sources',async () => {
  const calls=[];let fetches=0;
  const client={query:async sql => {
    calls.push(sql);
    if(sql.includes('from pg_class'))return {rows:[{schema:'public',name:'schema_migrations',kind:'r'},{schema:'odd"schema',name:'odd"table',kind:'r'}]};
    if(sql.startsWith('fetch'))return {rows:fetches++ === 0 ? Array.from({length:500},() => ({row:'{"id":1}'})) : []};
    return {rows:[]};
  }};
  const captured=await captureRecoveryTables(client);assert.equal(captured[0].count,500);assert.equal(captured[1].count,0);assert.equal(captured[0].digest.length,64);
  assert.ok(calls.some(sql => sql.includes('only "odd""schema"."odd""table"')));assert.equal(calls.filter(sql => sql === 'close recovery_rows').length,2);
  await assert.rejects(captureRecoveryTables({query:async () => ({rows:[]})}),/migration ledger/);
  await assert.rejects(captureRecoveryTables({query:async () => ({rows:[{kind:'f'}]})}),/Foreign-table/);
  await assert.rejects(captureRecoveryTables({query:async () => ({rows:[{present:true}]})}),/Large objects/);
});

test('sequence verification keeps next-value state and omits non-restorable log bookkeeping',async () => {
  const calls=[];
  await captureRecoveryTables({query:async sql => {
    calls.push(sql);
    if(sql.includes('from pg_class'))return {rows:[{schema:'public',name:'schema_migrations',kind:'r'},{schema:'public',name:'counter',kind:'S'}]};
    return {rows:[]};
  }});
  assert.ok(calls.some(sql => sql.includes("jsonb_build_object('last_value',last_value,'is_called',is_called)")));
  assert.ok(calls.every(sql => !sql.includes('log_cnt')));
});

test('schema table definitions preserve constraints, column order/defaults, storage, inheritance and ownership',async () => {
  let query;
  await captureRecoveryTableDefinitions({query:async sql => {query=sql;return {rows:[]};}});
  for(const part of ['pg_get_constraintdef(k.oid,true)','k.convalidated','k.connoinherit','order by a.attnum','pg_get_expr(d.adbin,d.adrelid)','a.attstattarget','c.relrowsecurity','c.relforcerowsecurity','pg_get_userbyid(c.relowner)','pg_inherits','c.relpartbound','pg_get_partkeydef(c.oid)'])assert.ok(query.includes(part),part);
});

test('cursor failures refuse partial contents and still attempt closure',async () => {
  const calls=[];
  await assert.rejects(captureRecoveryTables({query:async sql => {
    calls.push(sql);
    if(sql.includes('from pg_class'))return {rows:[{schema:'public',name:'schema_migrations',kind:'r'}]};
    if(sql.startsWith('fetch'))throw new Error('read failed');
    return {rows:[]};
  }}),/read failed/);
  assert.equal(calls.at(-1),'close recovery_rows');
});
