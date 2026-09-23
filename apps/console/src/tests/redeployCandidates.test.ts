import { expect, test } from 'bun:test';
import type { ReleaseDto, SlotDto } from '@crewstation/contracts';
import { defaultRedeployTarget, redeployCandidates } from '../features/release/model/redeployCandidates';

const at = (hours: number) => new Date(Date.UTC(2026, 8, 23) + hours * 3_600_000).toISOString();
const release = (id: string, createdAt: string, redeployable: boolean, status: ReleaseDto['status'] = 'superseded') =>
  ({ id, serviceId: 's', tag: `v-${id}`, commitSha: 'a'.repeat(40), branch: 'main', status, redeployable, createdBy: 'o', createdAt, updatedAt: createdAt }) as unknown as ReleaseDto;
const ids = (list: readonly ReleaseDto[]): string[] => list.map((item) => String(item.id));
const idOf = (item: ReleaseDto | undefined): string | undefined => (item ? String(item.id) : undefined);
const empty = (offlineId?: string) => ({ name: 'preview', active: false, replicas: 0, readyReplicas: 0, state: 'empty', host: 'preview.test', ...(offlineId ? { offline: { releaseId: offlineId, at: at(9), reason: 'manual' } } : {}) }) as unknown as SlotDto;

// 2026-09-23 裁定：待验证版本空着时可以选版本部署，列表就是服务端说能重新部署的那些，新到旧。
test('候选版本：只取可重新部署的，新到旧；正选着的版本变得不可部署时仍留在列表里', () => {
  const releases = [release('old', at(0), true), release('prod', at(3), false, 'ready'), release('mid', at(1), true, 'offline'), release('bad', at(2), false, 'failed')];
  expect(ids(redeployCandidates(releases))).toEqual(['mid', 'old']);
  expect(ids(redeployCandidates(releases, 'bad'))).toEqual(['bad', 'mid', 'old']);
  expect(redeployCandidates([])).toEqual([]);
});

test('「部署版本…」默认选刚下线的那个；它不能再部署或从未下线过时选最新的可部署版本；一个都没有时没有入口', () => {
  const releases = [release('old', at(0), true), release('mid', at(1), true, 'offline'), release('new', at(2), true)];
  expect(idOf(defaultRedeployTarget(empty('mid'), releases))).toBe('mid');
  expect(idOf(defaultRedeployTarget(empty('gone'), releases))).toBe('new');
  expect(idOf(defaultRedeployTarget(empty(), releases))).toBe('new');
  expect(defaultRedeployTarget(empty('mid'), [release('mid', at(1), false, 'offline')])).toBeUndefined();
});
