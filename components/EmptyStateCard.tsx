import { EmptyStateConfig } from "../utils/emptyState";

export function EmptyStateCard({ state }: { state: EmptyStateConfig }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white px-6 py-14 text-center shadow-xs">
      <p className="text-2xl font-semibold text-berkeley-blue md:font-serif">
        {state.title}
      </p>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-500">
        {state.description}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={state.primaryAction}
          className="rounded-full bg-berkeley-blue px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-berkeley-medblue"
        >
          {state.primaryLabel}
        </button>
        {state.secondaryLabel && state.secondaryAction && (
          <button
            type="button"
            onClick={state.secondaryAction}
            className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            {state.secondaryLabel}
          </button>
        )}
      </div>
    </div>
  );
}
