/**
 * Connects to WS /ws/executions/{id}/logs and renders a live scrolling terminal.
 * Falls back to HTTP polling (/api/executions/{id}/logs) for finished executions.
 */
import { useEffect, useRef, useState } from 'react';

const levelColors: Record<string, string> = {
  INFO:    'text-gray-300',
  KEYWORD: 'text-blue-400',
  WARN:    'text-yellow-400',
  ERROR:   'text-red-400',
  DEBUG:   'text-gray-500',
};

export function LogViewer({ executionId, status }: { executionId: string; status: string }) {
  const [logs, setLogs] = useState<Array<{ id: number; level: string; message: string; timestamp: string }>>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const BASE = import.meta.env.VITE_API_BASE_URL || '';
  const BASE_WS = BASE.replace(/^http/, 'ws');

  useEffect(() => {
    if (!executionId) return;

    // Reset when switching executions so logs don't accumulate across selections.
    setLogs([]);

    const isLive = status === 'RUNNING' || status === 'QUEUED';

    if (isLive) {
      const ws = new WebSocket(`${BASE_WS}/ws/executions/${executionId}/logs`);
      ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type === 'done') {
          ws.close();
          return;
        }
        setLogs(prev => [...prev, data]);
      };
      return () => ws.close();
    } else {
      // Fetch all logs for finished executions (respect the configured API base)
      fetch(`${BASE}/api/executions/${executionId}/logs`)
        .then(r => r.json())
        .then(setLogs)
        .catch(() => setLogs([]));
    }
  }, [executionId, status]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="bg-gray-900 rounded-lg p-4 h-96 overflow-y-auto font-mono text-sm">
      {logs.map(log => (
        <div key={log.id} className="flex gap-2 py-0.5">
          <span className="text-gray-600 shrink-0 text-xs">
            {new Date(log.timestamp).toLocaleTimeString()}
          </span>
          <span className={`shrink-0 text-xs w-14 ${levelColors[log.level]}`}>
            {log.level}
          </span>
          <span className={levelColors[log.level]}>{log.message}</span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
