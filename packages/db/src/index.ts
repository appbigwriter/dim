import pg from "pg";
export interface DB {
  query<T = any>(
    sql: string,
    values?: any[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
}
export interface Database extends DB {
  transaction<T>(fn: (db: DB) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export function postgres(url: string): Database {
  const isLocal =
    url.includes("localhost") ||
    url.includes("127.0.0.1") ||
    url.includes("dim-postgres");
  const forceSsl =
    process.env.DB_SSL === "true" ||
    url.includes("sslmode=require") ||
    url.includes("ssl=true");
  const disableSsl =
    url.includes("sslmode=disable") || process.env.DB_SSL === "false";

  const pool = new pg.Pool({
    connectionString: url,
    max: 12,
    connectionTimeoutMillis: 10000,
    statement_timeout: 15000,
    ssl: disableSsl
      ? false
      : forceSsl || !isLocal
        ? { rejectUnauthorized: false }
        : undefined,
  });

  pool.on("error", (err) => {
    console.error("[PostgreSQL Pool Error]", err.message);
  });
  return {
    query: pool.query.bind(pool) as DB["query"],
    close: () => pool.end(),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
export async function one<T = any>(
  db: DB,
  sql: string,
  values: any[] = [],
): Promise<T | undefined> {
  return (await db.query<T>(sql, values)).rows[0];
}
export async function insert(db: DB, table: string, data: Record<string, any>) {
  if (
    !/^[a-z_][a-z0-9_]*$/.test(table) ||
    Object.keys(data).some((k) => !/^[a-z_][a-z0-9_]*$/.test(k))
  )
    throw new Error("Invalid SQL identifier");
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  return (
    await db.query(
      `INSERT INTO custom_dim.${table} (${entries.map(([k]) => k).join(",")}) VALUES (${entries.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`,
      entries.map(([, v]) =>
        v !== null && typeof v === "object" ? JSON.stringify(v) : v,
      ),
    )
  ).rows[0];
}
