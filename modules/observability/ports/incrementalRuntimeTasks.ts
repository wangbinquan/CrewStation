import type { CompleteRuntimeFactSources } from './completeRuntimeFactSources';
import type {CompleteRuntimeTaskBuild} from './completeRuntimeTask';
import type {CompleteRuntimeFold} from '../domain/completeRuntimeMetrics';
import type {CompleteWorkingRows} from './completeWorkingRows';
import type {RuntimeTaskHeaderFact} from '@crewstation/contracts';
export interface IncrementalRuntimeTask {readonly rowThrough?:string;readonly pricingSourceUnknown?:boolean;readonly task:RuntimeTaskHeaderFact;readonly fold:CompleteRuntimeFold;readonly build:Omit<CompleteRuntimeTaskBuild,'task'|'fold'|'metrics'|'attemptsNamespace'|'allocationsNamespace'|'phasesNamespace'|'fragmentsNamespace'>;readonly sourceRevision:string;readonly capturedAt:string;readonly version:string}
export interface IncrementalTaskRows {restore(task:IncrementalRuntimeTask,workspace:CompleteWorkingRows,namespace:string,visible:boolean,signal?:AbortSignal):Promise<CompleteRuntimeTaskBuild>}

export interface IncrementalRuntimeTaskSource {inventory(projectId?:string):Promise<void>;qualify(work:{key:string;revision:string}):Promise<void>;checkpoint?():Promise<string>;pending(cutoff?:string):Promise<{key:string;revision:string}|undefined>;acknowledge(work:{key:string;revision:string}):Promise<void>;bootstrapDone():Promise<boolean>;finishBootstrap():Promise<void>;failed?(error:unknown):Promise<void>;resume?():void;stop():void}

export interface RuntimePublicRows {rows:string;counts:string;dimensions:Readonly<Record<string,string>>}
export interface RuntimeMetadataStageInput {original:IncrementalRuntimeTask;facts:CompleteRuntimeFactSources;namespace:string;rows:CompleteWorkingRows;snapshotId:string;asOf:string;previousAttemptsNamespace:string;signal:AbortSignal}
export type RuntimeMetadataStage=(input:RuntimeMetadataStageInput)=>Promise<Pick<IncrementalRuntimeTask,'task'|'fold'|'build'>&{spaces:Readonly<Record<string,string>>}>;
export type RuntimePublicRowStage=(rows:CompleteWorkingRows,build:CompleteRuntimeTaskBuild,facts:CompleteRuntimeFactSources,namespace:string,signal:AbortSignal)=>Promise<RuntimePublicRows>;
