/* ============================================================================
 * Automation Framework -- migration 002: execution_parameters
 *
 * Stores the key-value run parameters for each execution in a NORMALIZED table
 * (one row per param), linked to executions. This replaces relying solely on the
 * executions.robot_params JSON column as the source of truth.
 *
 *   e.g. run "Search Wikipedia" with { term: "Playwright" } ->
 *        one row: (execution_id, key='term', value='Playwright')
 *
 * ASCII-only (see 001_init.sql header for why). Run after 001:
 *   sqlcmd -S .\SQLEXPRESS -E -i backend/migrations/002_execution_parameters.sql
 * ==========================================================================*/

USE AutomationFramework;
GO

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID('dbo.execution_parameters', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.execution_parameters (
        id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_exec_params PRIMARY KEY
                                       CONSTRAINT DF_exec_params_id DEFAULT NEWID(),
        execution_id  UNIQUEIDENTIFIER NOT NULL
                      CONSTRAINT FK_exec_params_exec REFERENCES dbo.executions(id) ON DELETE CASCADE,
        [key]         NVARCHAR(128)    NOT NULL,        -- param key, e.g. "url" / "term"
        value         NVARCHAR(MAX)    NULL,            -- param value as text
        CONSTRAINT UQ_exec_params_exec_key UNIQUE (execution_id, [key])
    );

    CREATE INDEX IX_exec_params_exec ON dbo.execution_parameters (execution_id);  -- "params for this run"
END
GO
