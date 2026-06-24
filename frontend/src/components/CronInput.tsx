/**
 * Cron expression input with quick presets and lightweight client-side validation.
 * Validation here is a 5-field sanity check only; the backend uses croniter as the
 * authoritative validator on submit.
 */
const presets: Array<{ label: string; expr: string }> = [
  { label: 'Every minute',   expr: '* * * * *' },
  { label: 'Every 5 min',    expr: '*/5 * * * *' },
  { label: 'Hourly',         expr: '0 * * * *' },
  { label: 'Daily 09:00',    expr: '0 9 * * *' },
  { label: 'Weekdays 09:00', expr: '0 9 * * 1-5' },
];

export function isLikelyValidCron(expr: string): boolean {
  return expr.trim().split(/\s+/).length === 5;
}

export function CronInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const valid = value.trim() === '' || isLikelyValidCron(value);

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. 0 9 * * 1-5"
        className={`w-full rounded-lg border px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 ${
          valid
            ? 'border-slate-300 focus:ring-indigo-400'
            : 'border-red-400 focus:ring-red-400'
        }`}
      />
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <button
            key={p.expr}
            type="button"
            onClick={() => onChange(p.expr)}
            className="px-2 py-1 text-xs rounded-md bg-slate-100 text-slate-600 hover:bg-indigo-100 hover:text-indigo-700"
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-400">
        Format: <span className="font-mono">minute hour day month day-of-week</span>
      </p>
    </div>
  );
}
