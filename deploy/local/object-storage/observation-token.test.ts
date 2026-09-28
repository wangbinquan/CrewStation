import { afterEach, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'cs-object-monitor-')); directories.push(dir);
  const secret = join(dir, 'secret.json'), request = join(dir, 'issued.json');
  writeFileSync(join(dir, 'kubectl'), `#!/usr/bin/env bun
const args = process.argv.slice(2).join(' '), secret = process.env.TEST_SECRET, request = process.env.TEST_REQUEST;
if (!args.includes('--context docker-desktop')) process.exit(8);
if (args.includes('get secret')) { if (await Bun.file(secret).exists()) console.log(await Bun.file(secret).text()); }
else if (args.includes('CreateAdminToken -')) { await Bun.write(request, await Bun.stdin.text()); if (process.env.TEST_FAIL === '1') process.exit(1); console.log(JSON.stringify({secretToken:'0011223344.only-two-read-scopes'})); }
else if (args.includes('create -f -')) { const value = JSON.parse(await Bun.stdin.text()); value.data = Object.fromEntries(Object.entries(value.stringData).map(([k,v]) => [k,Buffer.from(v).toString('base64')])); delete value.stringData; await Bun.write(secret, JSON.stringify(value)); }
else process.exit(9);
`); chmodSync(join(dir, 'kubectl'), 0o755);
  const run = async (extra: Record<string, string> = {}) => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, 'observation-token.ts')], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TEST_SECRET: secret, TEST_REQUEST: request, ...extra }, stdout: 'pipe', stderr: 'pipe' });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]); return { code, out, err };
  };
  return { secret, request, run };
}
test('installer issues only health and capacity scope over stdin and preserves the existing observation identity', async () => {
  const f = fixture(), result = await f.run(); expect(result.code).toBe(0);
  expect(JSON.parse(readFileSync(f.request, 'utf8'))).toEqual({ name: 'crewstation-observation', neverExpires: true, scope: ['GetClusterStatus', 'GetClusterHealth'] });
  expect(`${result.out}${result.err}`).not.toContain('only-two-read-scopes');
  const prior = readFileSync(f.secret, 'utf8'); writeFileSync(f.request, 'not invoked');
  expect((await f.run()).code).toBe(0); expect(readFileSync(f.secret, 'utf8')).toBe(prior); expect(readFileSync(f.request, 'utf8')).toBe('not invoked');
});
test('failed issuance and malformed existing secrets are never reported ready or replaced', async () => {
  const f = fixture(); expect((await f.run({ TEST_FAIL: '1' })).code).toBe(1); expect(await Bun.file(f.secret).exists()).toBe(false);
  writeFileSync(f.secret, JSON.stringify({ data: { wrongKey: 'dG9rZW4=' } })); const prior = readFileSync(f.secret, 'utf8');
  expect((await f.run()).code).toBe(1); expect(readFileSync(f.secret, 'utf8')).toBe(prior);
});
