import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Trash2, ListChecks, X } from 'lucide-react';
import { tasksApi } from '../api/client';
import { shortDateTime } from '../lib/format';
import type { Task } from '../types';

export function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [runTarget, setRunTarget] = useState<Task | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const navigate = useNavigate();

  function flash(kind: 'ok' | 'err', msg: string) {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 3500);
  }

  async function load() {
    try {
      const { data } = await tasksApi.list();
      setTasks(data);
    } catch {
      flash('err', 'Failed to load tasks');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleDelete(task: Task) {
    if (!confirm(`Delete task "${task.name}"? This removes its JSON record.`)) return;
    try {
      await tasksApi.delete(task.id);
      flash('ok', `Deleted "${task.name}"`);
      load();
    } catch {
      flash('err', 'Delete failed');
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {tasks.length === 0 ? (
          <div className="px-5 py-10 text-center text-slate-400 text-sm">
            No tasks yet. Drop a <code>task.robot</code> + <code>task_config.json</code> into
            <code> scripts/</code> and restart the API.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Tags</th>
                <th className="px-5 py-3 font-medium">Script path</th>
                <th className="px-5 py-3 font-medium">Created</th>
                <th className="px-5 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50 align-top">
                  <td className="px-5 py-3">
                    <div className="font-medium text-slate-800">{t.name}</div>
                    {t.description && (
                      <div className="text-xs text-slate-400 max-w-md mt-0.5">{t.description}</div>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(t.tags ?? []).map((tag) => (
                        <span key={tag} className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-500">{t.script_path}</td>
                  <td className="px-5 py-3 text-slate-500">{shortDateTime(t.created_at)}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setRunTarget(t)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700"
                      >
                        <Play className="w-3.5 h-3.5" /> Run
                      </button>
                      <button
                        onClick={() => navigate(`/executions?task=${t.id}`)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200"
                      >
                        <ListChecks className="w-3.5 h-3.5" /> Executions
                      </button>
                      <button
                        onClick={() => handleDelete(t)}
                        className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-red-600 hover:bg-red-50"
                        title="Delete task"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {runTarget && (
        <RunModal
          task={runTarget}
          onClose={() => setRunTarget(null)}
          onRan={(id) => {
            flash('ok', `Run queued (${id.slice(0, 8)})`);
            setRunTarget(null);
            navigate('/executions');
          }}
          onError={() => flash('err', 'Failed to start run')}
        />
      )}

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

function RunModal({
  task,
  onClose,
  onRan,
  onError,
}: {
  task: Task;
  onClose: () => void;
  onRan: (executionId: string) => void;
  onError: () => void;
}) {
  const fields = task.params ?? [];
  const hasFields = fields.length > 0;

  // Form-field mode: one value per declared param (pre-filled with any default).
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, f.default ?? '']))
  );
  // JSON mode (fallback for tasks that declare no params).
  const [paramsText, setParamsText] = useState('{}');

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function buildParams(): Record<string, unknown> | null {
    if (hasFields) {
      const missing = fields.find((f) => f.required && !values[f.name]?.trim());
      if (missing) {
        setError(`${missing.label ?? missing.name} is required.`);
        return null;
      }
      const params: Record<string, unknown> = {};
      for (const f of fields) {
        const v = values[f.name]?.trim();
        if (!v) continue;                                   // skip empty optional fields
        params[f.name] = f.type === 'number' ? Number(v) : v;
      }
      return params;
    }
    try {
      const params = JSON.parse(paramsText || '{}');
      if (typeof params !== 'object' || Array.isArray(params)) throw new Error();
      return params;
    } catch {
      setError('Params must be a JSON object, e.g. {"ENV": "staging"}');
      return null;
    }
  }

  async function submit() {
    const params = buildParams();
    if (!params) return;
    setBusy(true);
    try {
      const { data } = await tasksApi.run(task.id, params);
      onRan(data.id);
    } catch {
      onError();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-md p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-slate-800">Run “{task.name}”</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {hasFields ? (
          <div className="space-y-3">
            {fields.map((f) => (
              <div key={f.name}>
                <label className="block text-sm text-slate-600 mb-1">
                  {f.label ?? f.name}
                  {f.required && <span className="text-red-500 ml-0.5">*</span>}
                </label>
                <input
                  type={f.type === 'number' ? 'number' : 'text'}
                  value={values[f.name] ?? ''}
                  placeholder={f.placeholder}
                  onChange={(e) => {
                    setValues((v) => ({ ...v, [f.name]: e.target.value }));
                    setError(null);
                  }}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
            ))}
          </div>
        ) : (
          <>
            <label className="block text-sm text-slate-600 mb-1">Robot params (optional, JSON)</label>
            <textarea
              value={paramsText}
              onChange={(e) => { setParamsText(e.target.value); setError(null); }}
              rows={4}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </>
        )}

        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 text-sm">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? 'Starting…' : 'Run task'}
          </button>
        </div>
      </div>
    </div>
  );
}
