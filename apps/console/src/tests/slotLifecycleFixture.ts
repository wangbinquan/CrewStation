import type { MaintenanceDto, MaintenanceEventDto, ReleaseDto, SlotDto, SlotEventDto } from '@crewstation/contracts';
import { testerSummaryFixture } from './projectSummaryFixture';

export const projectId = '01a0bf5d-8f4b-7c21-8000-000000000001', serviceId = '01a0bf5d-8f4b-7c21-8000-000000000002';
export const ownerId = '01a0bf5d-8f4b-7c21-8000-000000000003', guestId = '01a0bf5d-8f4b-7c21-8000-000000000004';
export const prodId = '01a0bf5d-8f4b-7c21-8000-000000000012', standbyId = '01a0bf5d-8f4b-7c21-8000-000000000011', oldId = '01a0bf5d-8f4b-7c21-8000-000000000010';
export const at = (hours: number) => new Date(Date.UTC(2026, 8, 23) + hours * 3_600_000).toISOString();

type Role = 'owner' | 'developer' | 'tester';

function release(id: string, tag: string, sha: string, createdAt: string, extra: Partial<ReleaseDto> = {}): ReleaseDto {
  return { id, serviceId, tag, commitSha: sha.repeat(40), branch: 'main', status: 'ready', redeployable: false, createdBy: ownerId, createdAt, updatedAt: createdAt, ...extra } as ReleaseDto;
}

function slot(name: 'prod' | 'preview', of: ReleaseDto, extra: Partial<SlotDto> = {}): SlotDto {
  return { name, active: name === 'prod', releaseId: of.id, tag: of.tag, commitSha: of.commitSha, replicas: 1, readyReplicas: 1, state: 'ready', host: name === 'prod' ? 'demo.cs.localhost' : 'preview.demo.cs.localhost', ...extra } as SlotDto;
}

/**
 * RFC-021 的假服务端：正式槽跑 v1.1.0，待命槽是切流换下的 v1.0.0（回退保留到 74 小时后），v0.9.0 已被替代、可以重新部署。
 * 写请求按真实接口的形状改状态并回执；`fail` 给出时所有写请求按它失败（模拟他人先改过）。
 */
export function slotLifecycleFixture(role: Role = 'owner', admin = false) {
  const releases = [release(prodId, 'v1.1.0', 'b', at(2), { slot: 'prod' }), release(standbyId, 'v1.0.0', 'a', at(1), { slot: 'preview' }), release(oldId, 'v0.9.0', 'c', at(0), { status: 'superseded', redeployable: true })];
  const state = {
    slots: [slot('prod', releases[0]!), slot('preview', releases[1]!, { retention: { kind: 'rollback-target', since: at(2), deadline: at(74), postponements: 0, periodHours: 72 } })],
    slotEvents: [] as SlotEventDto[], maintenance: null as MaintenanceDto | null, history: [] as MaintenanceEventDto[],
    fail: undefined as { readonly status: number; readonly message: string } | undefined,
  };
  const writes: Array<{ readonly method: string; readonly path: string; readonly body: Record<string, unknown> }> = [];
  const standbyEvent = (kind: SlotEventDto['kind'], of: ReleaseDto, extra: Partial<SlotEventDto> = {}) => state.slotEvents.unshift({ id: `${kind}-${state.slotEvents.length}`, serviceId, kind, releaseId: of.id, tag: of.tag, actorUserId: ownerId, at: at(10), ...extra } as SlotEventDto);
  const write = (method: string, path: string, body: Record<string, unknown>): [unknown, number] => {
    if (path.endsWith('/slots/preview/offline')) {
      const gone = releases.find((item) => item.id === body.expectedReleaseId)!; Object.assign(gone, { status: 'offline', redeployable: true, slot: undefined });
      state.slots[1] = { name: 'preview', active: false, replicas: 0, readyReplicas: 0, state: 'empty', host: 'preview.demo.cs.localhost', offline: { releaseId: gone.id, tag: gone.tag, at: at(10), reason: 'manual', actorUserId: ownerId } } as SlotDto;
      standbyEvent('offline', gone, { reason: 'manual' }); return [{ items: state.slots }, 200];
    }
    if (path.endsWith('/slots/preview/postpone')) {
      const retention = state.slots[1]!.retention!, deadline = new Date(Date.parse(retention.deadline) + 72 * 3_600_000).toISOString();
      state.slots[1] = { ...state.slots[1]!, retention: { ...retention, deadline, postponements: retention.postponements + 1 } }; standbyEvent('postpone', releases[1]!, { deadline }); return [{ items: state.slots }, 200];
    }
    if (path.endsWith('/redeploy')) { const target = releases.find((item) => path.includes(item.id))!; Object.assign(target, { status: 'deploying', redeployable: false }); standbyEvent('redeploy', target); return [target, 202]; }
    if (path.endsWith('/maintenance/exit')) { state.maintenance = null; return [{ current: null, history: state.history }, 200]; }
    if (method === 'PUT' && path.endsWith('/maintenance')) {
      const previous = state.maintenance, users = (body.allowUserIds as string[]).map((userId) => ({ userId, name: '访客', email: 'guest@test.invalid' }));
      state.maintenance = { serviceId, projectId, switches: body.switches, allowUsers: users, reason: body.reason, ...(body.expectedEndAt ? { expectedEndAt: body.expectedEndAt } : {}), startedBy: previous?.startedBy ?? ownerId, startedAt: previous?.startedAt ?? at(10), updatedBy: ownerId, updatedAt: at(11), revision: (previous?.revision ?? 0) + 1 } as MaintenanceDto;
      state.history.unshift({ id: `m-${state.history.length}`, serviceId, kind: previous ? 'updated' : 'entered', actorUserId: ownerId, at: at(11), switches: state.maintenance.switches, reason: state.maintenance.reason, allowUserIds: body.allowUserIds } as MaintenanceEventDto);
      return [state.maintenance, 200];
    }
    return [{ error: 'not_found', message: `没有 ${method} ${path}` }, 404];
  };
  const read = (path: string): [unknown, number] => {
    if (path === '/v1/me') return [{ id: ownerId, name: '负责人', email: 'owner@test.invalid', platformRole: admin ? 'admin' : 'developer', isAdmin: admin, memberships: admin ? [] : [{ projectId, role }] }, 200];
    if (path === `/v1/projects/${projectId}`) return [{ id: projectId, serviceId, name: '演示应用', slug: 'demo', kind: 'DigitalWorker', state: 'active', ownerUserId: ownerId }, 200];
    if (path === `/v1/workbench/project-summaries/${projectId}`) return [testerSummaryFixture(projectId, serviceId), 200];
    if (path.endsWith('/slots')) return [{ items: state.slots }, 200];
    if (path.endsWith('/releases')) return [{ items: releases }, 200];
    if (path.startsWith('/v1/releases/')) return [releases.find((item) => path.endsWith(item.id)), 200];
    if (path.endsWith('/slot-events')) return [{ items: state.slotEvents }, 200];
    if (path.endsWith('/maintenance')) return [{ current: state.maintenance, history: state.history }, 200];
    if (path.endsWith('/members')) return [{ items: [{ userId: ownerId, name: '负责人', email: 'owner@test.invalid', role: 'owner' }] }, 200];
    if (path.endsWith('/member-candidates')) return [{ items: [{ userId: guestId, name: '访客', email: 'guest@test.invalid' }] }, 200];
    if (path.endsWith('/dev-session')) return [{ error: 'not_found', message: '没有开发会话' }, 404];
    return [{ items: [] }, 200];
  };
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://localhost').pathname, method = init?.method ?? 'GET';
    let result: [unknown, number];
    if (method === 'GET') result = read(path);
    else {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>; writes.push({ method, path, body });
      result = state.fail ? [{ error: 'conflict', message: state.fail.message }, state.fail.status] : write(method, path, body);
    }
    return new Response(JSON.stringify(result[0]), { status: result[1], headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { state, writes, releases };
}
