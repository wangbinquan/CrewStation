import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, TaskId } from '@crewstation/contracts';
import { ClusterInspectionSchema, ClusterOperationSchema, ClusterPageSchema, IDENTITY_HEADERS } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import { noopLogger } from '@crewstation/kernel';
import { runMigrations } from '@crewstation/persistence';
import { loadPlatformSettings } from '@crewstation/settings';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { createPlatformModule } from '../wiring';
import type { PlatformModule } from '../wiring';
const available = await testDatabaseAvailable();
let database: TestDatabase, platform: PlatformModule, admin: Actor;
const k8s = createFakeK8sClient();
const app = createApp({ name: 'cluster-platform-test' });
beforeAll(async () => {
  if (!available) return;
  database = await createTestDatabase();
  const settings = loadPlatformSettings({ CS_DATABASE_URL: database.url, CS_SECRET_KEY: Buffer.alloc(32, 3).toString('base64'), CS_GITLAB_URL: 'http://127.0.0.1:9' });
  platform = createPlatformModule({ db: database.db, settings, k8s, logger: noopLogger, instance: 'test.cluster-platform' }); await runMigrations(database.db, platform.api.migrations);
  const user = await platform.modules.identity.api.ensureUser({ externalId: 'cluster-admin', name: 'Cluster Admin', email: 'admin@cluster.test' });
  if (!user.isAdmin) await platform.modules.identity.api.setPlatformRole(user.id, { platformRole: 'admin', expectedRole: user.platformRole });
  admin = { userId: user.id, isAdmin: true }; for (const r of platform.api.routers.api) app.route('/', r);
});
afterAll(async () => { await database?.drop(); });
const request = (path: string, method = 'GET', body?: unknown) => app.request(`/v1/admin/cluster${path}`, { method, headers: { [IDENTITY_HEADERS.userId]: admin.userId, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const inspect = async (id: string, action: 'restart' | 'delete') => ClusterInspectionSchema.parse(await (await request(`/resources/${id}/inspect-operation`, 'POST', { action })).json());
const accept = async (id: string, action: 'restart' | 'delete') => { const i = await inspect(id, action); expect(i.capability.enabled).toBe(true); const response = await request('/operations', 'POST', { inspectionId: i.inspectionId, idempotencyKey: crypto.randomUUID(), params: i.request }); expect(response.status).toBe(202); return ClusterOperationSchema.parse(await response.json()); };
async function connect(id: TaskId) {
  const fact = (await platform.modules.taskRuntime.api.listClusterTasks()).find((t) => t.taskId === id)!;
  const pod = (await k8s.get(Resources.Pod!, fact.podName, fact.namespace))!;
  const token = (pod.spec as { containers: Array<{ env: Array<{ name: string; value: string }> }> }).containers[0]!.env.find((e) => e.name === 'CS_RUNNER_TOKEN')!.value;
  await k8s.mergePatch(Resources.Pod!, fact.podName, fact.namespace, { status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] } });
  await platform.modules.taskRuntime.api.onRunnerConnected(id, token);
}
describe.skipIf(!available)('cluster HTTP through actual platform composition', () => {
  test('registered platform components are visible without managed labels; unregistered namespace siblings are absent', async () => {
    await k8s.create({ apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'cs-api', namespace: 'crewstation-system', generation: 1 }, spec: { replicas: 1, template: { metadata: {}, spec: { containers: [{ name: 'api', image: 'api' }] } } } });
    await k8s.create({ apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'crewstation-dev-auth', namespace: 'crewstation-system', uid: 'dev-auth-deployment', labels: { 'app.kubernetes.io/managed-by': 'crewstation-local' } }, spec: { template: { spec: { containers: [{ name: 'dev-auth', envFrom: [{ secretRef: { name: 'crewstation-dev-auth' } }] }] } } } });
    await k8s.create({ apiVersion: 'v1', kind: 'Secret', metadata: { name: 'crewstation-dev-auth', namespace: 'crewstation-system', uid: 'dev-auth-secret' } });
    await k8s.create({ apiVersion: 'v1', kind: 'Pod', metadata: { name: 'external', namespace: 'crewstation-system' } }); await platform.modules.cluster.collect();
    const page = ClusterPageSchema.parse(await (await request('/resources?scope=system')).json()); expect(page.items.map((r) => r.name)).toEqual(['crewstation-dev-auth', 'crewstation-dev-auth', 'cs-api']);
    const api = page.items.find((r) => r.name === 'cs-api')!;
    const checked = await inspect(api.resourceId, 'restart'); expect(checked.capability.executionRoute).toBe('kubernetes'); expect(checked.capability.enabled).toBe(true);
    expect((await inspect(api.resourceId, 'delete')).capability.enabled).toBe(false);
  });
  test('persistent business workspace restart and close flow through owning modules, retaining task and volume', async () => {
    const { project, businessTask: business, taskRuntime: tasks, cluster, data } = platform.modules;
    await project.api.upsertServicePlan(admin, { name: 'standard-small', cpu: '1', memory: '1Gi', maxReplicas: 3, description: '' });
    await project.api.upsertTaskProfile(admin, { name: 'coding-medium', cpu: '1', memory: '1Gi', storage: '2Gi', description: '' });
    const p = await project.api.createProject(admin, { name: 'Cluster business', slug: 'cluster-business', kind: 'DigitalWorker', template: 'minimal-sample' });
    await data.api.ensureServiceData(p.serviceId!);
    const caller = { identity: 'cluster-business/cluster-business', project: 'cluster-business', service: 'cluster-business' };
    const task = await business.api.createTask(caller, { volumeMode: 'persistent', profile: 'coding-medium', labels: {} }); await connect(task.id); await business.api.getTask(caller, task.id);
    await cluster.collect(); const resources = await cluster.api.resources(admin, { scope: 'project', projectId: p.id, limit: 50 });
    const pod = resources.items.find((r) => r.taskId === task.id)!; expect(pod.purpose).toBe('business-workspace'); expect(pod.profile).toBe('coding-medium');
    const volume = structuredClone(resources.items.find((r) => r.kind === 'PersistentVolumeClaim'));
    const op = await accept(pod.resourceId, 'restart'), execution = cluster.runOnce();
    for (let i = 0; i < 200; i++) { const current = await tasks.api.getEnvironment(task.id); if (current?.state === 'creating') { await connect(task.id); break; } await Bun.sleep(5); }
    await execution; expect((await cluster.api.operation(admin, op.operationId)).phase).toBe('succeeded');
    expect(await tasks.api.runningTaskCount(p.id)).toBe(1); expect(await k8s.get(Resources.PersistentVolumeClaim!, volume!.name, volume!.namespace)).toMatchObject({ metadata: { uid: volume!.uid } });
    await cluster.collect(); const after = (await cluster.api.resources(admin, { scope: 'project', projectId: p.id, limit: 50 })).items.find((r) => r.taskId === task.id)!;
    await business.api.getTask(caller, task.id); const del = await accept(after.resourceId, 'delete'); await cluster.runOnce();
    expect((await cluster.api.operation(admin, del.operationId)).phase).toBe('succeeded'); expect((await business.api.getTask(caller, task.id)).state).toBe('closed'); expect(await tasks.api.runningTaskCount(p.id)).toBe(0);
    expect(await k8s.get(Resources.PersistentVolumeClaim!, volume!.name, volume!.namespace)).toBeDefined();
    expect((await request(`/operations/${del.operationId}`)).status).toBe(200); expect((await request('/operations')).status).toBe(200);
    // Regression: inventory must include the next DB page, including archived projects and released task instances.
    await database.handle.client`INSERT INTO project.projects SELECT (jsonb_populate_record(NULL::project.projects, to_jsonb(p) || jsonb_build_object('id', 'prj_' || lpad(to_hex(n), 32, '0'), 'slug', 'batch-' || n, 'namespace', 'cs-batch-' || n, 'state', 'archived'))).* FROM project.projects p CROSS JOIN generate_series(1, 505) n WHERE p.id = ${p.id}`;
    await database.handle.client`INSERT INTO task_runtime.environments SELECT (jsonb_populate_record(NULL::task_runtime.environments, to_jsonb(e) || jsonb_build_object('id', 'tsk_' || lpad(to_hex(n), 32, '0'), 'pod_name', 'batch-' || n)) ).* FROM task_runtime.environments e CROSS JOIN generate_series(1, 505) n WHERE e.id = ${task.id}`;
    const directory = await project.api.listClusterProjects(), executions = await tasks.api.listClusterTasks();
    expect(directory).toHaveLength(506); expect(directory.filter((p) => p.state === 'archived')).toHaveLength(505); expect(executions).toHaveLength(506);
    expect(new Set(executions.map((t) => t.taskId)).size).toBe(506); expect(executions.every((t) => !('runnerTokenHash' in t))).toBe(true);
  });
  test('profile-test stop resolves its durable test identity without a Pod label', async () => {
    const taskId = 'tsk_77777777777777777777777777777777' as TaskId, testId = 'pft_77777777777777777777777777777777', namespace = 'crewstation-system', podName = 'profile-stop';
    const pod = await k8s.create({ apiVersion: 'v1', kind: 'Pod', metadata: { name: podName, namespace, uid: crypto.randomUUID(), labels: { 'crewstation.io/task': taskId, 'app.kubernetes.io/managed-by': 'crewstation' } }, status: { phase: 'Pending' } });
    await database.handle.client`INSERT INTO task_runtime.environments (id, project_id, service_id, kind, state, volume_mode, profile, namespace, pod_name, pvc_name, trace_id, runner_token_hash, labels, created_at, updated_at, last_activity_at, pod_uid)
      VALUES (${taskId}, 'prj_00000000000000000000000000000001', 'svc_00000000000000000000000000000001', 'profile-test', 'creating', 'follow-container', 'coding-medium', ${namespace}, ${podName}, 'no-volume', '77777777777777777777777777777777', 'hash', ${JSON.stringify({ 'crewstation.io/profile-test': testId, 'crewstation.io/compute-profile': 'cluster-test' })}, NOW(), NOW(), NOW(), ${pod.metadata.uid!})`;
    await database.handle.client`INSERT INTO agent_runtime.profile_tests (test_id, profile, revision, content_hash, trigger, created_by, state, context, stages, created_at)
      VALUES (${testId}, 'cluster-test', 1, 'hash', 'manual', ${admin.userId}, 'running', ${JSON.stringify({ kind: 'platform-namespace', taskId })}, '[]', NOW())`;
    const { cluster, agentRuntime, taskRuntime } = platform.modules;
    await cluster.collect();
    const row = (await cluster.api.resources(admin, { scope: 'system', limit: 50 })).items.find((r) => r.taskId === taskId)!;
    // Live profile-test Pods intentionally carry no test-id label; only the UID-bound task record owns that link.
    expect(row.labels['crewstation.io/profile-test']).toBeUndefined();
    const checked = await inspect(row.resourceId, 'delete'); expect(checked.domain).toEqual({ testId });
    const op = await accept(row.resourceId, 'delete'); await cluster.runOnce();
    const result = await cluster.api.operation(admin, op.operationId); expect(result.phase, result.reason).toBe('succeeded');
    expect(await agentRuntime.api.getTest(admin, 'cluster-test', testId as never)).toMatchObject({ state: 'unknown', outcome: 'environment-lost' });
    expect(await taskRuntime.api.getEnvironment(taskId)).toMatchObject({ state: 'released' });
    expect(await k8s.get(Resources.Pod!, podName, namespace)).toBeUndefined();
  });

});
