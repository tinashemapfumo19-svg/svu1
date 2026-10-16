import pg from "pg";

export function createPool(config) {
  return new pg.Pool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000
  });
}

export async function checkDatabase(pool) {
  const result = await pool.query("select now() as now");
  return result.rows[0].now;
}
