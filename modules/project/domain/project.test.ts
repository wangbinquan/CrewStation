import { expect, test } from 'bun:test';
import { RESERVED_SLUGS } from './project';

// 项目的正式主机是 <slug>.<用户域>、服务主机是 <slug>.<服务域>：slug 与平台自己占用的主机前缀相同，
// 就会生成一条和平台路由同 Host 的 IngressRoute——服务域上的 events／mcp-* 平台路由没有显式优先级，两条谁生效不确定。
test('平台在用户域与服务域上占用的主机前缀都不能用作项目 slug', () => {
  for (const userDomainHost of ['console', 'preview', 'dev', 'registry']) expect(RESERVED_SLUGS).toContain(userDomainHost);
  for (const serviceDomainHost of ['api', 'events', 'mcp-capabilities', 'mcp-operations']) expect(RESERVED_SLUGS).toContain(serviceDomainHost);
  expect(RESERVED_SLUGS).toEqual(expect.arrayContaining(['www', 'auth', 'crewstation']));
  expect(new Set(RESERVED_SLUGS).size).toBe(RESERVED_SLUGS.length);
});
