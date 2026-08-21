import {
  isRouteErrorResponse,
  Link,
  useRouteError,
} from 'react-router-dom';

export function RouteErrorPage() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unexpected error';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-6 text-center text-white">
      <h1 className="text-2xl font-bold tracking-tight">JM SPAREPARTS</h1>
      <p className="mt-3 text-sm text-slate-400">{message}</p>
      <Link
        to="/"
        className="mt-6 inline-block rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium hover:bg-brand-500"
      >
        Back to home
      </Link>
    </div>
  );
}