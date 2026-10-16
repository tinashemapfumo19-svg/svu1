import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {previewLocales} from '../scripts/legacy-chat-locales-preview.js';
import {catalogue,acceptedLanguages,compareCatalogue,formatSignature,sourceText} from '../scripts/legacy-chat-locales-reader.js';
const bytes=value=>Buffer.from(value);
const entry=(key,value)=>`$GLOBALS["i18n"][${JSON.stringify(key)}]=${JSON.stringify(value)};`;
const list=value=>bytes(`/*<GetAcceptedLanguage>*/array(${value});/*</GetAcceptedLanguage>*/`);

test('locale recognizer accepts only bounded UTF-8 literal catalogues without interpreting code',()=>{
  const value=catalogue(bytes(`<?php /* comment */ ${entry('First','Value')} // comment\n${entry('Second','Next')} ?>`));assert.equal(value.values.get('First'),'Value');assert.equal(value.entries.length,2);
  for(const value of ['<?php include "private.php";','<?php '+entry('A','B')+'echo "run";','<?php $GLOBALS["secret"]["A"]="B";','<?php $GLOBALS["i18n"]["A"]=getenv("TOKEN");','<?php $GLOBALS["i18n"]["A"]="${secret}";','<?php '+entry('A','B')+'?> <script>run()</script>','<?php '+entry('A','B')+'?> /* not a PHP comment */','<?php /* missing','<?php'])assert.throws(()=>catalogue(bytes(value)),/No PHP was executed/);
  assert.throws(()=>sourceText(Buffer.from([0xff])),/UTF-8/);assert.throws(()=>sourceText(bytes('\0')),/NUL/);assert.throws(()=>sourceText(Buffer.alloc(256*1024+1)),/bounded/);
});
test('literal escapes preserve PHP single/double-quoted behavior and refuse interpolation/NUL',()=>{
  const value=catalogue(bytes(String.raw`<?php $GLOBALS['i18n']['it\'s']='\n\\'; $GLOBALS["i18n"]["escapes"]="\n\t\x41\101\$\q";`));
  assert.equal(value.values.get("it's"),'\\n\\');assert.equal(value.values.get('escapes'),'\n\tAA$\\q');
  assert.equal(catalogue(bytes(String.raw`<?php $GLOBALS["i18n"]["accent"]="\xc3\xa9";`)).values.get('accent'),'\u00e9');
  assert.throws(()=>catalogue(bytes(String.raw`<?php $GLOBALS["i18n"]["A"]="\xff";`)),/UTF-8/);
  for(const value of [String.raw`<?php $GLOBALS["i18n"]["A"]="\000";`,String.raw`<?php $GLOBALS["i18n"]["A"]="\u{41}";`])assert.throws(()=>catalogue(bytes(value)));
});
test('accepted locale marker validates the literal list, duplicates, identifiers and fallback',()=>{
  assert.deepEqual(acceptedLanguages(list("'en_US','fr_FR','eo','de_DE-formal'")),['en_US','fr_FR','eo','de_DE-formal']);
  for(const value of ["'fr_FR'","'en_US','en_US'","'en_US','../private'","'en_US',getenv('LANG')","'en_US');echo 'run';array('fr_FR'"])assert.throws(()=>acceptedLanguages(list(value)));
  assert.throws(()=>acceptedLanguages(bytes(String(list("'en_US'"))+String(list("'en_US'")))),/ambiguous/);
});
test('catalogue comparison retains duplicate evidence and separates missing, empty, extra and unchanged English',()=>{
  const english=catalogue(bytes('<?php '+entry('One','One')+entry('Two','Two')+entry('Three','Three'))),current=catalogue(bytes('<?php '+entry('One','Un')+entry('One','One')+entry('Two','')+entry('Extra','Extra'))),report=compareCatalogue(current,english);
  assert.equal(report.entries,4);assert.equal(report.uniqueKeys,3);assert.equal(report.duplicates.length,1);assert.deepEqual(report.missing,['Three']);assert.deepEqual(report.empty,['Two']);assert.deepEqual(report.extra,['Extra']);assert.equal(report.identicalEnglish,1);assert.equal(current.values.get('One'),'One');
});
test('format signatures account for escaped percent, positional ordering, types and bounded unsupported cases',()=>{
  assert.equal(formatSignature('%s %d %%'),'1:s,2:d');assert.equal(formatSignature('%2$d %1$s'),'1:s,2:d');
  for(const value of ['%','%n','%0$s','%65$s',"%'x10s"])assert.throws(()=>formatSignature(value));
  const english=catalogue(bytes('<?php '+entry('%s count %d','%s count %d')+entry('Markup','Markup'))),current=catalogue(bytes('<?php '+entry('%s count %d','%s count %s')+entry('Markup','<script>never run</script>'))),report=compareCatalogue(current,english);assert.equal(report.formatIssues.length,1);assert.deepEqual(report.markup,['Markup']);
  const empty=compareCatalogue(catalogue(bytes('<?php '+entry('%s count %d',''))),english);assert.equal(empty.empty.length,1);assert.equal(empty.formatIssues.length,0);
});
test('supplied archive and real CLI pin public source integrity and report review findings without changing files',async()=>{
  const before=await previewLocales();assert.equal(before.identicalBundles,true);assert.equal(before.reviewRequired,true);
  for(const bundle of before.bundles){assert.equal(bundle.accepted.length,39);assert.equal(bundle.packaged.length,42);assert.equal(bundle.inventory.length,43);assert.equal(bundle.digest,'1449b258559627b3f9be3a40715f9ac4339fd530799c57aee9d9d6766c775848');assert.deepEqual(bundle.englishBaselines,['main']);assert.ok(bundle.locales.every(locale=>locale.catalogues.main.status==='recognized' && locale.catalogues.admin.status==='missing'));
    assert.deepEqual(bundle.locales.filter(locale=>!locale.accepted).map(locale=>locale.code),['ca_CAT','cs_CZ','mk_MK']);assert.equal(bundle.locales.find(locale=>locale.code==='en_US').catalogues.main.uniqueKeys,125);assert.equal(bundle.locales.find(locale=>locale.code==='hu_HU').catalogues.main.duplicates.length,2);
  }
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/legacy-chat-locales-preview.js',import.meta.url))],{encoding:'utf8',maxBuffer:4*1024*1024,timeout:120000});assert.equal(result.status,2,result.stderr);const report=JSON.parse(result.stdout);assert.equal(report.phpExecuted,false);assert.equal(report.translationImported,false);assert.deepEqual(report,before);
  assert.deepEqual(await previewLocales(),before);
  const invalid=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/legacy-chat-locales-preview.js',import.meta.url)),'--import'],{encoding:'utf8',timeout:10000});assert.equal(invalid.status,1);assert.match(invalid.stderr,/Usage:/);assert.equal(invalid.stdout,'');
});
