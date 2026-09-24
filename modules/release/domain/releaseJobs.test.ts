import { expect, test } from 'bun:test';
import type { ReleaseId } from '@crewstation/contracts';
import { buildScript, jobOutcomeOf, releaseJobName } from './releaseJobs';

const id = '01a0bf5d-8f4b-7aea-8983-7b41e8b3a0e1' as ReleaseId;

test('Job 名字与 release 自己建时相同：RFC-013 之前的发布沿用旧 ID 的后 12 位', () => {
  expect(releaseJobName({ id }, 'build')).toBe('build-01a0bf5d8f4b7aea89837b41e8b3a0e1');
  expect(releaseJobName({ id }, 'migration')).toBe('migrate-01a0bf5d8f4b7aea89837b41e8b3a0e1');
  expect(releaseJobName({ id, legacyResourceId: 'rel_01a0954107447000b7936485fb80d15d' }, 'build')).toBe('build-6485fb80d15d');
});

test('构建脚本：令牌只在 GIT_TOKEN 里，克隆退避重试三次，向给定的 buildkitd 提交', () => {
  const script = buildScript('tcp://buildkitd:1234');
  expect(script).toContain('oauth2:${GIT_TOKEN}@');
  expect(script).toContain('for attempt in 1 2 3; do');
  expect(script).toContain('buildctl --addr "tcp://buildkitd:1234" build');
});

test('Job 记录的结果：Finished 定成败；没建成是失败；其余（含没有记录）还在跑', () => {
  expect(jobOutcomeOf(undefined)).toEqual({ state: 'running' });
  expect(jobOutcomeOf({ conditions: [{ type: 'Created', status: 'true' }] })).toEqual({ state: 'running' });
  expect(jobOutcomeOf({ conditions: [{ type: 'Finished', status: 'true', reason: 'succeeded' }] })).toEqual({ state: 'succeeded' });
  expect(jobOutcomeOf({ conditions: [{ type: 'Finished', status: 'true', reason: 'failed', message: 'BackoffLimitExceeded' }] })).toEqual({ state: 'failed', message: 'BackoffLimitExceeded' });
  expect(jobOutcomeOf({ conditions: [{ type: 'Finished', status: 'true', reason: 'failed' }] })).toEqual({ state: 'failed', message: 'Job 失败' });
  expect(jobOutcomeOf({ conditions: [{ type: 'Created', status: 'false', message: '构建 Job 没有建成：forbidden' }] })).toEqual({ state: 'failed', message: '构建 Job 没有建成：forbidden' });
  expect(jobOutcomeOf({ conditions: [{ type: 'Finished', status: 'false' }, { type: 'Created', status: 'false' }] })).toEqual({ state: 'failed', message: 'Job 没有建成' });
});
