import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { DEFAULT_TEST_DATABASE_URL, testDatabaseAvailable } from '@crewstation/testkit';
import { postgresDataPlane } from '../adapters/postgres/postgresDataPlane';

const available = await testDatabaseAvailable();
const adminUrl = process.env.CS_TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
const suffix = Bun.randomUUIDv7().replace(/-/g, '').slice(-10);
const names = { db: `cs_dcp_${suffix}`, role: `cs_dcp_${suffix}`, temp: `cs_t_dcp_${suffix}`, forever: `cs_dcp_inf_${suffix}`, foreign: `dcp_${suffix}`, owning: `cs_t_own${suffix}`, built: `cs_dcpnew_${suffix}`,
  reader: `cs_t_rd${suffix}`, changer: `cs_t_wr${suffix}` };

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
    for (const role of [names.reader, names.changer]) {
      if (!(await admin`SELECT 1 FROM pg_roles WHERE rolname = ${role}`).length) continue;
      const target = new URL(adminUrl); target.pathname = `/${names.db}`;
      const inDb = postgres(target.toString(), { max: 1, onnotice: () => undefined });
      try { await inDb.unsafe(`REASSIGN OWNED BY "${role}" TO "${names.role}"`); await inDb.unsafe(`DROP OWNED BY "${role}"`); } finally { await inDb.end(); }
      await admin.unsafe(`DROP OWNED BY "${role}"`);
    }
    for (const db of [names.db, names.built]) await admin.unsafe(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    for (const role of [names.owning, names.role, names.temp, names.forever, names.foreign, names.built, names.reader, names.changer]) await admin.unsafe(`DROP ROLE IF EXISTS "${role}"`);
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

  test('删临时角色：它在库里拥有的表转给运行角色后删掉；OID 对不上（同名的另一个角色）不删；不在的算完成；不是平台名字的拒绝', async () => {
    await admin.unsafe(`CREATE ROLE "${names.owning}" WITH LOGIN PASSWORD 'x'`);
    const target = new URL(adminUrl);
    target.pathname = `/${names.db}`;
    const inDb = postgres(target.toString(), { max: 1, onnotice: () => undefined });
    const plane = postgresDataPlane(adminUrl);
    try {
      await inDb.unsafe(`CREATE TABLE audit (id int)`);
      await inDb.unsafe(`ALTER TABLE audit OWNER TO "${names.owning}"`);
      const oid = (await plane.snapshot()).roles.get(names.owning)!.oid;
      expect(await plane.dropRole({ role: names.owning, oid: '1', database: names.db, reassignTo: names.role })).toBe('replaced');
      expect((await plane.snapshot()).roles.has(names.owning)).toBe(true);
      expect(await plane.dropRole({ role: names.owning, oid, database: names.db, reassignTo: names.role })).toBe('dropped');
      expect((await plane.snapshot()).roles.has(names.owning)).toBe(false);
      const owner = await inDb<{ tableowner: string }[]>`SELECT tableowner FROM pg_tables WHERE tablename = 'audit'`;
      expect(owner[0]?.tableowner).toBe(names.role);
      expect(await plane.dropRole({ role: names.owning, database: names.db, reassignTo: names.role })).toBe('absent');
      await expect(plane.dropRole({ role: 'postgres' })).rejects.toThrow('非法的数据面标识符');
    } finally { await inDb.end(); await plane.close(); }
  });

  // RFC-025 I28：data-control 建库与运行角色（口令由调用方先存下再给）。
  test('建库：角色不在就建、在就改口令，库不在才建（属主是这个角色），只有这个角色能连；重复执行不变；口令格式不对拒绝', async () => {
    const plane = postgresDataPlane(adminUrl);
    const as = (role: string, password: string) => { const url = new URL(adminUrl); url.username = role; url.password = password; url.pathname = `/${names.built}`; return url.toString(); };
    const connects = async (url: string): Promise<boolean> => { const client = postgres(url, { max: 1, onnotice: () => undefined, connect_timeout: 5 }); try { await client`SELECT 1`; return true; } catch { return false; } finally { await client.end(); } };
    try {
      const first = 'Aa0_-bcdefghijklmnopqrstuv', second = 'Zz9-_yxwvutsrqponmlkjihgf';
      await plane.ensureDatabase({ database: names.built, role: names.built, password: first });
      const snapshot = await plane.snapshot();
      expect(snapshot.databases.has(names.built) && snapshot.roles.has(names.built)).toBe(true);
      expect((await admin<{ owner: string }[]>`SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = ${names.built}`)[0]?.owner).toBe(names.built);
      expect(await connects(as(names.built, first))).toBe(true);
      // 同一个库，换一个口令再执行：角色改口令，库不重建（OID 不变）。
      const oid = snapshot.databases.get(names.built)!.oid;
      await plane.ensureDatabase({ database: names.built, role: names.built, password: second });
      expect((await plane.snapshot()).databases.get(names.built)?.oid).toBe(oid);
      expect(await connects(as(names.built, first))).toBe(false);
      expect(await connects(as(names.built, second))).toBe(true);
      // PUBLIC 的 CONNECT 已撤销：别的有登录权的角色连不上这个库。
      expect((await admin<{ ok: boolean }[]>`SELECT has_database_privilege(${names.foreign}, ${names.built}, 'CONNECT') AS ok`)[0]?.ok).toBe(false);
      await expect(plane.ensureDatabase({ database: names.built, role: names.built, password: "x' OR '1'='1" })).rejects.toThrow('口令格式不对');
      await expect(plane.ensureDatabase({ database: 'postgres', role: names.built, password: first })).rejects.toThrow('非法的数据面标识符');
    } finally { await plane.close(); }
  });

  // I28 第二步：访问绑定的临时角色。
  test('临时角色：只连得上所在的库，到期时间照写；诊断只读的能读不能写，生产变更的继承运行角色能写；重复执行改口令不重建', async () => {
    const plane = postgresDataPlane(adminUrl);
    const as = (role: string, password: string) => { const url = new URL(adminUrl); url.username = role; url.password = password; url.pathname = `/${names.db}`; return url.toString(); };
    const run = async (url: string, sql: string): Promise<boolean> => { const client = postgres(url, { max: 1, onnotice: () => undefined, connect_timeout: 5 }); try { await client.unsafe(sql); return true; } catch { return false; } finally { await client.end(); } };
    const target = new URL(adminUrl); target.pathname = `/${names.db}`;
    const owner = postgres(target.toString(), { max: 1, onnotice: () => undefined });
    try {
      await owner.unsafe(`CREATE TABLE IF NOT EXISTS orders (id int)`);
      await owner.unsafe(`ALTER TABLE orders OWNER TO "${names.role}"`);
      const until = '2031-01-01T00:00:00.000Z', password = 'Rr0_-abcdefghijklmnopqrstu';
      await plane.ensureTemporaryRole({ role: names.reader, database: names.db, ownerRole: names.role, readOnly: true, validUntil: until, password });
      await plane.ensureTemporaryRole({ role: names.changer, database: names.db, ownerRole: names.role, readOnly: false, validUntil: until, password });
      expect((await plane.snapshot()).roles.get(names.reader)?.validUntil).toBe(until);
      expect(await run(as(names.reader, password), 'SELECT count(*) FROM orders')).toBe(true);
      expect(await run(as(names.reader, password), 'INSERT INTO orders VALUES (1)')).toBe(false);
      expect(await run(as(names.changer, password), 'INSERT INTO orders VALUES (2)')).toBe(true);
      const oid = (await plane.snapshot()).roles.get(names.reader)!.oid, next = 'Nn1-_zyxwvutsrqponmlkjihg';
      await plane.ensureTemporaryRole({ role: names.reader, database: names.db, ownerRole: names.role, readOnly: true, validUntil: until, password: next });
      expect((await plane.snapshot()).roles.get(names.reader)?.oid).toBe(oid);
      expect(await run(as(names.reader, password), 'SELECT 1')).toBe(false);
      expect(await run(as(names.reader, next), 'SELECT 1')).toBe(true);
      await expect(plane.ensureTemporaryRole({ role: names.reader, database: names.db, ownerRole: names.role, readOnly: true, validUntil: 'not-a-time', password })).rejects.toThrow('到期时间不对');
    } finally { await owner.unsafe(`DROP TABLE IF EXISTS orders`); await owner.end(); await plane.close(); }
  });
});
