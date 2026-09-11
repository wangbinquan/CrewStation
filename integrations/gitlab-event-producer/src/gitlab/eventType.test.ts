import { describe, expect, test } from 'bun:test';
import { allEventTypes, mapEventType, normalizeHookName } from './eventType';

const PLATFORM_EVENT_TYPE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

describe('mapEventType', () => {
  test('push 与 tag push 映射成两段式类型', () => {
    expect(mapEventType('Push Hook', { object_kind: 'push' })).toEqual({ ok: true, hook: 'push hook', eventType: 'gitlab.push' });
    expect(mapEventType('Tag Push Hook', { object_kind: 'tag_push' })).toEqual({ ok: true, hook: 'tag push hook', eventType: 'gitlab.tag-push' });
  });

  test('合并请求按 object_attributes.action 细分', () => {
    const at = (action: string): unknown => mapEventType('Merge Request Hook', { object_attributes: { action } });
    expect(at('open')).toMatchObject({ eventType: 'gitlab.merge-request.open' });
    expect(at('merge')).toMatchObject({ eventType: 'gitlab.merge-request.merge' });
    expect(at('unapproved')).toMatchObject({ eventType: 'gitlab.merge-request.unapproved' });
  });

  test('流水线按 object_attributes.status 细分，议题按 action 细分', () => {
    expect(mapEventType('Pipeline Hook', { object_attributes: { status: 'success' } })).toMatchObject({ eventType: 'gitlab.pipeline.success' });
    expect(mapEventType('Pipeline Hook', { object_attributes: { status: 'canceled' } })).toMatchObject({ eventType: 'gitlab.pipeline.canceled' });
    expect(mapEventType('Issue Hook', { object_attributes: { action: 'close' } })).toMatchObject({ eventType: 'gitlab.issue.close' });
  });

  test('白名单外的动作退回两段式基础类型，绝不拼出没登记过的类型', () => {
    expect(mapEventType('Merge Request Hook', { object_attributes: { action: 'draft_toggled' } })).toMatchObject({ eventType: 'gitlab.merge-request' });
    expect(mapEventType('Pipeline Hook', { object_attributes: { status: 'waiting_for_resource' } })).toMatchObject({ eventType: 'gitlab.pipeline' });
    expect(mapEventType('Issue Hook', {})).toMatchObject({ eventType: 'gitlab.issue' });
    expect(mapEventType('Pipeline Hook', { object_attributes: { status: 42 } })).toMatchObject({ eventType: 'gitlab.pipeline' });
  });

  test('钩子名大小写与空白不敏感', () => {
    expect(normalizeHookName('  PUSH   Hook ')).toBe('push hook');
    expect(mapEventType('  merge   request hook', { object_attributes: { action: 'OPEN' } })).toMatchObject({ eventType: 'gitlab.merge-request.open' });
  });

  test('缺请求头或钩子未登记时返回 ok:false 与可读原因', () => {
    expect(mapEventType(null, {})).toMatchObject({ ok: false });
    expect(mapEventType('  ', {})).toMatchObject({ ok: false });
    const unknown = mapEventType('Wiki Page Hook', {});
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.reason).toContain('wiki page hook');
  });
});

describe('allEventTypes', () => {
  test('每个类型都合平台 Schema 的写法，且不重复', () => {
    const types = allEventTypes();
    expect(types.length).toBeGreaterThan(0);
    expect(new Set(types).size).toBe(types.length);
    for (const type of types) expect(type).toMatch(PLATFORM_EVENT_TYPE);
  });

  test('与 crewstation.yaml 的 spec.produces 逐项一致：改一处必须改另一处', async () => {
    const manifest = Bun.YAML.parse(await Bun.file(new URL('../../crewstation.yaml', import.meta.url)).text()) as {
      spec: { produces: { eventType: string }[] };
    };
    const declared = manifest.spec.produces.map((item) => item.eventType);
    expect(declared.slice().sort()).toEqual(allEventTypes().slice().sort());
  });

  test('包含最小样例订阅的 gitlab.push', () => {
    expect(allEventTypes()).toContain('gitlab.push');
  });
});
