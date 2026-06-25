import cron, { ScheduledTask } from "node-cron";
import cronParser from "cron-parser";
import { executionsRepo, schedulesRepo } from "../../common/repo.js";
import type { Schedule } from "../../common/types.js";

const jobs = new Map<string, ScheduledTask>();

async function runScheduled(sched: Schedule): Promise<void> {
  // Inserting a QUEUED execution enqueues it; params are copied onto the run.
  await executionsRepo.create(sched.task_id, "schedule", sched.robot_params ?? {}, sched.id);
  const nextRunAt = cronParser.parseExpression(sched.cron_expression, { tz: "UTC" }).next().toISOString();
  await schedulesRepo.recordRun(sched.id, nextRunAt);
}

export function addSchedule(sched: Schedule): void {
  if (!cron.validate(sched.cron_expression)) return;
  jobs.get(sched.id)?.stop();
  const task = cron.schedule(
    sched.cron_expression,
    () => { runScheduled(sched).catch((e) => console.error(`[SCHED] ${sched.id} failed:`, e)); },
    { timezone: "UTC" },
  );
  jobs.set(sched.id, task);
}

export function removeSchedule(scheduleId: string): void {
  jobs.get(scheduleId)?.stop();
  jobs.delete(scheduleId);
}

export async function loadSchedules(): Promise<void> {
  for (const s of await schedulesRepo.listActive()) addSchedule(s);
}
