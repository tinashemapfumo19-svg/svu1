import {lstat,readFile,readdir,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {acceptedLanguages,catalogue,compareCatalogue} from './legacy-chat-locales-reader.js';

const workspace=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function regularFile(path,root) {
  try {const info=await lstat(path);if(info.isSymbolicLink() || !info.isFile() || info.size>256*1024)throw new Error('Not a bounded regular source file.');
    const actual=await realpath(path);if(!actual.startsWith(root+sep))throw new Error('Source resolves outside the public bundle.');return readFile(path);
  }catch(error){if(error.code==='ENOENT')return null;throw error;}
}

export async function previewLocales(base=join(workspace,'_legacy_php_system')) {
  if((await lstat(base)).isSymbolicLink())throw new Error('Archive root symlinks are not allowed.');
  const bundles=[];
  for(const name of ['chat','chatbox']){
    const directory=join(base,name),root=await realpath(directory);if((await lstat(directory)).isSymbolicLink())throw new Error('Bundle symlinks are not allowed.');
    if((await lstat(join(directory,'src'))).isSymbolicLink())throw new Error('Source directory symlinks are not allowed.');
    const configuration=await regularFile(join(directory,'src','pfci18n.class.php'),root);if(!configuration)throw new Error('Missing public locale initializer.');
    const accepted=acceptedLanguages(configuration),folder=join(directory,'i18n');if((await lstat(folder)).isSymbolicLink() || !(await realpath(folder)).startsWith(root+sep))throw new Error('Locale directory escapes the public bundle.');
    const children=await readdir(folder,{withFileTypes:true});if(children.some(entry=>entry.isSymbolicLink()))throw new Error('Locale symlinks are not allowed.');
    const directories=children.filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort();
    if(directories.length>64 || directories.some(code=>!/^[a-z]{2,3}(?:_[A-Z]{2,3})?(?:-(?:formal|informal))?$/.test(code)))throw new Error('Unsupported locale directories.');
    const english={};for(const type of ['main','admin']){const bytes=await regularFile(join(folder,'en_US',`${type}.php`),root);if(!bytes){if(type==='main')throw new Error('Missing English main source.');continue;}english[type]=catalogue(bytes);}
    const locales=[],inventory=[{path:'src/pfci18n.class.php',sha256:createHash('sha256').update(configuration).digest('hex')}];
    for(const code of [...new Set([...directories,...accepted])].sort()){
      const item={code,accepted:accepted.includes(code),packaged:directories.includes(code),catalogues:{}};
      for(const type of ['main','admin']){
        const path=join(folder,code,`${type}.php`),bytes=await regularFile(path,root);
        if(!bytes){item.catalogues[type]={status:'missing'};continue;}
        const sha256=createHash('sha256').update(bytes).digest('hex');inventory.push({path:`i18n/${code}/${type}.php`,sha256});
        try {const current=catalogue(bytes);item.catalogues[type]=english[type]?{status:'recognized',sha256,...compareCatalogue(current,english[type])}:{status:'recognized-without-English-baseline',sha256,entries:current.entries.length,uniqueKeys:current.values.size,duplicates:current.duplicates};}catch(error){item.catalogues[type]={status:'refused',sha256,error:error.message};}
      }
      locales.push(item);
    }
    inventory.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
    bundles.push({name,accepted,packaged:directories,englishBaselines:Object.keys(english),locales,inventory,digest:digest(inventory)});
  }
  const identical=bundles[0].digest===bundles[1].digest;
  const reviewRequired=!identical || bundles.some(bundle=>bundle.locales.some(locale=>locale.accepted && (locale.catalogues.main.status!=='recognized' || ['duplicates','missing','empty','formatIssues','markup'].some(key=>locale.catalogues.main[key]?.length)) || Object.values(locale.catalogues).some(value=>value.status==='refused' || value.status==='recognized-without-English-baseline')));
  return {mode:'read-only literal-source preview',phpExecuted:false,translationImported:false,identicalBundles:identical,reviewRequired,bundles};
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv.length!==2){console.error('Usage: node scripts/legacy-chat-locales-preview.js');process.exitCode=1;}
  else try {const report=await previewLocales();console.log(JSON.stringify(report,null,2));process.exitCode=!report.identicalBundles?1:report.reviewRequired?2:0;}catch(error){console.error(error.message);process.exitCode=1;}
}
