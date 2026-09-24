import { expect, test } from 'bun:test';
import type { TaskId } from '@crewstation/contracts';
import { canonicalNativeIntent, nativeIntent, nativeIntentMatches } from './physicalIdentity';
import type { NativeExecution, TaskEnvironment } from './taskEnvironment';

const native = (profile: NativeExecution['profile']): NativeExecution => ({
  purpose: 'agent', parentTaskId: '01a0bf5d-8f4b-7c01-8e19-e226732a7100' as TaskId, parentPodUid: 'p', pvcUid: 'v', nodeName: 'n', agentId: 'a', runnerId: 'r', fingerprint: 'f', requestedProfile: null, profile, image: 'img', state: 'queued',
});
const inMemory = native({ id: 'x', name: 'm', cpu: '1', memory: '2Gi', storage: '10Gi' });
// jsonb 读回来时键按长度重排：同一个档位对象，键的先后不同。
const fromDatabase = native({ id: 'x', cpu: '1', name: 'm', memory: '2Gi', storage: '10Gi' });

// RFC-025 I25 第二步：资源中心照投影写意图注解，清理时照库里读回的环境比对，两边要认得出是同一份意图。
test('与键的先后无关的意图：内存里与库里读回的算出同一个值；旧摘要随键序变，所以比对时两种都认', () => {
  expect(canonicalNativeIntent('t', inMemory)).toBe(canonicalNativeIntent('t', fromDatabase));
  expect(nativeIntent('t', inMemory)).not.toBe(nativeIntent('t', fromDatabase));
  const env = { id: 't', native: fromDatabase } as unknown as TaskEnvironment;
  expect(nativeIntentMatches(canonicalNativeIntent('t', inMemory), env)).toBe(true);
  expect(nativeIntentMatches(nativeIntent('t', fromDatabase), env)).toBe(true);
  expect(nativeIntentMatches(nativeIntent('t', inMemory), env)).toBe(false);
  expect(nativeIntentMatches(canonicalNativeIntent('other', inMemory), env)).toBe(false);
  expect(nativeIntentMatches(undefined, env)).toBe(false);
});
