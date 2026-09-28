import { expect, test } from 'bun:test';
import { objectTransferMetrics } from './objectMetrics';

test('object meters export accurate counters and cumulative histogram buckets with bounded labels', () => {
  const metrics = objectTransferMetrics(2), backendId = Bun.randomUUIDv7(), spaceId = Bun.randomUUIDv7();
  metrics.record({ backendId, spaceId, operation: 'put', result: 'ok', bytes: 7, durationSeconds: 0.04 });
  metrics.record({ backendId, spaceId, operation: 'put', result: 'ok', bytes: 3, durationSeconds: 0.2 });
  metrics.record({ backendId, spaceId, operation: 'get', result: 'aborted', bytes: 2, durationSeconds: 1 });
  metrics.record({ backendId, spaceId, operation: 'delete', result: 'ok', bytes: 0, durationSeconds: 1 });
  metrics.record({ backendId, spaceId: 'filename\"secret', operation: 'get', result: 'ok', bytes: 10, durationSeconds: 1 });
  const text = metrics.render(), labels = `backend_id="${backendId}",space_id="${spaceId}",operation="put",result="ok"`;
  expect(text).toContain(`cs_object_transfer_bytes_total{${labels}} 10`);
  expect(text).toContain(`cs_object_transfer_requests_total{${labels}} 2`);
  expect(text).toContain(`cs_object_transfer_seconds_bucket{${labels},le="0.05"} 1`);
  expect(text).toContain(`cs_object_transfer_seconds_bucket{${labels},le="+Inf"} 2`);
  expect(text).toContain('cs_object_transfer_measurements_dropped_total 2');
  expect(text).not.toContain('filename'); expect(text).not.toContain('secret'); expect(text).not.toContain('operation="delete"');
});
