const colors: Record<string, string> = {
  QUEUED:    'bg-gray-100 text-gray-700',
  RUNNING:   'bg-blue-100 text-blue-700 animate-pulse',
  PASSED:    'bg-green-100 text-green-700',
  FAILED:    'bg-red-100 text-red-700',
  CANCELLED: 'bg-yellow-100 text-yellow-700',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${colors[status] ?? ''}`}>
      {status}
    </span>
  );
}
