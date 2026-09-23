import { describe, expect, test } from 'bun:test';
import { namespaceRenderOf, networkPolicyRendersOf } from './namespaceRender';

const hard = { pods: '30', 'requests.cpu': '8' };
const nsSpec = (over: Record<string, unknown> = {}) => ({
  children: [{ kind: 'Namespace', name: 'cs-demo' }, { kind: 'ResourceQuota', namespace: 'cs-demo', name: 'crewstation-project' }],
  labels: { 'crewstation.io/project': 'demo' }, quota: { hard }, ...over,
});
const policySpec = (names: readonly string[], over: Record<string, unknown> = {}) => ({
  children: names.map((name) => ({ kind: 'NetworkPolicy', namespace: 'cs-demo', name })), systemNamespace: 'crewstation-system', ...over,
});

describe('命名空间与网络策略的渲染输入（RFC-025 第四期）', () => {
  test('命名空间：名字取自 Namespace 子对象，额度名取自 ResourceQuota 子对象', () => {
    expect(namespaceRenderOf(nsSpec())).toEqual({ name: 'cs-demo', labels: { 'crewstation.io/project': 'demo' }, quota: { name: 'crewstation-project', hard } });
  });

  test('命名空间：缺标签、缺额度、额度为空、额度不在这个命名空间、子对象多或少，都不渲染', () => {
    expect(namespaceRenderOf(nsSpec({ labels: undefined }))).toBeUndefined();
    expect(namespaceRenderOf(nsSpec({ labels: { project: 7 } }))).toBeUndefined();
    expect(namespaceRenderOf(nsSpec({ quota: undefined }))).toBeUndefined();
    expect(namespaceRenderOf(nsSpec({ quota: { hard: {} } }))).toBeUndefined();
    expect(namespaceRenderOf(nsSpec({ quota: { hard: { pods: 30 } } }))).toBeUndefined();
    expect(namespaceRenderOf(nsSpec({ children: [{ kind: 'Namespace', name: 'cs-demo' }, { kind: 'ResourceQuota', namespace: 'cs-other', name: 'q' }] }))).toBeUndefined();
    expect(namespaceRenderOf(nsSpec({ children: [{ kind: 'Namespace', name: 'cs-demo' }] }))).toBeUndefined();
    expect(namespaceRenderOf(nsSpec({ children: [{ kind: 'Namespace', name: 'a' }, { kind: 'Namespace', name: 'b' }, { kind: 'ResourceQuota', namespace: 'a', name: 'q' }] }))).toBeUndefined();
  });

  test('网络策略：每条按名字取模板，带系统命名空间', () => {
    expect(networkPolicyRendersOf(policySpec(['crewstation-default', 'crewstation-integration-egress']))).toEqual([
      { namespace: 'cs-demo', name: 'crewstation-default', systemNamespace: 'crewstation-system' },
      { namespace: 'cs-demo', name: 'crewstation-integration-egress', systemNamespace: 'crewstation-system' },
    ]);
  });

  test('网络策略：有一条不认识、缺系统命名空间、没有策略或混进别的种类，整条不渲染', () => {
    expect(networkPolicyRendersOf(policySpec(['crewstation-default', 'crewstation-egress-allowlist']))).toBeUndefined();
    expect(networkPolicyRendersOf(policySpec(['crewstation-default'], { systemNamespace: '' }))).toBeUndefined();
    expect(networkPolicyRendersOf(policySpec([]))).toBeUndefined();
    expect(networkPolicyRendersOf({ ...policySpec(['crewstation-default']), children: [{ kind: 'NetworkPolicy', name: 'crewstation-default' }] })).toBeUndefined();
    expect(networkPolicyRendersOf({ ...policySpec(['crewstation-default']), children: [...policySpec(['crewstation-default']).children, { kind: 'Namespace', name: 'cs-demo' }] })).toBeUndefined();
  });
});
