/**
 * SQL Server connection pool shared by the backend API and the worker.
 *
 * Replaces the file-based store (store.ts) and directory job queue (jobqueue.ts).
 * Connects over TCP to the local SQL Server Express instance using a SQL login.
 *
 * Defaults target local dev (see enable-sql-tcp.ps1 for the one-time TCP setup).
 * Override any of these via environment variables:
 *   DB_SERVER (default "localhost")   DB_PORT (default 1433)
 *   DB_NAME   (default "AutomationFramework")
 *   DB_USER   (default "automation_app")   DB_PASSWORD (default dev password)
 */
import sql from "mssql";

const config: sql.config = {
  server:   process.env.DB_SERVER ?? "localhost",
  port:     Number(process.env.DB_PORT ?? 1433),
  database: process.env.DB_NAME ?? "AutomationFramework",
  user:     process.env.DB_USER ?? "automation_app",
  password: process.env.DB_PASSWORD ?? "Autom@tion2026!",
  options: {
    encrypt: false,                 // local instance, no TLS
    trustServerCertificate: true,
    enableArithAbort: true,
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30_000 },
};

let poolPromise: Promise<sql.ConnectionPool> | null = null;

/** Lazily create (once) and return the shared connection pool. */
export function getPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config).connect().catch((err: unknown) => {
      poolPromise = null;           // allow a later retry if the first connect fails
      throw err;
    });
  }
  return poolPromise!;
}

/** Get a fresh request bound to the shared pool. */
export async function request(): Promise<sql.Request> {
  return (await getPool()).request();
}

export { sql };
export const utcnowIso = (): string => new Date().toISOString();
