import { createHash, randomUUID } from 'node:crypto';

export function recoveryTarget(source,requested) {
  const name = requested || `svu_restore_${randomUUID().replaceAll('-','')}`;
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name) || !name.startsWith('svu_restore_') || name === source) throw new Error('Recovery target must be a separate svu_restore_ database with a safe identifier.');
  return name;
}
const identifier = (value) => `"${value.replaceAll('"','""')}"`;

export function schemaDigest(sql,tableDefinitions = []) {
  // Recent pg_dump versions randomize psql restriction tokens; these are not schema definitions.
  const normalized = sql.replace(/^\\(?:un)?restrict [A-Za-z0-9]+\r?\n/gm,'').replace(/\r\n/g,'\n');
  const tables = new Map(tableDefinitions.map((row) => [`-- Name: ${row.name}; Type: TABLE; Schema: ${row.schema}; Owner: ${row.owner}`,row]));
  const blocks = normalized.split(/(?=^--\n-- Name: )/m);
  const canonical = blocks.map((block) => {
    const key = block.split('\n')[1],definition = tables.get(key);
    // Restoring inline CHECKs can change internal grouping and ordering without changing meaning.
    // Use PostgreSQL's deparsed definitions, not SQL text rewriting.
    if (definition) return JSON.stringify(definition);
    return block;
  });
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export async function captureRecoveryTableDefinitions(client) {
  return (await client.query(`select n.nspname as schema,c.relname as name,pg_get_userbyid(c.relowner) as owner,c.relkind,c.relpersistence,c.reloptions,c.relreplident,c.relrowsecurity,c.relforcerowsecurity,
    am.amname as method,t.spcname as tablespace,pg_get_expr(c.relpartbound,c.oid) as partition,pg_get_partkeydef(c.oid) as "partitionKey",
    (select coalesce(jsonb_agg(jsonb_build_object('schema',pn.nspname,'name',pc.relname) order by i.inhseqno),'[]') from pg_inherits i join pg_class pc on pc.oid=i.inhparent join pg_namespace pn on pn.oid=pc.relnamespace where i.inhrelid=c.oid) as parents,
    (select coalesce(jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated,'storage',a.attstorage,'compression',a.attcompression,'statistics',a.attstattarget,'dimensions',a.attndims,'options',a.attoptions,'collationSchema',cn.nspname,'collation',co.collname) order by a.attnum),'[]') from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum left join pg_collation co on co.oid=a.attcollation left join pg_namespace cn on cn.oid=co.collnamespace where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) as columns,
    (select coalesce(jsonb_agg(jsonb_build_object('name',k.conname,'definition',pg_get_constraintdef(k.oid,true),'validated',k.convalidated,'noInherit',k.connoinherit) order by k.conname collate "C"),'[]') from pg_constraint k where k.conrelid=c.oid and k.contype='c') as checks
    from pg_class c join pg_namespace n on n.oid=c.relnamespace left join pg_am am on am.oid=c.relam left join pg_tablespace t on t.oid=c.reltablespace
    where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%' and c.relkind in ('r','p') order by n.nspname collate "C",c.relname collate "C"`)).rows;
}

export function schemaDifferenceNames(left,right,leftTables = [],rightTables = []) {
  const blocks = (sql,tables) => new Map(sql.split(/(?=^--\n-- Name: )/m).slice(1).map((block) => [block.split('\n')[1],schemaDigest(block,tables)]));
  const a = blocks(left,leftTables),b = blocks(right,rightTables);
  return [...new Set([...a.keys(),...b.keys()])].sort().filter((key) => a.get(key) !== b.get(key));
}

export async function captureRecoveryTables(client) {
  if ((await client.query('select exists(select 1 from pg_largeobject_metadata) as present')).rows[0]?.present) throw new Error('Large objects require separately verified object-content recovery.');
  const relations = (await client.query(`select n.nspname as schema,c.relname as name,c.relkind as kind from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%'
      and c.relkind in ('r','p','m','S','f') order by n.nspname collate "C",c.relname collate "C"`)).rows;
  if (relations.some((row) => row.kind === 'f')) throw new Error('Foreign-table contents require a separate provider recovery procedure.');
  if (!relations.some((row) => row.schema === 'public' && row.name === 'schema_migrations')) throw new Error('Recovery source has no application migration ledger.');
  const tables = [];
  for (const relation of relations) {
    const table = `${identifier(relation.schema)}.${identifier(relation.name)}`,hash = createHash('sha256');let count = 0;
    // ONLY prevents counting descendants twice; FETCH bounds client memory.
    const sql = relation.kind === 'S' ? `select jsonb_build_object('last_value',last_value,'is_called',is_called)::text as row from ${table}` : `select to_jsonb(t)::text as row from only ${table} t order by to_jsonb(t)::text collate "C"`;
    await client.query(`declare recovery_rows no scroll cursor for ${sql}`);
    try {
      while (true) {
        const rows = (await client.query('fetch forward 500 from recovery_rows')).rows;
        for (const {row} of rows) {hash.update(`${Buffer.byteLength(row)}:`);hash.update(row);count++;}
        if (rows.length < 500) break;
      }
    } finally {await client.query('close recovery_rows');}
    tables.push({...relation,count,digest:hash.digest('hex')});
  }
  return tables;
}

export function compareRecoveryTables(before,after) {
  const left = new Map(before.map((row) => [`${row.schema}.${row.name}`,row])),right = new Map(after.map((row) => [`${row.schema}.${row.name}`,row]));
  const changed = [...new Set([...left.keys(),...right.keys()])].sort().filter((key) => JSON.stringify(left.get(key)) !== JSON.stringify(right.get(key)));
  return {status:changed.length ? 'failed' : 'passed',relations:before.length,rows:before.reduce((total,row) => total + row.count,0),changed};
}

export async function withOwnedRecoveryDatabase(client,name,work) {
  // CREATE fails for an existing target. Never replace a database we did not create.
  recoveryTarget('',name);
  await client.query(`create database ${identifier(name)} template template0`);
  try {return await work();}
  finally {await client.query(`drop database ${identifier(name)} with (force)`);}
}
