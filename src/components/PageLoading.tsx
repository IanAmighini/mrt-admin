export function PageLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-6 w-48 rounded bg-black/10" />
        <div className="h-4 w-72 rounded bg-black/5" />
      </div>
      <div className="space-y-2">
        <div className="h-24 rounded-lg bg-black/5" />
        <div className="h-4 w-full rounded bg-black/5" />
        <div className="h-4 w-full rounded bg-black/5" />
        <div className="h-4 w-3/4 rounded bg-black/5" />
      </div>
    </div>
  );
}
