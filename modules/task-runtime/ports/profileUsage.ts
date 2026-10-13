import type {LaunchSpec} from '@crewstation/contracts';
interface ProfileTestRunInput {testId:string;profile:string;revision:number;launch:LaunchSpec}
import type {RunnerUsageSourceIdentity} from '@crewstation/contracts';
export interface ProfileUsage {accept(input:Pick<ProfileTestRunInput,'testId'|'profile'|'revision'|'launch'>):Promise<void>;bind(input:RunnerUsageSourceIdentity&{testId:string}):Promise<void>}
