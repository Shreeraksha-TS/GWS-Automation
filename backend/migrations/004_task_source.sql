/* ============================================================================
 * Automation Framework -- migration 004: store the script SOURCE on the task
 *
 * Adds tasks.script_source (NVARCHAR(MAX)) so an uploaded/generated .ts script's
 * text is saved in the DB, not just written to disk. The on-disk file remains the
 * runtime source (disk wins); this is a DB copy for record/audit.
 *
 * Run after 003:
 *   sqlcmd -S .\SQLEXPRESS -E -i backend/migrations/004_task_source.sql
 * ==========================================================================*/

USE AutomationFramework;
GO

IF COL_LENGTH('dbo.tasks', 'script_source') IS NULL
    ALTER TABLE dbo.tasks ADD script_source NVARCHAR(MAX) NULL;
GO