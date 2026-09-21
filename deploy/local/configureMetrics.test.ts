import { afterEach, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
test('metrics installer creates dedicated credentials once and preserves existing values on rerun', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-metrics-install-')); directories.push(dir);
  writeFileSync(join(dir, 'kubectl'), `#!/bin/sh\ncase "$*" in\n *'get secret'*) test ! -f "$TEST_SECRET" || cat "$TEST_SECRET" ;;\n *'apply -f -'*) cat > "$TEST_SECRET" ;;\n *) exit 1 ;;\nesac\n`); chmodSync(join(dir, 'kubectl'), 0o755);
  const run = async () => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, 'configure-metrics.ts')], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TEST_SECRET: join(dir, 'secret.json') }, stdout: 'pipe', stderr: 'pipe' });
    const [code, out, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(error).toBe(''); expect(code).toBe(0); return out;
  };
  const output = await run(), first = readFileSync(join(dir, 'secret.json'), 'utf8'), secret = JSON.parse(first) as { data: Record<string, string> };
  const tokens = ['CS_CLUSTER_METRICS_TOKEN', 'CS_PROMETHEUS_TOKEN', 'CS_STORAGE_PROBE_TOKEN'].map((k) => Buffer.from(secret.data[k]!, 'base64').toString());
  expect(new Set(tokens).size).toBe(3); for (const token of tokens) { expect(token).toHaveLength(64); expect(output).not.toContain(token); }
  expect(Buffer.from(secret.data['web.yml']!, 'base64').toString()).toContain('basic_auth_users:');
  await run(); expect(readFileSync(join(dir, 'secret.json'), 'utf8')).toBe(first);
});
