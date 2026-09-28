/** Called after the platform is ready, with explicit administrator credentials in the environment. */
import { RegisterObjectBackendSchema } from '../../../packages/contracts';
import type { ObjectBackendDto, ObjectStoragePlanDto } from '../../../packages/contracts';
import { registrationSession } from './registrationSession';

const namespace = process.env.CS_SYSTEM_NAMESPACE ?? 'crewstation-system';
const base = process.env.CS_CONSOLE_URL ?? 'http://console.cs.localhost';
async function secret(name: string) {
  const proc = Bun.spawn(['kubectl', '--context', process.env.CREWSTATION_KUBE_CONTEXT ?? 'docker-desktop', '-n', namespace, 'get', 'secret', name, '-o', 'json'], { stdout: 'pipe', stderr: 'pipe' });
  const [code, output] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if (code) throw new Error(`Cannot read ${name}; install Garage first`);
  const data = (JSON.parse(output) as { data?: Record<string, string> }).data;
  if (!data) throw new Error(`Missing ${name} data`);
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Buffer.from(v, 'base64').toString()]));
}
const session = await registrationSession({ base, sessionFile: process.env.CS_OBJECT_STORAGE_SESSION_FILE, username: process.env.CS_ADMIN_USERNAME, password: process.env.CS_ADMIN_PASSWORD });
const cookie = session.cookie;
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, { method, signal: AbortSignal.timeout(60_000), redirect: 'error',
    headers: { cookie, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error(`Object storage registration failed (HTTP ${response.status}, ${method} ${path})`);
  return response.json() as Promise<T>;
}
try {
  const keys = await secret('garage-credentials'), observation = await secret('garage-observation');
  const endpoint = `http://garage.${namespace}.svc.cluster.local:3900`, bucket = keys.GARAGE_DEFAULT_BUCKET;
  const backends = await request<{ items: ObjectBackendDto[] }>('GET', '/v3/admin/object-storage/backends');
  const matches = backends.items.filter((b) => b.endpoint === endpoint && b.bucket === bucket);
  if (matches.length > 1) throw new Error('Multiple backends reference local Garage; select and reconcile them in object storage administration');
  const backend = matches[0] ?? await request<ObjectBackendDto>('POST', '/v3/admin/object-storage/backends', RegisterObjectBackendSchema.parse({
    requestKey: 'crewstation-local-garage-v1', name: 'Local Garage', endpoint, region: 'garage', bucket,
    accessKeyId: keys.GARAGE_DEFAULT_ACCESS_KEY, secretAccessKey: keys.GARAGE_DEFAULT_SECRET_KEY,
    monitoring: { endpoint: `http://garage.${namespace}.svc.cluster.local:3903`, token: observation.CS_GARAGE_OBSERVATION_TOKEN },
    durability: 'dev-only', budgetBytes: 60 * 1024 ** 3,
  }));
  const plans = await request<{ items: ObjectStoragePlanDto[] }>('GET', '/v3/admin/object-storage/plans');
  if (!plans.items.some((p) => p.backendId === backend.id && p.name === 'Local object storage')) await request('POST', '/v3/admin/object-storage/plans', {
    name: 'Local object storage', backendId: backend.id, quotaBytes: 20 * 1024 ** 3, maxObjectBytes: 1024 ** 3, maxConcurrentTransfers: 4, enabled: true,
  });
  console.log('Local Garage backend and plan are registered; existing settings preserved. Grant project access in Object storage.');
} finally {
  await session.close();
}
