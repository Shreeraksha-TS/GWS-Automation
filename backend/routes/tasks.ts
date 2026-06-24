import { Router } from "express";
import * as store from "../../common/store.js";
import { newTask } from "../../common/records.js";
import { TaskCreate } from "../schemas.js";
import type { Task } from "../../common/types.js";

export const tasks = Router();

tasks.get("/", (_req, res) => {
  const list = store.listEntities<Task>(store.TASKS_DIR)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  res.json(list);
});

tasks.get("/:id", (req, res) => {
  const t = store.getEntity<Task>(store.TASKS_DIR, req.params.id);
  if (!t) return res.status(404).json({ error: "Task not found" });
  res.json(t);
});

tasks.post("/", (req, res) => {
  const p = TaskCreate.parse(req.body);
  const t = newTask(p.name, p.script_path, p.description ?? null, p.tags, p.params);
  store.saveEntity(store.TASKS_DIR, t.id, t);
  res.json(t);
});

tasks.delete("/:id", (req, res) => {
  if (!store.deleteEntity(store.TASKS_DIR, req.params.id))
    return res.status(404).json({ error: "Task not found" });
  res.status(204).end();
});
