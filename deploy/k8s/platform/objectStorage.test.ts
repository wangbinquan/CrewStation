import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installedSystemComponents } from '../../../modules/platform/domain/systemComponents';

interface Doc { kind: string; metadata: { name: string; namespace?: string }; data?: Record<string, string>; spec?: Record<string, unknown> }
const docs = (file: string) => (Bun.YAML.parse(readFileSync(join(import.meta.dir, file), 'utf8')) as Doc[]).filter(Boolean);
test('every installed Garage resource and both retained claims exist in the system ownership inventory', () => {
  const garage = docs('39-object-storage.yaml'), catalog = new Set(installedSystemComponents().map((item) => `${item.kind}/${item.name}`));
  for (const item of garage) { expect(item.metadata.namespace).toBe('crewstation-system'); expect(catalog.has(`${item.kind}/${item.metadata.name}`)).toBe(true); }
  const stateful = garage.find((item) => item.kind === 'StatefulSet')!.spec!;
  expect(stateful.persistentVolumeClaimRetentionPolicy).toEqual({ whenDeleted: 'Retain', whenScaled: 'Retain' });
  const claims = stateful.volumeClaimTemplates as Array<{ metadata: { name: string; ownerReferences?: unknown }; spec: { accessModes: string[]; resources: { requests: { storage: string } } } }>;
  expect(claims.map((claim) => claim.spec.resources.requests.storage)).toEqual(['5Gi', '100Gi']);
  for (const claim of claims) { expect(catalog.has(`PersistentVolumeClaim/${claim.metadata.name}-garage-0`)).toBe(true); expect(claim.metadata.ownerReferences).toBeUndefined(); expect(claim.spec.accessModes).toEqual(['ReadWriteOnce']); }
  const pod = (stateful.template as { spec: { automountServiceAccountToken: boolean; containers: Array<{ image: string; securityContext: { readOnlyRootFilesystem: boolean }; volumeMounts: Array<{ name: string }>; args: string[] }> } }).spec;
  expect(pod.automountServiceAccountToken).toBe(false); expect(pod.containers[0]!.image).toBe('dxflrs/garage@sha256:9c96caa2612d3411acc5b0e6701fb238dbfba33e533a6d7d3d811a4b12d0d020');
  expect(pod.containers[0]!.securityContext.readOnlyRootFilesystem).toBe(true);
  expect(pod.containers[0]!.volumeMounts.map((mount) => mount.name)).toEqual(['config', 'metadata', 'data']);
  const config = garage.find((item) => item.metadata.name === 'garage-config')!.data!['garage.toml']!;
  expect(config).toContain('replication_factor = 1'); expect(config).toContain('data_fsync = true'); expect(config).toContain('metrics_require_token = true');
  expect(config).not.toContain('rpc_secret ='); expect(config).not.toContain('admin_token =');
});
test('object metric counters are scraped per Pod, and user routes do not expose business service APIs', () => {
  const metrics = docs('38-cluster-metrics.yaml'), catalog = new Set(installedSystemComponents().map((item) => `${item.kind}/${item.name}`));
  for (const name of ['cs-object-metrics-api', 'cs-object-metrics-controller']) {
    expect(metrics.find((item) => item.metadata.name === name)?.spec?.clusterIP).toBe('None'); expect(catalog.has(`Service/${name}`)).toBe(true);
  }
  const config = Bun.YAML.parse(metrics.find((item) => item.metadata.name === 'prometheus-config')!.data!['prometheus.yml']!) as { scrape_configs: Array<{ job_name: string; dns_sd_configs?: unknown[]; authorization?: object }> };
  expect(config.scrape_configs.find((item) => item.job_name === 'crewstation-objects')?.dns_sd_configs).toHaveLength(2);
  expect(config.scrape_configs.find((item) => item.job_name === 'crewstation-objects')?.authorization).toEqual({ credentials_file: '/etc/metrics-secret/CS_CLUSTER_METRICS_TOKEN' });
  const route = docs('40-gateway.yaml').find((item) => item.metadata.name === 'console-object-storage')!.spec!;
  const entry = (route.routes as Array<{ match: string; middlewares: Array<{ name: string }> }>)[0]!;
  const pattern = new RegExp(/PathRegexp\(`(.+)`\)/.exec(entry.match)![1]!);
  for (const path of ['/v3/admin/object-storage/backends', '/v3/projects/p/object-storage/spaces', '/v3/object-storage/objects/id']) expect(pattern.test(path)).toBe(true);
  for (const path of ['/v3/objects', '/v3/business-tasks', '/v3/admin/object-storageevil', '/v3/projects/p/other']) expect(pattern.test(path)).toBe(false);
  expect(entry.middlewares.map((item) => item.name)).toEqual(['drop-identity-headers', 'forward-auth-user', 'rate-limit-platform-api', 'in-flight-platform-api']);
});

test('large object bodies use an authenticated dedicated listener without consuming ordinary API inflight slots', () => {
  const gateway = docs('40-gateway.yaml'), inventory = new Set(installedSystemComponents().map((item) => `${item.kind}/${item.name}`));
  const spec = (name: string) => gateway.find((item) => item.metadata.name === name)!.spec!;
  const route = (name: string) => (spec(name).routes as Array<{ match: string; middlewares: Array<{ name: string }>; services: Array<{ port: number }> }>)[0]!;
  for (const name of ['platform-object-storage', 'console-object-download']) {
    expect(inventory.has(`IngressRoute/${name}`)).toBe(true);
    expect(route(name).middlewares[0]!.name).toBe('drop-identity-headers');
    expect(route(name).middlewares.map((m) => m.name)).not.toContain('in-flight-platform-api');
    expect(route(name).services).toEqual([{ name: 'cs-api', port: 8087 }]);
  }
  expect(spec('platform-object-storage').entryPoints).toEqual(['objects']);
  expect(route('platform-object-storage').middlewares[1]!.name).toBe('forward-auth-service');
  expect(route('console-object-download').middlewares[1]!.name).toBe('forward-auth-user');
  expect(inventory.has('Middleware/in-flight-object-storage')).toBe(true);
  const allowed = new RegExp(/PathRegexp\(`(.+)`\)/.exec(route('platform-object-storage').match)![1]!);
  for (const path of ['/v3/objects', '/v3/objects/uploads/id/content']) expect(allowed.test(path)).toBe(true);
  for (const path of ['/v3/objectsevil', '/v3/admin/object-storage/backends', '/v3/business-tasks']) expect(allowed.test(path)).toBe(false);
  const deployment = docs('../system/32-traefik.yaml').find((item) => item.kind === 'Deployment')!.spec!;
  const args = (deployment.template as { spec: { containers: Array<{ args: string[] }> } }).spec.containers[0]!.args;
  expect(args).toContain('--entryPoints.objects.transport.respondingTimeouts.readTimeout=1805s');
  expect(args.some((arg) => arg.startsWith('--entryPoints.web.transport.respondingTimeouts.readTimeout='))).toBe(false);
  const ports = docs('30-cs-api.yaml').find((item) => item.kind === 'Service')!.spec!.ports;
  expect(ports).toContainEqual({ name: 'objects', port: 8087, targetPort: 8087 });
});
