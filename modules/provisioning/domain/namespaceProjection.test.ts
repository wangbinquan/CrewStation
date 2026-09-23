import { describe, expect, test } from 'bun:test';
import type { ProjectId } from '@crewstation/contracts';
import type { ProjectNamespace } from './namespaceProjection';
import { namespaceDeclaration, networkPolicyDeclaration } from './namespaceProjection';

const facts = (kind: ProjectNamespace['kind']): ProjectNamespace => ({ projectId: '01a0bf5d-8f4b-7178-82e1-9a99060b1192' as ProjectId, slug: 'demo', namespace: 'cs-demo', kind });

describe('命名空间与网络策略的期望（RFC-025 第四期）', () => {
  test('命名空间：Namespace 带项目标签，额度是平台缺省的四项上限；引用是项目 ID', () => {
    const worker = facts('DigitalWorker');
    expect(namespaceDeclaration(worker)).toEqual({
      kind: 'namespace', ref: worker.projectId, projectId: worker.projectId,
      spec: {
        children: [{ kind: 'Namespace', name: 'cs-demo' }, { kind: 'ResourceQuota', namespace: 'cs-demo', name: 'crewstation-project' }],
        labels: { 'crewstation.io/project': 'demo' }, quota: { hard: { pods: '30', 'requests.cpu': '8', 'requests.memory': '16Gi', persistentvolumeclaims: '20' } },
      },
      display: { namespace: 'cs-demo', quota: 'pods 30 · requests.cpu 8 · requests.memory 16Gi · persistentvolumeclaims 20' },
    });
  });

  // RFC-018 的安全边界压在这一个 kind 分支上：数字人服务槽不放行出站。
  test('网络策略：数字人三条；接入容器（APIProxy、EventProducer）多一条服务槽出站；带系统命名空间', () => {
    const names = (kind: ProjectNamespace['kind']) => networkPolicyDeclaration(facts(kind), 'crewstation-system').spec.children.map((child) => child.name);
    expect(names('DigitalWorker')).toEqual(['crewstation-default', 'crewstation-task-egress', 'crewstation-build-egress']);
    for (const kind of ['APIProxy', 'EventProducer'] as const) expect(names(kind)).toEqual(['crewstation-default', 'crewstation-task-egress', 'crewstation-build-egress', 'crewstation-integration-egress']);
    const worker = networkPolicyDeclaration(facts('DigitalWorker'), 'crewstation-system');
    expect(worker.spec.systemNamespace).toBe('crewstation-system');
    expect(worker.spec.children.every((child) => child.kind === 'NetworkPolicy' && child.namespace === 'cs-demo')).toBe(true);
    expect(worker.display).toEqual({ namespace: 'cs-demo', policies: 'crewstation-default, crewstation-task-egress, crewstation-build-egress' });
  });
});
