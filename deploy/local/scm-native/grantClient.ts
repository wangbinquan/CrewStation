import { ProjectDeletionContextSchema } from '../../../packages/contracts';
import type { ProjectDeletionContext } from '../../../packages/contracts';

/** A short, uncached check against the durable owner immediately before native effects. */
export function nativeDeletionGrantClient(input: { url: string; token: string; fetch?: typeof fetch }) {
  const url = new URL(input.url), fetcher = input.fetch ?? fetch, token = input.token;
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search
    || url.pathname !== '/internal/project-deletion/grant' || token.length < 32) throw Error('native-controller-grant-configuration');
  return async (raw: ProjectDeletionContext, signal: AbortSignal) => {
    const context = ProjectDeletionContextSchema.parse(raw), body = JSON.stringify(context);
    if (Buffer.byteLength(body) > 8_388_608) throw Error('native-controller-grant-budget');
    const response = await fetcher(url, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) });
    await response.body?.cancel(); if (response.status !== 204) throw Error('native-controller-grant-denied');
  };
}
