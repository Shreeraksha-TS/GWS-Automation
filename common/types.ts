export type ExecStatus = "QUEUED" | "RUNNING" | "PASSED" | "FAILED" | "CANCELLED";

// A single input a task asks for before it runs (rendered as a form field in the UI).
export interface TaskParam {
  name: string;                             // key passed into params, e.g. "URL"
  label?: string;                           // human label; defaults to `name`
  type?: "text" | "url" | "number";         // input type hint for the UI
  required?: boolean;                       // if true, the run is blocked until filled
  placeholder?: string;
  default?: string;
}

export interface Task {
  id: string;
  name: string;
  description: string | null;
  script_path: string;          // relative to SCRIPTS_DIR, e.g. "open_google/task.ts"
  tags: string[];
  params: TaskParam[];          // declared inputs prompted for before each run
  created_at: string;
  updated_at: string;
}

export interface Execution {
  id: string;
  task_id: string;
  status: ExecStatus;
  triggered_by: "manual" | "schedule" | "api";
  robot_params: Record<string, unknown>;   // params passed to the task (legacy key)
  started_at: string | null;
  finished_at: string | null;
  report_path: string | null;
  error_message: string | null;
  created_at: string;
}

export interface Schedule {
  id: string;
  task_id: string;
  cron_expression: string;
  robot_params: Record<string, unknown>;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
}

export interface LogEntry { id: number; timestamp: string; level: string; message: string; }

// Context handed to every task's exported run() function.
export interface TaskContext {
  page: any;                                // Playwright Page (kept `any` so common has no deps)
  params: Record<string, unknown>;
  outputDir: string;                        // reports/<executionId>
  log: (level: string, message: string) => void;
  step: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
}
