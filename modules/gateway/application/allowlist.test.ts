import { describe, expect, test } from 'bun:test';
import type { AllowlistDocument, WorkloadIdentity } from '@crewstation/contracts';
import { allowlistUseCases } from './allowlist';
import type { GatewayUseCaseDeps } from './dependencies';

const caller: WorkloadIdentity = { identity: 'demo/demo', project: 'demo', service: 'demo', kind: 'service', slot: 'prod' };
const platformCall = { host: 'api.svc.cs.internal', method: 'POST', path: '/v1/business-tasks' };
/** 升级前留下的旧文档：没有 identityVersion。 */
const legacy = { version: 40, generatedAt: '2026-09-20T12:53:55.831Z', defaultOpen: [], maxStaleSeconds: 300, entries: [] } as unknown as AllowlistDocument;

/** 内存里的放行表仓库：`beforeSave` 让用例在「读过最新版」与「落库」之间插入别的进程的动作。 */
function harness(stored: AllowlistDocument[], beforeSave?: (store: AllowlistDocument[]) => void) {
  const logs: Array<{ level: string; message: string }> = [];
  let composed = 0;
  const log = (level: string) => (message: string): void => { logs.push({ level, message }); };
  const deps = {
    allowlists: {
      latest: async () => [...stored].sort((a, b) => b.version - a.version)[0],
      save: async (doc: AllowlistDocument) => {
        beforeSave?.(stored);
        if (stored.some((existing) => existing.version === doc.version)) throw new Error('duplicate key value violates unique constraint "allowlists_pkey"');
        stored.push(doc);
      },
    },
    services: { listServices: async () => { composed += 1; return [{ identity: 'demo/demo', kind: 'DigitalWorker' as const }]; } },
    grants: { listCallers: async () => [], grantedOperations: async () => ({ operations: [], defaultOpen: [], operationRoutes: [] }) },
    settings: { allowlistMaxStaleSeconds: 300, serviceDomain: 'svc.cs.internal' },
    clock: { now: () => new Date('2026-09-21T03:00:00.000Z') },
    logger: { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') },
  } as unknown as GatewayUseCaseDeps;
  return { useCases: allowlistUseCases(deps), stored, logs, composed: () => composed };
}

describe('放行表的按需重建', () => {
  test('库里只有旧身份版本的文档：首个评估就地重建并放行，同进程的并发评估只重建一次', async () => {
    const h = harness([legacy]);
    const verdicts = await Promise.all([1, 2, 3].map(() => h.useCases.evaluate(caller, platformCall)));
    expect(verdicts.map((verdict) => verdict.allowed)).toEqual([true, true, true]);
    expect(h.stored.map((doc) => doc.version)).toEqual([40, 41]);
    expect(h.composed()).toBe(1);
    // 升级后没人触发过重算才会走到这里，要让运维在日志里看得见。
    expect(h.logs.filter((entry) => entry.level === 'warn').map((entry) => entry.message)).toEqual(['allowlist rebuilt on demand: no document of the current identity version']);
  });

  test('全新安装一份都没有：同样按需重建出第 1 版', async () => {
    const h = harness([]);
    expect((await h.useCases.evaluate(caller, platformCall)).allowed).toBe(true);
    expect(h.stored.map((doc) => doc.version)).toEqual([1]);
  });

  test('纯读取不写库：管理页读到旧文档照实报告没有可用的放行表', async () => {
    const h = harness([legacy]);
    expect(await h.useCases.currentAllowlist()).toBeUndefined();
    expect(h.stored).toHaveLength(1);
  });

  test('别的进程在本进程落库前抢到了同一个版本号：改用它落库的那份，不把主键冲突漏给调用方', async () => {
    const winner = { identityVersion: 2, operationRoutes: [], version: 41, generatedAt: '2026-09-21T03:00:00.000Z', defaultOpen: [], entries: [{ caller: 'demo/demo', operations: [], platformApi: true, platformHosts: ['platformApi'] }], maxStaleSeconds: 300 } as AllowlistDocument;
    const h = harness([legacy], (store) => { if (!store.includes(winner)) store.push(winner); });
    expect((await h.useCases.evaluate(caller, platformCall)).allowed).toBe(true);
    expect(h.stored.map((doc) => doc.version)).toEqual([40, 41]);
    expect(h.logs.filter((entry) => entry.level === 'error')).toEqual([]);
  });

  test('别的进程已经先写出可用的新版本：本进程不再叠一份内容相同的版本', async () => {
    const stored = [legacy];
    const h = harness(stored);
    // 本进程读到 40 之后、推导内容期间，另一个进程落了 41。
    const pending = h.useCases.evaluate(caller, platformCall);
    stored.push({ identityVersion: 2, operationRoutes: [], version: 41, generatedAt: '2026-09-21T03:00:00.000Z', defaultOpen: [], entries: [{ caller: 'demo/demo', operations: [], platformApi: true, platformHosts: ['platformApi'] }], maxStaleSeconds: 300 } as AllowlistDocument);
    expect((await pending).allowed).toBe(true);
    expect(stored.map((doc) => doc.version)).toEqual([40, 41]);
  });

  test('重建彻底失败：按原语义拒绝并记错误，下一次评估还会再试', async () => {
    let broken = true;
    const h = harness([legacy], () => { if (broken) throw new Error('connection refused'); });
    const denied = await h.useCases.evaluate(caller, platformCall);
    expect(denied).toMatchObject({ allowed: false, reason: '放行表尚未生成' });
    expect(h.logs.filter((entry) => entry.level === 'error').map((entry) => entry.message)).toEqual(['allowlist rebuild on demand failed']);
    broken = false;
    expect((await h.useCases.evaluate(caller, platformCall)).allowed).toBe(true);
  });

  test('手动重算与授权变更触发的重建永远落新版本，不受按需重建的去重影响', async () => {
    const h = harness([]);
    expect((await h.useCases.rebuildAllowlist()).version).toBe(1);
    expect((await h.useCases.rebuildAllowlist()).version).toBe(2);
    expect(h.logs.filter((entry) => entry.level === 'warn')).toEqual([]);
  });
});
