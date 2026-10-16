import type { ProjectId } from '@crewstation/contracts';
import type { RotationLedger, RotationControl } from '../ports/credentialRotation';

/** I31 的两段事务：意图必须先提交，才允许改数据面；完成时一并解除启动阻断。 */
export async function rotateDataCredential(ledger: RotationLedger, control: RotationControl, id: string, projectId: ProjectId): Promise<void> {
  const rotate = async () => {
    // 意图和禁止启动的条件先原子提交；第二段即使进程崩溃，管理员重试仍沿用同一口令。
    await ledger.withIdleProject(projectId, async (tx) => {
      await control.stageRotation(id, tx);
      await ledger.owner('data').within(tx).report(id, { conditions: [{ type: 'CredentialRotating', status: 'true', reason: 'credential-rotation', message: '管理员正在轮换口令，完成前暂停新的启动；失败后请重试轮换' }] });
    });
    await ledger.withIdleProject(projectId, async (tx) => {
      await control.finishRotation(id, tx);
      await ledger.owner('data').within(tx).report(id, { conditions: [{ type: 'CredentialRotating', status: 'false' }] });
    });
  };
  return control.withCredentialAdmission ? control.withCredentialAdmission(id, rotate) : rotate();
}

/** Data credential adapter keeps the creation-mode admission beside rotation policy. */
export function dataCredentialPorts(
  ledger: () => RotationLedger,
  control: () => RotationControl & { credentialOf(id: string): Promise<{ role: string; password: string } | undefined> },
  ledgerCreation: boolean,
) {
  return {
    credentialOf: (id: string) => control().credentialOf(id),
    rotateCredential: async (id: string, projectId: ProjectId) => {
      if (!ledgerCreation) throw new Error('口令轮换需要工作负载与发布均由资源中心创建');
      await rotateDataCredential(ledger(), control(), id, projectId);
    },
  };
}
