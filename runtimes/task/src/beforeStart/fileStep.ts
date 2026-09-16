import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { FileStep } from '@crewstation/contracts';
import { fsErrorCode } from '../commandError';
import type { ProcessLauncher } from '../process/launcher';
import { BeforeStartFailure } from './failure';
import { isPrivatePath, resolveHookPath } from './hookPaths';
import type { SharedPathRegistry } from './sharedPaths';
import type { HookContext } from './templateContext';
import { expandTemplate } from './templateContext';

export interface FileStepDeps { launcher: ProcessLauncher; shared: SharedPathRegistry }
export interface FileStepResult { path: string; written: boolean; hash: string }

/**
 * 预置文件：展开路径与内容 → 校验格式 → 处理“已存在”策略 → 临时文件＋原子替换。
 * 写入失败不得留下半个原文件；共享固定路径的占用在这里登记。
 */
export async function executeFileStep(step: FileStep, ctx: HookContext, deps: FileStepDeps): Promise<FileStepResult> {
  const path = resolveHookPath(step.pathTemplate, ctx, step.stepId);
  const content = expandTemplate(step.contentTemplate, ctx, { json: step.format !== 'text', stepId: step.stepId });
  if (step.format !== 'text') assertJson(content, step);
  const hash = new Bun.CryptoHasher('sha256').update(content).digest('hex');
  if (!isPrivatePath(path, ctx)) deps.shared.claim(path, hash, ctx.agentId, step.stepId);
  const existing = await readExisting(path, step.stepId);
  if (existing !== undefined) {
    if (existing === content) return { path, written: false, hash };
    if (step.existing === 'require-same') throw new BeforeStartFailure('file_path_in_use', `文件 ${path} 已存在且内容不同；改用 replace 策略或换路径`, step.stepId);
  }
  await ensureParentDirs(dirname(path), deps.launcher, step.stepId);
  const temp = `${path}.cs-hook-${randomBytes(6).toString('hex')}`;
  try {
    await writeFile(temp, content, { mode: step.mode });
    await deps.launcher.chownToWorker(temp);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    const code = fsErrorCode(error);
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') throw new BeforeStartFailure('path_denied', `没有权限写入 ${path}`, step.stepId);
    throw new BeforeStartFailure('file_write_failed', `写入 ${path} 失败：${error instanceof Error ? error.message : String(error)}`, step.stepId);
  }
  return { path, written: true, hash };
}

function assertJson(content: string, step: FileStep): void {
  try { JSON.parse(step.format === 'jsonc' ? stripJsonComments(content) : content); }
  catch (error) { throw new BeforeStartFailure('invalid_json', `展开后的 ${step.format.toUpperCase()} 不合法：${error instanceof Error ? error.message : String(error)}`, step.stepId); }
}

async function readExisting(path: string, stepId: string): Promise<string | undefined> {
  try {
    const info = await stat(path);
    if (info.isDirectory()) throw new BeforeStartFailure('path_denied', `${path} 是目录，不能作为文件落点`, stepId);
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof BeforeStartFailure) throw error;
    const code = fsErrorCode(error);
    if (code === 'ENOENT') return undefined;
    if (code === 'EACCES' || code === 'EPERM') throw new BeforeStartFailure('path_denied', `没有权限读取 ${path}`, stepId);
    throw error;
  }
}

/** 逐级建父目录并把新建的交给 worker；已存在的目录不改属主。 */
async function ensureParentDirs(dir: string, launcher: ProcessLauncher, stepId: string): Promise<void> {
  const created: string[] = [];
  let probe = dir;
  while (!(await exists(probe))) {
    created.push(probe);
    const parent = dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  if (created.length === 0) return;
  try { await mkdir(dir, { recursive: true }); } catch (error) { throw new BeforeStartFailure('path_denied', `无法创建目录 ${dir}：${error instanceof Error ? error.message : String(error)}`, stepId); }
  for (const path of created.reverse()) await launcher.chownToWorker(path);
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

/** 与 agent-runtime 的保存校验同一种宽松度：去掉行注释与块注释，字符串内容保留。 */
export function stripJsonComments(text: string): string {
  let out = '', inString = false, escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!, next = text[i + 1];
    if (inString) { out += ch; if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') inString = false; continue; }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === '/' && next === '/') { while (i < text.length && text[i] !== '\n') i += 1; out += '\n'; continue; }
    if (ch === '/' && next === '*') { const end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 1; continue; }
    out += ch;
  }
  return out;
}
