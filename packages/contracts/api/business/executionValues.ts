import { z } from 'zod';
import { isPlatformSpawnEnv } from '../../taskrunner/launch';

export const BUSINESS_EXECUTION_VERSION = 3;
export const BUSINESS_EXECUTION_LIMITS = {
  materialBytes: 1024 * 1024, materialFiles: 128, eventBytes: 256 * 1024,
  outputBytes: 64 * 1024 * 1024, summaryBytes: 256 * 1024, fileChunkBytes: 1024 * 1024,
  eventPageDefault: 200, eventPageMax: 1000, retentionDays: 7, leaseSeconds: 30, renewSeconds: 10,
} as const;

export const BusinessRequestKeySchema = z.string().min(1).max(128).regex(/^[^\u0000-\u001f\u007f]+$/u);
export const BusinessDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const BusinessGenerationSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const BusinessTaskContractVersionSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9./_-]*$/);
/** Static platform/driver namespaces; a profile may reserve additional names during material assembly. */
export function isBusinessEnvironmentReserved(name: string): boolean {
  return isPlatformSpawnEnv(name) || ['XDG_', 'LD_', 'DYLD_', 'ANTHROPIC_', 'OPENAI_', 'OPENCODE_', 'CLAUDE_'].some((prefix) => name.startsWith(prefix));
}
export const BusinessEnvironmentNameSchema = z.string().regex(/^[A-Z_][A-Z0-9_]*$/).max(128).refine((name) => !isBusinessEnvironmentReserved(name), '不能覆盖平台或驱动保留的环境变量');

/** Pure syntax validation; the Runner must additionally enforce realpath, open-file and ownership checks. */
export function isBusinessRelativePath(value: string): boolean {
  if (!value || value.startsWith('/') || value.includes('\\') || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  return value.split('/').every((part) => part !== '' && part !== '..' && part !== '.' && part !== '.crewstation');
}

export const BusinessRelativePathSchema = z.string().max(4096).refine(isBusinessRelativePath, '必须是工作区内的相对路径，不能引用平台管理目录');
export const BusinessCwdSchema = z.string().max(4096).refine((value) => {
  if (value === '/work' || value === '.') return true;
  return isBusinessRelativePath(value.startsWith('/work/') ? value.slice(6) : value);
}, 'cwd 必须位于 /work 内');

export const BusinessSubtaskStateV3Schema = z.enum(['admitting', 'pending', 'running', 'awaiting-input', 'verifying', 'cancelling', 'cancelled', 'succeeded', 'failed']);
export const BusinessTaskStateV3Schema = z.enum(['admitting', 'creating', 'running', 'pausing', 'paused', 'finalizing', 'closing', 'closed', 'failed']);
export const BusinessProcessStateSchema = z.enum(['not-started', 'live', 'unknown', 'exited']);

export type BusinessSubtaskStateV3 = z.infer<typeof BusinessSubtaskStateV3Schema>;
export type BusinessTaskStateV3 = z.infer<typeof BusinessTaskStateV3Schema>;
export type BusinessProcessState = z.infer<typeof BusinessProcessStateSchema>;
