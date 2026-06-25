import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Trash2, ListChecks, X, Plus, Pencil } from 'lucide-react';
import { tasksApi } from '../api/client';
import { shortDateTime } from '../lib/format';
import type { Task } from '../types';

export function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [runTarget, setRunTarget] = useState<Task | null>(null);
  const [editTarget, setEditTarget] = useState<Task | null>(null);
  const [addOpen, setAddOpen] = useState(false);
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
      <div className="flex justify-end">
        <button
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
        >
          <Plus className="w-4 h-4" /> Add Task
        </button>
      </div>

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
                        onClick={() => setEditTarget(t)}
                        className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-slate-600 hover:bg-slate-100"
                        title="Edit task"
                      >
                        <Pencil className="w-3.5 h-3.5" />
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

      {addOpen && (
        <AddTaskModal
          existing={tasks}
          onClose={() => setAddOpen(false)}
          onAdded={(name) => {
            flash('ok', `Added "${name}"`);
            setAddOpen(false);
            load();
          }}
          onError={(msg) => flash('err', msg)}
        />
      )}

      {editTarget && (
        <EditTaskModal
          task={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={(name) => {
            flash('ok', `Updated "${name}"`);
            setEditTarget(null);
            load();
          }}
          onError={(msg) => flash('err', msg)}
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
  const requiredKeys = fields.filter((f) => f.required).map((f) => f.name);

  // Declared params -> fixed rows (key locked). No declared params -> an editable
  // key-value editor (add/remove your own pairs at run time).
  const [pairs, setPairs] = useState<{ key: string; value: string }[]>(() =>
    hasFields ? fields.map((f) => ({ key: f.name, value: f.default ?? '' })) : [{ key: '', value: '' }]
  );

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function updatePair(i: number, patch: Partial<{ key: string; value: string }>) {
    setPairs((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
    setError(null);
  }

  function buildParams(): Record<string, unknown> | null {
    const params: Record<string, unknown> = {};
    for (const p of pairs) {
      const key = p.key.trim();
      if (!key && !p.value.trim()) continue;                // skip fully-blank rows
      if (!key) { setError('Each parameter needs a key.'); return null; }
      if (key in params) { setError(`Duplicate key "${key}".`); return null; }
      params[key] = p.value;
    }
    // Enforce required keys declared by the task.
    for (const f of fields) {
      if (f.required && !String(params[f.name] ?? '').trim()) {
        setError(`"${f.name}" is required.`);
        return null;
      }
    }
    return params;
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

        <div>
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

function AddTaskModal({
  existing,
  onClose,
  onAdded,
  onError,
}: {
  existing: Task[];
  onClose: () => void;
  onAdded: (name: string) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scriptPath, setScriptPath] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [mode, setMode] = useState<'scaffold' | 'upload'>('scaffold');
  const [scriptContent, setScriptContent] = useState('');
  const [uploadName, setUploadName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadName(file.name);
    file.text().then((text) => { setScriptContent(text); setError(null); });
  }

  async function add() {
    const trimmedName = name.trim();
    const trimmedPath = scriptPath.trim();
    if (!trimmedName) return setError('Name is required.');
    if (!trimmedPath) return setError('Script path is required.');
    if (existing.some((t) => t.script_path === trimmedPath))
      return setError(`A task for "${trimmedPath}" already exists.`);
    if (mode === 'upload' && !scriptContent.trim())
      return setError('Choose a .ts file to upload (or switch to Scaffold).');

    const tags = tagsText.split(',').map((t) => t.trim()).filter(Boolean);
    setBusy(true);
    try {
      await tasksApi.create({
        name: trimmedName,
        description: description.trim() || null,
        script_path: trimmedPath,
        tags,
        params: [],   // set parameters later via Edit Task
        ...(mode === 'upload' ? { script_content: scriptContent } : {}),
      });
      onAdded(trimmedName);
    } catch (e: any) {
      onError(e?.response?.data?.error ?? 'Failed to add task');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-lg p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-slate-800">Add Task</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-sm text-slate-600 mb-1">
              Name<span className="text-red-500 ml-0.5">*</span>
            </label>
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); setError(null); }}
              placeholder="Open Google"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-600 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What this task does…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-600 mb-1">
              Script path<span className="text-red-500 ml-0.5">*</span>
            </label>
            <input
              value={scriptPath}
              onChange={(e) => { setScriptPath(e.target.value); setError(null); }}
              placeholder="open_google/task.ts"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <p className="text-xs text-slate-400 mt-1">
              Relative to <code>scripts/</code>, e.g. <code>open_x/task.ts</code>.
            </p>
          </div>

          <div>
            <label className="block text-sm text-slate-600 mb-1">Script source</label>
            <div className="flex gap-2 mb-2">
              {(['scaffold', 'upload'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(m); setError(null); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                    mode === m ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {m === 'scaffold' ? 'Generate starter' : 'Upload .ts file'}
                </button>
              ))}
            </div>
            {mode === 'scaffold' ? (
              <p className="text-xs text-slate-400">
                A runnable starter <code>task.ts</code> is generated from your Run fields below.
              </p>
            ) : (
              <div>
                <input type="file" accept=".ts" onChange={onFile} className="text-xs text-slate-600" />
                {uploadName && <p className="text-xs text-green-600 mt-1">Loaded {uploadName} ({scriptContent.length} chars)</p>}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm text-slate-600 mb-1">Tags</label>
            <input
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="smoke, browser"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <p className="text-xs text-slate-400 mt-1">Comma-separated.</p>
          </div>
        </div>

        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 text-sm">
            Cancel
          </button>
          <button
            onClick={add}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? 'Adding…' : 'Add Task'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditTaskModal({
  task,
  onClose,
  onSaved,
  onError,
}: {
  task: Task;
  onClose: () => void;
  onSaved: (name: string) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(task.name);
  const [description, setDescription] = useState(task.description ?? '');
  const [tagsText, setTagsText] = useState((task.tags ?? []).join(', '));
  const [paramKeysText, setParamKeysText] = useState((task.params ?? []).map((p) => p.name).join(', '));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const trimmedName = name.trim();
    if (!trimmedName) return setError('Name is required.');
    const tags = tagsText.split(',').map((t) => t.trim()).filter(Boolean);
    const keys = [...new Set(paramKeysText.split(',').map((k) => k.trim()).filter(Boolean))];
    const params = keys.map((k) => ({ name: k, label: k, type: 'text' as const, required: true }));
    setBusy(true);
    try {
      await tasksApi.update(task.id, { name: trimmedName, description: description.trim() || null, tags, params });
      onSaved(trimmedName);
    } catch (e: any) {
      onError(e?.response?.data?.error ?? 'Failed to update task');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-lg p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-slate-800">Edit Task</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-sm text-slate-600 mb-1">
              Name<span className="text-red-500 ml-0.5">*</span>
            </label>
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); setError(null); }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-600 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-600 mb-1">Script path</label>
            <input
              value={task.script_path}
              readOnly
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-500"
            />
            <p className="text-xs text-slate-400 mt-1">Script path can't be changed.</p>
          </div>

          <div>
            <label className="block text-sm text-slate-600 mb-1">Tags</label>
            <input
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="smoke, browser"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <p className="text-xs text-slate-400 mt-1">Comma-separated.</p>
          </div>

          <div>
            <label className="block text-sm text-slate-600 mb-1">Parameters</label>
            <input
              value={paramKeysText}
              onChange={(e) => { setParamKeysText(e.target.value); setError(null); }}
              placeholder="url, term"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <p className="text-xs text-slate-400 mt-1">
              Comma-separated keys the Run form will ask for. Leave empty if none.
            </p>
          </div>
        </div>

        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 text-sm">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
