import { z } from "zod";

export const TaskParamSchema = z.object({
  name: z.string(),
  label: z.string().optional(),
  type: z.enum(["text", "url", "number"]).optional(),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
  default: z.string().optional(),
});

export const TaskCreate = z.object({
  name: z.string(),
  description: z.string().nullish(),
  script_path: z.string(),
  tags: z.array(z.string()).optional().default([]),
  params: z.array(TaskParamSchema).optional().default([]),
});

export const TriggerRequest = z.object({
  robot_params: z.record(z.unknown()).optional().default({}),   // params for the task
});

export const ScheduleCreate = z.object({
  task_id: z.string(),
  cron_expression: z.string(),
  robot_params: z.record(z.unknown()).optional().default({}),
});
