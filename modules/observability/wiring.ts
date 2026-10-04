import {randomUUID} from 'node:crypto';
import type {ReportSnapshotSession} from '@crewstation/persistence';
import type {CompleteRuntimeFactSourceFactory} from './ports/completeRuntimeFactSources';
import {buildCompleteRuntimeCohort} from './application/complete-statistics/cohort';
import {buildCompleteRuntimeTask} from './application/completeRuntimeTask';
import {sealCompleteRuntimeReport} from './application/complete-statistics/reportBuild';
import {runtimeReportAdmissionKey} from './ports/completeRuntimeReportCache';
import {completeRuntimeReportUseCases} from './application/complete-statistics/reportService';
import {completeRuntimeReportCache,originalRuntimeReportIdentity} from './adapters/persistence/reports/reportStore';
import {completeRuntimeFileSpool} from './adapters/persistence/reports/fileSpool';
import {completeRuntimeLedgerSources} from './adapters/persistence/completeRuntimeLedgerSources';
import {jsonHash} from '@crewstation/kernel';
import {completeRuntimeReportRoutes} from './http/completeRuntimeReportRoutes';
import {completeUsageWorkspace} from './adapters/persistence/completeUsageWorkspace';
import {completeExternalSort} from './application/completeExternalSort';
import type {CompleteUsageWorkspaceFactory} from './ports/completeUsageWorkspace';
import { developmentUsageReconciliation } from './application/developmentUsage';
import { valueDevelopmentUsagePage } from './application/developmentValuations';
import type { DevelopmentUsageSource } from './ports/developmentUsage';
import { executionValuations, valueRunnerUsagePage } from './application/executionValuations';
import { drizzleExecutionValuations, drizzleUsageLedger } from './adapters/persistence/drizzleUsageLedger';
import { runnerUsageReconciliation, usageIngestion } from './application/usageIngestion';
import { executionObservationUseCases } from './application/executionObservations';
import { executionObservationRoutes } from './http/executionObservationRoutes';
import type { ExecutionObservationAccess, RunnerUsageSource } from './ports/usageLedger';
import { join } from 'node:path';
import { drizzleCostVisibility, drizzleExecutionPricing, drizzleTokenPriceStore } from './adapters/persistence/drizzleTokenPricing';
import { tokenPricingUseCases } from './application/tokenPricing';
import { tokenPricingRoutes } from './http/tokenPricingRoutes';
import type { PricingProfileDirectory } from './ports/tokenPricing';
import type { ProjectId, UserId } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import type { K8sClient } from '@crewstation/k8s';
import type { Clock, Logger } from '@crewstation/kernel';
import { noopLogger, precondition, systemClock } from '@crewstation/kernel';
import type { Database, Executor, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { Hono } from 'hono';
import { kubernetesClusterObserver } from './adapters/k8s/clusterObserver';
import { drizzleAlertRepository } from './adapters/persistence/drizzleRepositories';
import type { ObservabilityModuleApi } from './api/moduleApi';
import { alertingUseCases } from './application/alerting';
import type { ObservabilityUseCaseDeps } from './application/dependencies';
import { logsAndHealthUseCases } from './application/logsAndHealth';
import { traceChainUseCases } from './application/traceChains';
import { observabilityRoutes } from './http/observabilityRoutes';
import type { ClusterObserver, ProjectAuthorizer, ServiceResolver, SlotRecords, SlotRoles } from './ports/sources';
import type { TraceChainSources } from "./ports/sources";
import type { ObservabilityDeletionTasks, ObservabilityProjectDirectory } from './ports/projectDeletion';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import { observabilityDeletionRepository } from './adapters/persistence/projectDeletion';
import { observabilityDeletionOwner } from './application/projectDeletion';

export interface ObservabilityModuleDeps {
  db: Database;
  reportSnapshot?:ReportSnapshotSession;
  reportFacts?:CompleteRuntimeFactSourceFactory<Executor>;
  reportDataRoot?:string;
  deletion?: { identities: ObservabilityProjectDirectory; tasks?: ObservabilityDeletionTasks; assertGrant(context: ProjectDeletionContext): Promise<void> };
  pricingProfiles?: PricingProfileDirectory;
  executionAccess?: ExecutionObservationAccess;
  usageSource?: RunnerUsageSource;
  /** Consume existing Session numeric copies without enabling development producers. */
  developmentUsageSource?: DevelopmentUsageSource;
  k8s: K8sClient;
  authorizer: ProjectAuthorizer;
  services: ServiceResolver;
  slots: SlotRoles;
  /** 服务槽记录（RFC-025 第三期），由组合根接到资源中心；缺省时健康与巡检按请求读集群。 */
  records?: SlotRecords;
  /** 调用链的数据来源（Design §14），由组合根接到 task-runtime、events、business-task 与 session。 */
  traces: TraceChainSources;
  isAdmin: (userId: UserId) => Promise<boolean>;
  /** 巡检的项目来源；缺省不巡检。 */
  listProjectIds?: () => Promise<ProjectId[]>;
  cluster?: ClusterObserver;
  clock?: Clock;
  logger?: Logger;
}

export interface ObservabilityModule {
  readonly api: ObservabilityModuleApi;
  readonly http: Hono<AppEnv>[];
  readonly workers: Array<{ start(): void; stop(): Promise<void> }>;
  readonly reportWorkers:Array<{start():void;drain():Promise<void>;stop():Promise<void>}>;
  readonly migrations: MigrationSet;
}

export const observabilityMigrations: MigrationSet = {
  module: 'observability',
  layer: 6,
  files: readMigrationDir(join(import.meta.dir, 'adapters', 'persistence', 'migrations')),
};

export function createObservabilityModule(deps: ObservabilityModuleDeps): ObservabilityModule {
  const logger = deps.logger ?? noopLogger;
  const useCaseDeps: ObservabilityUseCaseDeps = {
    alerts: drizzleAlertRepository(deps.db), cluster: deps.cluster ?? kubernetesClusterObserver(deps.k8s),
    authorizer: deps.authorizer, services: deps.services, slots: deps.slots, ...(deps.records ? { records: deps.records } : {}), clock: deps.clock ?? systemClock, logger,
  };
  const alerting = alertingUseCases(useCaseDeps);
  const ledger = drizzleUsageLedger(deps.db), executionPricing = drizzleExecutionPricing(deps.db);
  const observations = executionObservationUseCases({ ledger, visibility: drizzleCostVisibility(deps.db), authorizer: deps.authorizer, clock: useCaseDeps.clock,
    access: deps.executionAccess ?? { task: async () => { throw precondition('执行观测来源尚未接入'); } } });
  const valuations = drizzleExecutionValuations(deps.db), valueUsage = executionValuations({ store: valuations, pricing: executionPricing, clock: useCaseDeps.clock });
  const reconcileBusinessUsage = deps.usageSource ? runnerUsageReconciliation({ source: deps.usageSource, store: ledger, logger, value: valueRunnerUsagePage({ store: valuations, source: deps.usageSource, value: valueUsage }) }) : async () => 0;
  const reconcileDevelopment = deps.developmentUsageSource ? developmentUsageReconciliation({ source: deps.developmentUsageSource,
    store: ledger, pricing: executionPricing, logger, value: valueDevelopmentUsagePage({ models: ledger, store: valuations, value: valueUsage }) }) : undefined;
  let pendingUsage: Promise<number> | undefined;
  const reconcileUsage = reconcileDevelopment ? () => pendingUsage ??= (async () => {
    const results = await Promise.allSettled([reconcileBusinessUsage(), reconcileDevelopment()]);
    for (const result of results) if (result.status === 'rejected') logger.warn('execution usage participant unavailable');
    return results.reduce((sum, result) => sum + (result.status === 'fulfilled' ? result.value : 0), 0);
  })()
    .finally(() => { pendingUsage = undefined; }) : reconcileBusinessUsage;
  const completeReports=completeRuntimeReports(deps);
  const api: ObservabilityModuleApi = {
    runtimeCompleteTaskReport:(actor,projectId,taskId)=>{if(!completeReports)throw precondition('完整运行报告原来源尚未接入');return completeReports.request(actor,projectId,{from:'0001-01-01T00:00:00.000Z',to:useCaseDeps.clock.now().toISOString(),timezone:'Asia/Shanghai'},taskId);},
    runtimeCompleteReport:(actor,projectId,query)=>{if(!completeReports)throw precondition('完整运行报告原来源尚未接入');return completeReports.request(actor,projectId,query);},
    projectRuntimeStatistics:(actor,projectId,query)=>{if(!completeReports)throw precondition('完整运行报告原来源尚未接入');return completeReports.request(actor,projectId,query);},
    systemRuntimeStatistics:(actor,query)=>{if(!completeReports)throw precondition('完整运行报告原来源尚未接入');return completeReports.request(actor,null,query);},
    projectRuntimeTask:(actor,projectId,taskId)=>{if(!completeReports)throw precondition('完整运行报告原来源尚未接入');return completeReports.request(actor,projectId,{from:'0001-01-01T00:00:00.000Z',to:useCaseDeps.clock.now().toISOString(),timezone:'Asia/Shanghai'},taskId);},
    systemRuntimeTask:(actor,taskId)=>{if(!completeReports)throw precondition('完整运行报告原来源尚未接入');return completeReports.request(actor,null,{from:'0001-01-01T00:00:00.000Z',to:useCaseDeps.clock.now().toISOString(),timezone:'Asia/Shanghai'},taskId);},
    runtimeCompleteReportStatus:(actor,projectId,id)=>{if(!completeReports)throw precondition('完整运行报告原来源尚未接入');return completeReports.status(actor,projectId,id);},
    runtimeCompleteReportPage:(actor,projectId,id,query)=>{if(!completeReports)throw precondition('完整运行报告原来源尚未接入');return completeReports.page(actor,projectId,id,query);},
    ...(deps.deletion ? { deletionOwner: observabilityDeletionOwner(observabilityDeletionRepository({ db: deps.db, ...deps.deletion,...(completeReports?{reports:completeReports.deletionLifecycle}: {}) })) } : {}),
    name: 'observability', reconcileExecutionUsage: reconcileUsage, valueExecutionUsage: valueUsage,
    acceptExecutionPrice: (input) => executionPricing.accept(input, useCaseDeps.clock.now()), ...observations, ingestExecutionUsage: usageIngestion(ledger), ...logsAndHealthUseCases(useCaseDeps), ...alerting,
    ...tokenPricingUseCases({ store: drizzleTokenPriceStore(deps.db), profiles: deps.pricingProfiles ?? { list: async () => [] }, clock: useCaseDeps.clock }),
    ...traceChainUseCases({ authorizer: deps.authorizer, chains: deps.traces, clock: useCaseDeps.clock }),
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  const sweepAll = async (): Promise<void> => { for (const projectId of await (deps.listProjectIds?.() ?? Promise.resolve([]))) await alerting.sweepProject(projectId).catch((e: unknown) => logger.warn('alert sweep failed', { projectId, error: String(e) })); };
  return {
    api,
    http: [observabilityRoutes(api, deps.isAdmin), tokenPricingRoutes(api, deps.isAdmin), executionObservationRoutes(api, deps.isAdmin),completeRuntimeReportRoutes(api,deps.isAdmin)],
    reportWorkers:completeReports?[completeReports.worker]:[],
    workers: [...(deps.usageSource || deps.developmentUsageSource ? [executionUsageWorker(reconcileUsage, logger)] : []), { start: () => { timer ??= setInterval(() => void sweepAll(), 30_000); }, stop: async () => { if (timer) clearInterval(timer); timer = undefined; } }],
    migrations: observabilityMigrations,
  };
}

function executionUsageWorker(reconcile: () => Promise<number>, logger: Logger) {
  let timer: ReturnType<typeof setInterval> | undefined, running: Promise<void> | undefined;
  const tick = () => running ??= reconcile().then(() => {}, () => { logger.warn('execution usage source unavailable'); }).finally(() => { running = undefined; });
  return { start: () => { if (!timer) { timer = setInterval(() => { void tick(); }, 1000); void tick(); } },
    stop: async () => { if (timer) clearInterval(timer); timer = undefined; await running; } };
}

/** Wire original TEMP retention to the domain ordering and application merge at the composition boundary. */
export const completeStatisticsWorkspace:CompleteUsageWorkspaceFactory=(input)=>completeUsageWorkspace({...input,order:completeExternalSort});

function completeRuntimeReports(deps:ObservabilityModuleDeps) {
 const session=deps.reportSnapshot,factory=deps.reportFacts,root=deps.reportDataRoot;
 if(!session||!factory||!root)return undefined;
 const spool=completeRuntimeFileSpool(root),store=completeRuntimeReportCache(deps.db),owner=randomUUID();
 const costVisible=async(projectId:ProjectId)=> (await drizzleCostVisibility(deps.db).read(projectId))?.visibility==='project-members-and-services';
 return completeRuntimeReportUseCases({store,spool,owner,authorizer:deps.authorizer,costVisible,
  build:async(report,signal)=>{
   const started=Date.now(),query={...report.request.filters,...(report.request.taskId?{taskId:report.request.taskId}:{}),...(report.request.projectId?{projectId:report.request.projectId}:{} )};
   return session.run(async(snapshot)=>{
    const identity=await originalRuntimeReportIdentity(snapshot.executor),facts=factory(snapshot.executor,query,snapshot.snapshotId),namespace='complete-report/'+report.id;
    const build=await buildCompleteRuntimeCohort({query,facts,snapshotId:snapshot.snapshotId,asOf:snapshot.asOf,rows:snapshot.workspace,namespace,keyOf:jsonHash,system:report.request.projectId===null,usageWorkspace:completeStatisticsWorkspace,signal,
      task:(task,privateNamespace)=>buildCompleteRuntimeTask({task,snapshotId:snapshot.snapshotId,asOf:snapshot.asOf,rows:snapshot.workspace,namespace:privateNamespace,keyOf:jsonHash,system:report.request.projectId===null,usageWorkspace:completeStatisticsWorkspace,signal,attempts:facts.attempts(task),ledger:completeRuntimeLedgerSources(snapshot.executor,task,snapshot.snapshotId)}),
    });
    if(report.request.taskId&&build.summary.tasks!=='1')throw precondition('原任务不存在或原受理身份不唯一');
    const header={reportId:report.id,projectionVersion:2 as const,scope:report.request.projectId===null?'system' as const:'project' as const,projectId:report.request.projectId,filters:report.request.filters,asOf:snapshot.asOf,snapshotId:snapshot.snapshotId,generation:identity.generation,sourceRevision:identity.revision,...(report.request.taskId?{taskId:report.request.taskId}:{}),coverage:build.summary.metrics.state==='not-ready'?'complete-facts' as const:'complete' as const,buildMs:Date.now()-started};
    const manifest=await sealCompleteRuntimeReport({rows:snapshot.workspace,build,spool,header,buildOwner:report.owner,requestKey:report.requestKey,signal});return build.summary.metrics.state==='not-ready'?{state:'not-ready' as const,gaps:build.summary.metrics.gaps.map(reason=>({source:'original-cohort',reason})),manifest}:{state:'ready' as const,manifest};
   },signal,runtimeReportAdmissionKey);
  },
 });
}
