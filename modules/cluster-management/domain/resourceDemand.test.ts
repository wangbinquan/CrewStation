import { describe, expect, test } from 'bun:test';
import { activePod, addDemand, combine, decimalValue, emptyDemand, normalized, podDemand, quantity } from './resourceDemand';
import type { ResourceObject } from './inventory';
const pod = (spec: Record<string, unknown>, status: Record<string, unknown> = {}): ResourceObject => ({ apiVersion: 'v1', kind: 'Pod', metadata: { name: 'p' }, spec, status });
const container = (name: string, cpu: string, extra = {}) => ({ name, resources: { requests: { cpu }, limits: { cpu: '8' } }, ...extra });
describe('exact Kubernetes resource demand', () => {
  test('decimal, binary, exponent and counters beyond the JS integer range', () => {
    for (const [raw, expected] of [['250m', '0.25'], ['.5', '0.5'], ['1Gi', '1073741824'], ['1.5Gi', '1610612736'], ['1e3', '1000'], ['1E-3', '0.001'], ['1u', '0.000001'], ['1n', '0.000000001'], ['0.1n', '0.000000001'], ['9007199254740993', '9007199254740993'], ['1Ei', '1152921504606846976'], ['1E', '1000000000000000000']]) expect(decimalValue(quantity(raw!))).toBe(expected!);
    expect(decimalValue(-quantity('1.01'))).toBe('-1.01');
    for (const raw of ['-1', 'NaN', '1garbage', '1e9999', '1'.repeat(101)]) expect(() => quantity(raw)).toThrow();
    const errors: string[] = []; expect(normalized({ cpu: 'bad', memory: '1Ki', count: 4 }, errors)).toEqual({ memory: '1024' }); expect(errors).toHaveLength(1);
  });
  test('init peak includes preceding restartable sidecars and overhead', () => {
    const p = pod({ containers: [container('app', '2')], initContainers: [container('early', '5'), container('side', '1', { restartPolicy: 'Always' }), container('later', '6')], overhead: { cpu: '100m' } });
    expect(podDemand(p).requests.cpu).toBe('7.1');
    expect(podDemand(p).limits.cpu).toBe('16.1');
    expect(podDemand(p).missingRequests.memory).toBe(4);
    expect(podDemand(p).unboundedLimits.memory).toBe(4);
  });
  test('sidecars running alongside applications, Pod budgets and debugging containers', () => {
    const p = pod({ containers: [container('a', '2'), container('b', '3')], initContainers: [container('side', '1', { restartPolicy: 'Always' })], ephemeralContainers: [container('debug', '999')], resources: { requests: { cpu: '8', memory: '1Gi' }, limits: { cpu: '10' } }, overhead: { cpu: '100m' } });
    const demand = podDemand(p); expect(demand.requests).toEqual({ cpu: '8.1', memory: '1073741824' }); expect(demand.limits.cpu).toBe('10.1'); expect(demand.unboundedLimits.cpu).toBe(0);
    expect(podDemand(pod({ containers: [container('a', '2')], initContainers: [container('s', '3', { restartPolicy: 'Always' })] })).requests.cpu).toBe('5');
  });
  test('in-place resize reserves maximum until actuated; infeasible uses actuated allocation', () => {
    const spec = { containers: [container('a', '4')] }, status = { containerStatuses: [{ name: 'a', allocatedResources: { cpu: '3' }, resources: { requests: { cpu: '2' } } }] };
    expect(podDemand(pod(spec, status)).requests.cpu).toBe('4');
    expect(podDemand(pod(spec, { ...status, resize: 'Infeasible' })).requests.cpu).toBe('3');
    expect(podDemand(pod(spec, { ...status, conditions: [{ type: 'PodResizePending', status: 'True', reason: 'Infeasible' }] })).requests.cpu).toBe('3');
    expect(podDemand(pod({ ...spec, resources: { requests: { cpu: '5' } } }, { resources: { requests: { cpu: '6' } } })).requests.cpu).toBe('6');
  });
  test('resource keys, explicit zero, missing limits and terminal phases stay distinct', () => {
    const demand = podDemand(pod({ containers: [{ name: 'a', resources: { requests: { 'nvidia.com/gpu': '2', memory: '1Gi' }, limits: { cpu: '0' } } }] }));
    expect(demand.unboundedLimits.cpu).toBe(1); expect(demand.requests['nvidia.com/gpu']).toBe('2');
    expect(activePod(pod({}, { phase: 'Pending' }))).toBe(true); expect(activePod(pod({}, { phase: 'Failed' }))).toBe(false); expect(activePod(pod({}, { phase: 'Succeeded' }))).toBe(false);
    expect(addDemand(demand, emptyDemand())).toEqual(demand); expect(addDemand(demand, demand).requests.memory).toBe('2147483648');
    expect(combine({ cpu: '2' }, { cpu: '1' }, 'max')).toEqual({ cpu: '2' });
  });
});
