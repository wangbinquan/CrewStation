import { expect, test } from 'bun:test';
import { createFakeK8sClient } from '@crewstation/k8s';
import { assertRuntimeImageBuildIsolation } from './runtimeImageIsolation';

test('builder 未安装仓库隔离不能启动，真实部署清单覆盖 backend 与 NodePort，错误顺序拒绝', async () => {
  const k8s = createFakeK8sClient();
  await expect(assertRuntimeImageBuildIsolation(k8s, 'registry.internal:5000')).rejects.toThrow('未就绪');
  const source = await Bun.file(new URL('../../../../deploy/k8s/system/21-image-build-policy.yaml', import.meta.url)).text();
  const object = Bun.YAML.parse(source) as { apiVersion: string; kind: string; metadata: { name: string }; spec: { order: number; egress: unknown[] } };
  await k8s.apply(object);
  await expect(assertRuntimeImageBuildIsolation(k8s, 'registry.internal:5000')).resolves.toBeUndefined();
  await expect(assertRuntimeImageBuildIsolation(k8s, 'registry.internal:5001')).rejects.toThrow('隔离策略');
  await k8s.apply({ ...object, spec: { ...object.spec, egress: [...object.spec.egress].reverse() } });
  await expect(assertRuntimeImageBuildIsolation(k8s, 'registry.internal:5000')).rejects.toThrow('未就绪');
  await k8s.apply({ ...object, spec: { ...object.spec, order: 9999 } });
  await expect(assertRuntimeImageBuildIsolation(k8s, 'registry.internal:5000')).rejects.toThrow('未就绪');
});
