import { describe, expect, test } from 'bun:test';
import type { ProjectId, UserId } from '@crewstation/contracts';
import type { ConfigItem } from './configItem';
import { assertConfigName, writeActionFor } from './configItem';
import { keysOf, missingKeys, snapshotOf } from './configVersion';

const projectId = 'prj_00000000000000000000000000000001' as ProjectId;
const userId = 'usr_00000000000000000000000000000001' as UserId;
const item = (name: string, isSecret = false): ConfigItem => ({ projectId, env: 'production', name, isSecret, value: `v-${name}`, version: 1, updatedBy: userId, updatedAt: new Date('2026-09-11T00:00:00Z') });

describe('config domain', () => {
  test('配置项名必须是大写蛇形', () => {
    expect(() => assertConfigName('DATABASE_URL')).not.toThrow();
    expect(() => assertConfigName('database_url')).toThrow();
    expect(() => assertConfigName('1ABC')).toThrow();
    expect(() => assertConfigName('A-B')).toThrow();
  });

  test('生产组需要负责人动作，开发组需要开发者动作', () => {
    expect(writeActionFor('production')).toBe('manage-production-config');
    expect(writeActionFor('development')).toBe('manage-development-config');
  });

  test('快照按名字排序并保留 Secret 密文；键列表同序', () => {
    const snapshot = snapshotOf(projectId, 'production', 3, [item('ZZZ'), item('AAA', true)], userId, new Date());
    expect(snapshot.entries.map((e) => e.name)).toEqual(['AAA', 'ZZZ']);
    expect(snapshot.entries[0]).toMatchObject({ isSecret: true, value: 'v-AAA' });
    expect(keysOf(snapshot.entries)).toEqual(['AAA', 'ZZZ']);
  });

  test('Manifest env 段校验：key 缺省取 name，重复键只报一次', () => {
    const missing = missingKeys(
      [{ name: 'DB_URL', from: 'config', key: 'DATABASE_URL' }, { name: 'TOKEN', from: 'secret' }, { name: 'TOKEN2', from: 'secret', key: 'TOKEN' }, { name: 'PRESENT', from: 'config' }],
      [item('PRESENT')],
    );
    expect(missing).toEqual(['DATABASE_URL', 'TOKEN']);
  });
});
