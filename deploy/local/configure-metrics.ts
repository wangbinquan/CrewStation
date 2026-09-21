/** Installation-only credential generation. Values travel over stdin and are never logged. */
import { randomBytes } from 'node:crypto';

const namespace = process.env.CS_SYSTEM_NAMESPACE ?? 'crewstation-system';
async function kubectl(args: string[], input?: string) {
  const child = Bun.spawn(['kubectl', '-n', namespace, ...args], { stdin: input ? new Blob([input]) : 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const [status, out, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { status, out, error };
}
const existing = await kubectl(['get', 'secret', 'crewstation-metrics', '--ignore-not-found', '-o', 'json']);
if (existing.status) throw new Error(`Cannot read metrics credentials: ${existing.error}`);
const old = existing.out.trim() ? JSON.parse(existing.out) as { data?: Record<string, string> } : {};
const data = { ...old.data };
for (const key of ['CS_CLUSTER_METRICS_TOKEN', 'CS_PROMETHEUS_TOKEN', 'CS_STORAGE_PROBE_TOKEN']) data[key] ??= randomBytes(32).toString('hex');
for (const key of ['CS_CLUSTER_METRICS_TOKEN', 'CS_PROMETHEUS_TOKEN', 'CS_STORAGE_PROBE_TOKEN']) if (!old.data?.[key]) data[key] = Buffer.from(data[key]!).toString('base64');
if (!data['web.yml']) {
  const hash = await Bun.password.hash(Buffer.from(data.CS_PROMETHEUS_TOKEN!, 'base64').toString(), { algorithm: 'bcrypt', cost: 10 });
  data['web.yml'] = Buffer.from(`basic_auth_users:\n  crewstation: ${hash}\n`).toString('base64');
}
const result = await kubectl(['apply', '-f', '-'], JSON.stringify({ apiVersion: 'v1', kind: 'Secret', metadata: { name: 'crewstation-metrics', namespace }, type: 'Opaque', data }));
if (result.status) throw new Error('Cannot apply metrics credentials');
console.log('Dedicated metrics credentials are ready (existing values preserved).');
