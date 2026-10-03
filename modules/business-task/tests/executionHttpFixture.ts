import type { AgentProfile, BusinessReleaseMaterials, OutputContract } from '@crewstation/contracts';
import type { ReleaseId, ProjectId, ServiceId, WorkloadIdentity, TaskId, RuntimeImageSelection } from '@crewstation/contracts';
import { ManifestSchema } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { newResourceId, quotaExceeded } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import type { BusinessRuntimeImages } from '../ports/runtimeImages';
import type { ComputeCatalog, EnvironmentView, Environments } from '../ports/runtime';
import { createBusinessTaskModule } from '../wiring';

export async function executionHttpFixture(db: Database, images?: { port?: BusinessRuntimeImages; selection: RuntimeImageSelection }, options?: { releaseMaterials?: BusinessReleaseMaterials; outputContracts?: OutputContract[]; agentProfiles: AgentProfile[]; compute: ComputeCatalog }) {
  const serviceId = newResourceId() as ServiceId, projectId = newResourceId() as ProjectId, releaseId = newResourceId() as ReleaseId, taskProfileId = newResourceId();
  const environments = new Map<TaskId, EnvironmentView>(), sources = new Map<string, WorkloadIdentity & { source: NonNullable<WorkloadIdentity['source']> }>();
  sources.set('trusted', { identity: 'demo/demo', project: 'demo', service: 'demo', kind: 'service', slot: 'prod',
    source: { podUid: 'pod-one', ip: '10.244.27.1', releaseId, physicalSlot: 'blue', ready: true } });
  const environmentInputs: Array<Parameters<Environments['createEnvironment']>[0]> = [];
  const behavior = { quota: false, loseReceipt: false, unknown: false, starts: 0 };
  const deps: Parameters<typeof createBusinessTaskModule>[0] = {
    db, runtimeImages: images?.port, executionSources: { resolve: async (token) => sources.get(token) },
    environments: {
      createEnvironment: async (input) => {
        environmentInputs.push(input);
        const id = input.admission!.id, old = environments.get(id); if (old) return old;
        if (behavior.unknown) throw new Error('connection lost');
        if (behavior.quota) throw quotaExceeded('full');
        behavior.starts++;
        const env: EnvironmentView = { id, projectId, state: 'creating', connected: false, profile: input.profile!, traceId: input.traceId!, podName: `task-${id}` };
        environments.set(id, env);
        if (behavior.loseReceipt) throw new Error('receipt lost');
        return env;
      },
      getEnvironment: async (id) => { if (behavior.unknown) throw new Error('read unavailable'); return environments.get(id); },
      createNativeExecution: async () => { throw new Error('not used'); }, releaseEnvironment: async () => { throw new Error('not used'); },
      pauseEnvironment: async () => { throw new Error('not used'); }, resumeEnvironment: async () => { throw new Error('not used'); },
    },
    runner: { sendCommand: async () => ({}), listEvents: async () => [] }, directory: { resolveServiceIdentity: async () => ({ serviceId, projectId }) },
    authorizer: { authorize: async () => true }, isAdmin: async () => true,
    compute: options?.compute ?? { resolve: async () => { throw new Error('not used'); }, launchMaterial: async () => { throw new Error('not used'); } },
    settings: { mcp: [], outputLimitBytes: 262144, consumerName: newResourceId(), secretKeyBase64: Buffer.alloc(32, 27).toString('base64') },
  };
  const make = (overrides: Partial<Pick<Parameters<typeof createBusinessTaskModule>[0], 'settings' | 'storageControl' | 'deletionWorkSources' | 'executionObservations' | 'finalizationPreparation' | 'authorizer' | 'taskStorageStatus' | 'runner'>> = {}) => {
    const module = createBusinessTaskModule({ ...deps, ...overrides }), app = createApp({ name: 'v3-test' }); app.route('/', module.http.service);
    const request = (path: string, body?: unknown, token = 'trusted', headers: Record<string, string> = {}) => app.request(path, {
      method: body === undefined ? 'GET' : 'POST', headers: { 'x-cs-source-service': 'demo/demo', 'x-cs-source-token': token, 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { module, app, request };
  };
  const first = make();
  await first.module.api.registerContracts({ occurredAt: new Date().toISOString(), projectId, serviceId, releaseId, tag: 'v1', commitSha: 'a'.repeat(40),
    executionMaterials: options?.releaseMaterials, manifest: ManifestSchema.parse({ apiVersion: images ? 'crewstation/v3' : 'crewstation/v2', kind: 'DigitalWorker', spec: { service: { command: ['bun'], port: 3000, servicePlanId: newResourceId() },
      tasks: { ...images?.selection, agentProfiles: options?.agentProfiles, outputContracts: options?.outputContracts, taskProfileId, executionControl: 'fenced', acceptedTaskContractVersions: ['v1'], defaultVolumeMode: 'persistent' } } }),
  });
  return { ...first, make, environmentInputs, sources, serviceId, projectId, releaseId, taskProfileId, behavior, environments, runner: deps.runner, environmentPort: deps.environments };
}
