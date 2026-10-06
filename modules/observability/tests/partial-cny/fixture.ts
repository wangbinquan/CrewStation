// Dedicated acceptance-only partial records; original default 201/1001/2001 populations and rates are unchanged.
import type {UsageRecord,UsageValuation} from '@crewstation/contracts';
import type {completeCohortFixture} from '../completeCohortFixture';
import {rebuildUsageProjection} from '../../domain/usageProjection';
import {valueTokenUsage} from '../../domain/cnyPricing';
export function preparePartialCnyCohort(f:ReturnType<typeof completeCohortFixture>) {
 f.tasks.splice(3);f.attempts.splice(137);f.records.splice(137);f.captures.length=0;
 for(let n=0;n<f.records.length;n++){const {projection:_projection,...record}=f.records[n]!;f.records[n]=rebuildUsageProjection([{...record,coverage:'partial',usage:{input:record.usage.input,cacheRead:null,cacheWrite:'0',output:null}}]);}
}
export function partialCnyValuation(value:UsageValuation,record:UsageRecord):UsageValuation {
 // Calculate at the original first seed, using the same accepted four rates, never by rewriting a retained report.
 const priced=valueTokenUsage(record.projection.contribution,{input:'2',cacheRead:'0.5',cacheWrite:'3',output:'8'});
 if(value.availability!=='priced'||priced.completeness!=='partial')throw new Error('Dedicated original known partial valuation expected');
 return {...value,usageRevision:record.projection.projectionRevision,completeness:'partial',amountDecimal:priced.knownAmount,priceVersionRef:'ACCEPTANCE-ONLY-CNY-NOT-SUPPLIER-BILL-PARTIAL'};
}
