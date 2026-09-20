export type AuthenticationTab = 'methods' | 'fields';
export function parseAuthenticationSearch(search: Record<string, unknown>): { tab: AuthenticationTab } {
  return { tab: search.tab === 'fields' ? 'fields' : 'methods' };
}
