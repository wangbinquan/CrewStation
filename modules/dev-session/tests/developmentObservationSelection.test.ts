// The actual AgentStart identity and frozen launch drive v2 selection, never current dispatch material.
import {expect,test} from 'bun:test';
import {LaunchSpecSchema,type TaskId} from '@crewstation/contracts';
import {newResourceId} from '@crewstation/kernel';
import type {AgentStart} from '../ports/agentStarts';
import type {DevSessionSettings,ComputeCatalog,ResolvedCompute} from '../ports/platform';
import {developmentObservationIntent,developmentObservationSelected,restartDevelopmentObservationIntent} from '../domain/development/observationSelection';
import {freezeDevelopmentObservation} from '../application/development/observationSelection';
import {workspaceActor,workspaceProject,workspaceTask} from './workspaceFixture';
function fixture(){
 const start:AgentStart={agentId:newResourceId(),taskId:workspaceTask,createdBy:workspaceActor.userId,compute:newResourceId(),profile:{profileId:newResourceId(),revision:2},permission:'full',request:{prompt:'original prompt',cwd:'/work',resumeSessionId:'original-root'},execution:{taskId:newResourceId() as TaskId,runnerId:newResourceId(),image:'registry.test/runner@sha256:'+ 'a'.repeat(64)},state:'pending',cursor:0,finalized:false,createdAt:'2026-10-03T00:00:00.000Z'};
 const settings:DevSessionSettings={idleMinutes:30,userDomain:'cs.localhost',mcp:[{name:'platform',url:'http://platform.example.test/'}],defaultPreviewPort:3000,developmentNativeObservationAdmissions:[{projectId:workspaceProject,profileId:start.profile.profileId,profileRevision:2}]};
 const launch=LaunchSpecSchema.parse({protocol:'opencode',binaryPath:'/usr/local/bin/opencode',model:'provider/original-model'});
 const resolved:ResolvedCompute={id:start.profile.profileId,name:'Original profile',revision:2,protocol:'opencode',image:start.execution.image};
 return {start,settings,launch,resolved};
}
test('the exact project/profile/revision tuple selects only actual new starts; missing and mismatched selections remain legacy',()=>{
 const f=fixture();expect(developmentObservationSelected(f.settings,workspaceProject,f.start.profile)).toBe(true);
 expect(developmentObservationSelected({...f.settings,developmentNativeObservationAdmissions:undefined},workspaceProject,f.start.profile)).toBe(false);
 expect(developmentObservationSelected({...f.settings,developmentNativeObservationAdmissions:[]},workspaceProject,f.start.profile)).toBe(false);
 expect(developmentObservationSelected(f.settings,workspaceProject,{...f.start.profile,revision:3})).toBe(false);
 expect(developmentObservationSelected(f.settings,workspaceProject,{...f.start.profile,profileId:newResourceId()})).toBe(false);
 expect(developmentObservationSelected({...f.settings,developmentNativeObservationAdmissions:[{projectId:newResourceId(),profileId:f.start.profile.profileId,profileRevision:2}]},workspaceProject,f.start.profile)).toBe(false);
});
test('the normalized intent uses the actual workspace, child and agent, preserves request and launch, and remains immutable on restart',()=>{
 const f=fixture(),before=JSON.stringify(f.start),intent=developmentObservationIntent(workspaceProject,f.start,f.launch,f.settings.mcp),frozen=JSON.stringify(intent);
 expect(intent.identity).toEqual({projectId:workspaceProject,taskId:workspaceTask,executionId:f.start.execution.taskId,agentId:f.start.agentId,sourceKind:'development-agent',executionGeneration:1});
 expect(intent).toMatchObject({version:1,profileId:f.start.profile.profileId,profileRevision:2,launch:f.launch,permission:'full',mode:'interactive',initialPrompt:'original prompt',cwd:'/work',resumeSessionId:'original-root',systemPrompt:null,mcp:f.settings.mcp,nativeSource:{version:2}});
 expect(intent.nativeUsageLineageKey).toBe(`cs-development-workspace:${workspaceProject}:${workspaceTask}:opencode`);
 const next={agentId:newResourceId(),taskId:newResourceId() as TaskId},restarted=restartDevelopmentObservationIntent(intent,next)!;
 expect(restarted.identity).toEqual({...intent.identity,agentId:next.agentId,executionId:next.taskId});expect(restarted.nativeUsageLineageKey).toBe(intent.nativeUsageLineageKey);expect(restarted.launch).toEqual(intent.launch);expect(restarted.profileRevision).toBe(2);
 expect(restartDevelopmentObservationIntent(undefined,next)).toBeUndefined();expect(JSON.stringify(f.start)).toBe(before);expect(JSON.stringify(intent)).toBe(frozen);
});
test('selection acquires only same-revision metadata before any image or material; unselected starts do not touch metadata',async()=>{
 const f=fixture(),refs:unknown[]=[],compute:ComputeCatalog={resolve:async()=>f.resolved,launchMaterial:async()=>{throw Error('dispatch-only material');},launchMetadata:async ref=>{refs.push(ref);return {...f.resolved,launch:f.launch};}};
 expect((await freezeDevelopmentObservation({compute,settings:f.settings},workspaceProject,f.start,f.resolved))?.nativeSource).toEqual({version:2});expect(refs).toEqual([f.start.profile]);
 const before=refs.length;expect(await freezeDevelopmentObservation({compute,settings:{...f.settings,developmentNativeObservationAdmissions:[]}},workspaceProject,f.start,f.resolved)).toBeUndefined();expect(refs).toHaveLength(before);
 const missing={...compute,launchMetadata:undefined};await expect(freezeDevelopmentObservation({compute:missing,settings:f.settings},workspaceProject,f.start,f.resolved)).rejects.toThrow('固定修订启动元数据');
 for(const patch of [{id:newResourceId()},{revision:3},{protocol:'claude-code' as const}])await expect(freezeDevelopmentObservation({compute:{...compute,launchMetadata:async()=>({...f.resolved,launch:f.launch,...patch})},settings:f.settings},workspaceProject,f.start,f.resolved)).rejects.toThrow('不匹配');
 await expect(freezeDevelopmentObservation({compute,settings:f.settings},workspaceProject,f.start,{...f.resolved,protocol:'claude-code'})).rejects.toThrow('OpenCode');
});
