import { agentCommand, agentPayloadDigest } from './agentMaterial';
import { prepareAgentResume } from './agentResume';
import { randomBytes } from 'node:crypto';
import { BusinessOutputMaterialSchema, BusinessMaterialRequestSchema, PLATFORM_AGENT_PERMISSION } from '@crewstation/contracts';
import type { BusinessSubtaskV3Dto, ProjectId, ServiceId, TaskId, SubmitBusinessSubtaskV3 } from '@crewstation/contracts';
import { notFound, precondition, validation } from '@crewstation/kernel';
import { materialSecretReferences, validateBusinessMaterial } from '../../domain/businessMaterials';
import { requireBusinessAgent } from './capabilities';
import type { ExecutionAgentPlan } from '../../domain/executionAgent';
import type { ExecutionOperation } from '../../domain/taskAdmission';
import type { BusinessExecutionDeps } from './dependencies';

/** Resolve against the parent's immutable release, before reserving one attempt. */
export async function prepareAgentPlan(deps: BusinessExecutionDeps, parent: ExecutionOperation, serviceId: ServiceId, view: BusinessSubtaskV3Dto, runtimeTaskId: TaskId, input: Extract<SubmitBusinessSubtaskV3, { kind: 'agent' }>) {
  const { tasksSpec, projectId } = parent.intent, profile = tasksSpec.agentProfiles.find((p) => p.id === input.agentProfileId);
  if (!profile) throw validation('Agent 档案不属于父任务的发布契约', { code: 'invalid_configuration' });
  const volumeUid = (await deps.environments.getEnvironment(view.taskId))?.businessWorkspace?.volumeUid;
  if (!volumeUid) throw precondition('业务工作区尚未确认持久卷身份', { code: 'workspace_unavailable' });
  if (input.resumeSessionId) return prepareAgentResume(deps, serviceId, view, volumeUid, runtimeTaskId, input);
  const contract = input.outputContractId ? tasksSpec.outputContracts.find((entry) => entry.id === input.outputContractId) : undefined;
  if (input.outputContractId && !contract) throw validation('输出契约不属于父任务发布');
  const schemaDocument = contract?.schema ? parent.intent.releaseMaterials?.[contract.schema] : undefined;
  if (contract?.schema && schemaDocument === undefined) throw precondition('固定发布缺少输出 Schema', { code: 'release_material_missing' });
  const businessOutputContract = contract ? BusinessOutputMaterialSchema.parse({ id: contract.id, required: contract.required, ...(schemaDocument ? { schemaDocument } : {}) }) : undefined;
  const publishedPrompt = profile.systemPromptFile ? parent.intent.releaseMaterials?.[profile.systemPromptFile] : undefined;
  if (profile.systemPromptFile && publishedPrompt === undefined) throw precondition('固定发布缺少系统提示文件', { code: 'release_material_missing' });
  const stored = input.materialId ? await deps.materials.get(serviceId, view.taskId, input.materialId) : undefined;
  if (input.materialId && !stored) throw notFound('父任务执行材料', input.materialId);
  const { requestKey: _key, fence: _fence, ...material } = BusinessMaterialRequestSchema.parse({ requestKey: 'internal', ...(stored ? JSON.parse(await deps.cipher.open(stored.sealed)) : {}) });
  const resolved = await deps.compute.resolve(profile.compute, 'subtask', projectId);
  const capabilities = requireBusinessAgent(resolved);
  if (publishedPrompt && !capabilities.systemPrompt) throw precondition('档位不支持发布系统提示', { code: 'unsupported_capability' });
  const systemPrompt = [publishedPrompt, material.systemPrompt].filter(Boolean).join('\n\n');
  if (Buffer.byteLength(systemPrompt) > 1_048_576) throw validation('合成系统提示超过字节上限');
  const ref = { profileId: resolved.id, revision: resolved.revision }, credentialStamp = await deps.compute.pinLaunchVersion?.(ref);
  const launch = credentialStamp && deps.compute.launchMaterialAt ? await deps.compute.launchMaterialAt(ref, credentialStamp) : await deps.compute.launchMaterial(ref);
  if (launch.id !== resolved.id || launch.revision !== resolved.revision || launch.protocol !== resolved.protocol) throw precondition('固定档位材料不一致');
  const mcp = deps.settings.mcp.map((entry) => ({ ...entry, headers: {} as Record<string, string> }));
  validateBusinessMaterial(profile, material, capabilities, { mcp, reservedEnv: [...Object.keys(launch.beforeStart.vars), ...Object.keys(launch.beforeStart.secrets)] }, tasksSpec.agentProfiles);
  const ids = materialSecretReferences(material, profile);
  if (ids.length && !deps.agentSecrets) throw precondition('未启用项目 Secret 版本解析', { code: 'unsupported_capability' });
  const secretVersions = ids.length ? await deps.agentSecrets!.versions(projectId, ids) : [];
  const secretMcp: ExecutionAgentPlan['secretMcp'] = [];
  for (const selected of material.mcp) {
    const connection = profile.businessConfig!.mcpConnections.find((entry) => entry.id === selected.connectionId)!;
    const url = new URL(connection.url);
    for (const [key, value] of Object.entries(selected.parameters)) url.searchParams.set(key, value);
    mcp.push({ name: connection.name, url: url.href, headers: {} }); secretMcp.push({ name: connection.name, headers: connection.secretHeaders });
  }
  const plan: ExecutionAgentPlan = { kind: 'agent-plan', sessionKey: runtimeTaskId, volumeUid, credentialStamp, request: input, projectId, compute: resolved, material, secretVersions, secretMcp, nonce: randomBytes(32).toString('hex'), command: {
    businessOutputContract, id: view.executionId, type: 'startAgent', agentId: view.executionId, processAttemptId: view.executionId, compute: resolved.id, profileRevision: resolved.revision,
    launch: launch.launch, beforeStart: { ...launch.beforeStart, secrets: {} }, permission: PLATFORM_AGENT_PERMISSION, businessSkills: material.skills, businessSecretEnvNames: Object.entries(material.env).filter(([, value]) => typeof value !== 'string').map(([key]) => key), mode: input.mode, initialPrompt: input.prompt,
    ...(input.cwd ? { cwd: input.cwd } : {}), ...(systemPrompt ? { systemPrompt } : {}), env: {}, mcp,
  } };
  const command = await agentCommand(deps, plan, launch.beforeStart.secrets);
  if (input.runtimeImageVersionId || profile.runtimeImageVersionId) {
    if (!deps.runtimeImages?.reserveAgent) throw precondition('未启用业务 Agent 运行镜像选择', { code: 'unsupported_capability' });
    const selection = { ...(profile.runtimeImageVersionId ? { runtimeImageVersionId: profile.runtimeImageVersionId } : {}), ...(profile.allowedRuntimeImageVersionIds ? { allowedRuntimeImageVersionIds: profile.allowedRuntimeImageVersionIds } : {}) };
    plan.runtimeImage = await deps.runtimeImages.reserveAgent(projectId, runtimeTaskId, selection, { profileId: resolved.id, revision: resolved.revision }, input.runtimeImageVersionId);
    if (!plan.runtimeImage) throw precondition('业务 Agent 运行镜像选择未返回固定快照', { code: 'unsupported_capability' });
  }
  return { plan, payloadDigest: agentPayloadDigest(command, plan.nonce), view: { ...view, image: plan.runtimeImage?.image ?? resolved.image, agentProfileId: profile.id, computeProfileId: resolved.id, profileRevision: resolved.revision, ...(plan.runtimeImage ? { runtimeImage: plan.runtimeImage } : {}), ...(stored ? { materialDigest: stored.view.digest } : {}) } };
}

/** Freeze this attempt's price catalogue before durable admission can dispatch it.
 * Replayed admission uses the prior receipt and never captures a new price head. */
export async function acceptSubtaskObservation(deps: BusinessExecutionDeps, projectId: ProjectId, view: BusinessSubtaskV3Dto, plan?: ExecutionAgentPlan): Promise<void> {
  await deps.executionObservations?.accept({ identity: { projectId, taskId: view.taskId, subtaskId: view.id,
    executionId: view.executionId, executionGeneration: view.attempt },
    profile: plan ? { id: plan.compute.id, revision: plan.compute.revision, protocol: plan.compute.protocol } : null });
}
