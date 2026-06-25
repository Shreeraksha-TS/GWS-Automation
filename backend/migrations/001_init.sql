/* ============================================================================
 * Automation Framework -- initial schema (Microsoft SQL Server / T-SQL)
 *
 * Replaces the file-based store (common/store.ts) and the directory job queue
 * (common/jobqueue.ts). Field names mirror common/types.ts so existing records
 * migrate with no shape changes.
 *
 * IMPORTANT: keep this file ASCII-only. The legacy sqlcmd.exe reads scripts in
 * the system ANSI codepage; non-ASCII chars (em dashes, box-drawing) get
 * mis-decoded and can swallow comment terminators. ASCII avoids that entirely.
 *
 * Design decisions (agreed during planning):
 *   - Engine            -> SQL Server 2022 Express, local instance  .\SQLEXPRESS
 *   - Database          -> AutomationFramework (created below if missing)
 *   - Task run-fields   -> normalized dbo.task_params table (NOT a JSON column),
 *                          mirroring how dbo.task_tags normalizes string[] tags
 *   - Source of truth   -> DISK WINS: the app's seedTasks() repopulates tasks /
 *                          task_params / task_tags from scripts/<dir>/task_config.json.
 *                          The DB mirrors disk; the schema itself is unaffected.
 *   - Users / auth      -> none yet (single-user, local). Add later if needed.
 *   - Existing data     -> fresh start; no migration of the data/ JSON records.
 *
 * Conventions:
 *   - UUID PKs               -> UNIQUEIDENTIFIER DEFAULT NEWID()  (matches randomUUID())
 *   - Union/enum types       -> CHECK constraints
 *   - Record<string,unknown> -> NVARCHAR(MAX) validated with ISJSON()
 *   - ISO UTC timestamps     -> DATETIMEOFFSET DEFAULT SYSUTCDATETIME()
 *   - string[] tags          -> normalized task_tags table
 *   - TaskParam[] params     -> normalized task_params table
 *   - job queue              -> executions.status = 'QUEUED' + filtered index
 *
 * Run once (creates the DB if needed, then the schema):
 *   sqlcmd -S .\SQLEXPRESS -E -i backend/migrations/001_init.sql
 * ==========================================================================*/

/* -- database (create + select; CREATE DATABASE can't run inside a txn) ---- */
IF DB_ID('AutomationFramework') IS NULL
    CREATE DATABASE AutomationFramework;
GO
USE AutomationFramework;
GO

-- Required so filtered indexes (WHERE clauses below) can be created. These SET
-- options persist for the connection across the GO-separated batches that follow.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

SET XACT_ABORT ON;
GO

BEGIN TRANSACTION;
GO

/* -- tasks ---------------------------------------------------------------- */
CREATE TABLE dbo.tasks (
    id           UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_tasks PRIMARY KEY
                                   CONSTRAINT DF_tasks_id DEFAULT NEWID(),
    name         NVARCHAR(256)    NOT NULL,
    description  NVARCHAR(MAX)    NULL,
    script_path  NVARCHAR(512)    NOT NULL,          -- relative to SCRIPTS_DIR, e.g. "open_google/task.ts"
    created_at   DATETIMEOFFSET   NOT NULL CONSTRAINT DF_tasks_created DEFAULT SYSUTCDATETIME(),
    updated_at   DATETIMEOFFSET   NOT NULL CONSTRAINT DF_tasks_updated DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_tasks_name ON dbo.tasks (name);
-- "disk wins" relies on script_path being the natural key when re-seeding from disk.
CREATE UNIQUE INDEX UQ_tasks_script_path ON dbo.tasks (script_path);
GO

/* -- task_tags (string[] tags, normalized -- SQL Server has no array type) - */
CREATE TABLE dbo.task_tags (
    task_id  UNIQUEIDENTIFIER NOT NULL
             CONSTRAINT FK_task_tags_task REFERENCES dbo.tasks(id) ON DELETE CASCADE,
    tag      NVARCHAR(128)    NOT NULL,
    CONSTRAINT PK_task_tags PRIMARY KEY (task_id, tag)
);
GO
CREATE INDEX IX_task_tags_tag ON dbo.task_tags (tag);   -- "find tasks with tag X"
GO

/* -- task_params (TaskParam[] run-fields, normalized) ---------------------
 * One row per input the Run/Schedule forms prompt for. Mirrors the TaskParam
 * interface in common/types.ts:
 *   { name, label?, type?, required?, placeholder?, default? }
 * `default` is awkward (reserved word in many contexts) -> stored as default_val.
 * `seq` preserves the order fields were declared so the UI renders them in order.
 */
CREATE TABLE dbo.task_params (
    id           UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_task_params PRIMARY KEY
                                   CONSTRAINT DF_task_params_id DEFAULT NEWID(),
    task_id      UNIQUEIDENTIFIER NOT NULL
                 CONSTRAINT FK_task_params_task REFERENCES dbo.tasks(id) ON DELETE CASCADE,
    name         NVARCHAR(128)    NOT NULL,          -- param key, e.g. "URL" / "TERM"
    label        NVARCHAR(256)    NULL,              -- UI label; app defaults to name
    type         VARCHAR(16)      NOT NULL CONSTRAINT DF_task_params_type DEFAULT 'text'
                 CONSTRAINT CK_task_params_type CHECK (type IN ('text','url','number')),
    required     BIT              NOT NULL CONSTRAINT DF_task_params_req DEFAULT 0,
    placeholder  NVARCHAR(256)    NULL,
    default_val  NVARCHAR(512)    NULL,              -- maps to TaskParam.default
    seq          INT              NOT NULL CONSTRAINT DF_task_params_seq DEFAULT 0,  -- display order
    CONSTRAINT UQ_task_params UNIQUE (task_id, name)
);
GO
CREATE INDEX IX_task_params_task ON dbo.task_params (task_id);   -- "fields for this task, in order"
GO

/* -- schedules ------------------------------------------------------------ */
CREATE TABLE dbo.schedules (
    id              UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_schedules PRIMARY KEY
                                     CONSTRAINT DF_sched_id DEFAULT NEWID(),
    task_id         UNIQUEIDENTIFIER NOT NULL
                    CONSTRAINT FK_schedules_task REFERENCES dbo.tasks(id) ON DELETE CASCADE,
    cron_expression NVARCHAR(128)    NOT NULL,
    robot_params    NVARCHAR(MAX)    NOT NULL CONSTRAINT DF_sched_params DEFAULT N'{}'
                    CONSTRAINT CK_sched_params_json CHECK (ISJSON(robot_params) = 1),
    is_active       BIT              NOT NULL CONSTRAINT DF_sched_active DEFAULT 1,
    last_run_at     DATETIMEOFFSET   NULL,
    next_run_at     DATETIMEOFFSET   NULL,
    created_at      DATETIMEOFFSET   NOT NULL CONSTRAINT DF_sched_created DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_schedules_task ON dbo.schedules (task_id);
-- scheduler poll: "active schedules that are due" (filtered index = partial index)
CREATE INDEX IX_schedules_due  ON dbo.schedules (next_run_at) WHERE is_active = 1;
GO

/* -- executions ----------------------------------------------------------- */
CREATE TABLE dbo.executions (
    id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_executions PRIMARY KEY
                                   CONSTRAINT DF_exec_id DEFAULT NEWID(),
    task_id       UNIQUEIDENTIFIER NOT NULL
                  CONSTRAINT FK_exec_task REFERENCES dbo.tasks(id) ON DELETE CASCADE,
    -- which schedule fired this run (NULL for manual/api). NO ACTION avoids
    -- multiple-cascade-path errors; delete schedules explicitly or via app logic.
    schedule_id   UNIQUEIDENTIFIER NULL
                  CONSTRAINT FK_exec_schedule REFERENCES dbo.schedules(id),
    status        VARCHAR(12)      NOT NULL CONSTRAINT DF_exec_status DEFAULT 'QUEUED'
                  CONSTRAINT CK_exec_status
                  CHECK (status IN ('QUEUED','RUNNING','PASSED','FAILED','CANCELLED')),
    triggered_by  VARCHAR(10)      NOT NULL CONSTRAINT DF_exec_trigger DEFAULT 'manual'
                  CONSTRAINT CK_exec_trigger
                  CHECK (triggered_by IN ('manual','schedule','api')),
    robot_params  NVARCHAR(MAX)    NOT NULL CONSTRAINT DF_exec_params DEFAULT N'{}'
                  CONSTRAINT CK_exec_params_json CHECK (ISJSON(robot_params) = 1),
    started_at    DATETIMEOFFSET   NULL,
    finished_at   DATETIMEOFFSET   NULL,
    report_path   NVARCHAR(512)    NULL,            -- e.g. "<execId>/report.html"
    error_message NVARCHAR(MAX)    NULL,
    created_at    DATETIMEOFFSET   NOT NULL CONSTRAINT DF_exec_created DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_exec_task    ON dbo.executions (task_id);
CREATE INDEX IX_exec_status  ON dbo.executions (status);
CREATE INDEX IX_exec_created ON dbo.executions (created_at DESC);
-- queue claim: oldest QUEUED first (replaces queue/pending lexicographic order)
CREATE INDEX IX_exec_queue   ON dbo.executions (created_at) WHERE status = 'QUEUED';
GO

/* -- execution_logs (replaces data/logs/<id>.jsonl) ----------------------- */
CREATE TABLE dbo.execution_logs (
    id            BIGINT           IDENTITY(1,1) CONSTRAINT PK_exec_logs PRIMARY KEY,
    execution_id  UNIQUEIDENTIFIER NOT NULL
                  CONSTRAINT FK_logs_exec REFERENCES dbo.executions(id) ON DELETE CASCADE,
    [timestamp]   DATETIMEOFFSET   NOT NULL CONSTRAINT DF_logs_ts DEFAULT SYSUTCDATETIME(),
    level         VARCHAR(10)      NOT NULL,        -- INFO | WARN | ERROR | DEBUG
    message       NVARCHAR(MAX)    NOT NULL
);
GO
-- log tailing: "logs for this execution after line N" -> (execution_id, id)
CREATE INDEX IX_logs_exec ON dbo.execution_logs (execution_id, id);
GO

/* -- execution_steps (the step() timings -- today only inside report.html) - */
CREATE TABLE dbo.execution_steps (
    id            BIGINT           IDENTITY(1,1) CONSTRAINT PK_exec_steps PRIMARY KEY,
    execution_id  UNIQUEIDENTIFIER NOT NULL
                  CONSTRAINT FK_steps_exec REFERENCES dbo.executions(id) ON DELETE CASCADE,
    seq           INT              NOT NULL,        -- order within the run
    name          NVARCHAR(256)    NOT NULL,        -- e.g. "Navigate to URL"
    status        VARCHAR(12)      NOT NULL
                  CONSTRAINT CK_step_status CHECK (status IN ('PASSED','FAILED')),
    started_at    DATETIMEOFFSET   NULL,
    finished_at   DATETIMEOFFSET   NULL,
    duration_ms   INT              NULL,
    error_message NVARCHAR(MAX)    NULL,
    CONSTRAINT UQ_steps_exec_seq UNIQUE (execution_id, seq)
);
GO
CREATE INDEX IX_steps_exec ON dbo.execution_steps (execution_id);
GO

/* -- execution_artifacts (screenshots & report.html in reports/<id>/) ----- */
CREATE TABLE dbo.execution_artifacts (
    id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_exec_artifacts PRIMARY KEY
                                   CONSTRAINT DF_art_id DEFAULT NEWID(),
    execution_id  UNIQUEIDENTIFIER NOT NULL
                  CONSTRAINT FK_artifacts_exec REFERENCES dbo.executions(id) ON DELETE CASCADE,
    kind          VARCHAR(16)      NOT NULL
                  CONSTRAINT CK_art_kind CHECK (kind IN ('screenshot','report','trace','video','other')),
    file_path     NVARCHAR(512)    NOT NULL,        -- relative path under reports/
    content_type  VARCHAR(64)      NULL,            -- 'image/png', 'text/html'
    size_bytes    BIGINT           NULL,
    created_at    DATETIMEOFFSET   NOT NULL CONSTRAINT DF_art_created DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_artifacts_exec ON dbo.execution_artifacts (execution_id);
GO

COMMIT TRANSACTION;
GO

/* ============================================================================
 * Reference snippet (NOT executed) -- atomic queue claim that replaces
 * jobqueue.claimNext(). READPAST skips rows another worker has locked, so two
 * workers never grab the same job. This is SQL Server's SKIP LOCKED equivalent.
 *
 *   WITH next_job AS (
 *       SELECT TOP (1) *
 *       FROM dbo.executions WITH (READPAST, ROWLOCK, UPDLOCK)
 *       WHERE status = 'QUEUED'
 *       ORDER BY created_at
 *   )
 *   UPDATE next_job
 *   SET status = 'RUNNING', started_at = SYSUTCDATETIME()
 *   OUTPUT inserted.*;
 * ==========================================================================*/
