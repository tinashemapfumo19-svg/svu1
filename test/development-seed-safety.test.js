import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, link, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertDevelopmentSeed,databaseSeedTarget,jsonSeedTarget,assertRegularSeedPath } from '../scripts/development-seed-safety.js';

test('demo seed requires explicit development mode and refuses production/staging and conflicting modes',() => {
  for(const env of [{},{SVU_ENV:'production'},{NODE_ENV:'production'},{SVU_ENV:'staging'},{SVU_ENV:'development',NODE_ENV:'production'},{SVU_ENV:'production',NODE_ENV:'development'},{NODE_ENV:'test'}])assert.throws(() => assertDevelopmentSeed(env));
  for(const env of [{SVU_ENV:'development'},{NODE_ENV:'development'},{SVU_ENV:'development',NODE_ENV:'test'}])assert.doesNotThrow(() => assertDevelopmentSeed(env));
});

test('PostgreSQL acknowledgement is exact, single-use and limited to local non-system destinations',() => {
  const url='postgres://user:secret@127.0.0.1:5433/svu_rebuild';
  assert.equal(databaseSeedTarget(url,['--reset-database','svu_rebuild']),'svu_rebuild');
  for(const args of [[],['--reset-database'],['--reset-database','other'],['--reset-database','svu_rebuild','extra'],['--reset-database=svu_rebuild']])assert.throws(() => databaseSeedTarget(url,args));
  for(const db of ['postgres','template0','template1','bad%3Bname'])assert.throws(() => databaseSeedTarget(`postgres://localhost/${db}`,['--reset-database',db]));
  for(const host of ['example.com','127.0.0.2','localhost.example.com'])assert.throws(() => databaseSeedTarget(`postgres://${host}/svu_rebuild`,['--reset-database','svu_rebuild']));
  assert.throws(() => databaseSeedTarget('https://localhost/svu_rebuild',['--reset-database','svu_rebuild']));
  assert.throws(() => databaseSeedTarget(`${url}?host=remote.example`,['--reset-database','svu_rebuild']),/overrides/);
  assert.throws(() => databaseSeedTarget('postgres://user:secret@localhost:invalid/svu_rebuild',['--reset-database','svu_rebuild']),error => !String(error).includes('secret') && /Invalid PostgreSQL/.test(error.message));
});

test('JSON acknowledgement is exact and rejects traversal, devices, alternate streams and non-JSON paths',() => {
  assert.equal(jsonSeedTarget('data/dev-store.json',['--reset-file','data/dev-store.json']),resolve('data/dev-store.json'));
  assert.throws(() => jsonSeedTarget('data/dev-store.json',[]));
  assert.throws(() => jsonSeedTarget('data/dev-store.json',['--reset-file','data/other.json']));
  for(const path of ['../outside.json','data/../outside.json','data/file.js','data/CON.json','data/NUL.json','data/dev.json:stream.json','data'])assert.throws(() => jsonSeedTarget(path,['--reset-file',path]));
});

test('JSON path checks refuse hard links/non-files, preserve bytes and permit a fresh contained target',async () => {
  const root=await mkdtemp(join(tmpdir(),'svu-seed-path-'));
  try {
    await mkdir(join(root,'data'));await writeFile(join(root,'original.json'),'sentinel');await link(join(root,'original.json'),join(root,'data','linked.json'));
    await assert.rejects(assertRegularSeedPath(join(root,'data','linked.json'),root),/links/);
    assert.equal(await readFile(join(root,'original.json'),'utf8'),'sentinel');
    await assert.rejects(assertRegularSeedPath(join(root,'data'),root),/non-regular/);
    await assertRegularSeedPath(join(root,'data','fresh.json'),root);
    await assert.rejects(assertRegularSeedPath(join(root,'outside','..','..','out.json'),root),/outside/);
  }finally {await rm(root,{recursive:true,force:true});}
});

test('native seed CLIs refuse unsafe inputs before any database connection or filesystem replacement',async () => {
  const root=await mkdtemp(join(tmpdir(),'svu-seed-cli-'));
  try {
    const target=join(root,'protected.json');await writeFile(target,'sentinel');
    const env={...process.env,SVU_ENV:'production',NODE_ENV:'production',DATABASE_URL:'postgres://127.0.0.1:1/never_connect',SVU_DATA_FILE:target};
    for(const script of ['scripts/seed-postgres.js','scripts/seed.js']) {
      const result=spawnSync(process.execPath,[script],{env,encoding:'utf8'});assert.equal(result.status,1);assert.match(result.stderr,/explicit development/);assert.doesNotMatch(result.stderr,/ECONNREFUSED|secret/);
    }
    for(const args of [[],['--reset-database','wrong']]) {
      const result=spawnSync(process.execPath,['scripts/seed-postgres.js',...args],{env:{...env,SVU_ENV:'development',NODE_ENV:'development'},encoding:'utf8'});
      assert.equal(result.status,1);assert.doesNotMatch(result.stderr,/ECONNREFUSED/);assert.match(result.stderr,/acknowledge|acknowledgement/);
    }
    const file=spawnSync(process.execPath,['scripts/seed.js','--reset-file',target],{env:{...env,SVU_ENV:'development',NODE_ENV:'development'},encoding:'utf8'});
    assert.equal(file.status,1);assert.match(file.stderr,/inside workspace data/);assert.equal(await readFile(target,'utf8'),'sentinel');
  }finally {await rm(root,{recursive:true,force:true});}
});

test('native JSON seed acknowledges atomic replacement and refuses a junction without changing its destination',async () => {
  const dataRoot=resolve('data');await mkdir(dataRoot,{recursive:true});
  const root=await mkdtemp(join(dataRoot,'seed-safety-')),target=join(root,'store.json'),junction=join(root,'redirect');let linked=false;
  // The generated directory is verified inside workspace/data before recursive cleanup.
  jsonSeedTarget(target,['--reset-file',target]);
  const env={...process.env,SVU_ENV:'development',NODE_ENV:'development',SVU_DATA_FILE:target};
  try {
    await writeFile(target,'sentinel');
    const seeded=spawnSync(process.execPath,['scripts/seed.js','--reset-file',target],{env,encoding:'utf8'});
    assert.equal(seeded.status,0,seeded.stderr);assert.equal(JSON.parse(await readFile(target,'utf8')).schemaVersion,1);
    assert.deepEqual(await readdir(root),['store.json']);
    await mkdir(join(root,'real'));await writeFile(join(root,'real','store.json'),'protected');
    await symlink(join(root,'real'),junction,'junction');linked=true;
    const redirected=join(junction,'store.json');
    const denied=spawnSync(process.execPath,['scripts/seed.js','--reset-file',redirected],{env:{...env,SVU_DATA_FILE:redirected},encoding:'utf8'});
    assert.equal(denied.status,1);assert.match(denied.stderr,/refuses links/);assert.equal(await readFile(join(root,'real','store.json'),'utf8'),'protected');
  }finally {if(linked)await unlink(junction);await rm(root,{recursive:true,force:true});}
});
