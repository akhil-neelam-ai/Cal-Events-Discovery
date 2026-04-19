const KEY = 'cal-events:recent-v1';
const MAX = 8;

export function getRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function addRecentSearch(q: string): void {
  const trimmed = q.trim();
  if (!trimmed || trimmed.length < 2) return;
  try {
    const current = getRecentSearches().filter(s => s.toLowerCase() !== trimmed.toLowerCase());
    localStorage.setItem(KEY, JSON.stringify([trimmed, ...current].slice(0, MAX)));
  } catch { /* storage full or blocked — safe to ignore */ }
}

export function clearRecentSearches(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
