import cron, { ScheduledTask } from "node-cron";
import * as store from "../../common/store.js";
import { newExecution } from "../../common/records.js";
import { enqueue } from "../../common/jobqueue.js";
import type { Schedule } from "../../common/types.js";

const jobs = new Map<string, ScheduledTask>();

function runScheduled(taskId: string, params: Record<string, unknown>, scheduleId: string): void {
  const execution = newExecution(taskId, "schedule", params);
  store.saveEntity(store.EXEC_DIR, execution.id, execution);
  enqueue(execution.id);
  const sched = store.getEntity<Schedule>(store.SCHED_DIR, scheduleId);
  if (sched) { sched.last_run_at = store.utcnowIso(); store.saveEntity(store.SCHED_DIR, scheduleId, sched); }
}

export function addSchedule(sched: Schedule): void {
  if (!cron.validate(sched.cron_expression)) return;
  jobs.get(sched.id)?.stop();
  const task = cron.schedule(
    sched.cron_expression,
    () => runScheduled(sched.task_id, sched.robot_params ?? {}, sched.id),
    { timezone: "UTC" },
  );
  jobs.set(sched.id, task);
}

export function removeSchedule(scheduleId: string): void {
  jobs.get(scheduleId)?.stop();
  jobs.delete(scheduleId);
}

export function loadSchedules(): void {
  for (const s of store.listEntities<Schedule>(store.SCHED_DIR)) if (s.is_active) addSchedule(s);
}
