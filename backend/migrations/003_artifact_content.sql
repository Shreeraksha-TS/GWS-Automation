/* ============================================================================
 * Automation Framework -- migration 003: store artifact CONTENT in the database
 *
 * Adds execution_artifacts.content (VARBINARY(MAX)) so the actual report.html
 * and screenshot bytes are persisted in the DB, not just referenced by path.
 * report.html bytes can be read back as text: CAST(content AS NVARCHAR(MAX)).
 *
 * Run after 002:
 *   sqlcmd -S .\SQLEXPRESS -E -i backend/migrations/003_artifact_content.sql
 * ==========================================================================*/

USE AutomationFramework;
GO

IF COL_LENGTH('dbo.execution_artifacts', 'content') IS NULL
    ALTER TABLE dbo.execution_artifacts ADD content VARBINARY(MAX) NULL;
GO