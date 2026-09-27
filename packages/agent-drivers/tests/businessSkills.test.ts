import { afterEach, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { noopLogger } from '@crewstation/kernel';
import { LaunchSpecSchema } from '@crewstation/contracts';
import { stageBusinessSkills } from '../injection/businessSkills';
import { claudeCodeAdapter } from '../drivers/claudeCode/driver';
import { opencodeAdapter } from '../drivers/opencode/driver';
import { createFakeProcessHost } from './fakeProcessHost';

const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
const content = '---\nname: review-code\ndescription: Inspect code carefully\n---\nRead references/rules.md';
const files = [{ path: 'review-code/SKILL.md', content }, { path: 'review-code/references/rules.md', content: 'check output' }];
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'business-skills-test-')); cleanups.push(() => rm(root, { recursive: true, force: true })); return root; }

test('material staging owns a fresh tree until every file is written; unrelated worker symlinks cannot redirect writes', async () => {
  const root = await fixture(), host = createFakeProcessHost([]), owners: string[] = [];
  host.chownToWorker = async (path) => { owners.push(path); };
  await symlink('/tmp', join(root, 'skills'));
  const staged = (await stageBusinessSkills(files, host, [join(root, 'platform')]))!; cleanups.push(staged.dispose);
  expect(staged.root).not.toStartWith(root); expect(owners.at(-1)).toBe(staged.root);
  expect(await readFile(join(staged.skills, 'review-code/SKILL.md'), 'utf8')).toBe(content);
  expect(await readFile(join(staged.skills, 'review-code/references/rules.md'), 'utf8')).toBe('check output');
  expect(JSON.parse(await readFile(join(staged.root, '.claude-plugin/plugin.json'), 'utf8')).name).toBe('crewstation-business');
  staged.dispose(); expect(existsSync(staged.root)).toBe(false);
});
test('path traversal, malformed skill roots and platform name collisions reject without overwriting platform files', async () => {
  const root = await fixture(), host = createFakeProcessHost([]);
  await mkdir(join(root, 'review-code')); await writeFile(join(root, 'review-code/SKILL.md'), 'platform');
  await expect(stageBusinessSkills(files, host, [root])).rejects.toThrow('重名');
  expect(await readFile(join(root, 'review-code/SKILL.md'), 'utf8')).toBe('platform');
  await expect(stageBusinessSkills([{ path: '../escape', content }], host, [])).rejects.toThrow();
  await expect(stageBusinessSkills([{ path: 'review-code/script.sh', content: 'x' }], host, [])).rejects.toThrow('SKILL.md');
  await expect(stageBusinessSkills([{ path: 'review-code/SKILL.md', content: content.replace('name: review-code', 'name: wrong') }], host, [])).rejects.toThrow('name');
});
for (const protocol of ['claude-code', 'opencode'] as const) test(`${protocol} material is wired to native discovery and cleaned with the execution`, async () => {
  const root = await fixture(), home = join(root, 'home'); await mkdir(home);
  const host = createFakeProcessHost([{ stdout: ['1.18.29'] }]), adapter = protocol === 'opencode' ? opencodeAdapter() : claudeCodeAdapter();
  const prepared = await adapter.prepare({ agentId: `skill-${protocol}`, compute: 'profile', profileRevision: 1, launch: LaunchSpecSchema.parse({ protocol, binaryPath: '/usr/bin/agent' }), mode: 'oneshot', permission: 'full', mcp: [], businessEvents: true, businessSkills: files },
    { cwd: root, runDir: join(root, 'run'), managed: { home, runDir: join(root, 'run') }, env: { HOME: home }, host, logger: noopLogger });
  cleanups.push(prepared.dispose);
  const plan = prepared.plan({ prompt: 'review', resident: false });
  const directory = protocol === 'opencode' ? JSON.parse(plan.env.OPENCODE_CONFIG_CONTENT!).skills.paths[0] as string : join(plan.cmd[plan.cmd.indexOf('--plugin-dir') + 1]!, 'skills');
  expect(await readFile(join(directory, 'review-code/SKILL.md'), 'utf8')).toBe(content);
  expect(plan.env.HOME).toBe(home); prepared.dispose(); expect(existsSync(directory)).toBe(false);
});
