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
  // Optional uploaded .ts source. When present it's written to the script file
  // instead of generating a scaffold. (Sent as text from the browser.)
  script_content: z.string().optional(),
});

// Editing an existing task: script_path is immutable, so it's not accepted here.
export const TaskUpdate = z.object({
  name: z.string(),
  description: z.string().nullish(),
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
