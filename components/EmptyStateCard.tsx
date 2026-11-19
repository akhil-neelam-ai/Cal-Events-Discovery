import { EmptyStateConfig } from "../utils/emptyState";

export function EmptyStateCard({ state }: { state: EmptyStateConfig }) {
  return (
    <div className="sheet-plain beside">
      <p className="what s2">{state.title}</p>
      <p>{state.description}</p>
      <div className="sheet-actions">
        <button
          type="button"
          onClick={state.primaryAction}
          className="btn-toner"
        >
          {state.primaryLabel}
        </button>
        {state.secondaryLabel && state.secondaryAction && (
          <button
            type="button"
            onClick={state.secondaryAction}
            className="btn-line"
          >
            {state.secondaryLabel}
          </button>
        )}
      </div>
    </div>
  );
}
