import { lstat, readFile } from 'node:fs/promises';

/** Reuse an explicitly supplied operator session, including OIDC-only installations. Never log its cookie. */
export async function registrationSession(input: { base: string; sessionFile?: string; username?: string; password?: string }, fetcher: typeof fetch = fetch) {
  if (input.sessionFile) {
    const file = await lstat(input.sessionFile);
    if (!file.isFile() || file.size > 16 * 1024 || (file.mode & 0o077) !== 0) throw new Error('Administrator session file must be a private regular file (0600) under 16 KiB');
    const cookie = (await readFile(input.sessionFile, 'utf8')).trim();
    if (!cookie || /[\r\n]/.test(cookie)) throw new Error('Administrator session file must contain one Cookie header value');
    const response = await fetcher(`${input.base}/v1/me`, { headers: { cookie }, signal: AbortSignal.timeout(15_000), redirect: 'error' });
    if (!response.ok || !(await response.json() as { isAdmin?: boolean }).isAdmin) throw new Error('The supplied session is not an active administrator');
    return { cookie, close: async () => {} }; // The caller owns this existing session.
  }
  if (!input.username || !input.password) throw new Error('Provide CS_OBJECT_STORAGE_SESSION_FILE or administrator credentials to register storage');
  const response = await fetcher(`${input.base}/auth/login`, { method: 'POST', signal: AbortSignal.timeout(30_000), redirect: 'manual', body: new URLSearchParams({ username: input.username, password: input.password }) });
  if (!response.ok || !(await response.json() as { user?: { isAdmin?: boolean } }).user?.isAdmin) throw new Error('Administrator login failed');
  const cookie = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  if (!cookie) throw new Error('Administrator session cookie missing');
  return { cookie, close: async () => { await fetcher(`${input.base}/auth/logout`, { method: 'POST', headers: { cookie }, signal: AbortSignal.timeout(15_000) }).catch(() => undefined); } };
}
