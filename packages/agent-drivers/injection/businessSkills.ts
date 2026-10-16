import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { BusinessMaterialRequestSchema } from '@crewstation/contracts';
import { materializeBusinessFiles } from './materialFiles';
import type { BusinessMaterialDownload, BusinessMaterialRequest } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';
import type { ProcessHost } from '../contract/processHost';

export type BusinessSkillFiles = BusinessMaterialRequest['skills'];
export interface StagedBusinessSkills { root: string; skills: string; dispose(): void }
/** A new private tree is populated before granting worker access; no writes follow worker-controlled symlinks. */
export async function stageBusinessSkills(files: BusinessSkillFiles | undefined, host: ProcessHost, reservedRoots: readonly string[], options?: { runDir: string; downloads?: readonly BusinessMaterialDownload[]; signal?: AbortSignal }): Promise<StagedBusinessSkills | undefined> {
  if (!files?.length) return undefined;
  const parsed = BusinessMaterialRequestSchema.parse({ requestKey: 'staging', skills: files }).skills;
  const names = new Set(parsed.map((file) => file.path.split('/')[0]!));
  for (const name of names) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw validation('skill 名称只能包含小写字母、数字和单连字符', { code: 'invalid_configuration' });
    const entry = parsed.find((file) => file.path === `${name}/SKILL.md`);
    if (!entry) throw validation('每个 skill 必须提供 SKILL.md', { code: 'invalid_configuration' });
    if (reservedRoots.some((root) => existsSync(join(root, name)))) throw validation('业务 skill 与平台或工作区 skill 重名', { code: 'invalid_configuration', skill: name });
  }
  const root = mkdtempSync(join(options?.runDir ?? tmpdir(), 'cs-business-material-')), skills = join(root, 'skills');
  const dispose = () => { rmSync(root, { recursive: true, force: true }); };
  try {
    await materializeBusinessFiles(skills, parsed.map((file) => ({ ...file, kind: 'file' as const })), options?.downloads ?? [], host, options?.signal);
    for (const name of names) {
      const file = parsed.find((entry) => entry.path === `${name}/SKILL.md`)!;
      if ((file.object?.size ?? Buffer.byteLength(file.content ?? '')) > 1024 * 1024) throw validation('SKILL.md 超过正文预算', { code: 'invalid_configuration' });
      const content = readFileSync(join(skills, name, 'SKILL.md'), 'utf8');
      if (!/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(content)) throw validation('SKILL.md 必须含 frontmatter', { code: 'invalid_configuration' });
      const header = content.slice(0, content.indexOf('\n---', 4));
      if (!new RegExp(`^name: *["']?${name}["']? *$`, 'm').test(header) || !/^description: *\S/m.test(header)) throw validation('skill frontmatter 的 name 或 description 无效', { code: 'invalid_configuration' });
    }
    mkdirSync(join(root, '.claude-plugin'), { mode: 0o700 });
    writeFileSync(join(root, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'crewstation-business', version: '1.0.0' }), { mode: 0o600, flag: 'wx' });
    await host.chownToWorker(join(root, '.claude-plugin/plugin.json')); await host.chownToWorker(join(root, '.claude-plugin'));
    await host.chownToWorker(root); return { root, skills, dispose };
  } catch (error) { dispose(); throw error; }
}
/** Native discovery roots are read only: business material is always in its own private directory. */
export function nativeSkillRoots(cwd: string, home: string, configHome?: string): string[] {
  const roots = [join(home, '.claude/skills'), join(home, '.agents/skills'), join(configHome ?? join(home, '.config'), 'opencode/skills'), join(configHome ?? join(home, '.config'), 'opencode/skill')];
  for (let at = resolve(cwd); ; at = dirname(at)) {
    for (const path of ['.claude/skills', '.agents/skills', '.opencode/skills', '.opencode/skill']) roots.push(join(at, path));
    if (dirname(at) === at) break;
  }
  return roots;
}
