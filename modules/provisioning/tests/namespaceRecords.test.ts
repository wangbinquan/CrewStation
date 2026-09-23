import { describe, expect, test } from 'bun:test';
import type { ProjectId, ServiceId } from '@crewstation/contracts';
import type { ProjectFacts } from '../api/steps';
import { namespaceRecords } from '../application/namespaceRecords';
import type { NamespaceDeclaration, NetworkPolicyDeclaration } from '../domain/namespaceProjection';
import type { NamespaceLedger, NamespaceRecordView } from '../ports/ledger';

const facts: ProjectFacts = {
  projectId: '01a0bf5d-8f4b-7178-82e1-9a99060b1192' as ProjectId, state: 'provisioning', serviceId: '01a0bf5d-8f4b-76c5-866c-f1feda3d63bb' as ServiceId,
  slug: 'demo', name: 'demo', namespace: 'cs-demo', kind: 'APIProxy', template: '01a0bf5d-8f4b-7002-9560-94caf593fb19',
};

/** 假台账：声明按种类记下期望，阶段由用例拨；读的次数记下来，用来确认开通链真的在轮询。 */
function fakeLedger() {
  const declared: (NamespaceDeclaration | NetworkPolicyDeclaration)[] = [];
  const views = new Map<string, NamespaceRecordView | undefined>();
  let reads = 0;
  const ledger: NamespaceLedger = {
    declare: async (input) => {
      declared.push(input);
      const id = `${input.kind}:${input.ref}`;
      if (!views.has(id)) views.set(id, { id, phase: 'provisioning', children: input.spec.children.map((child) => ({ kind: child.kind, name: child.name, phase: 'absent' })) });
      return { id };
    },
    get: async (id) => { reads += 1; return views.get(id); },
  };
  return { ledger, declared, views, reads: () => reads };
}

describe('开通链的命名空间：写期望，等记录运行中再走下一步（RFC-025 第四期）', () => {
  test('写命名空间与网络策略两条记录；两条都运行中才返回', async () => {
    const fake = fakeLedger();
    const records = namespaceRecords(fake.ledger, { systemNamespace: 'crewstation-system', pollMs: 5, readyTimeoutMs: 2_000 });
    const done = records.ensure(facts);
    await Bun.sleep(30);
    expect(fake.declared.map((input) => input.kind)).toEqual(['namespace', 'network-policy-set']);
    expect(fake.reads()).toBeGreaterThan(2);
    fake.views.set(`namespace:${facts.projectId}`, { id: 'n', phase: 'ready', children: [] });
    await Bun.sleep(20);
    let settled = false;
    void done.then(() => { settled = true; });
    await Bun.sleep(20);
    expect(settled).toBe(false);
    fake.views.set(`network-policy-set:${facts.projectId}`, { id: 'p', phase: 'ready', children: [] });
    await done;
    // 接入容器多一条服务槽出站；默认策略放行的系统命名空间照设置。
    const policies = fake.declared.find((input) => input.kind === 'network-policy-set') as NetworkPolicyDeclaration;
    expect(policies.spec.systemNamespace).toBe('crewstation-system');
    expect(policies.spec.children.map((child) => child.name)).toContain('crewstation-integration-egress');
  });

  test('等不到运行中：抛错说明还缺哪些对象（开通记失败，作业重试）；记录不见了、有原因的、只有阶段的各自写明', async () => {
    const fake = fakeLedger();
    const records = namespaceRecords(fake.ledger, { systemNamespace: 'crewstation-system', pollMs: 5, readyTimeoutMs: 30 });
    await expect(records.ensure(facts)).rejects.toThrow('命名空间 cs-demo 没有就绪：命名空间还缺 Namespace cs-demo、ResourceQuota crewstation-project；网络策略还缺 NetworkPolicy crewstation-default、NetworkPolicy crewstation-task-egress、NetworkPolicy crewstation-build-egress、NetworkPolicy crewstation-integration-egress');
    fake.views.set(`namespace:${facts.projectId}`, { id: 'n', phase: 'degraded', reason: { message: '额度被拒绝' }, children: [] });
    fake.views.set(`network-policy-set:${facts.projectId}`, undefined);
    await expect(records.ensure(facts)).rejects.toThrow('命名空间 cs-demo 没有就绪：命名空间：额度被拒绝；网络策略记录不见了');
    fake.views.set(`namespace:${facts.projectId}`, { id: 'n', phase: 'ready', children: [] });
    fake.views.set(`network-policy-set:${facts.projectId}`, { id: 'p', phase: 'starting', children: [] });
    await expect(records.ensure(facts)).rejects.toThrow('命名空间 cs-demo 没有就绪：网络策略阶段为 starting');
  });

  test('启动重下发只写期望，不等调和器', async () => {
    const fake = fakeLedger();
    const records = namespaceRecords(fake.ledger, { systemNamespace: 'crewstation-system' });
    await records.declare({ ...facts, kind: 'DigitalWorker' });
    expect(fake.declared.map((input) => `${input.kind}:${input.spec.children.length}`)).toEqual(['namespace:2', 'network-policy-set:3']);
    expect(fake.reads()).toBe(0);
  });
});
