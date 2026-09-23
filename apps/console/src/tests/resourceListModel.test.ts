import { expect, test } from 'bun:test';
import type { ApiOperationDto, ApiRequestDto, EventTypeDto } from '@crewstation/contracts';
import { groupEventTypes, subscriptionSnippet } from '../features/events/components/eventFamilies';
import { indexPending, INITIAL_OPERATION_FILTER, internalCallUrl, operationStatus, platformCallUrl, PLATFORM_PROVIDER, sectionOperations } from '../features/catalog/components/list/operationSections';

const op = (id: string, proxy: string, path: string, extra: Partial<ApiOperationDto> = {}): ApiOperationDto =>
  ({ id: `01a0bf5d-8f4b-7a11-8000-${id.padStart(12, '0')}`, proxyId: `01a0bf5d-8f4b-7a11-9000-${proxy.length.toString().padStart(12, '0')}`, proxy, method: 'GET', path, openPolicy: 'targeted', granted: false, ...extra }) as ApiOperationDto;
const granted = op('1', 'crm', '/customers', { openPolicy: 'default', granted: true, summary: '客户列表' });
const requestable = op('2', 'billing', '/invoices');
const pendingOp = op('3', 'billing', '/bills');
const blocked = op('4', 'hr', '/people', { openPolicy: 'default', granted: false });
const pending = indexPending([{ id: '01a0bf5d-8f4b-74eb-82d5-2045557ce77e', operationId: pendingOp.id, state: 'pending' } as ApiRequestDto, { id: '01a0bf5d-8f4b-74eb-82d5-2045557ce77f', operationId: requestable.id, state: 'rejected' } as ApiRequestDto]);
const platform = [{ method: 'POST', path: '/v2/business-tasks', summary: '创建业务任务' }];

test('接口状态：已授权可调；有待审申请是审批中（被拒的不算）；定向开放可申请；默认开放却未授权是未授权', () => {
  expect([granted, pendingOp, requestable, blocked].map((item) => operationStatus(item, pending))).toEqual(['callable', 'pending', 'requestable', 'blocked']);
});

test('可调用的（含平台接口）一组，其余一组且可申请的在审批中前面；筛选文字、提供方与状态只作用于已取回的列表', () => {
  const all = sectionOperations([blocked, pendingOp, requestable, granted], platform, pending, INITIAL_OPERATION_FILTER);
  expect([all.callable.map((item) => item.path), all.platform.map((item) => item.path), all.other.map((item) => item.path)]).toEqual([['/customers'], ['/v2/business-tasks'], ['/invoices', '/bills', '/people']]);
  expect(sectionOperations([granted, requestable], platform, pending, { ...INITIAL_OPERATION_FILTER, text: '客户' })).toEqual({ callable: [granted], platform: [], other: [] });
  expect(sectionOperations([granted, requestable], platform, pending, { ...INITIAL_OPERATION_FILTER, status: 'request' })).toEqual({ callable: [], platform: [], other: [requestable] });
  expect(sectionOperations([granted, requestable], platform, pending, { ...INITIAL_OPERATION_FILTER, provider: PLATFORM_PROVIDER })).toEqual({ callable: [], platform, other: [] });
  expect(sectionOperations([granted, requestable], platform, pending, { ...INITIAL_OPERATION_FILTER, provider: requestable.proxyId }).platform).toEqual([]);
});

test('调用地址就是代码里写的：内部 API 前缀以 /api/ 结尾后接代理与路径，平台接口接在平台 API 地址后', () => {
  expect(internalCallUrl({ proxy: 'billing', path: '/invoices/{id}' })).toBe('${CS_INTERNAL_API_BASE}billing/invoices/{id}');
  expect(internalCallUrl({ proxy: 'billing', path: 'invoices' })).toBe('${CS_INTERNAL_API_BASE}billing/invoices');
  expect(platformCallUrl(platform[0]!)).toBe('${CS_PLATFORM_API_URL}/v2/business-tasks');
});

const type = (eventType: string, producer: string, extra: Partial<EventTypeDto> = {}): EventTypeDto =>
  ({ id: `01a0bf5d-8f4b-780c-85dd-${String(eventType.length).padStart(12, '0')}`, name: eventType, producerId: '01a0bf5d-8f4b-780c-85dd-00000000e0e1', state: 'active', eventType, producer, producerProject: `${producer}-producer`, ...extra }) as EventTypeDto;

test('事件类型按生产方分组、按族归并：族名本身也可以是类型，下线的不列；前缀不是生产方名时整名作族', () => {
  const groups = groupEventTypes([type('gitlab.issue.open', 'gitlab'), type('gitlab.issue', 'gitlab'), type('gitlab.issue.close', 'gitlab'), type('gitlab.push', 'gitlab'), type('gitlab.tag', 'gitlab', { state: 'removed' }), type('source.changed', 'crm')]);
  expect(groups.map((group) => [group.producer, group.count, group.families.map((family) => [family.name, family.self?.eventType, family.leaves.map((leaf) => leaf.leaf)])])).toEqual([
    ['crm', 1, [['source.changed', 'source.changed', []]]],
    ['gitlab', 4, [['gitlab.issue', 'gitlab.issue', ['close', 'open']], ['gitlab.push', 'gitlab.push', []]]],
  ]);
});

test('订阅片段按 ID 绑定并在注释里写明类型，处理路径是可改的建议值', () => {
  expect(subscriptionSnippet({ id: '01a0bf5d-8f4b-780c-85dd-000000000001', eventType: 'gitlab.merge-request.open' }))
    .toBe('- eventTypeId: 01a0bf5d-8f4b-780c-85dd-000000000001  # gitlab.merge-request.open\n  handlerPath: /events/gitlab-merge-request-open\n');
});
