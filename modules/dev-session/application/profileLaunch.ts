import type { BeforeStartMaterial, LaunchSpec, ProfileRevisionRef } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { DevSessionUseCaseDeps } from './dependencies';

export interface ProfileLaunchFields {
  compute: string;
  profileRevision: number;
  launch: LaunchSpec;
  beforeStart: BeforeStartMaterial;
  processAttemptId: string;
}

/**
 * 按受理时固定的档位修订组装两类启动命令的档位部分（RFC-006，TaskRunner 协议 2）。材料含解密凭据，只进这一次命令。
 * 同一 agentId 只有一个 attempt：重发只恢复原执行结果，不重跑启动前脚本（RFC-004 §5.2 沿用）。
 */
export async function profileLaunchFields(deps: Pick<DevSessionUseCaseDeps, 'compute'>, profile: ProfileRevisionRef | undefined, agentId: string): Promise<ProfileLaunchFields> {
  if (!profile) throw precondition('这条 CLI 记录受理于档位合并之前，没有固定的档位修订，不能再启动；请新建一个 CLI', { code: 'profile_revision_missing' });
  const material = await deps.compute.launchMaterial(profile);
  return { compute: material.name, profileRevision: material.revision, launch: material.launch, beforeStart: material.beforeStart, processAttemptId: `${agentId}:1` };
}
