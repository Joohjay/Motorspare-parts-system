interface StatusPillProps {
  status: string;
}

const statusClasses: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  INACTIVE: 'bg-red-50 text-red-700 ring-red-200',
};

export function StatusPill({ status }: StatusPillProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusClasses[status] ?? 'bg-slate-100 text-slate-600 ring-slate-200'}`}
    >
      {status}
    </span>
  );
}