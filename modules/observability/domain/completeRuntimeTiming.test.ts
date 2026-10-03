// RFC-034 complete duration union and nearest-rank integer arithmetic.
import {describe,expect,test} from 'bun:test';
import {completeIntervalTotals,completePercentileRank} from './completeRuntimeTiming';
async function* rows(values:Array<{start:number;end:number}>) {yield* values;}
describe('complete original timing',()=>{
  test('overlap, nested, touching and zero intervals contribute exactly once to the active union',async()=>{
    expect(await completeIntervalTotals(rows([{start:0,end:0},{start:0,end:10},{start:1,end:5},{start:8,end:12},{start:12,end:20},{start:25,end:30}]))).toEqual({cumulativeMs:'31',activeUnionMs:'25'});
  });
  test('10001 intervals have no population cap and retain exact cumulative/union durations',async()=>{
    expect(await completeIntervalTotals((async function*(){for(let n=0;n<10001;n++) yield {start:n,end:n+3};})())).toEqual({cumulativeMs:'30003',activeUnionMs:'10003'});
    expect(completePercentileRank(10001n,1n,2n)).toBe(5001n);expect(completePercentileRank(10001n,95n,100n)).toBe(9501n);
    expect(completePercentileRank(9007199254740993n,95n,100n)).toBe(8556839292003944n);
  });
  test('unordered or invalid original intervals fail instead of publishing a subset',async()=>{
    await expect(completeIntervalTotals(rows([{start:5,end:8},{start:4,end:10}]))).rejects.toThrow('not ordered');
    await expect(completeIntervalTotals(rows([{start:5,end:4}]))).rejects.toThrow('Invalid');
  });
});
