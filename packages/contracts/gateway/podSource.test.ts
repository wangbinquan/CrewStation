import { expect, test } from 'bun:test';
import { WorkloadIdentitySchema } from './identity';

test('原 Pod 来源覆盖服务、开发与业务，旧索引可读；实例边界与未知来源字段严格校验', () => {
  const workload = { identity: 'demo/demo', project: 'demo', service: 'demo', kind: 'service' as const }, pod = { uid: 'original-pod', name: 'demo-blue', namespace: 'cs-demo', ip: '10.1.2.3' };
  expect(WorkloadIdentitySchema.parse(workload)).toEqual(workload);
  for (const kind of ['service', 'dev-session', 'business-task', 'platform']) expect(WorkloadIdentitySchema.parse({ ...workload, kind, pod })).toMatchObject({ kind, pod });
  expect(WorkloadIdentitySchema.parse({ ...workload, pod: { ...pod, ip: '2001:db8::1' } })).toHaveProperty('pod.ip', '2001:db8::1');
  for (const patch of [{ uid: '' }, { uid: 'x'.repeat(129) }, { name: '' }, { name: 'x'.repeat(254) }, { namespace: '' }, { namespace: 'x'.repeat(254) }, { ip: 'not-an-ip' }, { credentials: 'secret' }])
    expect(WorkloadIdentitySchema.safeParse({ ...workload, pod: { ...pod, ...patch } }).success).toBe(false);
});
