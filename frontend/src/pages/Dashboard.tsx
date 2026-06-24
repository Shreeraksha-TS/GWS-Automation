import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ListChecks, PlayCircle, CheckCircle2, CalendarClock } from 'lucide-react';
import { tasksApi, executionsApi, schedulesApi } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { timeAgo, duration } from '../lib/format';
import type { Task, Execution, Schedule } from '../types';

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string | number;
  icon: typeof ListChecks;
  accent: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${accent}`}>
        <Icon className="w-6 h-6" />
      </div>
      <div>
        <div className="text-2xl font-bold text-slate-800">{value}</div>
        <div className="text-sm text-slate-500">{label}</div>
      </div>
    </div>
  );
}

export function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [execs, setExecs] = useState<Execution[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);

  async function load() {
    try {
      const [t, e, s] = await Promise.all([
        tasksApi.list(),
        executionsApi.list(),
        schedulesApi.list(),
      ]);
      setTasks(t.data);
      setExecs(e.data);
      setSchedules(s.data);
    } catch {
      /* transient API hiccup — keep last good data */
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 15000); // auto-refresh every 15s
    return () => clearInterval(id);
  }, []);

  const taskName = (id: string) => tasks.find((t) => t.id === id)?.name ?? id.slice(0, 8);

  const today = new Date().toDateString();
  const todaysRuns = execs.filter((e) => new Date(e.created_at).toDateString() === today).length;

  const finished = execs.filter((e) => e.status === 'PASSED' || e.status === 'FAILED');
  const passed = finished.filter((e) => e.status === 'PASSED').length;
  const passRate = finished.length ? Math.round((passed / finished.length) * 100) : 0;

  const activeSchedules = schedules.filter((s) => s.is_active).length;
  const recent = execs.slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Tasks" value={tasks.length} icon={ListChecks} accent="bg-indigo-100 text-indigo-600" />
        <StatCard label="Today's Runs" value={todaysRuns} icon={PlayCircle} accent="bg-blue-100 text-blue-600" />
        <StatCard label="Pass Rate" value={`${passRate}%`} icon={CheckCircle2} accent="bg-green-100 text-green-600" />
        <StatCard label="Active Schedules" value={activeSchedules} icon={CalendarClock} accent="bg-amber-100 text-amber-600" />
      </div>

      <div className="bg-white rounded-xl border border-slate-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">Recent Executions</h2>
          <Link to="/executions" className="text-sm text-indigo-600 hover:underline">
            View all
          </Link>
        </div>
        {recent.length === 0 ? (
          <div className="px-5 py-10 text-center text-slate-400 text-sm">No executions yet.</div>
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
              {recent.map((e) => (
                <tr key={e.id} className="border-b border-slate-50 hover:bg-slate-50">
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
    </div>
  );
}
