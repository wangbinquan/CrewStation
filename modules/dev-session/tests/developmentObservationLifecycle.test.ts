// Actual application/record transitions against original in-memory ports; no model or physical cleanup claim.
import {expect,test} from 'bun:test';
import {DevelopmentUsageReceiptSchema,LaunchSpecSchema,type TaskId} from '@crewstation/contracts';
import type {AgentStart} from '../ports/agentStarts';
import type {DevelopmentObservationParticipant} from '../ports/developmentObservation';
import {AgentExecutionLifecycle} from '../application/agentExecution';
import {agentUseCases,clusterAgentUseCases} from '../application/agents';
import {agentExecutionFixture} from './agentExecutionFixture';
import {computeId,computeSelector,fakeComputeCatalog,type FakeProfile} from './computeFixture';
import {workspaceActor,workspaceProject,workspaceTask} from './workspaceFixture';
function receipt(start:AgentStart,terminal=false){
 const intent=start.execution.observationIntent!;
 return DevelopmentUsageReceiptSchema.parse({key:{executionId:start.execution.taskId,journalId:crypto.randomUUID(),incarnation:crypto.randomUUID(),payloadDigest:'a'.repeat(64)},podUid:'test-original-pod',identity:intent.identity,profileId:intent.profileId,profileRevision:intent.profileRevision,phase:terminal?'finished':'running',lastSequence:0,acknowledgedSequence:0,finalThrough:null,result:terminal?'completed':null,interruption:null});
}
function fixture(selected=true){
 const f=agentExecutionFixture(),profile:FakeProfile={name:'observation-validation',protocol:'opencode',revision:2,model:'provider/original-model'},catalog=fakeComputeCatalog(()=>[profile]),calls:string[]=[],metadataRefs:unknown[]=[],preparations:AgentStart[]=[];
 const control={result:'accepted' as 'accepted'|'waiting'|'terminal',endFailure:undefined as Error|undefined,endCalls:0};
 catalog.launchMetadata=async ref=>{calls.push('metadata');metadataRefs.push(ref);return {id:computeId(profile.name),name:profile.name,revision:2,protocol:'opencode',image:'registry.test/runtime/observation-validation@sha256:'+ '0'.repeat(64),launch:LaunchSpecSchema.parse({protocol:'opencode',binaryPath:'/usr/local/bin/opencode',model:'provider/original-model'})};};
 f.deps.compute=catalog;f.deps.settings={...f.deps.settings,developmentNativeObservationAdmissions:selected?[{projectId:workspaceProject,profileId:computeId(profile.name),profileRevision:2}]:[]};
 const create=f.deps.environments.createNativeExecution;f.deps.environments.createNativeExecution=async input=>{calls.push('create');return create(input);};
 const participant:DevelopmentObservationParticipant={prepare:async start=>{calls.push('prepare');preparations.push(structuredClone(start));},dispatch:async start=>{calls.push('dispatch');return control.result==='waiting'?{kind:'waiting',reason:'source-unavailable'}:control.result==='terminal'?{kind:'terminal',receipt:receipt(start,true),actualEndedAt:null}:{kind:'accepted',receipt:receipt(start)};},end:async()=>{calls.push('end');control.endCalls++;if(control.endFailure){const failure=control.endFailure;control.endFailure=undefined;throw failure;}}};
 f.starts.finalizeEndedExecution=async(agentId,executionId)=>{const original=(await f.starts.get(agentId))!;if(original.execution.taskId!==executionId||original.state!=='ended')throw Error('simulated finalization identity mismatch');await f.starts.update({...original,finalized:true});};
 const lifecycle=new AgentExecutionLifecycle(f.deps,f.starts,participant),api=agentUseCases(f.deps,f.starts,lifecycle);
 return {...f,profile,catalog,calls,metadataRefs,preparations,control,participant,lifecycle,api,start:()=>api.startAgent(workspaceActor,workspaceTask,{compute:computeSelector(profile.name),prompt:'original prompt'})};
}
test('default-off uses the original headless path and does not acquire metadata, selected storage or a numeric participant',async()=>{
 const f=fixture(false),dto=await f.start(),start=(await f.starts.get(dto.agentId))!;expect(start.execution.observationIntent).toBeUndefined();expect(f.metadataRefs).toHaveLength(0);expect(f.preparations).toHaveLength(0);expect(f.inputs[0]?.developmentUsageStorage).toBeUndefined();expect(f.inputs[0]?.developmentUsageProtection).toBeUndefined();
 f.connect(dto.execution!.taskId);await f.lifecycle.dispatch(dto.agentId);expect(f.routed.filter(row=>row.command.type==='startAgent')).toHaveLength(1);expect(f.calls.filter(value=>value==='dispatch')).toHaveLength(0);expect(f.catalog.materials).toEqual([start.profile]);
});
test('selected metadata and original preparation precede actual create; acceptance marks one dispatched start without legacy material or command',async()=>{
 const f=fixture(),dto=await f.start(),start=(await f.starts.get(dto.agentId))!;expect(f.calls.slice(0,3)).toEqual(['metadata','prepare','create']);expect(f.inputs[0]).toMatchObject({id:start.execution.taskId,developmentUsageStorage:{version:1},developmentUsageProtection:{version:1}});
 expect(start.execution.observationIntent?.identity).toMatchObject({taskId:workspaceTask,executionId:start.execution.taskId,agentId:start.agentId});expect(f.preparations[0]?.execution.observationIntent).toEqual(start.execution.observationIntent);
 f.deps.settings={...f.deps.settings,developmentNativeObservationAdmissions:[]};f.profile.revision=99;f.connect(dto.execution!.taskId);await f.lifecycle.dispatch(dto.agentId);await f.lifecycle.dispatch(dto.agentId);
 expect((await f.starts.get(dto.agentId))?.state).toBe('dispatched');expect(f.calls.filter(value=>value==='dispatch')).toHaveLength(1);expect(f.inputs).toHaveLength(1);expect(f.routed.filter(row=>row.command.type==='startAgent')).toHaveLength(0);expect(f.catalog.materials).toHaveLength(0);expect(f.metadataRefs).toHaveLength(1);
});
test('a selected waiting participant never becomes dispatched, reselects, or sends an ordinary legacy start',async()=>{
 const f=fixture();f.control.result='waiting';const dto=await f.start();f.connect(dto.execution!.taskId);
 for(let n=0;n<3;n++)await f.lifecycle.dispatch(dto.agentId);
 const start=(await f.starts.get(dto.agentId))!;expect(start.state).toBe('pending');expect(start.dispatchedAt).toBeUndefined();expect(start.finalized).toBe(false);expect(f.preparations).toHaveLength(1);expect(f.inputs).toHaveLength(1);expect(f.routed).toHaveLength(0);expect(f.catalog.materials).toHaveLength(0);
});
test('logical terminal has no invented actual end or physical finished state; occupancy remains until real finished native state',async()=>{
 const f=fixture();f.control.result='terminal';const dto=await f.start(),id=dto.execution!.taskId;f.connect(id);await f.lifecycle.dispatch(dto.agentId);
 const logical=(await f.starts.get(dto.agentId))!;expect(logical.state).toBe('ended');expect(logical.endedAt).toBeUndefined();expect(logical.finalized).toBe(false);expect(f.releases).toEqual([id]);
 const env=f.environments.get(id)!;expect(env.native?.state).toBe('cleaning');f.environments.delete(id);await f.lifecycle.dispatch(dto.agentId);
 expect((await f.starts.get(dto.agentId))!.finalized).toBe(false);expect((await f.api.listAgents(workspaceActor,workspaceTask)).find(row=>row.agentId===dto.agentId)?.execution?.state).not.toBe('finished');
 env.state='released';env.connected=false;env.native!.state='finished';f.environments.set(id,env);await f.lifecycle.dispatch(dto.agentId);
 expect((await f.starts.get(dto.agentId))!.finalized).toBe(true);expect((await f.api.listAgents(workspaceActor,workspaceTask)).find(row=>row.agentId===dto.agentId)?.execution?.state).toBe('finished');expect(f.releases).toEqual([id]);
});
test('a failed ending handoff retains the ended record and retries its original outcome without manufacturing a timestamp',async()=>{
 const f=fixture(),dto=await f.start(),start=(await f.starts.get(dto.agentId))!;f.control.endFailure=Error('retry original ending handoff');
 await expect(f.lifecycle.end(start,{failure:'original failure',actualEndedAt:null})).rejects.toThrow('retry original ending handoff');
 const ended=(await f.starts.get(dto.agentId))!;expect(ended).toMatchObject({state:'ended',failure:'original failure',finalized:false});expect(ended.endedAt).toBeUndefined();
 await f.lifecycle.end(ended,{cancelled:true});expect((await f.starts.get(dto.agentId))!.failure).toBe('original failure');expect((await f.starts.get(dto.agentId))!.cancelled).toBeUndefined();expect((await f.starts.get(dto.agentId))!.endedAt).toBeUndefined();expect(f.control.endCalls).toBe(2);
});
test('cluster restart retains the original selection and lineage, uses a genuine new identity, and waits for predecessor cleanup',async()=>{
 const f=fixture(),dto=await f.start(),old=(await f.starts.get(dto.agentId))!,commands=clusterAgentUseCases(f.deps,f.starts,f.lifecycle),operation=crypto.randomUUID();
 f.deps.settings={...f.deps.settings,developmentNativeObservationAdmissions:[]};f.profile.revision=99;
 const one=await commands.manageClusterAgent({...workspaceActor,isAdmin:true},old.execution.taskId,true,operation),two=await commands.manageClusterAgent({...workspaceActor,isAdmin:true},old.execution.taskId,true,operation);expect(one).toEqual(two);
 const next=(await f.starts.findByExecution(one.operationId as TaskId))!;expect(next.agentId).not.toBe(old.agentId);expect(next.execution.taskId).not.toBe(old.execution.taskId);expect(next.execution.previousTaskId).toBe(old.execution.taskId);expect(next.profile).toEqual(old.profile);
 expect(next.execution.observationIntent?.identity).toEqual({...old.execution.observationIntent!.identity,agentId:next.agentId,executionId:next.execution.taskId});expect(next.execution.observationIntent?.nativeUsageLineageKey).toBe(old.execution.observationIntent!.nativeUsageLineageKey);expect(next.execution.observationIntent?.launch).toEqual(old.execution.observationIntent!.launch);
 await f.lifecycle.dispatch(next.agentId);expect(f.inputs).toHaveLength(1);const previous=f.environments.get(old.execution.taskId)!;previous.native!.state='finished';previous.state='released';await f.lifecycle.dispatch(next.agentId);await f.lifecycle.dispatch(next.agentId);
 expect(f.inputs).toHaveLength(2);expect(f.inputs[1]).toMatchObject({id:next.execution.taskId,developmentUsageStorage:{version:1},developmentUsageProtection:{version:1}});expect(f.preparations).toHaveLength(2);expect(f.metadataRefs).toHaveLength(1);expect(f.state.released).toBe(false);
});
test('a selected repository without the physical finalization participant rejects admission before original preparation or material',async()=>{
 const f=fixture();delete f.starts.finalizeEndedExecution;
 await expect(f.start()).rejects.toMatchObject({kind:'precondition'});expect(f.preparations).toHaveLength(0);expect(f.inputs).toHaveLength(0);expect(f.catalog.materials).toHaveLength(0);expect(f.routed).toHaveLength(0);
});
