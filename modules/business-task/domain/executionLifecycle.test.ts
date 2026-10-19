// RFC-043: every image reader takes the current pin, and recovery material changes with it. Locks the two helpers the
// view, recovery proof, rebuild, restart, close and owner proof share, so a reader cannot fall back to the admission snapshot.
import { expect, test } from 'bun:test';
import type { RuntimeImageExecutionSnapshot } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { currentTaskRuntimeImage, taskMaterialDigest } from './executionLifecycle';

const snapshot = (tag: string): RuntimeImageExecutionSnapshot => {
  const digest = `sha256:${tag.repeat(64)}`;
  return { versionId: newResourceId(), image: `registry.test/task@${digest}`, digest, architecture: 'linux/amd64', initializer: { steps: [], env: {}, secrets: [] }, tools: [], initializerDigest: digest, validationId: newResourceId(), selectionSource: 'configuration' };
};

test('the current pin is the upgrade snapshot when present, else the admission snapshot', () => {
  const admitted = snapshot('a'), upgraded = snapshot('b');
  expect(currentTaskRuntimeImage(admitted, undefined)).toBe(admitted);
  expect(currentTaskRuntimeImage(admitted, { runtimeImage: null })).toBe(admitted);
  expect(currentTaskRuntimeImage(admitted, { runtimeImage: upgraded })).toBe(upgraded);
  expect(currentTaskRuntimeImage(undefined, undefined)).toBeUndefined();
});

test('recovery material is unchanged for a task never upgraded and differs once it is repinned', () => {
  const effective = 'e'.repeat(64), first = snapshot('c'), second = snapshot('d');
  expect(taskMaterialDigest(effective, undefined)).toBe(effective);
  expect(taskMaterialDigest(effective, { runtimeImage: null })).toBe(effective);
  const repinned = taskMaterialDigest(effective, { runtimeImage: first });
  expect(repinned).toBe(jsonHash({ admission: effective, runtimeImageVersionId: first.versionId }));
  expect(repinned).not.toBe(effective);
  expect(taskMaterialDigest(effective, { runtimeImage: second })).not.toBe(repinned);
});
