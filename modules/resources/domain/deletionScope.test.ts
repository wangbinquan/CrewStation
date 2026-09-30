import { expect, test } from 'bun:test';
import { compatiblePhysicalScope } from './deletionScope';
test('原 PVC 在途首次绑定属于原范围，已有原 PV 身份或节点位置不能改变', () => {
  const pending = { kind: 'protected:PVC', id: 'original', identity: JSON.stringify({ uid: 'original-pvc' }), count: 1 };
  const bound = { ...pending, identity: JSON.stringify({ uid: 'original-pvc', target: { pvUid: 'original-pv', directory: 'original-directory' } }) };
  expect(compatiblePhysicalScope([pending], [bound])).toBe(true);
  expect(compatiblePhysicalScope([bound], [bound])).toBe(true);
  expect(compatiblePhysicalScope([bound], [{ ...bound, identity: JSON.stringify({ uid: 'original-pvc', target: { pvUid: 'replacement-pv', directory: 'original-directory' } }) }])).toBe(false);
  expect(compatiblePhysicalScope([bound], [{ ...bound, identity: JSON.stringify({ uid: 'original-pvc', target: { pvUid: 'original-pv', directory: 'replacement-directory' } }) }])).toBe(false);
  expect(compatiblePhysicalScope([pending], [{ ...pending, identity: JSON.stringify({ uid: 'replacement-pvc' }) }])).toBe(false);
  expect(compatiblePhysicalScope([pending], [pending, { ...pending, id: 'new' }])).toBe(false);
});
