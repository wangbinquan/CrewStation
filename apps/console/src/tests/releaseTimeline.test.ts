import { expect, test } from 'bun:test';
import type { ReleaseDto, TrafficSwitchDto } from '@crewstation/contracts';
import { releaseTimeline, shortId } from '../shared/project/releaseTimeline';

const release = (id: string, tag: string, createdAt: string): ReleaseDto => ({ id, serviceId: 'svc', tag, commitSha: 'a'.repeat(40), branch: 'main', status: 'ready', createdBy: 'u', createdAt, updatedAt: createdAt }) as unknown as ReleaseDto;
const swap = (id: string, releaseId: string, previousReleaseId: string | null, actorUserId: string, createdAt: string, reason?: string): TrafficSwitchDto => ({ id, serviceId: 'svc', fromSlot: 'preview', toSlot: 'prod', releaseId, previousReleaseId, actorUserId, reason, createdAt }) as unknown as TrafficSwitchDto;

test('发布与切流按时间倒序合并；切流解析标签与人名，缺失时保留 ID；回退＝目标比切走的发布更早', () => {
  const r1 = release('r1', 'v1.0.0', '2026-09-01T00:00:00Z'), r2 = release('r2', 'v1.1.0', '2026-09-02T00:00:00Z');
  const entries = releaseTimeline([r1, r2], [swap('s1', 'r2', 'r1', 'alice', '2026-09-03T00:00:00Z', '验收通过'), swap('s2', 'r1', 'r2', 'bob', '2026-09-04T00:00:00Z'), swap('s3', 'gone', null, 'carol', '2026-09-05T00:00:00Z')], new Map([['alice', '小艾']]));
  expect(entries.map((entry) => entry.id)).toEqual(['switch:s3', 'switch:s2', 'switch:s1', 'release:r2', 'release:r1']);
  const switches = entries.filter((entry) => entry.kind === 'switch');
  expect(switches[2]).toMatchObject({ tag: 'v1.1.0', actorName: '小艾', rollback: false, entry: { reason: '验收通过' } });
  // 离开项目的人：名单里没有，保留 ID 由界面显示短 ID；目标更早即回退。
  expect(switches[1]).toMatchObject({ tag: 'v1.0.0', rollback: true }); expect(switches[1]!.kind === 'switch' ? switches[1]!.actorName : 'x').toBeUndefined();
  // 发布记录里找不到的发布：不下回退结论，也不猜标签。
  expect(switches[0]).toMatchObject({ rollback: false }); expect(switches[0]!.kind === 'switch' ? switches[0]!.tag : 'x').toBeUndefined();
  expect(shortId('01a0bf5d-8f4b-7e1e-8dde-c9c2ae13ed34')).toBe('01a0bf5d'); expect(shortId('abc')).toBe('abc');
  // 同一时刻切流排在发布前：切流总是发生在该发布之后。
  expect(releaseTimeline([r1], [swap('s0', 'r1', null, 'alice', r1.createdAt)]).map((entry) => entry.kind)).toEqual(['switch', 'release']);
});
