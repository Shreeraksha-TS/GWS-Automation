import { Router, type Request, type Response, type NextFunction } from "express";
import cron from "node-cron";
import cronParser from "cron-parser";
import { schedulesRepo } from "../../common/repo.js";
import { ScheduleCreate } from "../schemas.js";
import { addSchedule, removeSchedule } from "../services/scheduler.js";

export const schedules = Router();

const wrap = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };

schedules.get("/", wrap(async (_req, res) => {
  res.json(await schedulesRepo.list());
}));

schedules.post("/", wrap(async (req, res) => {
  const p = ScheduleCreate.parse(req.body);
  if (!cron.validate(p.cron_expression))
    return res.status(400).json({ error: `Invalid cron expression: ${p.cron_expression}` });
  const nextRunAt = cronParser.parseExpression(p.cron_expression, { tz: "UTC" }).next().toISOString();
  const sched = await schedulesRepo.create(p.task_id, p.cron_expression, p.robot_params, nextRunAt);
  addSchedule(sched);          // register with node-cron
  res.json(sched);
}));

schedules.patch("/:id/toggle", wrap(async (req, res) => {
  const sched = await schedulesRepo.toggle(req.params.id);
  if (!sched) return res.status(404).json({ error: "Schedule not found" });
  if (sched.is_active) addSchedule(sched); else removeSchedule(req.params.id);
  res.json(sched);
}));

schedules.delete("/:id", wrap(async (req, res) => {
  if (!(await schedulesRepo.remove(req.params.id)))
    return res.status(404).json({ error: "Schedule not found" });
  removeSchedule(req.params.id);
  res.status(204).end();
}));
