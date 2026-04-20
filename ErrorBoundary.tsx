import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message?: string;
}

export default class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('App render failed:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-berkeley-lightgray px-4 py-16 text-gray-800">
          <div className="mx-auto max-w-xl rounded-3xl border border-red-200 bg-white p-8 text-center shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-red-600">App Error</p>
            <h1 className="mt-3 text-3xl font-semibold text-berkeley-blue md:font-serif">
              Something went wrong loading Cal Events.
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Try refreshing the page to reload the latest campus event snapshot.
            </p>
            {this.state.message && (
              <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-left text-xs text-red-700">
                {this.state.message}
              </p>
            )}
            <button
              type="button"
              onClick={this.handleReload}
              className="mt-6 rounded-full bg-berkeley-blue px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-berkeley-medblue"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
