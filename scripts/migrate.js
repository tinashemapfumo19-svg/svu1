import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadConfig } from "../server/config.js";
import { createPool } from "../server/db.js";

const config = loadConfig();
const pool = createPool(config);
const migrationsDir = resolve("migrations");

try {
  await pool.query(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const applied = await pool.query("select name from schema_migrations");
  const appliedNames = new Set(applied.rows.map((row) => row.name));
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (appliedNames.has(file)) {
      console.log(`Skipping ${file}`);
      continue;
    }

    const sql = await readFile(join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
  if ((await pool.query("select to_regprocedure('refresh_legacy_access_profiles()') is not null as present")).rows[0].present) {
    await pool.query('select refresh_legacy_access_profiles()');
  }
} finally {
  await pool.end();
}
