import { expect, test } from 'bun:test';
import { VerifyReleaseJourneyRequestSchema, ReleaseJourneyPageRequestSchema } from './requests';
import { ReleaseJourneySourceSchema } from './values';

test('journey writes require complete version/revision identity and reject extra fields', () => {
  const input = { requestKey: 'verify-1', expectedRevision: 3, expectedReleaseId: Bun.randomUUIDv7(), expectedCommitSha: 'a'.repeat(40), expectedTargetRevision: 'b'.repeat(64), note: '已检查登录流程' };
  expect(VerifyReleaseJourneyRequestSchema.safeParse(input).success).toBe(true);
  for (const key of Object.keys(input).filter((key) => key !== 'note')) {
    const partial: Record<string, unknown> = { ...input }; delete partial[key];
    expect(VerifyReleaseJourneyRequestSchema.safeParse(partial).success).toBe(false);
  }
  expect(VerifyReleaseJourneyRequestSchema.safeParse({ ...input, bypass: true }).success).toBe(false);
  expect(VerifyReleaseJourneyRequestSchema.safeParse({ ...input, note: 'x'.repeat(501) }).success).toBe(false);
  expect(ReleaseJourneySourceSchema.safeParse({ kind: 'session' }).success).toBe(false);
  expect(ReleaseJourneySourceSchema.safeParse({ kind: 'repository', taskId: Bun.randomUUIDv7() }).success).toBe(false);
});
test('history pagination is bounded and strict', () => {
  expect(ReleaseJourneyPageRequestSchema.parse({}).limit).toBe(20);
  expect(ReleaseJourneyPageRequestSchema.parse({ limit: '50' }).limit).toBe(50);
  for (const value of [{ limit: 0 }, { limit: 51 }, { cursor: '' }, { limit: 'invalid' }, { projectId: 'other' }]) expect(ReleaseJourneyPageRequestSchema.safeParse(value).success).toBe(false);
});
