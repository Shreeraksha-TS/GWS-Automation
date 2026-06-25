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
  // Same key->value editor as the Run dialog: declared params become locked rows,
  // a task with no declared params gets a single free-form editable row.
  const [pairs, setPairs] = useState<{ key: string; value: string }[]>([{ key: '', value: '' }]);
  const [busy, setBusy] = useState(false);

  const selectedTask = tasks.find((t) => t.id === taskId);
  const fields = selectedTask?.params ?? [];
  const hasFields = fields.length > 0;
  const requiredKeys = fields.filter((f) => f.required).map((f) => f.name);

  // When the selected task changes, reset rows (pre-filling declared params + defaults).
  useEffect(() => {
    setPairs(
      hasFields
        ? fields.map((f) => ({ key: f.name, value: f.default ?? '' }))
        : [{ key: '', value: '' }]
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, tasks]);

  function updatePair(i: number, patch: Partial<{ key: string; value: string }>) {
    setPairs((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }

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

  // Build robot_params from the key->value rows, enforcing required declared params
  // so the automated run always has its assigned data. Returns null (and flashes) on error.
  function buildParams(): Record<string, unknown> | null {
    const params: Record<string, unknown> = {};
    for (const p of pairs) {
      const key = p.key.trim();
      if (!key && !p.value.trim()) continue;              // skip fully-blank rows
      if (!key) { flash('err', 'Each parameter needs a key.'); return null; }
      if (key in params) { flash('err', `Duplicate key "${key}".`); return null; }
      const f = fields.find((x) => x.name === key);
      params[key] = f?.type === 'number' ? Number(p.value) : p.value;
    }
    for (const f of fields) {
      if (f.required && !String(params[f.name] ?? '').trim()) {
        flash('err', `"${f.label ?? f.name}" is required.`);
        return null;
      }
    }
    return params;
  }

  async function create() {
    if (!taskId) return flash('err', 'Pick a task first');
    if (!isLikelyValidCron(cron)) return flash('err', 'Cron must have 5 fields');

    const robot_params = buildParams();
    if (!robot_params) return;

    setBusy(true);
    try {
      await schedulesApi.create({ task_id: taskId, cron_expression: cron, robot_params });
      flash('ok', 'Schedule created');
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
            <div className="mt-4">
              <label className="block text-sm text-slate-600 mb-2">Parameters (key &rarr; value)</label>
              <div className="space-y-2">
                {pairs.map((p, i) => {
                  const isRequired = requiredKeys.includes(p.key);
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        value={p.key}
                        readOnly={hasFields}
                        onChange={(e) => updatePair(i, { key: e.target.value })}
                        placeholder="key (e.g. url)"
                        className={`w-1/3 rounded-lg border px-2 py-1.5 font-mono text-xs ${
                          hasFields
                            ? 'border-slate-200 bg-slate-50 text-slate-600'
                            : 'border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-400'
                        }`}
                      />
                      <span className="text-slate-400 text-xs">&rarr;</span>
                      <input
                        value={p.value}
                        onChange={(e) => updatePair(i, { value: e.target.value })}
                        placeholder={isRequired ? 'value (required)' : 'value'}
                        className={`flex-1 rounded-lg border px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                          isRequired && !p.value.trim() ? 'border-red-300' : 'border-slate-300'
                        }`}
                      />
                    </div>
                  );
                })}
              </div>
              {requiredKeys.length > 0 ? (
                <p className="text-xs text-slate-400 mt-1">Required: {requiredKeys.join(', ')}</p>
              ) : (
                <p className="text-xs text-slate-400 mt-1">Add key-value pairs, or leave empty to run with none.</p>
              )}
            </div>
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
