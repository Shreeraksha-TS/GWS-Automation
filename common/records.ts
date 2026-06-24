import { randomUUID } from "node:crypto";
import { utcnowIso } from "./store.js";
import type { Task, TaskParam, Execution, Schedule } from "./types.js";

export function newTask(
  name: string, script_path: string,
  description: string | null = null, tags: string[] = [], params: TaskParam[] = [],
): Task {
  const now = utcnowIso();
  return { id: randomUUID(), name, description, script_path, tags, params, created_at: now, updated_at: now };
}

export function newExecution(
  task_id: string, triggered_by: Execution["triggered_by"] = "manual",
  robot_params: Record<string, unknown> = {},
): Execution {
  return {
    id: randomUUID(), task_id, status: "QUEUED", triggered_by, robot_params,
    started_at: null, finished_at: null, report_path: null, error_message: null,
    created_at: utcnowIso(),
  };
}

export function newSchedule(
  task_id: string, cron_expression: string,
  robot_params: Record<string, unknown> = {},
): Schedule {
  return {
    id: randomUUID(), task_id, cron_expression, robot_params, is_active: true,
    last_run_at: null, next_run_at: null, created_at: utcnowIso(),
  };
}
