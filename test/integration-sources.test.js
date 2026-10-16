import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureIntegrationSources, compareIntegrationSources } from '../scripts/integration-sources.js';

test('integration fingerprints are deterministic and changes, additions and removals invalidate the checkpoint',async () => {
  const root = await mkdtemp(join(tmpdir(),'svu-source-check-'));
  try {
    for (const directory of ['server','src','scripts','migrations','test','e2e']) await mkdir(join(root,directory));
    for (const path of ['index.html','package.json','package-lock.json','playwright.config.js','src/app.js']) await writeFile(join(root,path),'baseline');
    const before=await captureIntegrationSources(root),same=await captureIntegrationSources(root);
    assert.equal(before.digest,same.digest);assert.equal(before.fileCount,5);
    assert.equal(compareIntegrationSources(before,same).status,'passed');
    await writeFile(join(root,'src/app.js'),'changed');await writeFile(join(root,'migrations/new.sql'),'added');await rm(join(root,'index.html'));
    // A required root file disappearing fails capture rather than producing a partial manifest.
    await assert.rejects(captureIntegrationSources(root),{code:'ENOENT'});
    await writeFile(join(root,'index.html'),'baseline');await rm(join(root,'src/app.js'));
    const after=await captureIntegrationSources(root),result=compareIntegrationSources(before,after);
    assert.equal(result.status,'failed');assert.deepEqual(result.changed,['migrations/new.sql','src/app.js']);
    await writeFile(join(root,'src/app.js'),'changed');
    const edited=compareIntegrationSources(before,await captureIntegrationSources(root));assert.deepEqual(edited.changed,['migrations/new.sql','src/app.js']);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('generated evidence outside the source roots does not change source fingerprints',async () => {
  const root=await mkdtemp(join(tmpdir(),'svu-source-evidence-'));
  try {
    for(const directory of ['server','src','scripts','migrations','test','e2e','data','docs'])await mkdir(join(root,directory));
    for(const path of ['index.html','package.json','package-lock.json','playwright.config.js'])await writeFile(join(root,path),'baseline');
    const before=await captureIntegrationSources(root);await writeFile(join(root,'data/run.json'),'generated');await writeFile(join(root,'docs/status.md'),'coordination');
    assert.equal(compareIntegrationSources(before,await captureIntegrationSources(root)).status,'passed');
  }finally {await rm(root,{recursive:true,force:true});}
});
