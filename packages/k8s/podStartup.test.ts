import { expect, test } from 'bun:test';
import type { K8sObject } from './resources';
import type { PodEventLike } from './podStartup';
import { podStartup } from './podStartup';

const IMAGE = 'registry.local/crewstation/task@sha256:abc';
const pod = (status: Record<string, unknown>, spec: Record<string, unknown> = {}): K8sObject => ({
  apiVersion: 'v1', kind: 'Pod', metadata: { name: 'task-1', uid: 'pod-uid' },
  spec: { initContainers: [{ name: 'checkout', image: IMAGE }], containers: [{ name: 'main', image: IMAGE }], ...spec }, status,
});
const event = (reason: string, message: string, fieldPath: string, at: string, extra: Partial<PodEventLike> = {}): PodEventLike =>
  ({ reason, message, involvedObject: { fieldPath }, firstTimestamp: at, lastTimestamp: at, ...extra });

test('未调度：带调度器给出的原因，没有节点与调度时间', () => {
  const observed = podStartup(pod({ phase: 'Pending', conditions: [{ type: 'PodScheduled', status: 'False', reason: 'Unschedulable', message: '0/1 nodes are available: 1 Insufficient cpu.' }] }));
  expect(observed).toMatchObject({ uid: 'pod-uid', phase: 'Pending', unschedulable: { reason: 'Unschedulable', message: '0/1 nodes are available: 1 Insufficient cpu.' } });
  expect(observed.node).toBeUndefined();
  expect(observed.scheduledAt).toBeUndefined();
  expect(observed.containers.map((c) => [c.name, c.init])).toEqual([['checkout', true], ['main', false]]);
});

test('已调度、init 在跑、主容器等待：调度时间取条件的 lastTransitionTime，容器时间取容器状态', () => {
  const observed = podStartup(pod({
    phase: 'Pending',
    conditions: [{ type: 'PodScheduled', status: 'True', lastTransitionTime: '2026-09-23T03:00:01Z' }],
    initContainerStatuses: [{ name: 'checkout', state: { running: { startedAt: '2026-09-23T03:00:04Z' } } }],
    containerStatuses: [{ name: 'main', state: { waiting: { reason: 'PodInitializing' } } }],
  }, { nodeName: 'docker-desktop' }));
  expect(observed).toMatchObject({ node: 'docker-desktop', scheduledAt: '2026-09-23T03:00:01Z' });
  expect(observed.containers).toEqual([
    { name: 'checkout', init: true, image: IMAGE, startedAt: '2026-09-23T03:00:04Z' },
    { name: 'main', init: false, image: IMAGE, waiting: { reason: 'PodInitializing' } },
  ]);
});

test('init 以非 0 退出：开始、结束、退出码与原因都在', () => {
  const observed = podStartup(pod({ phase: 'Failed', initContainerStatuses: [{ name: 'checkout', state: { terminated: { startedAt: '2026-09-23T03:00:04Z', finishedAt: '2026-09-23T03:00:19Z', exitCode: 1, reason: 'Error' } } }] }));
  expect(observed.containers[0]).toEqual({ name: 'checkout', init: true, image: IMAGE, startedAt: '2026-09-23T03:00:04Z', finishedAt: '2026-09-23T03:00:19Z', exitCode: 1, terminatedReason: 'Error' });
});

test('镜像拉取：Pulling 到 Pulled 的时间与 kubelet 报告的用时；节点上已有；按 fieldPath 归到容器', () => {
  const events = [
    event('Scheduled', 'Successfully assigned ns/task-1 to docker-desktop', '', '2026-09-23T03:00:01Z'),
    event('Pulling', `Pulling image "${IMAGE}"`, 'spec.initContainers{checkout}', '2026-09-23T03:00:02Z'),
    event('Pulled', `Successfully pulled image "${IMAGE}" in 2.345s (2.345s including waiting). Image size: 123 bytes.`, 'spec.initContainers{checkout}', '2026-09-23T03:00:04Z'),
    event('Pulled', `Container image "${IMAGE}" already present on machine`, 'spec.containers{main}', '2026-09-23T03:00:20Z'),
    event('Pulled', 'Container image "other" already present on machine', 'spec.containers{sidecar}', '2026-09-23T03:00:20Z'),
  ];
  expect(podStartup(pod({ phase: 'Pending' }), events).pulls).toEqual([
    { container: 'checkout', image: IMAGE, startedAt: '2026-09-23T03:00:02Z', endedAt: '2026-09-23T03:00:04Z', cached: false, took: '2.345s' },
    { container: 'main', image: IMAGE, endedAt: '2026-09-23T03:00:20Z', cached: true },
  ]);
});

test('拉取失败与退避：留下原文；之后拉取成功则清掉失败；事件只有 eventTime 时也能取到时间；乱序事件按时间排', () => {
  const failing = [
    event('BackOff', `Back-off pulling image "${IMAGE}"`, 'spec.containers{main}', '2026-09-23T03:00:09Z', { count: 3 } as Partial<PodEventLike>),
    event('Pulling', `Pulling image "${IMAGE}"`, 'spec.containers{main}', '', { firstTimestamp: null, lastTimestamp: null, eventTime: '2026-09-23T03:00:02.000000Z' }),
    event('Failed', `Failed to pull image "${IMAGE}": not found`, 'spec.containers{main}', '2026-09-23T03:00:05Z'),
  ];
  const failed = podStartup(pod({ phase: 'Pending' }, { initContainers: [] }), failing).pulls;
  expect(failed).toEqual([{ container: 'main', image: IMAGE, startedAt: '2026-09-23T03:00:02.000000Z', cached: false, failure: `Back-off pulling image "${IMAGE}"` }]);
  const recovered = podStartup(pod({ phase: 'Pending' }, { initContainers: [] }), [...failing, event('Pulled', `Successfully pulled image "${IMAGE}" in 450ms (450ms including waiting)`, 'spec.containers{main}', '2026-09-23T03:00:30Z')]).pulls;
  expect(recovered).toEqual([{ container: 'main', image: IMAGE, startedAt: '2026-09-23T03:00:02.000000Z', endedAt: '2026-09-23T03:00:30Z', cached: false, took: '450ms' }]);
});

test('没有状态的新 Pod：阶段未知，容器只有名字与镜像；与镜像无关的 Failed 事件不算拉取', () => {
  const observed = podStartup(pod(undefined as never, { initContainers: undefined }), [event('Failed', 'Error: container create failed', 'spec.containers{main}', '2026-09-23T03:00:05Z')]);
  expect(observed).toEqual({ uid: 'pod-uid', phase: 'Unknown', containers: [{ name: 'main', init: false, image: IMAGE }], pulls: [] });
});
