import { afterEach, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dirs: string[] = [];
afterEach(() => { for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'cs-garage-install-')); dirs.push(dir);
  const secret = join(dir, 'secret.json');
  writeFileSync(join(dir, 'kubectl'), `#!/usr/bin/env bun
const args = process.argv.slice(2).join(' '), path = process.env.TEST_SECRET;
if (args.includes('get secret')) { if (await Bun.file(path).exists()) console.log(await Bun.file(path).text()); }
else if (args.includes('get pvc')) console.log(JSON.stringify({ items: process.env.TEST_PVC_EXISTS === '1' ? [{metadata:{name:'data-garage-0'}}] : [] }));
else if (args.includes('create -f -')) { const value = JSON.parse(await Bun.stdin.text()); value.data = Object.fromEntries(Object.entries(value.stringData).map(([k,v]) => [k,Buffer.from(v).toString('base64')])); delete value.stringData; await Bun.write(path, JSON.stringify(value)); }
else process.exit(1);
`); chmodSync(join(dir, 'kubectl'), 0o755);
  const run = async (extra: Record<string, string> = {}) => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, 'configure.ts')], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TEST_SECRET: secret, ...extra }, stdout: 'pipe', stderr: 'pipe' });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]); return { code, out, err };
  };
  return { secret, run };
}
test('Garage credentials are created once, travel only over stdin and preserve the existing identity on reinstall', async () => {
  const f = fixture(), result = await f.run(); expect(result.code).toBe(0);
  const original = readFileSync(f.secret, 'utf8'), value = JSON.parse(original) as { data: Record<string, string> };
  for (const encoded of Object.values(value.data)) expect(`${result.out}${result.err}`).not.toContain(Buffer.from(encoded, 'base64').toString());
  expect(Buffer.from(value.data.GARAGE_DEFAULT_ACCESS_KEY!, 'base64').toString()).toMatch(/^GK[0-9a-f]{32}$/);
  expect((await f.run()).code).toBe(0); expect(readFileSync(f.secret, 'utf8')).toBe(original);
});
test('missing credentials with old volumes fail closed; incomplete existing credentials are never regenerated', async () => {
  const f = fixture(); expect((await f.run({ TEST_PVC_EXISTS: '1' })).code).toBe(1);
  writeFileSync(f.secret, JSON.stringify({ data: { GARAGE_DEFAULT_ACCESS_KEY: 'a2V5' } }));
  const before = readFileSync(f.secret, 'utf8');
  expect((await f.run()).code).toBe(1); expect(readFileSync(f.secret, 'utf8')).toBe(before);
});
