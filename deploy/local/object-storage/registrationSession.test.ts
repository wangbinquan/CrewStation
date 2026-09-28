import { expect, test } from 'bun:test';
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registrationSession } from './registrationSession';

test('OIDC operator session is read from a private file, checked and never logged out by registration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cs-object-session-')), path = join(directory, 'cookie');
  try {
    await writeFile(path, 'session=private', { mode: 0o600 }); let calls = 0;
    const session = await registrationSession({ base: 'http://console', sessionFile: path }, (async (url, init) => {
      calls++; expect(String(url)).toBe('http://console/v1/me'); expect(new Headers(init?.headers).get('cookie')).toBe('session=private'); return Response.json({ isAdmin: true });
    }) as typeof fetch);
    await session.close(); expect(calls).toBe(1);
    await expect(registrationSession({ base: 'http://console', sessionFile: path }, (async () => Response.json({ isAdmin: false })) as typeof fetch)).rejects.toThrow('administrator');
    await chmod(path, 0o644); await expect(registrationSession({ base: 'http://console', sessionFile: path })).rejects.toThrow('private');
    await chmod(path, 0o600); await symlink(path, join(directory, 'link')); await expect(registrationSession({ base: 'http://console', sessionFile: join(directory, 'link') })).rejects.toThrow('private');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('password login owns and closes only its newly created session; missing credentials fail before a request', async () => {
  await expect(registrationSession({ base: 'http://console' })).rejects.toThrow('Provide');
  const paths: string[] = [];
  const session = await registrationSession({ base: 'http://console', username: 'admin', password: 'secret' }, (async (url) => {
    paths.push(String(url)); return Response.json({ user: { isAdmin: true } }, { headers: { 'set-cookie': 'session=test; HttpOnly' } });
  }) as typeof fetch);
  expect(session.cookie).toBe('session=test'); await session.close(); expect(paths).toEqual(['http://console/auth/login', 'http://console/auth/logout']);
});
