import { expect, test } from 'bun:test';
import { requireCheckedTaskTarget, storageDeploymentPreflight } from './compatibility';

test('an activated store blocks legacy or undeclared target images before any migration or deployment', async () => {
  const calls: string[][] = [];
  let minimum = '1', label: string | undefined = undefined;
  const run = async (args: string[]) => { calls.push(args); return args[0] === 'docker' ? JSON.stringify({ Id: `sha256:${'a'.repeat(64)}`, Config: { Labels: label ? { 'io.crewstation.storage-contract': label } : {} } }) : args.at(-1)!.includes('to_regclass') ? 't' : minimum; };
  await expect(storageDeploymentPreflight(run, 'system', ['old'], false)).rejects.toThrow('does not support');
  expect(calls.every((c) => !c.includes('apply') && !c.includes('migrate'))).toBe(true);
  label = '1'; expect((await storageDeploymentPreflight(run, 'system', ['current'], false)).requiredVersion).toBe(1);
  minimum = '2'; await expect(storageDeploymentPreflight(run, 'system', ['current'], false)).rejects.toThrow('contract 2');
  minimum = ''; await expect(storageDeploymentPreflight(run, 'system', ['current'], false)).rejects.toThrow('unreadable');
  await expect(storageDeploymentPreflight(async () => { throw new Error('unreachable'); }, 'system', ['current'], false)).rejects.toThrow('unreachable');
});
test('fresh legacy install may run without storage; activating objects requires all selected targets to declare compatibility', async () => {
  const legacy = async (args: string[]) => args[0] === 'docker' ? JSON.stringify({ Id: `sha256:${'b'.repeat(64)}` }) : args.at(-1)!.includes('object_spaces') ? 't' : 'f';
  expect((await storageDeploymentPreflight(legacy, 'system', ['legacy'], false)).requiredVersion).toBe(0);
  await expect(storageDeploymentPreflight(legacy, 'system', ['legacy'], true)).rejects.toThrow('does not support');
  await expect(storageDeploymentPreflight(async () => 'f', 'system', ['legacy'], false)).rejects.toThrow('without a contract marker');
});

test('activated storage and first activation cannot skip the checked runtime target', () => {
  expect(() => requireCheckedTaskTarget(1, false, true)).toThrow('CS_SKIP_TASK_RUNTIME');
  expect(() => requireCheckedTaskTarget(0, true, true)).toThrow('CS_SKIP_TASK_RUNTIME');
  expect(() => requireCheckedTaskTarget(0, false, true)).not.toThrow();
  expect(() => requireCheckedTaskTarget(1, true, false)).not.toThrow();
});
