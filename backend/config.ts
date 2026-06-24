export const config = {
  dataDir:    process.env.DATA_DIR    ?? "/app/data",
  secretKey:  process.env.SECRET_KEY  ?? "dev-secret",
  host:       process.env.API_HOST    ?? "0.0.0.0",
  port: Number(process.env.API_PORT   ?? 8000),
  scriptsDir: process.env.SCRIPTS_DIR ?? "/app/scripts",
  reportsDir: process.env.REPORTS_DIR ?? "/app/reports",
  staticDir:  process.env.STATIC_DIR  ?? "/app/static",
};
