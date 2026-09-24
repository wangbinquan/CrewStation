import { expect, test } from 'bun:test';
import { jobRenderOf } from './jobRender';

const children = [{ kind: 'Job', namespace: 'cs-demo', name: 'build-r1' }, { kind: 'Secret', namespace: 'cs-demo', name: 'build-r1-env' }];
const job = {
  releaseId: 'r1', purpose: 'build', image: 'builder:1', command: ['sh', '-c', 'echo'], env: { REPO_URL: 'http://git/demo.git', REF: 'v1' }, resources: { cpu: '250m', memory: '512Mi' },
  activeDeadlineSeconds: 1800, ttlSecondsAfterFinished: 3600, envSecret: 'build-r1-env',
};

test('Job 记录的期望：名字取自子对象，字段齐全才渲染', () => {
  const { envSecret: _envSecret, ...fields } = job;
  expect(jobRenderOf({ children, job })).toEqual({ ...fields, purpose: 'build', namespace: 'cs-demo', name: 'build-r1', secret: 'build-r1-env' } as never);
  expect(jobRenderOf({ children, job: { ...job, purpose: 'migration', env: {} } })?.purpose).toBe('migration');
  // 旧形状（release 自己建的 Job）没有 job：不渲染。
  expect(jobRenderOf({ children: children.slice(0, 1) })).toBeUndefined();
});

test('字段不全、类型不对、子对象对不上都不渲染', () => {
  const broken = [
    { ...job, purpose: 'deploy' }, { ...job, image: '' }, { ...job, command: [] }, { ...job, command: ['sh', ''] }, { ...job, env: { A: 1 } }, { ...job, resources: { cpu: '1' } },
    { ...job, activeDeadlineSeconds: 0 }, { ...job, ttlSecondsAfterFinished: 1.5 }, { ...job, envSecret: 'other-env' }, { ...job, releaseId: '' },
  ];
  for (const candidate of broken) expect(jobRenderOf({ children, job: candidate })).toBeUndefined();
  expect(jobRenderOf({ children: [children[0]!], job })).toBeUndefined();
  expect(jobRenderOf({ children: [children[0]!, { ...children[1]!, namespace: 'cs-other' }], job })).toBeUndefined();
  expect(jobRenderOf({ children: [{ ...children[0]!, namespace: undefined as never }, children[1]!], job })).toBeUndefined();
});
