import { expect, test } from 'bun:test';
import { boundedMetricsText, parseMetricsJson } from './metrics';
import { createK8sClient } from './client';
test('bounded metrics decoding preserves large counters and rejects oversized and failed sources', async () => {
  expect(parseMetricsJson(await boundedMetricsText(new Response('{"n":9007199254740993,"small":3,"fraction":0.1}')))).toEqual({ n: '9007199254740993', small: 3, fraction: 0.1 });
  await expect(boundedMetricsText(new Response('too long'), 2)).rejects.toThrow('too large');
  await expect(boundedMetricsText(new Response('x', { headers: { 'content-length': '100' } }), 2)).rejects.toThrow('too large');
  await expect(boundedMetricsText(new Response(null))).rejects.toThrow('Empty');
  await expect(boundedMetricsText(new Response('forbidden', { status: 403 }))).rejects.toThrow('403');
});
test('node proxy only addresses the two named metrics endpoints', async () => {
  const urls: string[] = [], client = createK8sClient({ server: 'https://cluster', token: 'token', defaultNamespace: 'default' }, (async (url: string) => { urls.push(url); return new Response('{}'); }) as typeof fetch);
  await client.nodeMetrics('node-1', 'summary'); await client.nodeMetrics('node-1', 'cadvisor', new AbortController().signal);
  expect(urls).toEqual(['https://cluster/api/v1/nodes/node-1/proxy/stats/summary', 'https://cluster/api/v1/nodes/node-1/proxy/metrics/cadvisor']);
  await expect(client.nodeMetrics('../secrets', 'summary')).rejects.toThrow('Invalid');
  await expect(client.nodeMetrics('node', 'bad' as 'summary')).rejects.toThrow('Invalid');
});
