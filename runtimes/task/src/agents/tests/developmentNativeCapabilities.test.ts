// Actual on-disk journal capability, not a claim of real model execution or complete capture.
import {afterEach,expect,test} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DevelopmentStartIntentSchema,DevelopmentUsageAdmissionSchema,ProjectIdSchema,TaskIdSchema,RunnerHelloSchema,TASKRUNNER_PROTOCOL_VERSION,type RunnerHello} from '@crewstation/contracts';
import {DevelopmentUsageJournal} from '../developmentUsageJournal';
import {developmentIntentDigest} from '../developmentStartIntent';
import {developmentNativePageCapabilities} from '../development/nativeCapabilities';
const id=(n:number)=>`019f0000-0000-7000-8000-${String(n).padStart(12,'0')}`;
const roots:string[]=[],journals:DevelopmentUsageJournal[]=[];
afterEach(()=>{for(const journal of journals.splice(0))journal.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'cs-native-hello-'));roots.push(root);
 const context={runtimeTaskId:TaskIdSchema.parse(id(3)),workspaceTaskId:TaskIdSchema.parse(id(2)),projectId:ProjectIdSchema.parse(id(1)),podUid:'actual-validation-pod'};
 const journal=new DevelopmentUsageJournal(root,context,crypto.randomUUID());journals.push(journal);
 return {journal,context,selected:{taskId:context.runtimeTaskId,podUid:context.podUid}};
}
test('v2 is advertised only for selected actual task and Pod with a fresh healthy original journal and native reader',()=>{
 const f=fixture();expect(developmentNativePageCapabilities(f.selected,f.journal)).toEqual({});expect(f.journal.info().receipt).toBeNull();expect(developmentNativePageCapabilities(f.selected,f.journal,2)).toEqual({developmentNativePagesV2:2});
 expect(developmentNativePageCapabilities(undefined,f.journal,2)).toEqual({});expect(developmentNativePageCapabilities(f.selected,undefined,2)).toEqual({});
 expect(developmentNativePageCapabilities({...f.selected,taskId:TaskIdSchema.parse(id(9))},f.journal,2)).toEqual({});expect(developmentNativePageCapabilities({...f.selected,podUid:'replacement-pod'},f.journal,2)).toEqual({});
 expect(developmentNativePageCapabilities(f.selected,{info:()=>{throw Error('unreadable journal');},nativePage:f.journal.nativePage.bind(f.journal),nativeBeginTurn:f.journal.nativeBeginTurn.bind(f.journal),nativeTurnOwner:f.journal.nativeTurnOwner.bind(f.journal)},2)).toEqual({});
});
test('an actual interrupted original journal cannot retain the v2 capability through a cached receipt',()=>{
 const f=fixture(),intent=DevelopmentStartIntentSchema.parse({version:1,identity:{projectId:f.context.projectId,taskId:f.context.workspaceTaskId,executionId:f.context.runtimeTaskId,agentId:id(4),sourceKind:'development-agent',executionGeneration:1},profileId:id(5),profileRevision:2,
  launch:{protocol:'opencode',binaryPath:'/usr/local/bin/opencode'},permission:'full',mode:'interactive',initialPrompt:'original',cwd:null,resumeSessionId:null,systemPrompt:null,mcp:[],nativeUsageLineageKey:'actual-original-lineage',nativeSource:{version:2}});
 const draft={intent,digestNonce:'a'.repeat(64)},admission=DevelopmentUsageAdmissionSchema.parse({...draft,key:{executionId:f.context.runtimeTaskId,journalId:f.journal.journalId,incarnation:f.journal.incarnation,payloadDigest:developmentIntentDigest(draft)}});
 f.journal.reserve(admission);f.journal.running(admission.key);expect(developmentNativePageCapabilities(f.selected,f.journal,2)).toEqual({developmentNativePagesV2:2});
 f.journal.close();journals.splice(journals.indexOf(f.journal),1);expect(f.journal.info().receipt?.interruption).toBe('journal-unavailable');expect(developmentNativePageCapabilities(f.selected,f.journal,2)).toEqual({});
});
test('Hello keeps old fields unchanged; optional v2 requires all original numeric and native dependencies',()=>{
 const hello:RunnerHello={type:'hello',protocolVersion:TASKRUNNER_PROTOCOL_VERSION,taskId:TaskIdSchema.parse(id(3)),runnerToken:'test-only-runner-token',workdir:'/work',capabilities:{protocols:['opencode'],pty:true,preview:false}};
 expect(RunnerHelloSchema.parse(hello)).toEqual(hello);
 const capabilities={...hello.capabilities,developmentUsageV1:1,developmentUsageStopV1:1,usageObservationsV1:1,developmentNativeSourceV1:1,nativeUsageTreeV1:1,developmentNativePagesV2:2};
 expect(RunnerHelloSchema.parse({...hello,capabilities}).capabilities.developmentNativePagesV2).toBe(2);
 for(const field of ['developmentUsageV1','developmentUsageStopV1','usageObservationsV1','developmentNativeSourceV1','nativeUsageTreeV1'] as const)expect(RunnerHelloSchema.safeParse({...hello,capabilities:{...capabilities,[field]:undefined}}).success).toBe(false);
 expect(RunnerHelloSchema.safeParse({...hello,capabilities:{...capabilities,developmentNativePagesV2:1}}).success).toBe(false);
});
