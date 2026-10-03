import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('actual cs-api report data path uses a writable pod volume for the non-root control-plane image', () => {
  const api = (Bun.YAML.parse(readFileSync(join(import.meta.dir, '30-cs-api.yaml'), 'utf8')) as Array<{ kind: string; spec: { template: { spec: {
    securityContext: { fsGroup: number }; containers: Array<{ name: string; volumeMounts: Array<{ name: string; mountPath: string }> }>;
    volumes: Array<{ name: string; emptyDir: object; hostPath?: object }>;
  } } } }>).find((document) => document.kind === 'Deployment')!.spec.template.spec;
  const config = Bun.YAML.parse(readFileSync(join(import.meta.dir, '10-config.yaml'), 'utf8')) as { data: Record<string, string> };
  const container = api.containers.find((item) => item.name === 'cs-api')!;
  const mount = container.volumeMounts.find((item) => item.mountPath === config.data['CS_RUNTIME_REPORT_DATA_ROOT'])!;
  expect(mount.name).toBe('runtime-report-spool');
  expect(api.volumes.find((item) => item.name === mount.name)).toEqual({ name: 'runtime-report-spool', emptyDir: {} });
  expect(api.securityContext.fsGroup).toBe(1000);
  expect(readFileSync(join(import.meta.dir, '../../docker/control-plane.Dockerfile'), 'utf8')).toMatch(/^USER bun$/m);
});
