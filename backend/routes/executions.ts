import { Router, type Request, type Response, type NextFunction } from "express";
import { tasksRepo, executionsRepo, logsRepo } from "../../common/repo.js";
import { TriggerRequest } from "../schemas.js";

// Mounted at /api (so it owns /api/tasks/:id/run and /api/executions/*).
export const executions = Router();

const wrap = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };

executions.post("/tasks/:taskId/run", wrap(async (req, res) => {
  const task = await tasksRepo.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: "Task not found" });
  const { robot_params } = TriggerRequest.parse(req.body);
  // Inserting with status 'QUEUED' IS the enqueue; the worker claims it. Params are
  // also written to execution_parameters by the repo.
  const ex = await executionsRepo.create(req.params.taskId, "manual", robot_params);
  res.json(ex);
}));

executions.get("/executions", wrap(async (req, res) => {
  const taskId = req.query.task_id as string | undefined;
  res.json(await executionsRepo.list(taskId));
}));

executions.get("/executions/:id", wrap(async (req, res) => {
  const ex = await executionsRepo.get(req.params.id);
  if (!ex) return res.status(404).json({ error: "Execution not found" });
  res.json(ex);
}));

executions.get("/executions/:id/logs", wrap(async (req, res) => {
  const afterId = Number(req.query.after_id ?? 0);
  res.json(await logsRepo.read(req.params.id, afterId));
}));
