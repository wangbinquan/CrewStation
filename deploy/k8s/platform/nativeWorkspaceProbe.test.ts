import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('installed native workspace source sees the entire original kubelet catalog through a read-only mount and an independent template', () => {
  type Container = { env: Array<{ name: string; value?: string }>; volumeMounts: Array<{ name: string; mountPath: string; readOnly?: boolean; subPath?: string }> };
  type Document = { kind: string; metadata: { name: string }; spec?: { template: { spec: { hostPID: boolean; containers: Container[]; volumes: Array<{ name: string; hostPath: { path: string; type: string } }> } } } };
  const documents = Bun.YAML.parse(readFileSync(join(import.meta.dir, '38-cluster-metrics.yaml'), 'utf8')) as Document[];
  const pod = documents.find(row => row.kind === 'DaemonSet' && row.metadata.name === 'cs-storage-probe')!.spec!.template.spec, container = pod.containers[0]!;
  const path = container.env.find(row => row.name === 'CS_STORAGE_PROBE_POD_ROOT')!.value, mount = container.volumeMounts.find(row => row.mountPath === path)!;
  expect(pod.hostPID).toBe(true); expect(mount).toEqual({ name: 'kubelet-pods', mountPath: '/kubelet-pods', readOnly: true });
  expect(pod.volumes.find(row => row.name === mount.name)!.hostPath).toEqual({ path: '/var/lib/kubelet/pods', type: 'Directory' });
  expect(container.volumeMounts.every(row => row.readOnly && !row.subPath)).toBe(true);
  const template = container.env.find(row => row.name === 'CS_STORAGE_PROBE_TEMPLATE_ROOT')!.value!;
  expect(template.startsWith('/app/templates/')).toBe(true); expect(container.volumeMounts.some(row => template.startsWith(row.mountPath))).toBe(false);
  expect(readFileSync(join(import.meta.dir, '../../docker/control-plane.Dockerfile'), 'utf8')).toContain('COPY templates ./templates');
});
