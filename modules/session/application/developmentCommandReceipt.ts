import type { RunnerCommand, TaskId } from '@crewstation/contracts';
import { DevelopmentUsageInfoSchema, DevelopmentUsageReceiptSchema, DevelopmentUsageStopReceiptSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { DevelopmentUsageStore } from '../ports/developmentUsage';
import { persistDevelopmentInfo } from './developmentUsageReceipt';

export async function prepareDevelopmentCommand(store: DevelopmentUsageStore | undefined, taskId: TaskId, command: RunnerCommand): Promise<void> {
  if (!(command.type === 'startAgent' && command.developmentUsage) && command.type !== 'ackDevelopmentUsageEvents' && command.type !== 'stopDevelopmentAgent') return;
  if (!store) throw precondition('Session 开发数字存储未启用');
  const key = command.type === 'startAgent' ? command.developmentUsage!.key : command.type === 'stopDevelopmentAgent' ? command.admission.key : command.key;
  const current = await store.get(taskId, key);
  if (!current) throw precondition('首次派发前必须持久登记开发数字原键');
  if (command.type === 'ackDevelopmentUsageEvents') {
    if (command.through > current.persistedThrough) throw precondition('不能确认尚未复制的开发数字');
    return;
  }
  const intent = command.type === 'stopDevelopmentAgent' ? command.admission.intent : command.developmentUsage!.intent, registration = current.registration;
  if (command.type === 'stopDevelopmentAgent' && command.podUid !== registration.podUid) throw precondition('停止命令不属于原Pod');
  if (command.type === 'startAgent' && (current.drainReason || current.loss || current.closure)) throw precondition('开发数字原来源已关闭或不可取回，不能重新启动模型');
  if (jsonHash(intent.identity) !== jsonHash(registration.identity) || intent.profileId !== registration.profileId || intent.profileRevision !== registration.profileRevision) throw precondition('启动意图与原开发数字归属不同');
}
export async function persistDevelopmentReply(store: DevelopmentUsageStore | undefined, taskId: TaskId, command: RunnerCommand, payload: unknown): Promise<void> {
  if (!store) return;
  if (command.type === 'stopDevelopmentAgent') {
    const reply = DevelopmentUsageStopReceiptSchema.parse(payload);
    if (jsonHash(reply.receipt.key) !== jsonHash(command.admission.key) || reply.receipt.podUid !== command.podUid) throw precondition('停止回执不属于原键和Pod');
    await store.ingest(taskId, reply.receipt);
  }
  if (command.type === 'developmentUsageInfo' && command.key) {
    const current = await store.get(taskId, command.key);
    if (current) await persistDevelopmentInfo(store, current, DevelopmentUsageInfoSchema.parse(payload));
  }
  if (command.type === 'ackDevelopmentUsageEvents') {
    const receipt = DevelopmentUsageReceiptSchema.parse(payload);
    if (jsonHash(command.key) !== jsonHash(receipt.key) || receipt.acknowledgedSequence < command.through) throw precondition('Runner 未确认原开发数字键和水位');
    await store.ingest(taskId, receipt);
    await store.acknowledgeRunner(taskId, command.key, command.through);
  }
}
