import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { X, FileText } from 'lucide-react';
import { tasksApi, executionsApi } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { LogViewer } from '../components/LogViewer';
import { timeAgo, duration, shortDateTime } from '../lib/format';
import type { Task, Execution } from '../types';

const FILTERS = ['All', 'QUEUED', 'RUNNING', 'PASSED', 'FAILED'] as const;
type Filter = (typeof FILTERS)[number];

const BASE = import.meta.env.VITE_API_BASE_URL || '';

export function Executions() {
  const [params] = useSearchParams();
  const taskFilter = params.get('task') ?? undefined;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [execs, setExecs] = useState<Execution[]>([]);
  const [filter, setFilter] = useState<Filter>('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function load() {
    try {
      const [t, e] = await Promise.all([tasksApi.list(), executionsApi.list(taskFilter)]);
      setTasks(t.data);
      setExecs(e.data);
    } catch {
      /* keep last good data */
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 3000); // poll so QUEUED→RUNNING→PASSED is visible
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskFilter]);

  const taskName = (id: string) => tasks.find((t) => t.id === id)?.name ?? id.slice(0, 8);

  const visible = useMemo(
    () => (filter === 'All' ? execs : execs.filter((e) => e.status === filter)),
    [execs, filter]
  );

  const selected = execs.find((e) => e.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              filter === f ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {f}
          </button>
        ))}
        {taskFilter && (
          <span className="ml-auto self-center text-xs text-slate-500">
            Filtered to task {taskName(taskFilter)}
          </span>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {visible.length === 0 ? (
          <div className="px-5 py-10 text-center text-slate-400 text-sm">No executions match this filter.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100">
                <th className="px-5 py-3 font-medium">Task</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Triggered by</th>
                <th className="px-5 py-3 font-medium">Duration</th>
                <th className="px-5 py-3 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => (
                <tr
                  key={e.id}
                  onClick={() => setSelectedId(e.id)}
                  className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer"
                >
                  <td className="px-5 py-3 font-medium text-slate-700">{taskName(e.task_id)}</td>
                  <td className="px-5 py-3"><StatusBadge status={e.status} /></td>
                  <td className="px-5 py-3 text-slate-500">{e.triggered_by}</td>
                  <td className="px-5 py-3 text-slate-500">{duration(e.started_at, e.finished_at)}</td>
                  <td className="px-5 py-3 text-slate-500">{timeAgo(e.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <ExecutionDetail
          key={selected.id}
          execution={selected}
          taskName={taskName(selected.task_id)}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

function ExecutionDetail({
  execution,
  taskName,
  onClose,
}: {
  execution: Execution;
  taskName: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex justify-end z-50" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-white h-full shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 h-16 border-b border-slate-200">
          <div>
            <div className="font-semibold text-slate-800">{taskName}</div>
            <div className="text-xs text-slate-400 font-mono">{execution.id}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <Field label="Status"><StatusBadge status={execution.status} /></Field>
            <Field label="Triggered by">{execution.triggered_by}</Field>
            <Field label="Duration">{duration(execution.started_at, execution.finished_at)}</Field>
            <Field label="Created">{shortDateTime(execution.created_at)}</Field>
          </div>

          {execution.error_message && (
            <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">
              {execution.error_message}
            </div>
          )}

          {execution.report_path && (
            <a
              href={`${BASE}/reports/${execution.report_path}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200"
            >
              <FileText className="w-4 h-4" /> View Report
            </a>
          )}

          <div>
            <div className="text-sm font-medium text-slate-600 mb-2">Logs</div>
            <LogViewer executionId={execution.id} status={execution.status} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">{label}</div>
      <div className="text-slate-700">{children}</div>
    </div>
  );
}
