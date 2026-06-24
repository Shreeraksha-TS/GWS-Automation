import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, ListChecks, PlayCircle, CalendarClock, Bot } from 'lucide-react';

const nav = [
  { to: '/',           label: 'Dashboard',  icon: LayoutDashboard, end: true },
  { to: '/tasks',      label: 'Tasks',      icon: ListChecks,      end: false },
  { to: '/executions', label: 'Executions', icon: PlayCircle,      end: false },
  { to: '/schedules',  label: 'Schedules',  icon: CalendarClock,   end: false },
];

const titles: Record<string, string> = {
  '/': 'Dashboard',
  '/tasks': 'Tasks',
  '/executions': 'Executions',
  '/schedules': 'Schedules',
};

export function Layout() {
  const { pathname } = useLocation();
  const title = titles[pathname] ?? 'RPA Platform';

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 bg-slate-900 text-slate-200 flex flex-col">
        <div className="flex items-center gap-2 px-5 h-16 border-b border-slate-800">
          <Bot className="w-6 h-6 text-indigo-400" />
          <span className="font-semibold text-lg tracking-tight">RPA Platform</span>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <Icon className="w-5 h-5" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-4 text-xs text-slate-500 border-t border-slate-800">
          Phase 1 POC · File-based
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center px-8">
          <h1 className="text-xl font-semibold text-slate-800">{title}</h1>
        </header>
        <main className="flex-1 overflow-y-auto p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
