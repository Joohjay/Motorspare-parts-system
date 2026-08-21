import type { StockStatus } from '@/types/api';
import { stockStatusLabels } from '@/lib/inventoryApi';

interface StockStatusPillProps {
  status: StockStatus;
}

const classes: Record<StockStatus, string> = {
  HEALTHY: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  LOW_STOCK: 'bg-amber-50 text-amber-700 ring-amber-200',
  OUT_OF_STOCK: 'bg-red-50 text-red-700 ring-red-200',
};

const icons: Record<StockStatus, string> = {
  HEALTHY: 'M5 13l4 4L19 7',
  LOW_STOCK: 'M12 9v4m0 4h.01',
  OUT_OF_STOCK: 'M6 18L18 6M6 6l12 12',
};

export function StockStatusPill({ status }: StockStatusPillProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${classes[status]}`}
      title={stockStatusLabels[status]}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5"
        aria-hidden="true"
      >
        <path d={icons[status]} />
      </svg>
      {stockStatusLabels[status]}
    </span>
  );
}