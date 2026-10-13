import {z} from 'zod';
import {RunnerHelloSchema,WorkloadConsumerSchema,WorkloadStartPermitSchema,WorkloadStopProofSchema} from '@crewstation/contracts';
import {jsonHash} from '@crewstation/kernel';
import {DevelopmentCleanupOwnerSchema,DevelopmentCleanupSelectionSchema} from './prestartCleanup';
/** This allows original physical cleanup only; it asserts no numerical completeness. */
export const DevelopmentUnsupportedCliEvidenceSchema=z.strictObject({version:z.literal(3),kind:z.literal('unsupported-cli'),numericState:z.literal('unknown'),phase:z.enum(['stopping','closed']),selection:DevelopmentCleanupSelectionSchema,owner:DevelopmentCleanupOwnerSchema,
 capability:z.strictObject({version:z.literal(1),podUid:z.uuid(),capabilities:RunnerHelloSchema.shape.capabilities}),consumer:WorkloadConsumerSchema,startPermit:WorkloadStartPermitSchema,stopProof:WorkloadStopProofSchema.nullable(),stopProofDigest:z.string().regex(/^[a-f0-9]{64}$/).nullable()
}).superRefine((e,c)=>{const s=e.selection,p=e.startPermit,w=e.consumer,b=e.capability;const fail=(message:string)=>c.addIssue({code:'custom',message});
 if(s.identity.sourceKind!=='development-cli'||b.podUid!==s.podUid||b.capabilities.developmentNativeCliV2===2||b.capabilities.developmentCliFenceV1===1||w.id!==s.consumerId||w.resourceId!==s.identity.executionId||w.taskId!==s.identity.taskId||w.purpose!=='agent'||w.revision!==s.renderStart||w.finalization!==null||p.podUid!==s.podUid||e.owner.profileId!==s.profileId||e.owner.profileRevision!==s.profileRevision)fail('旧 CLI 清理必须保持原能力、Pod、消费者、许可与原人民币受理');
 if(e.phase==='stopping' ? e.stopProof!==null||e.stopProofDigest!==null : !e.stopProof||e.stopProofDigest!==jsonHash(e.stopProof)||jsonHash(e.stopProof.consumer)!==jsonHash(w)||e.stopProof.podUid!==p.podUid||e.stopProof.nodeUid!==p.nodeUid||e.stopProof.nodeName!==p.nodeName||e.stopProof.type!=='kubelet-terminated')fail('数值未知不能替代真实原容器停止证明');
});
