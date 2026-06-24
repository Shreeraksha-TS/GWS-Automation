import { Router } from "express";
import * as store from "../../common/store.js";
import { newExecution } from "../../common/records.js";
import { enqueue } from "../../common/jobqueue.js";
import { TriggerRequest } from "../schemas.js";
import type { Execution, Task } from "../../common/types.js";

// Mounted at /api (so it owns /api/tasks/:id/run and /api/executions/*).
export const executions = Router();

executions.post("/tasks/:taskId/run", (req, res) => {
  const task = store.getEntity<Task>(store.TASKS_DIR, req.params.taskId);
  if (!task) return res.status(404).json({ error: "Task not found" });
  const { robot_params } = TriggerRequest.parse(req.body);
  const ex = newExecution(req.params.taskId, "manual", robot_params);
  store.saveEntity(store.EXEC_DIR, ex.id, ex);
  enqueue(ex.id);
  res.json(ex);
});

executions.get("/executions", (req, res) => {
  let list = store.listEntities<Execution>(store.EXEC_DIR);
  const taskId = req.query.task_id as string | undefined;
  if (taskId) list = list.filter(e => e.task_id === taskId);
  list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  res.json(list.slice(0, 100));
});

executions.get("/executions/:id", (req, res) => {
  const ex = store.getEntity<Execution>(store.EXEC_DIR, req.params.id);
  if (!ex) return res.status(404).json({ error: "Execution not found" });
  res.json(ex);
});

executions.get("/executions/:id/logs", (req, res) => {
  const afterId = Number(req.query.after_id ?? 0);
  res.json(store.readLogs(req.params.id, afterId));
});
