import { randomBytes } from 'node:crypto';
import type { TaskId } from '@crewstation/contracts';
import { DevelopmentUsageInfoSchema } from '@crewstation/contracts';
import { conflict, jsonHash, notFound, precondition } from '@crewstation/kernel';
import type { AgentStartRepository } from '../ports/agentStarts';
import type { Environments } from '../ports/runtime';
import type { DevelopmentUsageOwner, DevelopmentUsageOwnerStore, DevelopmentUsagePreparation, DevelopmentUsagePricing } from '../ports/developmentUsage';
import { DevelopmentUsagePreparationSchema, DevelopmentUsagePreparedSchema, developmentOwnerIntentDigest } from '../domain/developmentUsage';

export function developmentUsageOwner(store: DevelopmentUsageOwnerStore, starts: AgentStartRepository, environments: Pick<Environments, 'getEnvironment'>, pricing?: DevelopmentUsagePricing): DevelopmentUsageOwner {
  const prepare = async (raw: DevelopmentUsagePreparation) => {
    const input = DevelopmentUsagePreparationSchema.parse(raw), { intent } = input, id = intent.identity.executionId as TaskId;
    const original = await store.get(id);
    if (original) {
      if (jsonHash({ intent: original.intent, context: original.context }) !== jsonHash(input)) throw conflict('开发执行已有另一份稳定启动意图');
      return original;
    }
    const start = await starts.findByExecution(id);
    if (!start) throw notFound('开发 Agent 受理', id);
    if (start.state !== 'pending' || start.cancelled || start.finalized) throw precondition('只能在首次派发前登记开发数字意图');
    if (start.agentId !== intent.identity.agentId || start.taskId !== intent.identity.taskId || start.profile.profileId !== intent.profileId || start.profile.revision !== intent.profileRevision || start.permission !== intent.permission || intent.mode !== 'interactive'
      || start.request.prompt !== intent.initialPrompt || (start.request.cwd ?? null) !== intent.cwd || (start.request.resumeSessionId ?? null) !== intent.resumeSessionId || intent.systemPrompt !== null) throw conflict('开发数字意图不符合实际 Agent 受理');
    const workspace = await environments.getEnvironment(start.taskId);
    if (!workspace || workspace.native || workspace.projectId !== intent.identity.projectId || workspace.serviceId !== input.context.serviceId || workspace.traceId !== input.context.traceId || (workspace.branch ?? null) !== input.context.branch) throw conflict('开发数字意图不符合实际项目工作区');
    if (!pricing) throw precondition('开发执行人民币受理尚未装配');
    const price = await pricing.accept({ identity: intent.identity, profile: { id: intent.profileId, revision: intent.profileRevision, protocol: intent.launch.protocol } });
    const digestNonce = randomBytes(32).toString('hex');
    const prepared = DevelopmentUsagePreparedSchema.parse({ ...input, price, digestNonce, payloadDigest: developmentOwnerIntentDigest({ intent, digestNonce }) });
    return store.prepare(prepared);
  };
  return {
    prepare, get: store.get, unsupported: store.unsupported, close: store.close,
    bind: async (id, raw) => {
      const current = await store.get(id); if (!current) throw notFound('开发数字受理', id);
      const info = DevelopmentUsageInfoSchema.parse(raw);
      const execution = await environments.getEnvironment(id), native = execution?.native;
      if (!execution || !native?.podUid || native.purpose !== 'agent' || native.agentId !== current.intent.identity.agentId || native.parentTaskId !== current.intent.identity.taskId || execution.projectId !== current.intent.identity.projectId) throw conflict('数字绑定缺少实际子执行 Pod 的归属证明');
      const expectedPodUid = native.podUid;
      if (info.runtimeTaskId !== id || info.podUid !== expectedPodUid) throw conflict('Runner 数字来源不符合实际子执行 Pod');
      if (current.binding) {
        const original = current.binding;
        if (info.podUid !== original.podUid || info.journalId !== original.key.journalId || (info.receipt ? jsonHash(info.receipt.key) !== jsonHash(original.key) : info.incarnation !== original.key.incarnation)) throw conflict('原开发 journal/Pod 绑定不可替换');
        if (info.receipt && (info.receipt.podUid !== original.podUid || jsonHash(info.receipt.identity) !== jsonHash(original.identity) || info.receipt.profileId !== original.profileId || info.receipt.profileRevision !== original.profileRevision)) throw conflict('原 Runner 回执不符合开发归属');
        return current;
      }
      if (info.receipt) throw conflict('未绑定的 owner 不能认领已受理的 Runner journal');
      return store.bind(id, { runtimeTaskId: id, key: { executionId: id, journalId: info.journalId, incarnation: info.incarnation, payloadDigest: current.payloadDigest }, podUid: expectedPodUid,
        identity: current.intent.identity, profileId: current.intent.profileId, profileRevision: current.intent.profileRevision });
    },
    resolve: async (key) => {
      const current = await store.get(key.executionId as TaskId);
      return current?.binding && jsonHash(current.binding.key) === jsonHash(key) ? { registration: current.binding, price: current.price } : undefined;
    },
  };
}
