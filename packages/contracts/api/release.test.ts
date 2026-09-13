import { expect, test } from 'bun:test';
import { PublishDevSessionRequestSchema } from './devSession';
import { PublishRequestSchema } from './release';
import { CreateReleaseTagRequestSchema } from './scm';
import { TaskIdSchema } from '../ids';

test('发布来源契约保留完整 SHA 与会话身份；缩写、分支名和错误任务 ID 不能作为确认值', () => {
  const expectedCommitSha = 'a'.repeat(40), expectedTaskId = TaskIdSchema.parse(`tsk_${'b'.repeat(32)}`);
  expect(PublishDevSessionRequestSchema.parse({ branch: 'main', expectedCommitSha, expectedTaskId })).toEqual({ branch: 'main', version: 'patch', expectedCommitSha, expectedTaskId });
  for (const sha of ['a'.repeat(7), 'a'.repeat(41), 'HEAD', 'a;echo test', '']) {
    expect(PublishRequestSchema.safeParse({ branch: 'main', expectedCommitSha: sha }).success).toBe(false);
    expect(CreateReleaseTagRequestSchema.safeParse({ branch: 'main', bump: 'patch', expectedCommitSha: sha }).success).toBe(false);
  }
  expect(PublishDevSessionRequestSchema.safeParse({ branch: 'main', expectedTaskId: 'previous' }).success).toBe(false);
  expect(PublishRequestSchema.parse({ branch: 'main', expectedCommitSha: 'b'.repeat(64) }).expectedCommitSha).toHaveLength(64);
  expect(PublishDevSessionRequestSchema.parse({ branch: 'main' })).toEqual({ branch: 'main', version: 'patch' });
});
