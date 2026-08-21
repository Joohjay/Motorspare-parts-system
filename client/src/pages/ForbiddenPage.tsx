import { Link } from 'react-router-dom';

export function ForbiddenPage() {
  return (
    <div className="flex flex-col items-center py-20 text-center">
      <p className="text-6xl font-bold text-slate-300">403</p>
      <h1 className="mt-4 text-xl font-semibold text-slate-900">Forbidden</h1>
      <p className="mt-2 text-sm text-slate-500">
        You do not have permission to view this page.
      </p>
      <Link
        to="/"
        className="mt-6 text-sm font-medium text-brand-600 hover:text-brand-500"
      >
        Back to home
      </Link>
    </div>
  );
}