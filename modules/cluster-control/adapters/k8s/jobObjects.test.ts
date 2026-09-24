import { expect, test } from 'bun:test';
import type { JobRender } from '../../domain/jobRender';
import { jobSecretObject, releaseJobObject } from './jobObjects';

const job: JobRender = {
  namespace: 'cs-demo', name: 'build-r1', secret: 'build-r1-env', releaseId: 'r1', purpose: 'build', image: 'builder:1', command: ['sh', '-c', 'echo'],
  env: { REPO_URL: 'http://git/demo.git' }, resources: { cpu: '250m', memory: '512Mi' }, activeDeadlineSeconds: 1800, ttlSecondsAfterFinished: 3600,
};
type Container = { env: Array<{ name: string; value?: string }>; envFrom: unknown; resources: unknown };

test('Job：标签与 release 自己建时相同，凭据只从这一次的 Secret 引用，明文里只有不含凭据的变量', () => {
  const object = releaseJobObject(job);
  expect(object.metadata).toMatchObject({ name: 'build-r1', namespace: 'cs-demo', labels: { 'app.kubernetes.io/component': 'build', 'crewstation.io/release': 'r1', 'app.kubernetes.io/managed-by': 'crewstation' } });
  const spec = (object as { spec?: unknown }).spec as { activeDeadlineSeconds: number; ttlSecondsAfterFinished: number; backoffLimit: number; template: { spec: { containers: Container[]; restartPolicy: string } } };
  expect(spec).toMatchObject({ activeDeadlineSeconds: 1800, ttlSecondsAfterFinished: 3600, backoffLimit: 0 });
  expect(spec.template.spec.restartPolicy).toBe('Never');
  expect(spec.template.spec.containers[0]).toMatchObject({ env: [{ name: 'REPO_URL', value: 'http://git/demo.git' }], envFrom: [{ secretRef: { name: 'build-r1-env' } }], resources: { requests: { cpu: '250m', memory: '512Mi' } } });
  expect(releaseJobObject({ ...job, purpose: 'migration' }).metadata.labels?.['app.kubernetes.io/component']).toBe('migration');
});

test('凭据 Secret：不可变，名字是期望里的', () => {
  expect(jobSecretObject(job, { GIT_TOKEN: 't' })).toMatchObject({ kind: 'Secret', immutable: true, stringData: { GIT_TOKEN: 't' }, metadata: { name: 'build-r1-env', namespace: 'cs-demo' } });
});
