import { expect, test } from 'bun:test';
import type { ReleaseId } from '@crewstation/contracts';
import { buildScript, jobOutcomeOf, releaseImageReference, releaseJobName } from './releaseJobs';

const id = '01a0bf5d-8f4b-7aea-8983-7b41e8b3a0e1' as ReleaseId;

test('Job 名字与 release 自己建时相同：RFC-013 之前的发布沿用旧 ID 的后 12 位', () => {
  expect(releaseJobName({ id }, 'build')).toBe('build-01a0bf5d8f4b7aea89837b41e8b3a0e1');
  expect(releaseJobName({ id }, 'migration')).toBe('migrate-01a0bf5d8f4b7aea89837b41e8b3a0e1');
  expect(releaseJobName({ id, legacyResourceId: 'rel_01a0954107447000b7936485fb80d15d' }, 'build')).toBe('build-6485fb80d15d');
});

test('构建脚本：令牌只在 GIT_TOKEN 里，克隆退避重试三次，向给定的 buildkitd 提交', () => {
  const script = buildScript('tcp://buildkitd:1234');
  expect(script).toContain('GIT_ASKPASS');
  expect(script).toContain('fetch --quiet --depth 1');
  expect(script).toContain('source commit mismatch');
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

test('镜像引用：普通版本原样；派生候选版本号里的 + 换成 _，标签符合镜像语法', () => {
  expect(releaseImageReference('registry', 'svc', 'v1.2.3')).toBe('registry/svc:v1.2.3');
  // RFC-044 T9 本机验收：迁移候选版本号带 semver 构建元数据（v0.1.2+migrate.<操作>），原样当镜像标签，推送被仓库以 invalid reference format 拒绝。
  const image = releaseImageReference('registry', 'svc', 'v0.1.2+migrate.01a182cb945873419ac818e36f790339');
  expect(image).toBe('registry/svc:v0.1.2_migrate.01a182cb945873419ac818e36f790339');
  expect(image.slice(image.lastIndexOf(':') + 1)).toMatch(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/);
});
