import { describe, expect, test } from 'bun:test';
import type { ProjectId, RouteEntry } from '@crewstation/contracts';
import type { RouteLedger } from '../ports/ledger';
import { declareRoutes } from './reconcileRoutes';

const service = { serviceId: 'svc-1', projectId: '01a0bf5d-8f4b-7b10-9a12-5e7d8c4b3a66' as ProjectId, serviceName: 'demo', namespace: 'cs-demo' };
const prod: RouteEntry = { host: 'demo.cs.localhost', domain: 'user', kind: 'prod', target: { namespace: 'cs-demo', service: 'demo-blue', port: 80 }, middlewares: ['auth'] };
const system = { names: new Set(['auth']), namespace: 'crewstation-system' };

function fakeLedger(desiredOf: (ref: string) => 'present' | 'absent' | undefined) {
  const declared: string[] = [], released: string[] = [];
  const ledger: RouteLedger = {
    declare: async (input) => { declared.push(`${input.ref} ${JSON.stringify(input.spec.middlewares)}`); return { id: input.ref }; },
    find: async (ref) => { const desired = desiredOf(ref); return desired ? { id: ref, desired } : undefined; },
    requestRelease: async (id) => { released.push(id); },
  };
  return { ledger, declared, released };
}

describe('路由记录的第几条（RFC-025 第三期后半）', () => {
  test('前面的已释放就顺延：声明到第一条空着或还在用的引用，摘除释放的是还在用的那条；系统中间件带系统命名空间', async () => {
    const chain = fakeLedger((ref) => (ref === 'svc-1/prod' || ref === 'svc-1/internal-api' ? 'absent' : ref === 'svc-1/internal-api~2' ? 'present' : undefined));
    await declareRoutes(chain.ledger, system, service, [prod]);
    expect(chain.declared).toEqual(['svc-1/prod~2 [{"name":"auth","namespace":"crewstation-system"}]']);
    expect(chain.released).toEqual(['svc-1/internal-api~2']);
  });

  test('台账数据异常（同一种路由释放过太多条）：不无休止地找下去，报错交给调用方', async () => {
    const stuck = fakeLedger(() => 'absent');
    await expect(declareRoutes(stuck.ledger, system, service, [prod])).rejects.toThrow('路由 svc-1/prod 已有 64 条释放过的记录');
    expect(stuck.declared).toEqual([]);
  });
});
