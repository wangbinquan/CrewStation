import {z} from 'zod';
import {UsageExecutionIdentitySchema} from './usageLedger';
import {NativeUsagePassIdentitySchema,NativeUsagePassCountsSchema} from '../../taskrunner/native-usage/pages';
const count=z.string().regex(/^(0|[1-9]\d*)$/),digest=z.string().regex(/^[a-f0-9]{64}$/);
/** Original source/worker metadata only. Token and CNY values remain in their original ledgers. */
export const RuntimeNativePagedCaptureSchema=z.strictObject({
 id:digest,sourceVersion:z.literal(2),identity:UsageExecutionIdentitySchema,sourceId:z.string().min(1),
 pass:NativeUsagePassIdentitySchema,turnIndex:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),preparedAt:z.iso.datetime(),
 sourceState:z.enum(['receiving','source-eof']),pages:count,counts:NativeUsagePassCountsSchema,
 scanPosition:count,sourceWatermark:count,pathsComplete:z.boolean(),workState:z.enum(['pending','processed']),
 visitedSteps:count,heldSteps:count,cursor:z.strictObject({ordinal:count,index:z.number().int().nonnegative().max(1000)}),
 numericEof:z.boolean(),valuationEof:z.boolean(),baselineState:z.enum(['before-only','complete-before','complete-birth','unknown']),
 issues:z.array(z.string().min(1)),sourceDigest:digest,
 previousPopulation:z.strictObject({visited:count,held:count,issues:z.array(z.string().min(1))}).optional(),
}).superRefine((v,ctx)=>{
 const invalid=(message:string)=>ctx.addIssue({code:'custom',message});
 if(!('sourceKind' in v.identity)||v.identity.sourceKind!=='development-agent')invalid('原生分页报告必须属于实际开发执行');
 if((v.pass.phase==='baseline')!==(v.baselineState==='before-only')&&v.baselineState!=='unknown')invalid('原生基线资格与原 pass 阶段不符');
 if(BigInt(v.heldSteps)>BigInt(v.visitedSteps)||BigInt(v.visitedSteps)>BigInt(v.counts.steps)||BigInt(v.cursor.ordinal)>BigInt(v.pages))invalid('原生工作人口超出已保留原页');
 if(v.numericEof&&(v.sourceState!=='source-eof'||v.visitedSteps!==v.counts.steps||v.cursor.ordinal!==v.pages||v.cursor.index!==0))invalid('原生数字 EOF 必须覆盖全部原步骤');
 if(v.valuationEof&&!v.numericEof||v.workState==='processed'&&(!v.numericEof||!v.valuationEof||v.heldSteps!=='0'))invalid('原生处理完成必须保留数字及估值 EOF');
 if(v.previousPopulation&&BigInt(v.previousPopulation.held)>BigInt(v.previousPopulation.visited))invalid('先前原生工作人口不一致');
});
export type RuntimeNativePagedCapture=z.infer<typeof RuntimeNativePagedCaptureSchema>;
