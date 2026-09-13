import type { ComparisonDeployment } from '@crewstation/contracts';
import { ComparisonTargetSchema, TaskIdSchema } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';
import { z } from 'zod';

const referenceSchema = z.object({ taskId: TaskIdSchema, runnerId: z.string().uuid(), target: ComparisonTargetSchema, deployment: z.string().max(256) });
type ComparisonReference = z.infer<typeof referenceSchema>;

/** 不承载授权：每次仍查项目权限、当前 taskId、Runner 随机名册和部署版本。跨控制面副本无需共享缓存。 */
export function encodeComparisonReference(reference: ComparisonReference): string {
  return Buffer.from(JSON.stringify(reference)).toString('base64url');
}

export function decodeComparisonReference(value: string): ComparisonReference {
  try {
    if (value.length > 2048) throw new Error('too long');
    return referenceSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    throw validation('比较引用无效，请重新计算');
  }
}

export function deploymentReference(deployment: ComparisonDeployment): string {
  return deployment.status === 'ready' ? `${deployment.releaseId}:${deployment.commitSha}` : deployment.status;
}
