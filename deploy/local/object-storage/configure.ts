/** Installation owns only these long-lived system credentials. Never reset a volume's identity. */
import { randomBytes } from 'node:crypto';

const namespace = process.env.CS_SYSTEM_NAMESPACE ?? 'crewstation-system';
async function kubectl(args: string[], input?: object) {
  const child = Bun.spawn(['kubectl', '--context', process.env.CREWSTATION_KUBE_CONTEXT ?? 'docker-desktop', '-n', namespace, ...args], { stdin: input ? new Blob([JSON.stringify(input)]) : 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (code) throw new Error(`Garage installation command failed (${args[0]})`);
  return output;
}
const current = (await kubectl(['get', 'secret', 'garage-credentials', '--ignore-not-found', '-o', 'json'])).trim();
if (current) {
  const data = (JSON.parse(current) as { data?: Record<string, string> }).data;
  for (const key of ['GARAGE_DEFAULT_ACCESS_KEY', 'GARAGE_DEFAULT_SECRET_KEY', 'GARAGE_DEFAULT_BUCKET', 'GARAGE_RPC_SECRET', 'GARAGE_ADMIN_TOKEN']) if (!data?.[key]) throw new Error(`Existing Garage credentials lack ${key}; recover them without replacing the storage identity`);
  console.log('Garage credentials preserved.');
} else {
  const volumes = JSON.parse(await kubectl(['get', 'pvc', '-l', 'app.kubernetes.io/name=garage', '-o', 'json'])) as { items?: unknown[] };
  if (!Array.isArray(volumes.items) || volumes.items.length > 0) throw new Error('Garage volumes exist or cannot be verified; recover their credentials before installation');
  const stringData = { GARAGE_DEFAULT_ACCESS_KEY: `GK${randomBytes(16).toString('hex')}`, GARAGE_DEFAULT_SECRET_KEY: randomBytes(32).toString('hex'), GARAGE_DEFAULT_BUCKET: 'crewstation-objects', GARAGE_RPC_SECRET: randomBytes(32).toString('hex'), GARAGE_ADMIN_TOKEN: randomBytes(32).toString('hex') };
  await kubectl(['create', '-f', '-'], { apiVersion: 'v1', kind: 'Secret', type: 'Opaque', metadata: { name: 'garage-credentials', namespace, labels: { 'app.kubernetes.io/part-of': 'crewstation' } }, stringData });
  console.log('Garage system credentials created.');
}
