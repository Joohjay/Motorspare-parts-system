import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Only generic diagnostics — never secrets.
    console.error('AppErrorBoundary caught an error', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
          <div className="max-w-md rounded-xl border border-slate-800 bg-slate-900 p-8 text-center">
            <h1 className="text-lg font-semibold">Something went wrong</h1>
            <p className="mt-2 text-sm text-slate-400">
              JM SPAREPARTS hit an unexpected error. Reload the page to
              continue.
            </p>
            <button
              type="button"
              className="mt-6 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium hover:bg-brand-500"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}