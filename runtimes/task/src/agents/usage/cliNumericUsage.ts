import type { DevelopmentUsageAdmission, OpencodeActivityInput, StartAgentTerminalCommand } from '@crewstation/contracts';
import { DevelopmentStartIntentSchema, DevelopmentUsageAdmissionSchema } from '@crewstation/contracts';
import { beginDevelopmentNativePagedCapture, type DevelopmentNativePagedCapture } from '@crewstation/agent-drivers';
import { DevelopmentAgentUsage } from '../developmentAgentUsage';
import { developmentIntentDigest } from '../developmentStartIntent';
import type { DevelopmentUsageJournal } from '../developmentUsageJournal';
import { RunnerCommandError } from '../../commandError';
/** Numeric capture observes the actual CLI hooks and database, independently of the display projection. */
export class CliNumericUsage {
 readonly usage:DevelopmentAgentUsage;
 private env:Readonly<Record<string,string|undefined>>|undefined;
 private active:{root:string;turn:string;capture:DevelopmentNativePagedCapture;completed:boolean}|undefined;
 private turnIndex=0;
 private failure=false;
 private readonly seen=new Set<string>();
 private readonly childSessions=new Set<string>();
 constructor(readonly admission:DevelopmentUsageAdmission,journal:DevelopmentUsageJournal){const reserved=journal.reserve(admission);this.usage=new DevelopmentAgentUsage(journal,admission,!reserved.created);}
 prepare(env:Readonly<Record<string,string|undefined>>){this.env=env;}
 async event(event:OpencodeActivityInput){
  if(event.type==='session'){if(event.parentId!==null)this.childSessions.add(event.sessionId);return;}
  if(this.childSessions.has(event.sessionId)||event.type==='tool')return;
  if(this.failure)throw new Error('Original CLI numeric source remains interrupted');if(this.seen.has(event.eventId))return;
  try{
   if(event.type==='prompt'){
    if(this.active || !this.env || !this.usage.nativeProducer)throw new Error('CLI original turn/baseline unavailable');
    const turn=event.sessionId+':'+event.messageId;
    const capture=await beginDevelopmentNativePagedCapture({producer:this.usage.nativeProducer,env:this.env,turn,turnIndex:this.turnIndex,resumeSessionId:event.sessionId});
    this.active={root:event.sessionId,turn,capture,completed:false};
   }else if(event.type==='assistant' && this.active?.root===event.sessionId && event.completed && (event.finish==='stop'||event.error))this.active.completed=true;
   else if(event.type==='status' && event.status==='idle' && this.active?.root===event.sessionId && this.active.completed){const current=this.active;await current.capture.finish(current.root,[]);this.active=undefined;this.turnIndex++;}
   this.seen.add(event.eventId);
  }catch(error){this.failure=true;try{this.usage.nativeProducer?.interrupted();}catch{this.usage.incomplete();}throw error;}
 }
 async finish(result:'completed'|'error'|'cancelled'){
  // A reaped process permits reading its final database tail, but never erases an unconfirmed turn outcome.
  if(this.active){await this.active.capture.finish(this.active.root,this.active.completed?[]:['cli-turn-unconfirmed']).catch(()=>{this.failure=true;});this.active=undefined;}
  if(this.failure){try{this.usage.nativeProducer?.interrupted();}catch{this.usage.incomplete();}}
  this.usage.finish(result);
 }
}
export function reserveCliNumericUsage(command:StartAgentTerminalCommand,journal?:DevelopmentUsageJournal):CliNumericUsage|undefined{
 if(!command.developmentUsage)return undefined;
 if(!journal)throw new RunnerCommandError('development_usage_unsupported','当前 CLI Runner 无数字日志');
 const a=DevelopmentUsageAdmissionSchema.parse(command.developmentUsage),i=a.intent;
 const actual=DevelopmentStartIntentSchema.parse({...i,identity:{...i.identity,agentId:command.agentId},launch:command.launch,profileId:command.compute,profileRevision:command.profileRevision,permission:command.permission,mode:'cli',initialPrompt:null,systemPrompt:null,resumeSessionId:null,cwd:command.cwd??null,mcp:command.mcp.map(({name,url})=>({name,url}))});
 if(i.identity.sourceKind!=='development-cli'||i.launch.protocol!=='opencode'||JSON.stringify(actual)!==JSON.stringify(i)||developmentIntentDigest(a)!==a.key.payloadDigest||command.beforeStart.profile!==i.profileId||command.beforeStart.revision!==i.profileRevision)throw new RunnerCommandError('development_intent_conflict','CLI 启动不能改变原受理');
 return new CliNumericUsage(a,journal);
}
