/**
 * SQL Server data-access layer. Replaces the file-based store.ts, jobqueue.ts,
 * and records.ts. Returns the same shapes declared in types.ts so the routes and
 * worker need only swap which functions they call.
 *
 * Grouped into repositories: tasksRepo, executionsRepo, schedulesRepo, logsRepo.
 */
import { randomUUID } from "node:crypto";
import { getPool, sql } from "./db.js";
import type { Task, TaskParam, Execution, Schedule, LogEntry } from "./types.js";

const toIso = (d: unknown): string | null =>
  d == null ? null : d instanceof Date ? d.toISOString() : new Date(d as string).toISOString();

const uniq = (xs: string[]): string[] => [...new Set(xs)];

/* ============================ tasks ==================================== */

function rowToParam(row: any): TaskParam {
  return {
    name: row.name,
    label: row.label ?? undefined,
    type: (row.type ?? "text") as TaskParam["type"],
    required: !!row.required,
    placeholder: row.placeholder ?? undefined,
    default: row.default_val ?? undefined,
  };
}

function rowToTask(row: any, tags: string[], params: TaskParam[]): Task {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    script_path: row.script_path,
    tags,
    params,
    created_at: toIso(row.created_at)!,
    updated_at: toIso(row.updated_at)!,
  };
}

async function insertTags(tx: any, taskId: string, tags: string[]): Promise<void> {
  for (const tag of uniq(tags)) {
    await new sql.Request(tx)
      .input("task_id", sql.UniqueIdentifier, taskId)
      .input("tag", sql.NVarChar(128), tag)
      .query("INSERT INTO dbo.task_tags (task_id, tag) VALUES (@task_id, @tag);");
  }
}

async function insertParams(tx: any, taskId: string, params: TaskParam[]): Promise<void> {
  let seq = 0;
  for (const p of params) {
    await new sql.Request(tx)
      .input("id", sql.UniqueIdentifier, randomUUID())
      .input("task_id", sql.UniqueIdentifier, taskId)
      .input("name", sql.NVarChar(128), p.name)
      .input("label", sql.NVarChar(256), p.label ?? null)
      .input("type", sql.VarChar(16), p.type ?? "text")
      .input("required", sql.Bit, p.required ? 1 : 0)
      .input("placeholder", sql.NVarChar(256), p.placeholder ?? null)
      .input("default_val", sql.NVarChar(512), p.default ?? null)
      .input("seq", sql.Int, seq++)
      .query(`INSERT INTO dbo.task_params
                (id, task_id, name, label, type, required, placeholder, default_val, seq)
              VALUES (@id, @task_id, @name, @label, @type, @required, @placeholder, @default_val, @seq);`);
  }
}

export interface TaskInput {
  name: string;
  description: string | null;
  script_path: string;
  tags: string[];
  params: TaskParam[];
  script_source?: string | null;   // the .ts source, stored in the DB for record/audit
}

export const tasksRepo = {
  async list(): Promise<Task[]> {
    const pool = await getPool();
    const [tasksR, tagsR, paramsR] = await Promise.all([
      pool.request().query("SELECT * FROM dbo.tasks ORDER BY created_at DESC;"),
      pool.request().query("SELECT task_id, tag FROM dbo.task_tags;"),
      pool.request().query("SELECT * FROM dbo.task_params ORDER BY seq;"),
    ]);
    const tagsByTask = new Map<string, string[]>();
    for (const r of tagsR.recordset) {
      const k = String(r.task_id).toLowerCase();
      (tagsByTask.get(k) ?? tagsByTask.set(k, []).get(k)!).push(r.tag);
    }
    const paramsByTask = new Map<string, TaskParam[]>();
    for (const r of paramsR.recordset) {
      const k = String(r.task_id).toLowerCase();
      (paramsByTask.get(k) ?? paramsByTask.set(k, []).get(k)!).push(rowToParam(r));
    }
    return tasksR.recordset.map((row) => {
      const k = String(row.id).toLowerCase();
      return rowToTask(row, tagsByTask.get(k) ?? [], paramsByTask.get(k) ?? []);
    });
  },

  async get(id: string): Promise<Task | null> {
    const pool = await getPool();
    const r = await pool.request()
      .input("id", sql.UniqueIdentifier, id)
      .query("SELECT * FROM dbo.tasks WHERE id = @id;");
    if (!r.recordset.length) return null;
    return this._hydrate(r.recordset[0]);
  },

  async getByScriptPath(scriptPath: string): Promise<Task | null> {
    const pool = await getPool();
    const r = await pool.request()
      .input("sp", sql.NVarChar(512), scriptPath)
      .query("SELECT * FROM dbo.tasks WHERE script_path = @sp;");
    if (!r.recordset.length) return null;
    return this._hydrate(r.recordset[0]);
  },

  async _hydrate(row: any): Promise<Task> {
    const pool = await getPool();
    const [tagsR, paramsR] = await Promise.all([
      pool.request().input("id", sql.UniqueIdentifier, row.id)
        .query("SELECT tag FROM dbo.task_tags WHERE task_id = @id;"),
      pool.request().input("id", sql.UniqueIdentifier, row.id)
        .query("SELECT * FROM dbo.task_params WHERE task_id = @id ORDER BY seq;"),
    ]);
    return rowToTask(row, tagsR.recordset.map((x) => x.tag), paramsR.recordset.map(rowToParam));
  },

  async create(input: TaskInput): Promise<Task> {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const id = randomUUID();
      const row = (await new sql.Request(tx)
        .input("id", sql.UniqueIdentifier, id)
        .input("name", sql.NVarChar(256), input.name)
        .input("description", sql.NVarChar(sql.MAX), input.description)
        .input("script_path", sql.NVarChar(512), input.script_path)
        .input("script_source", sql.NVarChar(sql.MAX), input.script_source ?? null)
        .query(`INSERT INTO dbo.tasks (id, name, description, script_path, script_source)
                OUTPUT inserted.* VALUES (@id, @name, @description, @script_path, @script_source);`)).recordset[0];
      await insertTags(tx, id, input.tags);
      await insertParams(tx, id, input.params);
      await tx.commit();
      return rowToTask(row, uniq(input.tags), input.params);
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  },

  /** Disk-wins seed: insert if new, else refresh definition from the config file. */
  async upsertFromDisk(input: TaskInput): Promise<void> {
    const existing = await this.getByScriptPath(input.script_path);
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      let id: string;
      if (existing) {
        id = existing.id;
        await new sql.Request(tx)
          .input("id", sql.UniqueIdentifier, id)
          .input("name", sql.NVarChar(256), input.name)
          .input("description", sql.NVarChar(sql.MAX), input.description)
          .input("script_source", sql.NVarChar(sql.MAX), input.script_source ?? null)
          .query(`UPDATE dbo.tasks SET name = @name, description = @description,
                  script_source = @script_source, updated_at = SYSUTCDATETIME() WHERE id = @id;`);
        await new sql.Request(tx).input("id", sql.UniqueIdentifier, id)
          .query("DELETE FROM dbo.task_tags WHERE task_id = @id;");
        await new sql.Request(tx).input("id", sql.UniqueIdentifier, id)
          .query("DELETE FROM dbo.task_params WHERE task_id = @id;");
      } else {
        id = randomUUID();
        await new sql.Request(tx)
          .input("id", sql.UniqueIdentifier, id)
          .input("name", sql.NVarChar(256), input.name)
          .input("description", sql.NVarChar(sql.MAX), input.description)
          .input("script_path", sql.NVarChar(512), input.script_path)
          .input("script_source", sql.NVarChar(sql.MAX), input.script_source ?? null)
          .query(`INSERT INTO dbo.tasks (id, name, description, script_path, script_source)
                  VALUES (@id, @name, @description, @script_path, @script_source);`);
      }
      await insertTags(tx, id, input.tags);
      await insertParams(tx, id, input.params);
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  },

  /** Update an existing task's name/description/tags/params (script_path is immutable). */
  async update(
    id: string,
    input: { name: string; description: string | null; tags: string[]; params: TaskParam[] },
  ): Promise<Task | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await new sql.Request(tx)
        .input("id", sql.UniqueIdentifier, id)
        .input("name", sql.NVarChar(256), input.name)
        .input("description", sql.NVarChar(sql.MAX), input.description)
        .query(`UPDATE dbo.tasks SET name = @name, description = @description,
                updated_at = SYSUTCDATETIME() WHERE id = @id;`);
      await new sql.Request(tx).input("id", sql.UniqueIdentifier, id)
        .query("DELETE FROM dbo.task_tags WHERE task_id = @id;");
      await new sql.Request(tx).input("id", sql.UniqueIdentifier, id)
        .query("DELETE FROM dbo.task_params WHERE task_id = @id;");
      await insertTags(tx, id, input.tags);
      await insertParams(tx, id, input.params);
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }
    return this.get(id);
  },

  async remove(id: string): Promise<boolean> {
    const pool = await getPool();
    const r = await pool.request()
      .input("id", sql.UniqueIdentifier, id)
      .query("DELETE FROM dbo.tasks WHERE id = @id;");   // cascades to tags/params/executions
    return (r.rowsAffected[0] ?? 0) > 0;
  },
};

/* ========================== executions ================================ */

function rowToExecution(row: any): Execution {
  return {
    id: row.id,
    task_id: row.task_id,
    status: row.status,
    triggered_by: row.triggered_by,
    robot_params: JSON.parse(row.robot_params ?? "{}"),
    started_at: toIso(row.started_at),
    finished_at: toIso(row.finished_at),
    report_path: row.report_path ?? null,
    error_message: row.error_message ?? null,
    created_at: toIso(row.created_at)!,
  };
}

export const executionsRepo = {
  async create(
    taskId: string,
    triggeredBy: Execution["triggered_by"],
    params: Record<string, unknown>,
    scheduleId: string | null = null,
  ): Promise<Execution> {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const id = randomUUID();
      const row = (await new sql.Request(tx)
        .input("id", sql.UniqueIdentifier, id)
        .input("task_id", sql.UniqueIdentifier, taskId)
        .input("schedule_id", sql.UniqueIdentifier, scheduleId)
        .input("triggered_by", sql.VarChar(10), triggeredBy)
        .input("robot_params", sql.NVarChar(sql.MAX), JSON.stringify(params ?? {}))
        .query(`INSERT INTO dbo.executions (id, task_id, schedule_id, status, triggered_by, robot_params)
                OUTPUT inserted.*
                VALUES (@id, @task_id, @schedule_id, 'QUEUED', @triggered_by, @robot_params);`)).recordset[0];
      // Requirement: each run param also stored as a row in execution_parameters.
      for (const [key, value] of Object.entries(params ?? {})) {
        await new sql.Request(tx)
          .input("id", sql.UniqueIdentifier, randomUUID())
          .input("execution_id", sql.UniqueIdentifier, id)
          .input("key", sql.NVarChar(128), key)
          .input("value", sql.NVarChar(sql.MAX), value == null ? null : String(value))
          .query(`INSERT INTO dbo.execution_parameters (id, execution_id, [key], value)
                  VALUES (@id, @execution_id, @key, @value);`);
      }
      await tx.commit();
      return rowToExecution(row);
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  },

  async list(taskId?: string): Promise<Execution[]> {
    const pool = await getPool();
    const req = pool.request();
    let q = "SELECT TOP (100) * FROM dbo.executions";
    if (taskId) { req.input("task_id", sql.UniqueIdentifier, taskId); q += " WHERE task_id = @task_id"; }
    q += " ORDER BY created_at DESC;";
    return (await req.query(q)).recordset.map(rowToExecution);
  },

  async get(id: string): Promise<Execution | null> {
    const pool = await getPool();
    const r = await pool.request()
      .input("id", sql.UniqueIdentifier, id)
      .query("SELECT * FROM dbo.executions WHERE id = @id;");
    return r.recordset.length ? rowToExecution(r.recordset[0]) : null;
  },

  /** Run parameters for an execution, read from the normalized table. */
  async getParams(id: string): Promise<Record<string, string>> {
    const pool = await getPool();
    const r = await pool.request()
      .input("id", sql.UniqueIdentifier, id)
      .query("SELECT [key], value FROM dbo.execution_parameters WHERE execution_id = @id;");
    const out: Record<string, string> = {};
    for (const row of r.recordset) out[row.key] = row.value;
    return out;
  },

  /** Atomic queue claim: oldest QUEUED -> RUNNING. READPAST = SKIP LOCKED. */
  async claimNext(): Promise<Execution | null> {
    const pool = await getPool();
    const r = await pool.request().query(`
      WITH next_job AS (
        SELECT TOP (1) *
        FROM dbo.executions WITH (READPAST, ROWLOCK, UPDLOCK)
        WHERE status = 'QUEUED'
        ORDER BY created_at
      )
      UPDATE next_job
      SET status = 'RUNNING', started_at = SYSUTCDATETIME()
      OUTPUT inserted.*;`);
    return r.recordset.length ? rowToExecution(r.recordset[0]) : null;
  },

  async finish(
    id: string,
    fields: { status: Execution["status"]; report_path?: string | null; error_message?: string | null },
  ): Promise<void> {
    const pool = await getPool();
    await pool.request()
      .input("id", sql.UniqueIdentifier, id)
      .input("status", sql.VarChar(12), fields.status)
      .input("report_path", sql.NVarChar(512), fields.report_path ?? null)
      .input("error_message", sql.NVarChar(sql.MAX), fields.error_message ?? null)
      .query(`UPDATE dbo.executions
              SET status = @status, finished_at = SYSUTCDATETIME(),
                  report_path = @report_path, error_message = @error_message
              WHERE id = @id;`);
  },
};

/* ========================== schedules ================================= */

function rowToSchedule(row: any): Schedule {
  return {
    id: row.id,
    task_id: row.task_id,
    cron_expression: row.cron_expression,
    robot_params: JSON.parse(row.robot_params ?? "{}"),
    is_active: !!row.is_active,
    last_run_at: toIso(row.last_run_at),
    next_run_at: toIso(row.next_run_at),
    created_at: toIso(row.created_at)!,
  };
}

export const schedulesRepo = {
  async list(): Promise<Schedule[]> {
    const pool = await getPool();
    return (await pool.request()
      .query("SELECT * FROM dbo.schedules ORDER BY created_at DESC;")).recordset.map(rowToSchedule);
  },

  async listActive(): Promise<Schedule[]> {
    const pool = await getPool();
    return (await pool.request()
      .query("SELECT * FROM dbo.schedules WHERE is_active = 1;")).recordset.map(rowToSchedule);
  },

  async get(id: string): Promise<Schedule | null> {
    const pool = await getPool();
    const r = await pool.request()
      .input("id", sql.UniqueIdentifier, id)
      .query("SELECT * FROM dbo.schedules WHERE id = @id;");
    return r.recordset.length ? rowToSchedule(r.recordset[0]) : null;
  },

  async create(
    taskId: string, cron: string, params: Record<string, unknown>, nextRunAt: string | null,
  ): Promise<Schedule> {
    const pool = await getPool();
    const row = (await pool.request()
      .input("id", sql.UniqueIdentifier, randomUUID())
      .input("task_id", sql.UniqueIdentifier, taskId)
      .input("cron", sql.NVarChar(128), cron)
      .input("robot_params", sql.NVarChar(sql.MAX), JSON.stringify(params ?? {}))
      .input("next_run_at", sql.DateTimeOffset, nextRunAt ? new Date(nextRunAt) : null)
      .query(`INSERT INTO dbo.schedules (id, task_id, cron_expression, robot_params, next_run_at)
              OUTPUT inserted.*
              VALUES (@id, @task_id, @cron, @robot_params, @next_run_at);`)).recordset[0];
    return rowToSchedule(row);
  },

  async toggle(id: string): Promise<Schedule | null> {
    const pool = await getPool();
    const r = await pool.request()
      .input("id", sql.UniqueIdentifier, id)
      .query(`UPDATE dbo.schedules SET is_active = 1 - is_active
              OUTPUT inserted.* WHERE id = @id;`);
    return r.recordset.length ? rowToSchedule(r.recordset[0]) : null;
  },

  async recordRun(id: string, nextRunAt: string | null): Promise<void> {
    const pool = await getPool();
    await pool.request()
      .input("id", sql.UniqueIdentifier, id)
      .input("next_run_at", sql.DateTimeOffset, nextRunAt ? new Date(nextRunAt) : null)
      .query(`UPDATE dbo.schedules SET last_run_at = SYSUTCDATETIME(), next_run_at = @next_run_at
              WHERE id = @id;`);
  },

  async remove(id: string): Promise<boolean> {
    const pool = await getPool();
    // Detach any executions first so the FK (NO_ACTION) doesn't block the delete.
    // History is preserved -- the runs just lose their schedule link.
    await pool.request()
      .input("id", sql.UniqueIdentifier, id)
      .query("UPDATE dbo.executions SET schedule_id = NULL WHERE schedule_id = @id;");
    const r = await pool.request()
      .input("id", sql.UniqueIdentifier, id)
      .query("DELETE FROM dbo.schedules WHERE id = @id;");
    return (r.rowsAffected[0] ?? 0) > 0;
  },
};

/* ========================== artifacts ================================= */

export const artifactsRepo = {
  async add(
    executionId: string,
    kind: "screenshot" | "report" | "trace" | "video" | "other",
    filePath: string,
    contentType: string | null = null,
    sizeBytes: number | null = null,
    content: Buffer | null = null,            // raw file bytes stored in the DB
  ): Promise<void> {
    const pool = await getPool();
    await pool.request()
      .input("id", sql.UniqueIdentifier, randomUUID())
      .input("execution_id", sql.UniqueIdentifier, executionId)
      .input("kind", sql.VarChar(16), kind)
      .input("file_path", sql.NVarChar(512), filePath)
      .input("content_type", sql.VarChar(64), contentType)
      .input("size_bytes", sql.BigInt, sizeBytes)
      .input("content", sql.VarBinary(sql.MAX), content)
      .query(`INSERT INTO dbo.execution_artifacts
                (id, execution_id, kind, file_path, content_type, size_bytes, content)
              VALUES (@id, @execution_id, @kind, @file_path, @content_type, @size_bytes, @content);`);
  },

  async list(executionId: string): Promise<Array<{ kind: string; file_path: string }>> {
    const pool = await getPool();
    const r = await pool.request()
      .input("id", sql.UniqueIdentifier, executionId)
      .query("SELECT kind, file_path FROM dbo.execution_artifacts WHERE execution_id = @id;");
    return r.recordset.map((x) => ({ kind: x.kind, file_path: x.file_path }));
  },
};

/* ============================= steps ================================== */

export const stepsRepo = {
  // Record one step's outcome and timing (id is an IDENTITY column, so it's omitted).
  async add(
    executionId: string,
    seq: number,
    name: string,
    status: "PASSED" | "FAILED",
    startedAt: string | null,
    finishedAt: string | null,
    durationMs: number | null,
    errorMessage: string | null = null,
  ): Promise<void> {
    const pool = await getPool();
    await pool.request()
      .input("execution_id", sql.UniqueIdentifier, executionId)
      .input("seq", sql.Int, seq)
      .input("name", sql.NVarChar(256), name)
      .input("status", sql.VarChar(12), status)
      .input("started_at", sql.DateTimeOffset, startedAt ? new Date(startedAt) : null)
      .input("finished_at", sql.DateTimeOffset, finishedAt ? new Date(finishedAt) : null)
      .input("duration_ms", sql.Int, durationMs)
      .input("error_message", sql.NVarChar(sql.MAX), errorMessage)
      .query(`INSERT INTO dbo.execution_steps
                (execution_id, seq, name, status, started_at, finished_at, duration_ms, error_message)
              VALUES (@execution_id, @seq, @name, @status, @started_at, @finished_at, @duration_ms, @error_message);`);
  },

  async list(executionId: string): Promise<Array<{
    seq: number; name: string; status: string; duration_ms: number | null; error_message: string | null;
  }>> {
    const pool = await getPool();
    const r = await pool.request()
      .input("id", sql.UniqueIdentifier, executionId)
      .query(`SELECT seq, name, status, duration_ms, error_message
              FROM dbo.execution_steps WHERE execution_id = @id ORDER BY seq;`);
    return r.recordset.map((x) => ({
      seq: x.seq, name: x.name, status: x.status,
      duration_ms: x.duration_ms, error_message: x.error_message,
    }));
  },
};

/* ============================= logs =================================== */

export const logsRepo = {
  async append(executionId: string, level: string, message: string): Promise<void> {
    const pool = await getPool();
    await pool.request()
      .input("execution_id", sql.UniqueIdentifier, executionId)
      .input("level", sql.VarChar(10), level)
      .input("message", sql.NVarChar(sql.MAX), message)
      .query(`INSERT INTO dbo.execution_logs (execution_id, level, message)
              VALUES (@execution_id, @level, @message);`);
  },

  async read(executionId: string, afterId = 0): Promise<LogEntry[]> {
    const pool = await getPool();
    const r = await pool.request()
      .input("execution_id", sql.UniqueIdentifier, executionId)
      .input("after_id", sql.BigInt, afterId)
      .query(`SELECT id, [timestamp], level, message FROM dbo.execution_logs
              WHERE execution_id = @execution_id AND id > @after_id ORDER BY id;`);
    return r.recordset.map((row) => ({
      id: Number(row.id),
      timestamp: toIso(row.timestamp)!,
      level: row.level,
      message: row.message,
    }));
  },
};
