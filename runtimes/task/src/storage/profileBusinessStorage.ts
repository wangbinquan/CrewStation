import { chmod, chown, lstat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RunnerConfig } from '../config';
import { RunnerCommandError } from '../commandError';

/** Test Pods have no tenant volume. Keep their probe journal private across Runner restarts in that Pod. */
export async function profileBusinessStorage(config: RunnerConfig): Promise<RunnerConfig> {
  if (!config.businessProbe) return config;
  const owner = process.getuid?.(); if (owner === undefined) throw new RunnerCommandError('unsupported_capability', '档位业务测试需要 Unix 文件权限');
  const root = join(tmpdir(), `crewstation-profile-${config.taskId}`), journal = join(root, 'journal'), home = join(root, 'session');
  await directory(root, owner, 0o711);
  await directory(journal, owner, 0o700);
  await directory(home, config.workerUid, 0o700, config.workerGid);
  return { ...config, businessJournalDir: journal, businessSessionDir: home };
}
async function directory(path: string, uid: number, mode: number, gid = uid): Promise<void> {
  let created = false;
  try { await mkdir(path, { mode }); created = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  if (created) { await chown(path, uid, gid); await chmod(path, mode); }
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o777) !== mode) throw new RunnerCommandError('business_volume_invalid', '档位测试存储身份不一致');
}
