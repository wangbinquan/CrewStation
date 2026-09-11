import { describe, expect, test } from 'bun:test';
import type { ProjectId, ServiceId } from '@crewstation/contracts';
import { newBinding, repositoryHttpUrl, repositoryPath, transition } from './repositoryBinding';

describe('repositoryBinding', () => {
  const now = new Date('2026-09-11T10:00:00.000Z');
  const base = newBinding({ serviceId: 'svc_1' as ServiceId, projectId: 'prj_1' as ProjectId, remoteProjectId: '42', pathWithNamespace: 'crewstation/demo', httpUrl: 'http://g/crewstation/demo.git', defaultBranch: 'main', now });

  test('路径与地址由平台配置推出', () => {
    expect(repositoryPath('/crewstation/', 'demo')).toBe('crewstation/demo');
    expect(repositoryHttpUrl('http://gitlab.local:8929/', 'crewstation/demo')).toBe('http://gitlab.local:8929/crewstation/demo.git');
  });

  test('creating → ready｜failed，failed → creating（重试），ready 终态；迁移清除旧消息', () => {
    expect(base.state).toBe('creating');
    const failed = transition(base, 'failed', now, 'push rejected');
    expect(failed).toMatchObject({ state: 'failed', message: 'push rejected' });
    const retried = transition(failed, 'creating', now);
    expect(retried.state).toBe('creating');
    expect(retried.message).toBeUndefined();
    const ready = transition(retried, 'ready', now);
    expect(ready.state).toBe('ready');
    expect(() => transition(ready, 'failed', now)).toThrow(expect.objectContaining({ kind: 'precondition' }));
    expect(() => transition(base, 'creating', now)).toThrow(expect.objectContaining({ kind: 'precondition' }));
  });
});
