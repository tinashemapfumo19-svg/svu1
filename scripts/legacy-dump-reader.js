import { createHash } from 'node:crypto';

const identifier = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const fail = (line, reason) => { throw new Error(`Legacy dump preview: ${reason} at line ${line}. No SQL was executed.`); };

// This recognizer accepts the archive's literal phpMyAdmin dump format, not arbitrary SQL.
// Quoted values are consumed without retaining their contents in tokens or reports.
function* tokens(sql) {
  let i = 0, line = 1;
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) { if (c === '\n') line++; i++; continue; }
    if (c === '#' || (sql.startsWith('--', i) && /\s/.test(sql[i + 2] || '\n'))) {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (sql.startsWith('/*', i)) {
      const start = line, end = sql.indexOf('*/', i + 2);
      if (end < 0) fail(start, 'unterminated comment');
      if (sql[i + 2] === '!' && !/^\/\*!\d*\s*SET\b/i.test(sql.slice(i, Math.min(end, i + 100)))) fail(start, 'unsupported executable comment');
      if (sql[i + 2] === '!' && /\bSQL_MODE\b/i.test(sql.slice(i, end))) fail(start, 'unsupported executable quoting-mode setting');
      for (; i < end + 2; i++) if (sql[i] === '\n') line++;
      continue;
    }
    const start = line;
    if (c === "'" || c === '"' || c === '`') {
      const quote = c; let name = '', closed = false, mode = '', incompatibleMode = false;
      const trackMode = (character) => {
        mode = (mode + character).slice(-32);
        incompatibleMode ||= /NO_BACKSLASH_ESCAPES|ANSI_QUOTES/i.test(mode);
      };
      i++;
      while (i < sql.length) {
        const next = sql[i++];
        if (next === '\n') line++;
        if (next === '\\' && quote !== '`') {
          if (i >= sql.length) fail(start, 'unterminated quoted value');
          if (sql[i] === '\n') line++;
          trackMode(sql[i++]); continue;
        }
        if (next === quote) {
          if (sql[i] === quote) { i++; if (quote === '`') name += quote; else trackMode(quote); continue; }
          closed = true; break;
        }
        if (quote === '`') name += next;
        else trackMode(next);
      }
      if (!closed) fail(start, 'unterminated quoted value');
      if (quote === '`' && !identifier.test(name)) fail(start, 'unsupported identifier');
      yield quote === '`' ? { kind: 'identifier', value: name, line: start } : { kind: 'literal', incompatibleMode, line: start };
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(i));
    if (word) { i += word[0].length; yield { kind: 'word', value: word[0], line: start }; continue; }
    const number = /^(?:0x[0-9a-f]+|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)/i.exec(sql.slice(i));
    if (number) { i += number[0].length; yield { kind: 'number', line: start }; continue; }
    if ('(),;=.+-'.includes(c)) { i++; yield { kind: c, line: start }; continue; }
    const error = new Error(`Legacy dump preview: unsupported token at line ${start}. No SQL was executed.`);
    error.byteOffset = i;
    throw error;
  }
}

const is = (token, word) => token?.kind === 'word' && token.value.toUpperCase() === word;
const named = (token) => ['identifier', 'word'].includes(token?.kind) && identifier.test(token.value);

function groups(list, line) {
  const result = []; let depth = 0, current = [];
  for (const token of list) {
    if (token.kind === ',' && depth === 0) { if (!current.length) fail(line, 'empty definition'); result.push(current); current = []; continue; }
    current.push(token);
    if (token.kind === '(') depth++;
    if (token.kind === ')' && --depth < 0) fail(line, 'unbalanced definition');
  }
  if (depth || !current.length) fail(line, 'incomplete definition');
  result.push(current); return result;
}

function createTable(statement, tables) {
  const line = statement[0].line; let at = 2;
  if (is(statement[at], 'IF') && is(statement[at + 1], 'NOT') && is(statement[at + 2], 'EXISTS')) at += 3;
  const name = statement[at++];
  if (!named(name) || statement[at++]?.kind !== '(') fail(line, 'unsupported table definition');
  const key = name.value.toLowerCase();
  if (tables.has(key)) fail(line, 'duplicate table definition');
  let depth = 1, end = at;
  for (; end < statement.length; end++) {
    if (statement[end].kind === '(') depth++;
    if (statement[end].kind === ')' && --depth === 0) break;
  }
  if (depth) fail(line, 'incomplete table definition');
  let option = end + 1;
  while (option < statement.length) {
    if (is(statement[option], 'COMMENT')) {
      option++; if (statement[option]?.kind === '=') option++;
      if (statement[option++]?.kind !== 'literal') fail(line, 'invalid table comment');
      continue;
    }
    if (is(statement[option], 'DEFAULT')) option++;
    if (is(statement[option], 'CHARACTER') && is(statement[option + 1], 'SET')) option += 2;
    else if (['ENGINE', 'CHARSET', 'COLLATE', 'AUTO_INCREMENT'].some((word) => is(statement[option], word))) option++;
    else fail(line, 'unsupported table option');
    if (statement[option]?.kind === '=') option++;
    if (!['word', 'number'].includes(statement[option++]?.kind)) fail(line, 'invalid table option');
  }
  const columns = [], primaryKey = [];
  for (const definition of groups(statement.slice(at, end), line)) {
    if (is(definition[0], 'PRIMARY') && is(definition[1], 'KEY')) {
      if (definition[2]?.kind !== '(' || definition.at(-1)?.kind !== ')') fail(line, 'unsupported primary key');
      for (const part of groups(definition.slice(3, -1), line)) {
        if (part.length !== 1 || !named(part[0])) fail(line, 'unsupported primary key');
        primaryKey.push(part[0].value);
      }
    } else if (['KEY', 'UNIQUE', 'CONSTRAINT', 'INDEX', 'FULLTEXT', 'FOREIGN', 'CHECK'].some((word) => is(definition[0], word))) {
      continue;
    } else {
      if (!named(definition[0]) || definition[1]?.kind !== 'word') fail(line, 'unsupported column definition');
      if (columns.some((column) => column.name.toLowerCase() === definition[0].value.toLowerCase())) fail(line, 'duplicate column');
      columns.push({ name: definition[0].value, type: definition[1].value.toLowerCase() });
    }
  }
  if (!columns.length || primaryKey.some((name) => !columns.some((column) => column.name === name))) fail(line, 'invalid table columns');
  tables.set(key, { name: name.value, columns, primaryKey, rows: 0, insertStatements: 0 });
}

function insertRows(statement, tables) {
  const line = statement[0].line;
  if (!is(statement[1], 'INTO') || !named(statement[2])) fail(line, 'unsupported insert');
  const table = tables.get(statement[2].value.toLowerCase());
  if (!table) fail(line, 'insert has no preceding table definition');
  let at = 3, columns = table.columns.map((column) => column.name);
  if (statement[at]?.kind === '(') {
    const end = statement.findIndex((token, index) => index > at && token.kind === ')');
    if (end < 0) fail(line, 'incomplete insert columns');
    columns = groups(statement.slice(at + 1, end), line).map((part) => {
      if (part.length !== 1 || !named(part[0])) fail(line, 'unsupported insert column');
      return part[0].value;
    });
    at = end + 1;
  }
  if (new Set(columns).size !== columns.length || columns.some((name) => !table.columns.some((column) => column.name === name))) fail(line, 'unknown or duplicate insert column');
  if (!is(statement[at++], 'VALUES')) fail(line, 'only literal VALUES inserts are supported');
  let rows = 0;
  while (at < statement.length) {
    if (statement[at++]?.kind !== '(') fail(line, 'expected insert row');
    let count = 0;
    while (at < statement.length) {
      if (['+', '-'].includes(statement[at]?.kind)) {
        at++; if (statement[at]?.kind !== 'number') fail(line, 'invalid signed literal');
      }
      if (statement[at]?.kind === 'word' && /^_(?:binary|utf8|utf8mb4|latin1)$/i.test(statement[at].value)) at++;
      if (!['literal', 'number'].includes(statement[at]?.kind) && !is(statement[at], 'NULL')) fail(line, 'nonliteral insert value');
      at++; count++;
      if (statement[at]?.kind === ')') { at++; break; }
      if (statement[at++]?.kind !== ',') fail(line, 'invalid insert row');
    }
    if (statement[at - 1]?.kind !== ')' || count !== columns.length) fail(line, 'insert row column count mismatch');
    rows++;
    if (at < statement.length && statement[at++]?.kind !== ',') fail(line, 'unsupported insert suffix');
    if (at === statement.length && statement[at - 1]?.kind === ',') fail(line, 'incomplete insert rows');
  }
  if (!rows) fail(line, 'empty insert');
  table.rows += rows; table.insertStatements++;
}

export function previewLegacyDump(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError('Preview requires the original dump bytes.');
  if (bytes.length > 128 * 1024 * 1024) throw new Error('Legacy dump preview exceeds the 128 MiB input limit.');
  const sql = bytes.toString('latin1'), tables = new Map();
  let statement = [], statements = 0, settings = 0;
  for (const token of tokens(sql)) {
    if (token.kind !== ';') { statement.push(token); continue; }
    if (!statement.length) continue;
    statements++;
    if (is(statement[0], 'CREATE') && is(statement[1], 'TABLE')) createTable(statement, tables);
    else if (is(statement[0], 'INSERT')) insertRows(statement, tables);
    else if (is(statement[0], 'SET')) {
      if (statement.some((entry) => entry.incompatibleMode)) fail(statement[0].line, 'unsupported SQL quoting mode');
      if (statement.some((entry) => entry.value?.toUpperCase() === 'SQL_MODE') && (statement.length !== 4 || statement[1].value?.toUpperCase() !== 'SQL_MODE' || statement[2].kind !== '=' || statement[3].kind !== 'literal')) fail(statement[0].line, 'unsupported SQL quoting-mode setting');
      settings++;
    } else fail(statement[0].line, 'unsupported statement');
    statement = [];
  }
  if (statement.length) fail(statement[0].line, 'unterminated statement');
  if (!tables.size) fail(1, 'no table definitions');
  const result = [...tables.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return {
    format: 'svu.legacy-dump-preview.v1', applied: false, valuesIncluded: false,
    source: { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
    totals: { tables: result.length, columns: result.reduce((sum, table) => sum + table.columns.length, 0), rows: result.reduce((sum, table) => sum + table.rows, 0), insertStatements: result.reduce((sum, table) => sum + table.insertStatements, 0), statements, settings },
    tables: result,
    limitations: ['Counts describe archived INSERT rows, not current production records.', 'No row values, attachments, mappings, duplicate-key checks or imports are provided.', 'Dynamic PHP-created tables and external systems may be absent from this archive.']
  };
}
