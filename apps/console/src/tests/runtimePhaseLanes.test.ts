// RFC-034: actual Agent segments share a lane; a retained environment is visually distinct from model activity.
import {test,expect} from 'bun:test';
import type {RuntimePhase,TaskId} from '@crewstation/contracts';
import {runtimePhaseLanes} from '../features/observability/model/runtimePhaseLanes';
const taskId='019f0000-0000-7000-8000-000000000001' as TaskId;
const row=(key:string,agentId:string,kind:RuntimePhase['kind']):RuntimePhase=>({key,taskId,agentId,agentName:'Original '+agentId,turnId:key,kind,source:'native-activity',quality:'known',startedAt:'2026-10-13T00:00:00.000Z',endedAt:'2026-10-13T00:00:10.000Z',durationMs:'10000',open:false,reason:null});
test('two real turns keep the same Agent lane and another physical owner cannot be merged into it',()=>{const rows=[row('one','agent','active'),row('two','agent','waiting'),row('other','other','active'),{...row('resident','agent','residence'),runtimeTaskId:'019f0000-0000-7000-8000-000000000002' as TaskId}],lanes=runtimePhaseLanes(rows);expect(lanes).toHaveLength(3);expect(lanes[0]?.name).toBe('Original agent');expect(lanes[0]?.segments.map(r=>r.kind)).toEqual(['active','waiting']);expect(lanes.at(-1)?.segments[0]?.kind).toBe('residence');});
