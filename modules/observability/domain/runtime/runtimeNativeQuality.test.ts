// RFC-034: source EOF, cardinality and empty-turn proof are independently required.
import {test,expect} from 'bun:test';
import {ExecutionObservationIdentitySchema,NativeUsageProofSchema} from '@crewstation/contracts';
import {newResourceId} from '@crewstation/kernel';
import {nativeCaptureSummary,type NativeCaptureDocument} from '../usageProjection';
import {runtimeNativeQuality} from './runtimeNativeQuality';
const identity=ExecutionObservationIdentitySchema.parse({projectId:newResourceId(),taskId:newResourceId(),subtaskId:newResourceId(),executionId:newResourceId(),executionGeneration:1});
const original:NativeCaptureDocument={id:'original',identity,sourceId:'physical',began:true,baselineRoot:'root',historicalRevisionGap:false,proof:NativeUsageProofSchema.parse({contract:'opencode-child-steps-v1',lineageKey:'original',turn:'turn',turnIndex:1,state:'complete',root:'root',observedAt:'2026-10-13T00:00:00.000Z',baseline:{kind:'fresh',fingerprint:null},fingerprint:'a'.repeat(64),sessions:1,steps:0,emitted:0,baselineSteps:0,priorRevisionGap:false,issues:[]})};
test('an affirmative empty source is different from pending, unavailable, revised or unmatched cardinality',()=>{const complete=nativeCaptureSummary(original,{steps:0,baselines:0,unresolved:0,revised:0});expect(runtimeNativeQuality(complete)).toMatchObject({complete:true,empty:true,included:true});for(const value of [{...complete,state:'pending' as const},{...complete,proof:{...complete.proof,state:'partial' as const}},{...complete,unresolvedBaselineSteps:1},{...complete,receivedSteps:1}])expect(runtimeNativeQuality(value).complete).toBe(false);});
