import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { DEFAULT_TEST_DATABASE_URL, testDatabaseAvailable } from '@crewstation/testkit';
import { postgresDataPlane } from '../adapters/postgres/postgresDataPlane';

const available = await testDatabaseAvailable();
const adminUrl = process.env.CS_TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
const suffix = Bun.randomUUIDv7().replace(/-/g, '').slice(-10);
const names = { db: `cs_dcp_${suffix}`, role: `cs_dcp_${suffix}`, temp: `cs_t_dcp_${suffix}`, forever: `cs_dcp_inf_${suffix}`, foreign: `dcp_${suffix}` };

describe.skipIf(!available)('数据面快照：平台数据库集群上带平台前缀的库与角色（RFC-025 第四期）', () => {
  let admin: ReturnType<typeof postgres>;
  beforeAll(async () => {
    admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
    await admin.unsafe(`CREATE ROLE "${names.role}" WITH LOGIN PASSWORD 'x'`);
    await admin.unsafe(`CREATE DATABASE "${names.db}" OWNER "${names.role}"`);
    await admin.unsafe(`CREATE ROLE "${names.temp}" WITH LOGIN PASSWORD 'x' VALID UNTIL '2030-01-01T00:00:00Z'`);
    await admin.unsafe(`CREATE ROLE "${names.forever}" WITH LOGIN PASSWORD 'x' VALID UNTIL 'infinity'`);
    await admin.unsafe(`CREATE ROLE "${names.foreign}" WITH LOGIN PASSWORD 'x'`);
  });
  afterAll(async () => {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${names.db}" WITH (FORCE)`);
    for (const role of [names.role, names.temp, names.forever, names.foreign]) await admin.unsafe(`DROP ROLE IF EXISTS "${role}"`);
    await admin.end();
  });

  test('列出 cs_ 前缀的库与角色（OID、临时角色的到期时间）；无限期当没有到期；别的名字不列', async () => {
    const reader = postgresDataPlane(adminUrl, { now: () => new Date('2026-09-24T00:00:00Z') });
    try {
      const snapshot = await reader.snapshot();
      expect(snapshot.observedAt).toBe('2026-09-24T00:00:00.000Z');
      expect(snapshot.databases.get(names.db)?.oid).toMatch(/^\d+$/);
      expect(snapshot.roles.get(names.role)).toMatchObject({ name: names.role });
      expect(snapshot.roles.get(names.role)?.validUntil).toBeUndefined();
      expect(snapshot.roles.get(names.temp)?.validUntil).toBe('2030-01-01T00:00:00.000Z');
      expect(snapshot.roles.get(names.forever)?.validUntil).toBeUndefined();
      expect(snapshot.roles.has(names.foreign)).toBe(false);
      expect([...snapshot.databases.keys()].every((name) => name.startsWith('cs_'))).toBe(true);
    } finally { await reader.close(); }
  });
});
