import type { ResourceId } from '@crewstation/contracts';
import type { PlatformUsageAdmission,PlatformUsageIdentity,RunnerUsageSourceIdentity,RunnerUsageSourcePage,RuntimeStatisticsQuery,PlatformUsagePage,Actor } from '@crewstation/contracts';
export interface PlatformUsageAcceptance {testId:ResourceId;profileId:ResourceId;profileRevision:number;protocol:'opencode'|'claude-code'|'terminal'}
export interface PlatformUsageBinding extends RunnerUsageSourceIdentity {testId:ResourceId}
export interface PlatformUsageStore {
 accept(input:PlatformUsageAcceptance,now:Date):Promise<PlatformUsageAdmission>;
 bind(input:PlatformUsageBinding):Promise<void>;
 resolve(source:RunnerUsageSourceIdentity):Promise<PlatformUsageIdentity|undefined>;
 ingest(source:RunnerUsageSourcePage):Promise<boolean>;
 read(query:RuntimeStatisticsQuery,after?:string):Promise<PlatformUsagePage>;
}
export interface PlatformUsageQueries {read(actor:Actor,query:RuntimeStatisticsQuery,after?:string):Promise<PlatformUsagePage>}
