import type { AppIconSource } from '@crewstation/contracts';
import { validAppIconUrl } from '@crewstation/contracts';

export function applicationOrigin(host?: string): string | undefined {
  return host && /^[a-z\d][a-z\d.-]*(?::\d+)?$/i.test(host) ? `${location.protocol === 'https:' ? 'https:' : 'http:'}//${host}` : undefined;
}
export function appIconSources(projectId: string, source: AppIconSource | undefined, origin?: string): string[] {
  const candidates: string[] = [];
  if (source?.kind === 'upload') candidates.push(`/v1/apps/${encodeURIComponent(projectId)}/icon?revision=${source.revision}`);
  if (source?.kind === 'url' && validAppIconUrl(source.url)) {
    try {
      const url = source.url.startsWith('/') ? origin ? new URL(source.url, origin) : undefined : new URL(source.url);
      if (url && (location.protocol !== 'https:' || url.protocol === 'https:')) candidates.push(url.href);
    } catch { /* A malformed source must never block the application entry. */ }
  }
  if (origin) candidates.push(`${origin}/favicon.ico`);
  return [...new Set(candidates)];
}
