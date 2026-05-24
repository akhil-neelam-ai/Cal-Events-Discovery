import React from "react";

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  React.PropsWithChildren,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
          <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-lg">
            <h1 className="mb-2 text-xl font-bold text-berkeley-blue">
              Something went wrong
            </h1>
            <p className="mb-6 text-sm text-slate-600">
              The events page hit an unexpected error. Reload to try again.
            </p>
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-xl bg-berkeley-blue px-5 py-2.5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berkeley-gold focus-visible:ring-offset-2"
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
