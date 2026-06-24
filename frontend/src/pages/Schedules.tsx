import { useEffect, useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { tasksApi, schedulesApi } from '../api/client';
import { CronInput, isLikelyValidCron } from '../components/CronInput';
import { shortDateTime, timeAgo } from '../lib/format';
import type { Task, Schedule } from '../types';

export function Schedules() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  // Add-schedule form state
  const [taskId, setTaskId] = useState('');
  const [cron, setCron] = useState('0 9 * * 1-5');
  const [paramsText, setParamsText] = useState('{}');
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const selectedTask = tasks.find((t) => t.id === taskId);
  const fields = selectedTask?.params ?? [];
  const hasFields = fields.length > 0;

  // When the selected task changes, reset its field values (pre-filling any defaults).
  useEffect(() => {
    setParamValues(Object.fromEntries(fields.map((f) => [f.name, f.default ?? ''])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  function flash(kind: 'ok' | 'err', msg: string) {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 3500);
  }

  async function load() {
    try {
      const [t, s] = await Promise.all([tasksApi.list(), schedulesApi.list()]);
      setTasks(t.data);
      setSchedules(s.data);
      if (!taskId && t.data.length) setTaskId(t.data[0].id);
    } catch {
      flash('err', 'Failed to load schedules');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const taskName = (id: string) => tasks.find((t) => t.id === id)?.name ?? id.slice(0, 8);

  async function create() {
    if (!taskId) return flash('err', 'Pick a task first');
    if (!isLikelyValidCron(cron)) return flash('err', 'Cron must have 5 fields');

    let robot_params: Record<string, unknown>;
    if (hasFields) {
      // Build params from the task's declared fields, enforcing required ones so the
      // automated run always has its assigned data.
      const missing = fields.find((f) => f.required && !paramValues[f.name]?.trim());
      if (missing) return flash('err', `${missing.label ?? missing.name} is required`);
      robot_params = {};
      for (const f of fields) {
        const v = paramValues[f.name]?.trim();
        if (!v) continue;
        robot_params[f.name] = f.type === 'number' ? Number(v) : v;
      }
    } else {
      try {
        robot_params = JSON.parse(paramsText || '{}');
        if (typeof robot_params !== 'object' || Array.isArray(robot_params)) throw new Error();
      } catch {
        return flash('err', 'Params must be a JSON object');
      }
    }

    setBusy(true);
    try {
      await schedulesApi.create({ task_id: taskId, cron_expression: cron, robot_params });
      flash('ok', 'Schedule created');
      setParamsText('{}');
      load();
    } catch (e: any) {
      flash('err', e?.response?.data?.detail ?? 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(s: Schedule) {
    try {
      await schedulesApi.toggle(s.id);
      load();
    } catch {
      flash('err', 'Toggle failed');
    }
  }

  async function remove(s: Schedule) {
    if (!confirm('Delete this schedule?')) return;
    try {
      await schedulesApi.delete(s.id);
      flash('ok', 'Schedule deleted');
      load();
    } catch {
      flash('err', 'Delete failed');
    }
  }

  return (
    <div className="space-y-6">
      {/* Add schedule */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="font-semibold text-slate-800 mb-4">Add Schedule</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div>
            <label className="block text-sm text-slate-600 mb-1">Task</label>
            <select
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              {tasks.length === 0 && <option value="">No tasks available</option>}
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {hasFields ? (
              <div className="mt-4 space-y-3">
                {fields.map((f) => (
                  <div key={f.name}>
                    <label className="block text-sm text-slate-600 mb-1">
                      {f.label ?? f.name}
                      {f.required && <span className="text-red-500 ml-0.5">*</span>}
                    </label>
                    <input
                      type={f.type === 'number' ? 'number' : 'text'}
                      value={paramValues[f.name] ?? ''}
                      placeholder={f.placeholder}
                      onChange={(e) =>
                        setParamValues((v) => ({ ...v, [f.name]: e.target.value }))
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <>
                <label className="block text-sm text-slate-600 mb-1 mt-4">Robot params (JSON)</label>
                <textarea
                  value={paramsText}
                  onChange={(e) => setParamsText(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </>
            )}
          </div>
          <div>
            <label className="block text-sm text-slate-600 mb-1">Cron expression</label>
            <CronInput value={cron} onChange={setCron} />
          </div>
          <div className="flex items-end">
            <button
              onClick={create}
              disabled={busy}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" /> {busy ? 'Creating…' : 'Create Schedule'}
            </button>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {schedules.length === 0 ? (
          <div className="px-5 py-10 text-center text-slate-400 text-sm">No schedules yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100">
                <th className="px-5 py-3 font-medium">Task</th>
                <th className="px-5 py-3 font-medium">Cron</th>
                <th className="px-5 py-3 font-medium">Next run</th>
                <th className="px-5 py-3 font-medium">Last run</th>
                <th className="px-5 py-3 font-medium">Active</th>
                <th className="px-5 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-700">{taskName(s.task_id)}</td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-600">{s.cron_expression}</td>
                  <td className="px-5 py-3 text-slate-500">{shortDateTime(s.next_run_at)}</td>
                  <td className="px-5 py-3 text-slate-500">{timeAgo(s.last_run_at)}</td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => toggle(s)}
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        s.is_active ? 'bg-green-500' : 'bg-slate-300'
                      }`}
                      title={s.is_active ? 'Active — click to pause' : 'Paused — click to activate'}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                          s.is_active ? 'translate-x-5' : ''
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => remove(s)}
                      className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-red-600 hover:bg-red-50"
                      title="Delete schedule"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {toast && (
        <div
          className={`fixed bottom-6 right-6 px-4 py-3 rounded-lg shadow-lg text-sm text-white ${
            toast.kind === 'ok' ? 'bg-green-600' : 'bg-red-600'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
