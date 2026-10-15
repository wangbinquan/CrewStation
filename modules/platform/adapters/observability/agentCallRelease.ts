// RFC-034 v2 §4.4 —— 通用兜底：执行环境释放后，其中仍在运行的执行记为中断（Runner 失联、Pod 丢失或
// owner 来不及补终态时，记录不会永远停在运行中）。至少一次投递；对已结束的执行是空操作。
import { DomainTopic } from '@crewstation/contracts';
import type { EventConsumer } from '@crewstation/eventbus';
import { createEventConsumer } from '@crewstation/eventbus';
import type { Logger } from '@crewstation/kernel';
import { precondition } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import type { AgentCallRecorderSource } from '../../ports/agentCalls';

export const AGENT_CALL_RELEASE_CONSUMER = 'observability-agent-calls';

export function agentCallReleaseConsumer(db: Database, logger: Logger, recorder: AgentCallRecorderSource): EventConsumer {
  return createEventConsumer({ db, consumer: AGENT_CALL_RELEASE_CONSUMER, logger }).on(DomainTopic.taskReleased, async (event) => {
    const current = recorder();
    // 抛错让消费者原地重试：记录器在控制器角色启动前已装配，未装配只可能是装配缺陷。
    if (!current) throw precondition('Agent 执行记录尚未装配', { code: 'agent_call_recorder_unavailable' });
    await current.closeRuntimeTask(event.payload.taskId, new Date(event.payload.occurredAt));
  });
}
