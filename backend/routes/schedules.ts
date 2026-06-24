import { Router } from "express";
import cron from "node-cron";
import cronParser from "cron-parser";
import * as store from "../../common/store.js";
import { newSchedule } from "../../common/records.js";
import { ScheduleCreate } from "../schemas.js";
import { addSchedule, removeSchedule } from "../services/scheduler.js";
import type { Schedule } from "../../common/types.js";

export const schedules = Router();

schedules.get("/", (_req, res) => {
  res.json(store.listEntities<Schedule>(store.SCHED_DIR)
    .sort((a, b) => b.created_at.localeCompare(a.created_at)));
});

schedules.post("/", (req, res) => {
  const p = ScheduleCreate.parse(req.body);
  if (!cron.validate(p.cron_expression))
    return res.status(400).json({ error: `Invalid cron expression: ${p.cron_expression}` });
  const sched = newSchedule(p.task_id, p.cron_expression, p.robot_params);
  sched.next_run_at = cronParser.parseExpression(p.cron_expression, { tz: "UTC" }).next().toISOString();
  store.saveEntity(store.SCHED_DIR, sched.id, sched);
  addSchedule(sched);          // register with node-cron
  res.json(sched);
});

schedules.patch("/:id/toggle", (req, res) => {
  const sched = store.getEntity<Schedule>(store.SCHED_DIR, req.params.id);
  if (!sched) return res.status(404).json({ error: "Schedule not found" });
  sched.is_active = !sched.is_active;
  store.saveEntity(store.SCHED_DIR, req.params.id, sched);
  if (sched.is_active) addSchedule(sched); else removeSchedule(req.params.id);
  res.json(sched);
});

schedules.delete("/:id", (req, res) => {
  if (!store.getEntity(store.SCHED_DIR, req.params.id))
    return res.status(404).json({ error: "Schedule not found" });
  removeSchedule(req.params.id);
  store.deleteEntity(store.SCHED_DIR, req.params.id);
  res.status(204).end();
});
