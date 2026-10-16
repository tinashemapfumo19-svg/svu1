import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const directories = ['server','src','scripts','migrations','test','e2e'];
const rootFiles = ['index.html','package.json','package-lock.json','playwright.config.js'];

export async function captureIntegrationSources(root = resolve('.')) {
  const files = [];
  async function visit(relative) {
    const path = join(root,relative),stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error(`Integration source fingerprint refuses symbolic links: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await visit(`${relative}/${name}`);
    } else if (stat.isFile()) files.push({path:relative,sha256:createHash('sha256').update(await readFile(path)).digest('hex')});
  }
  for (const directory of directories) await visit(directory);
  for (const file of rootFiles) await visit(file);
  files.sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return {algorithm:'sha256',fileCount:files.length,digest:createHash('sha256').update(JSON.stringify(files)).digest('hex'),files};
}

export function compareIntegrationSources(before,after) {
  const old = new Map(before.files.map((file) => [file.path,file.sha256]));
  const current = new Map(after.files.map((file) => [file.path,file.sha256]));
  const changed = [...new Set([...old.keys(),...current.keys()])].filter((path) => old.get(path) !== current.get(path)).sort();
  return {status:changed.length ? 'failed' : 'passed',algorithm:'sha256',before:before.digest,after:after.digest,fileCount:after.fileCount,changed};
}
