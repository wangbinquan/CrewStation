import { ResourceIdSchema, RunnerHelloSchema, TASKRUNNER_PROTOCOL_VERSION } from '@crewstation/contracts';
import type { RunnerCommand } from '@crewstation/contracts';
import type { ResourceIdentityDirectory } from '@crewstation/persistence';
import type { LegacyRunnerBoundary, LegacyRunnerBridge } from '../../ports/legacyRunner';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : undefined;

/** Protocol 2 stays on its original process identities; only typed metadata is projected. */
export function legacyRunnerIdentity(directory: ResourceIdentityDirectory): LegacyRunnerBoundary {
  return { normalizeTask: async (raw) => {
    const frame = object(raw);
    if (frame?.type !== 'hello' || typeof frame.taskId !== 'string' || ResourceIdSchema.safeParse(frame.taskId).success) return raw;
    const taskId = await directory.resolve('task', [frame.taskId]);
    return taskId ? { ...frame, taskId } : raw;
  }, hello: async (raw) => {
    const frame = object(raw);
    if (frame?.type !== 'hello' || frame.protocolVersion !== 2 || typeof frame.taskId !== 'string') return undefined;
    const taskId = ResourceIdSchema.safeParse(frame.taskId).success ? frame.taskId : await directory.resolve('task', [frame.taskId]);
    if (!taskId) return undefined;
    const parsed = RunnerHelloSchema.safeParse({ ...frame, taskId, protocolVersion: TASKRUNNER_PROTOCOL_VERSION });
    return parsed.success ? { hello: parsed.data, bridge: bridgeFor(directory, taskId) } : undefined;
  } };
}

function bridgeFor(directory: ResourceIdentityDirectory, taskId: string): LegacyRunnerBridge {
  const { incomingId, outgoingId, ids } = bridgeIdMapping(directory, taskId);
  const beforeStart = async (record: ObjectValue | undefined) => {
    if (!record) return;
    const profile = object(record.profile), oldProfile = profile?.profile;
    if (profile && typeof oldProfile === 'string') {
      profile.profileId = await incomingId('compute-profile', oldProfile); delete profile.profile;
    }
    await ids(record, 'incoming');
    if (record.executionId) record.executionId = await incomingId('before-start-execution', record.executionId);
    for (const step of [record, ...Array.isArray(record.steps) ? record.steps : [], record.error]) {
      const item = object(step); if (!item) continue;
      for (const key of ['stepId', 'currentStepId']) if (item[key]) item[key] = await incomingId('compute-step', item[key], typeof oldProfile === 'string' ? oldProfile : undefined);
      const error = object(item.error); if (error?.stepId) error.stepId = await incomingId('compute-step', error.stepId, typeof oldProfile === 'string' ? oldProfile : undefined);
    }
  };
  const terminal = async (value: unknown) => {
    const record = object(value); await ids(record, 'incoming');
    const hook = object(record?.beforeStart);
    if (hook?.executionId) hook.executionId = await incomingId('before-start-execution', hook.executionId);
  };
  return {
    incoming: async (raw, commandType) => {
      const frame = object(structuredClone(raw)); if (!frame) return raw;
      if (frame.type === 'event') {
        const event = object(frame.event);
        switch (event?.kind) {
          case 'agent': await ids(object(event.event), 'incoming'); await ids(object(object(event.event)?.spec), 'incoming'); break;
          case 'nativeActivity': {
            const activity = object(event.activity); await ids(activity, 'incoming');
            if (activity?.eventId) activity.eventId = await incomingId('native-activity-event', activity.eventId);
            break;
          }
          case 'nativeTerminal': await terminal(event.terminal); break;
          case 'beforeStart': await beforeStart(object(event.execution)); break;
          case 'terminalOutput': case 'terminalClosed': case 'terminalResized': case 'execOutput': case 'execExited': await ids(event, 'incoming'); break;
        }
      } else if (frame.type === 'result') {
        const payload = object(frame.payload);
        if (commandType === 'listAgentTerminals') { await ids(payload, 'incoming'); if (Array.isArray(payload?.terminals)) for (const item of payload.terminals) await terminal(item); }
        if (commandType === 'startAgentTerminal') await terminal(payload);
        if (commandType === 'compareWorkspace' || commandType === 'workspaceComparisonDetails') await ids(payload, 'incoming');
        if (commandType === 'attachTerminal' || commandType === 'exec' || commandType === 'probeTerminal') await ids(payload, 'incoming');
      }
      return frame;
    },
    outgoing: async (command: RunnerCommand) => {
      const frame = structuredClone(command) as unknown as ObjectValue;
      await ids(frame, 'outgoing');
      const material = object(frame.beforeStart);
      if (material) {
        material.profile = await outgoingId('compute-profile', material.profile);
        if (Array.isArray(material.steps)) {
          const stepIds = new Map<string, string>();
          for (const step of material.steps) {
            const item = object(step); if (!item || typeof item.stepId !== 'string') continue;
            const old = await outgoingId('compute-step', item.stepId) as string; stepIds.set(item.stepId, old); item.stepId = old;
          }
          const configFile = object(material.configFile);
          if (typeof configFile?.pathTemplate === 'string') configFile.pathTemplate = configFile.pathTemplate.replace(/(\{\{\s*steps\.)([^.\s]+)(\.)/g, (match, prefix, id, suffix) => stepIds.has(id) ? `${prefix}${stepIds.get(id)}${suffix}` : match);
          for (const step of material.steps) {
            const item = object(step); if (!item) continue;
            if (Array.isArray(item.argv)) item.argv = item.argv.map((arg) => typeof arg === 'string' ? arg.replace(/(\{\{\s*steps\.)([^.\s]+)(\.)/g, (match, prefix, id, suffix) => stepIds.has(id) ? `${prefix}${stepIds.get(id)}${suffix}` : match) : arg);
            for (const key of ['pathTemplate', 'contentTemplate', 'cwdTemplate', 'source']) if (typeof item[key] === 'string') item[key] = item[key].replace(/(\{\{\s*steps\.)([^.\s]+)(\.)/g, (match, prefix, id, suffix) => stepIds.has(id) ? `${prefix}${stepIds.get(id)}${suffix}` : match);
          }
        }
      }
      if (frame.type === 'verifyContract' && typeof frame.subtaskId === 'string') {
        const canonical = frame.subtaskId, legacy = `sub_${canonical.replaceAll('-', '')}`;
        await directory.bind('session', 'subtask', [legacy], canonical);
        frame.subtaskId = legacy;
      }
      return frame;
    },
  };
}

function bridgeIdMapping(directory: ResourceIdentityDirectory, taskId: string) {
  const readCache = new Map<string, string>(), writeCache = new Map<string, string>();
  const incomingId = async (kind: string, value: unknown, scope?: string): Promise<unknown> => {
    if (typeof value !== 'string' || ResourceIdSchema.safeParse(value).success) return value;
    const keys = scope ? [scope, value] : [value], cacheKey = JSON.stringify([kind, keys]);
    if (readCache.has(cacheKey)) return readCache.get(cacheKey)!;
    const known = await directory.resolve(kind, keys);
    if (!known && (kind === 'compute-profile' || kind === 'compute-step')) throw new Error(`Unknown legacy ${kind}`);
    const id = known ?? await directory.bind('session', kind, [taskId, value]);
    readCache.set(cacheKey, id); writeCache.set(`${kind}:${id}`, value);
    return id;
  };
  const outgoingId = async (kind: string, value: unknown): Promise<unknown> => {
    if (typeof value !== 'string') return value;
    const cached = writeCache.get(`${kind}:${value}`);
    if (cached) return cached;
    const aliases = await directory.aliases(kind, value);
    const scoped = aliases.find((keys) => keys.length === 2 && keys[0] === taskId);
    const keys = scoped ?? aliases.find((keys) => keys.length === 1) ?? (kind === 'compute-step' ? aliases[0] : undefined);
    let legacy = keys?.at(-1) ?? value;
    if (!keys && kind === 'compute-profile' && ResourceIdSchema.safeParse(value).success) {
      legacy = `p-${value.replaceAll('-', '')}`;
      await directory.bind('session', kind, [legacy], value);
    }
    writeCache.set(`${kind}:${value}`, legacy);
    return legacy;
  };
  const ids = async (record: ObjectValue | undefined, direction: 'incoming' | 'outgoing') => {
    if (!record) return;
    for (const [field, kind] of [['agentId', 'agent'], ['terminalId', 'terminal'], ['runnerId', 'runner'], ['execId', 'exec'], ['probeId', 'agent'], ['compute', 'compute-profile'], ['comparisonId', 'workspace-comparison']] as const) {
      if (record[field] !== undefined) record[field] = await (direction === 'incoming' ? incomingId(kind, record[field]) : outgoingId(kind, record[field]));
    }
  };
  return { incomingId, outgoingId, ids };
}
