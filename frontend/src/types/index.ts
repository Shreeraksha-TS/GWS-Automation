export type TaskStatus = 'QUEUED' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELLED';

export interface TaskParam {
  name: string;
  label?: string;
  type?: 'text' | 'url' | 'number';
  required?: boolean;
  placeholder?: string;
  default?: string;
}

export interface Task {
  id: string;
  name: string;
  description?: string;
  script_path: string;
  tags: string[];
  params?: TaskParam[];
  created_at: string;
}

export interface Execution {
  id: string;
  task_id: string;
  status: TaskStatus;
  triggered_by: string;
  robot_params?: Record<string, string>;
  started_at?: string;
  finished_at?: string;
  report_path?: string;
  error_message?: string;
  created_at: string;
}

export interface LogEntry {
  id: number;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'KEYWORD';
  message: string;
}

export interface Schedule {
  id: string;
  task_id: string;
  cron_expression: string;
  robot_params?: Record<string, string>;
  is_active: boolean;
  last_run_at?: string;
  next_run_at?: string;
  created_at: string;
}
