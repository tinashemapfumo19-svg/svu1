import { lstat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep, dirname } from 'node:path';

export function assertDevelopmentSeed(env = process.env) {
  const mode = env.SVU_ENV || env.NODE_ENV;
  if (mode !== 'development' || env.NODE_ENV && !['development','test'].includes(env.NODE_ENV)) {
    throw new Error('Demo seeding requires explicit development mode and is forbidden in production/staging.');
  }
}

function acknowledged(args,flag) {
  if (args.length !== 2 || args[0] !== flag || !args[1]) throw new Error(`Demo seeding destroys target data. Supply ${flag} followed by the exact target to acknowledge the reset.`);
  return args[1];
}

export function databaseSeedTarget(databaseUrl,args) {
  let url,database;
  try {url=new URL(databaseUrl);database=decodeURIComponent(url.pathname.slice(1));}catch {throw new Error('Invalid PostgreSQL connection URL for demo seeding.');}
  if(url.search || url.hash)throw new Error('Demo seed connection URLs cannot contain parameter or fragment overrides.');
  if (!['postgres:','postgresql:'].includes(url.protocol) || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) || !/^[a-z][a-z0-9_]{0,62}$/.test(database) || ['postgres','template0','template1'].includes(database)) {
    throw new Error('Demo seeding requires a named non-system database on a loopback PostgreSQL server.');
  }
  if (acknowledged(args,'--reset-database') !== database) throw new Error('Reset acknowledgement does not match the configured database.');
  return database;
}

export function jsonSeedTarget(dataFile,args,root = process.cwd()) {
  const dataRoot = resolve(root,'data'),target = resolve(root,dataFile),within = relative(dataRoot,target);
  if (!within || isAbsolute(within) || within.startsWith(`..${sep}`) || within === '..' || !within.endsWith('.json') || within.split(sep).some((part) => !/^[a-zA-Z0-9_.-]+$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error('Demo JSON seed target must be a regular .json path inside workspace data, without device names or alternate streams.');
  }
  if (resolve(root,acknowledged(args,'--reset-file')) !== target) throw new Error('Reset acknowledgement does not match the configured JSON file.');
  return target;
}

export async function assertRegularSeedPath(target,root = process.cwd()) {
  // Check the workspace/data ancestors too: a data symlink must not redirect writes outside it.
  const paths = [];
  for (let path=target;;path=dirname(path)) {paths.push(path);if(path===resolve(root))break;if(dirname(path)===path)throw new Error('JSON seed target is outside the workspace.');}
  for (const path of paths.reverse()) {
    let stat;
    try {stat=await lstat(path);}catch(error){if(error.code==='ENOENT')continue;throw error;}
    if(stat.isSymbolicLink() || path===target && (!stat.isFile() || stat.nlink>1) || path!==target && !stat.isDirectory()) throw new Error('Demo JSON seed refuses links or non-regular target paths.');
  }
}
