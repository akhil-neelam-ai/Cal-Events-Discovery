export function LoadingStateView() {
  return (
    <div className="loading-chalk beside">
      <h3>Loading events</h3>
      <p className="motion-safe:animate-pulse">Fetching Berkeley events...</p>
    </div>
  );
}
