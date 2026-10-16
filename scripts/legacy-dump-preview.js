import { readFile, lstat } from 'node:fs/promises';
import { previewLegacyDump } from './legacy-dump-reader.js';

try {
  if (process.argv.length !== 3) throw new Error('Usage: npm run legacy:preview -- archive.sql (read-only; no apply option).');
  const path = process.argv[2], info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 128 * 1024 * 1024) throw new Error('Preview requires a regular SQL archive no larger than 128 MiB.');
  const bytes = await readFile(path);
  console.log(JSON.stringify(previewLegacyDump(bytes), null, 2));
} catch (error) {
  // Filesystem errors can contain paths. Do not print source snippets or private locations.
  console.error(error.code ? 'Legacy dump preview could not read the archive.' : error.message);
  process.exitCode = 1;
}
