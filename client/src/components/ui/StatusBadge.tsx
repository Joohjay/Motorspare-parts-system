interface StatusBadgeProps {
  status: 'up' | 'down' | 'loading' | 'error';
  label?: string;
}

const badgeClasses: Record<StatusBadgeProps['status'], string> = {
  up: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  down: 'bg-red-50 text-red-700 ring-red-200',
  loading: 'bg-slate-100 text-slate-600 ring-slate-200',
  error: 'bg-red-50 text-red-700 ring-red-200',
};

const defaultLabels: Record<StatusBadgeProps['status'], string> = {
  up: 'Up',
  down: 'Down',
  loading: 'Loading',
  error: 'Error',
};

export function StatusBadge({ status, label }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${badgeClasses[status]}`}
    >
      <span
        className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${status === 'up' ? 'bg-emerald-500' : status === 'down' || status === 'error' ? 'bg-red-500' : 'bg-slate-400'}`}
      />
      {label ?? defaultLabels[status]}
    </span>
  );
}