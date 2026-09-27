import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { BusinessMaterialRequestSchema } from '@crewstation/contracts';
import type { BusinessMaterialRequest } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';
import type { ProcessHost } from '../contract/processHost';

export type BusinessSkillFiles = BusinessMaterialRequest['skills'];
export interface StagedBusinessSkills { root: string; skills: string; dispose(): void }
/** A new private tree is populated before granting worker access; no writes follow worker-controlled symlinks. */
export async function stageBusinessSkills(files: BusinessSkillFiles | undefined, host: ProcessHost, reservedRoots: readonly string[]): Promise<StagedBusinessSkills | undefined> {
  if (!files?.length) return undefined;
  const parsed = BusinessMaterialRequestSchema.parse({ requestKey: 'staging', skills: files }).skills;
  const names = new Set(parsed.map((file) => file.path.split('/')[0]!));
  for (const name of names) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw validation('skill 名称只能包含小写字母、数字和单连字符', { code: 'invalid_configuration' });
    const entry = parsed.find((file) => file.path === `${name}/SKILL.md`);
    if (!entry || !/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(entry.content)) throw validation('每个 skill 必须提供含 frontmatter 的 SKILL.md', { code: 'invalid_configuration' });
    const header = entry.content.slice(0, entry.content.indexOf('\n---', 4));
    if (!new RegExp(`^name: *["']?${name}["']? *$`, 'm').test(header) || !/^description: *\S/m.test(header)) throw validation('skill frontmatter 的 name 或 description 无效', { code: 'invalid_configuration' });
    if (reservedRoots.some((root) => existsSync(join(root, name)))) throw validation('业务 skill 与平台或工作区 skill 重名', { code: 'invalid_configuration', skill: name });
  }
  const root = mkdtempSync(join(tmpdir(), 'cs-business-material-')), skills = join(root, 'skills');
  const dispose = () => { rmSync(root, { recursive: true, force: true }); };
  try {
    mkdirSync(skills, { mode: 0o700 });
    for (const file of parsed) {
      const path = resolve(skills, file.path);
      if (!path.startsWith(`${skills}/`) || file.path.split('/').length < 2) throw validation('skill 文件路径无效');
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); writeFileSync(path, file.content, { mode: 0o600, flag: 'wx' });
    }
    mkdirSync(join(root, '.claude-plugin'), { mode: 0o700 });
    writeFileSync(join(root, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'crewstation-business', version: '1.0.0' }), { mode: 0o600, flag: 'wx' });
    const own = async (path: string): Promise<void> => {
      for (const entry of readdirSync(path, { withFileTypes: true })) { const child = join(path, entry.name); if (entry.isDirectory()) await own(child); else await host.chownToWorker(child); }
      await host.chownToWorker(path);
    };
    await own(root); return { root, skills, dispose };
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
