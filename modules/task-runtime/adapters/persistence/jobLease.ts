import { precondition } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { lockJobLease } from '@crewstation/queue';
import type { NativeExecutionJobLease } from '../../ports/unitOfWork';

/** 提交前再核一次的作业租约检查：事务内所有写完成后、提交之前重跑。 */
export type CommitCheck = () => Promise<void>;

/** 只在提交事务内核验持久作业租约，并登记到提交前的复核里；租约丢失时整个事务回滚。 */
export async function authorizeTaskJob(db: Executor, checks: CommitCheck[] | undefined, identity: NativeExecutionJobLease,
  kind: string, payload: Readonly<Record<string, string>>, failureCode: string): Promise<void> {
  if (!checks) throw precondition('作业租约只能在提交事务内核验', { code: 'job_lease_transaction_required' });
  const { jobId, fencingToken } = identity;
  const check = async () => {
    if (!await lockJobLease(db, jobId, fencingToken, { kind, payload })) throw precondition('作业租约已失效', { code: failureCode });
  };
  await check(); checks.push(check);
}
