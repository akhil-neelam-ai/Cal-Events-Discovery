export function LoadingStateView() {
  return (
    <div className="flex flex-col items-center justify-center py-20 space-y-4">
      <div className="relative">
        <div className="w-16 h-16 border-4 border-berkeley-blue/20 rounded-full" />
        <div className="absolute top-0 w-16 h-16 border-4 border-transparent border-t-berkeley-gold rounded-full animate-spin" />
      </div>
      <div className="text-center">
        <h3 className="text-berkeley-blue font-bold text-lg">Loading Events</h3>
        <p className="text-gray-500 text-sm animate-pulse">
          Fetching Berkeley events...
        </p>
      </div>
    </div>
  );
}
