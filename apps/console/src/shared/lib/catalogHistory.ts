/** Per-user, per-filter cursor history. A shared deep link can always return to page one. */
export function catalogHistory(scope: string, userId: string | undefined, filter: unknown, cursor?: string) {
  const key = `cs-catalog:${scope}:${userId ?? ''}:${JSON.stringify(filter)}`;
  const read = (): Record<string, string> => {
    try { const data: unknown = JSON.parse(sessionStorage.getItem(key) ?? '{}'); return data && typeof data === 'object' && !Array.isArray(data) ? Object.fromEntries(Object.entries(data).filter(([name, value]) => name.length <= 2048 && typeof value === 'string' && value.length <= 2048)) : {}; } catch { return {}; }
  };
  return {
    previous: cursor && Object.hasOwn(read(), cursor) ? read()[cursor] : undefined,
    remember: (next: string) => { if (!userId) return; try { sessionStorage.setItem(key, JSON.stringify({ ...Object.fromEntries(Object.entries(read()).slice(-99)), [next]: cursor ?? '' })); } catch { /* Storage is optional. */ } },
    clear: () => { try { sessionStorage.removeItem(key); } catch { /* Storage is optional. */ } },
  };
}
