/* ============================================================================
 * Automation Framework -- COMPLETE database schema (Microsoft SQL Server / T-SQL)
 *
 * Single self-contained script: creates the AutomationFramework database (if it
 * does not exist) and all tables, constraints, and indexes. Consolidates
 * migrations 001_init.sql + 002_execution_parameters.sql.
 *
 * SAFE TO RE-RUN: every object is created only IF it does not already exist
 * (IF OBJECT_ID(...) IS NULL). It never drops data.
 *
 * ASCII-only on purpose: the legacy sqlcmd.exe reads scripts in the system ANSI
 * codepage, and non-ASCII chars (em dashes / box-drawing) can break comment
 * parsing. Also avoid a slash-star sequence inside comments (T-SQL nests comments).
 *
 * Run:
 *   sqlcmd -S .\SQLEXPRESS -E -i AutomationFramework_schema.sql
 *   -- or with the app login over TCP:
 *   sqlcmd -S localhost,1433 -U automation_app -P "<password>" -i AutomationFramework_schema.sql
 *
 * Tables:
 *   tasks                 task definitions (name, description, script_path)
 *   task_tags             normalized tags (string[] per task)
 *   task_params           normalized run-field definitions (TaskParam[])
 *   schedules             cron schedules per task
 *   executions            run records + job queue (status QUEUED/RUNNING/...)
 *   execution_parameters  key-value run params per execution
 *   execution_logs        per-run log lines
 *   execution_steps       per-run step timings
 *   execution_artifacts   report.html + screenshots (relative paths under reports/)
 * ==========================================================================*/

/* -- database (CREATE DATABASE cannot run inside a transaction) ----------- */
IF DB_ID('AutomationFramework') IS NULL
    CREATE DATABASE AutomationFramework;
GO
USE AutomationFramework;
GO

-- Required for the filtered indexes below; persists across the GO batches.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* -- tasks ---------------------------------------------------------------- */
IF OBJECT_ID('dbo.tasks', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.tasks (
        id           UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_tasks PRIMARY KEY
                                       CONSTRAINT DF_tasks_id DEFAULT NEWID(),
        name          NVARCHAR(256)   NOT NULL,
        description   NVARCHAR(MAX)   NULL,
        script_path   NVARCHAR(512)   NOT NULL,        -- relative to SCRIPTS_DIR, e.g. "open_google/task.ts"
        script_source NVARCHAR(MAX)   NULL,            -- the .ts source (DB copy of the on-disk file)
        created_at   DATETIMEOFFSET   NOT NULL CONSTRAINT DF_tasks_created DEFAULT SYSUTCDATETIME(),
        updated_at   DATETIMEOFFSET   NOT NULL CONSTRAINT DF_tasks_updated DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_tasks_name ON dbo.tasks (name);
    CREATE UNIQUE INDEX UQ_tasks_script_path ON dbo.tasks (script_path);  -- natural key for disk-wins seeding
END
GO

/* -- task_tags (normalized string[] tags) -------------------------------- */
IF OBJECT_ID('dbo.task_tags', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.task_tags (
        task_id  UNIQUEIDENTIFIER NOT NULL
                 CONSTRAINT FK_task_tags_task REFERENCES dbo.tasks(id) ON DELETE CASCADE,
        tag      NVARCHAR(128)    NOT NULL,
        CONSTRAINT PK_task_tags PRIMARY KEY (task_id, tag)
    );
    CREATE INDEX IX_task_tags_tag ON dbo.task_tags (tag);
END
GO

/* -- task_params (normalized TaskParam[] run-field definitions) ----------- */
IF OBJECT_ID('dbo.task_params', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.task_params (
        id           UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_task_params PRIMARY KEY
                                       CONSTRAINT DF_task_params_id DEFAULT NEWID(),
        task_id      UNIQUEIDENTIFIER NOT NULL
                     CONSTRAINT FK_task_params_task REFERENCES dbo.tasks(id) ON DELETE CASCADE,
        name         NVARCHAR(128)    NOT NULL,        -- param key, e.g. "URL" / "TERM"
        label        NVARCHAR(256)    NULL,            -- UI label; app defaults to name
        type         VARCHAR(16)      NOT NULL CONSTRAINT DF_task_params_type DEFAULT 'text'
                     CONSTRAINT CK_task_params_type CHECK (type IN ('text','url','number')),
        required     BIT              NOT NULL CONSTRAINT DF_task_params_req DEFAULT 0,
        placeholder  NVARCHAR(256)    NULL,
        default_val  NVARCHAR(512)    NULL,            -- maps to TaskParam.default
        seq          INT              NOT NULL CONSTRAINT DF_task_params_seq DEFAULT 0,
        CONSTRAINT UQ_task_params UNIQUE (task_id, name)
    );
    CREATE INDEX IX_task_params_task ON dbo.task_params (task_id);
END
GO

/* -- schedules ------------------------------------------------------------ */
IF OBJECT_ID('dbo.schedules', 'U') IS NULL
BEGIN
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
    CREATE INDEX IX_schedules_task ON dbo.schedules (task_id);
    CREATE INDEX IX_schedules_due  ON dbo.schedules (next_run_at) WHERE is_active = 1;
END
GO

/* -- executions (also the job queue: status = 'QUEUED') ------------------- */
IF OBJECT_ID('dbo.executions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.executions (
        id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_executions PRIMARY KEY
                                       CONSTRAINT DF_exec_id DEFAULT NEWID(),
        task_id       UNIQUEIDENTIFIER NOT NULL
                      CONSTRAINT FK_exec_task REFERENCES dbo.tasks(id) ON DELETE CASCADE,
        schedule_id   UNIQUEIDENTIFIER NULL
                      CONSTRAINT FK_exec_schedule REFERENCES dbo.schedules(id),  -- NULL for manual/api
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
        report_path   NVARCHAR(512)    NULL,           -- e.g. "search_wiki/2026-06-24/<id>/report.html"
        error_message NVARCHAR(MAX)    NULL,
        created_at    DATETIMEOFFSET   NOT NULL CONSTRAINT DF_exec_created DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_exec_task    ON dbo.executions (task_id);
    CREATE INDEX IX_exec_status  ON dbo.executions (status);
    CREATE INDEX IX_exec_created ON dbo.executions (created_at DESC);
    CREATE INDEX IX_exec_queue   ON dbo.executions (created_at) WHERE status = 'QUEUED';  -- claim oldest QUEUED
END
GO

/* -- execution_parameters (key-value run params per execution) ------------ */
IF OBJECT_ID('dbo.execution_parameters', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.execution_parameters (
        id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_exec_params PRIMARY KEY
                                       CONSTRAINT DF_exec_params_id DEFAULT NEWID(),
        execution_id  UNIQUEIDENTIFIER NOT NULL
                      CONSTRAINT FK_exec_params_exec REFERENCES dbo.executions(id) ON DELETE CASCADE,
        [key]         NVARCHAR(128)    NOT NULL,       -- param key, e.g. "url" / "term"
        value         NVARCHAR(MAX)    NULL,           -- param value as text
        CONSTRAINT UQ_exec_params_exec_key UNIQUE (execution_id, [key])
    );
    CREATE INDEX IX_exec_params_exec ON dbo.execution_parameters (execution_id);
END
GO

/* -- execution_logs (per-run log lines) ----------------------------------- */
IF OBJECT_ID('dbo.execution_logs', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.execution_logs (
        id            BIGINT           IDENTITY(1,1) CONSTRAINT PK_exec_logs PRIMARY KEY,
        execution_id  UNIQUEIDENTIFIER NOT NULL
                      CONSTRAINT FK_logs_exec REFERENCES dbo.executions(id) ON DELETE CASCADE,
        [timestamp]   DATETIMEOFFSET   NOT NULL CONSTRAINT DF_logs_ts DEFAULT SYSUTCDATETIME(),
        level         VARCHAR(10)      NOT NULL,       -- INFO | WARN | ERROR | DEBUG | KEYWORD
        message       NVARCHAR(MAX)    NOT NULL
    );
    CREATE INDEX IX_logs_exec ON dbo.execution_logs (execution_id, id);  -- log tailing after line N
END
GO

/* -- execution_steps (per-run step timings) ------------------------------- */
IF OBJECT_ID('dbo.execution_steps', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.execution_steps (
        id            BIGINT           IDENTITY(1,1) CONSTRAINT PK_exec_steps PRIMARY KEY,
        execution_id  UNIQUEIDENTIFIER NOT NULL
                      CONSTRAINT FK_steps_exec REFERENCES dbo.executions(id) ON DELETE CASCADE,
        seq           INT              NOT NULL,       -- order within the run
        name          NVARCHAR(256)    NOT NULL,       -- e.g. "Navigate to URL"
        status        VARCHAR(12)      NOT NULL
                      CONSTRAINT CK_step_status CHECK (status IN ('PASSED','FAILED')),
        started_at    DATETIMEOFFSET   NULL,
        finished_at   DATETIMEOFFSET   NULL,
        duration_ms   INT              NULL,
        error_message NVARCHAR(MAX)    NULL,
        CONSTRAINT UQ_steps_exec_seq UNIQUE (execution_id, seq)
    );
    CREATE INDEX IX_steps_exec ON dbo.execution_steps (execution_id);
END
GO

/* -- execution_artifacts (report.html + screenshots under reports/) ------- */
IF OBJECT_ID('dbo.execution_artifacts', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.execution_artifacts (
        id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_exec_artifacts PRIMARY KEY
                                       CONSTRAINT DF_art_id DEFAULT NEWID(),
        execution_id  UNIQUEIDENTIFIER NOT NULL
                      CONSTRAINT FK_artifacts_exec REFERENCES dbo.executions(id) ON DELETE CASCADE,
        kind          VARCHAR(16)      NOT NULL
                      CONSTRAINT CK_art_kind CHECK (kind IN ('screenshot','report','trace','video','other')),
        file_path     NVARCHAR(512)    NOT NULL,       -- relative path under reports/
        content_type  VARCHAR(64)      NULL,           -- 'image/png', 'text/html'
        size_bytes    BIGINT           NULL,
        content       VARBINARY(MAX)   NULL,           -- the actual file bytes (report html / screenshot)
        created_at    DATETIMEOFFSET   NOT NULL CONSTRAINT DF_art_created DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_artifacts_exec ON dbo.execution_artifacts (execution_id);
END
GO

PRINT 'AutomationFramework schema is ready.';
GO

/* ============================================================================
 * Reference snippet (NOT executed) -- atomic queue claim used by the worker.
 * READPAST skips rows another worker has locked (SQL Server's SKIP LOCKED):
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