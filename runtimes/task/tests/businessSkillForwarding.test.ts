import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LaunchSpecSchema } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import { createOpencodeCliDriver } from '../src/agents/cliDriver';
import { createProcessLauncher } from '../src/process/launcher';

test('Runner CLI adapter carries business skill files through to the child native discovery config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-skill-forward-'));
  try {
    const home = join(root, 'home'), binary = join(root, 'opencode'); await mkdir(home);
    await writeFile(binary, `#!${process.execPath}\nif(process.argv.includes('--version')) { console.log('1.18.29'); process.exit(0); }\nconst config=JSON.parse(process.env.OPENCODE_CONFIG_CONTENT);\nconst directory=config.skills?.paths?.[0];\nif(!directory) throw new Error('business skills missing');\nconst text=await Bun.file(directory+'/probe/SKILL.md').text();\nconsole.log(JSON.stringify({type:'text',part:{type:'text',text},sessionID:'session-skill'}));\n`, { mode: 0o755 });
    const launcher = createProcessLauncher({ isolation: { enabled: false, uid: 10001, gid: 10001, wrap: (cmd) => cmd }, processEnv: process.env, workerHome: home, logger: noopLogger });
    const skill = '---\nname: probe\ndescription: test material delivery\n---\nTOKEN_FROM_SKILL';
    const run = createOpencodeCliDriver().start({ agentId: 'forward-skills', compute: 'test', profileRevision: 1, mode: 'oneshot', permission: 'full', mcp: [], businessEvents: true,
      launch: LaunchSpecSchema.parse({ protocol: 'opencode', binaryPath: binary }), initialPrompt: 'probe', businessSkills: [{ path: 'probe/SKILL.md', content: skill }] },
    { cwd: root, env: launcher.baseEnv({ HOME: home }), launcher, logger: noopLogger, managed: { home, runDir: join(root, 'run') } });
    const events = []; for await (const event of run.events) events.push(event);
    expect(events.filter((event) => event.type === 'text').map((event) => event.text).join('')).toBe(skill);
    expect(events.at(-1)?.type).toBe('completed');
  } finally { await rm(root, { recursive: true, force: true }); }
});
