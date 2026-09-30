// RFC-034: actual native file metadata must distinguish copied IDs and preserve healthy reopens.
import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { copyFileSync, existsSync, linkSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DevelopmentNativeObserver } from './developmentNativeObserver';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function paths() { const root = mkdtempSync(join(tmpdir(), 'cs-source-observer-')); roots.push(root); return { root, a: join(root, 'a.db'), b: join(root, 'b.db') }; }
function seed(path: string, input = 10) { const db = new Database(path); db.exec('CREATE TABLE usage (id TEXT PRIMARY KEY,input INTEGER);'); db.query('INSERT INTO usage VALUES(?,?)').run('same-native-part', input); db.close(); }
function sample(observer: DevelopmentNativeObserver) { return observer.read((path) => { const db = new Database(path, { readonly: true }); try { return db.query<{ input: number }, []>('SELECT input FROM usage').get()!.input; } finally { db.close(); } }); }
test('same native file survives observer reopen and ordinary WAL writes with one stable source epoch', () => {
  const { a } = paths(); seed(a); const first = new DevelopmentNativeObserver(a), before = sample(first);
  expect(before.store.state).toBe('observed'); expect(before.value).toBe(10);
  const db = new Database(a); db.exec('PRAGMA journal_mode=WAL;'); db.query('UPDATE usage SET input=?').run(15); db.close();
  const reopened = new DevelopmentNativeObserver(a), after = sample(reopened);
  expect(after.store).toEqual(before.store); expect(after.value).toBe(15); expect(reopened.issues()).toEqual([]);
  expect(statSync(a + '.crewstation-usage.sqlite').mode & 0o777).toBe(0o600);
});
test('copied native DB and copied sidecar cannot reuse source epoch, even with the same native IDs', () => {
  const { a, b } = paths(); seed(a); const before = sample(new DevelopmentNativeObserver(a));
  copyFileSync(a, b); copyFileSync(a + '.crewstation-usage.sqlite', b + '.crewstation-usage.sqlite');
  const after = sample(new DevelopmentNativeObserver(b)); expect(after.value).toBe(10); expect(after.store.state).toBe('observed');
  if (before.store.state !== 'observed' || after.store.state !== 'observed') throw new Error('Expected observed stores');
  expect(after.store.sourceEpoch).not.toBe(before.store.sourceEpoch); expect(after.store.actualPathDigest).not.toBe(before.store.actualPathDigest); expect(after.store.fileIdentityDigest).not.toBe(before.store.fileIdentityDigest);
});
test('pending startup creates no upstream directory or DB and a later real creation is observed', () => {
  const { root, a } = paths(), observer = new DevelopmentNativeObserver(a);
  expect(observer.inspect()).toEqual({ state: 'pending' }); expect(existsSync(a)).toBe(false); expect(existsSync(a + '.crewstation-usage.sqlite')).toBe(false);
  seed(a); expect(sample(observer).value).toBe(10); expect(observer.changed()).toBe(false);
  const absent = join(root, 'absent', 'native.db'); expect(new DevelopmentNativeObserver(absent).inspect()).toEqual({ state: 'pending' }); expect(existsSync(join(root, 'absent'))).toBe(false);
  expect(new DevelopmentNativeObserver(null).inspect()).toEqual({ state: 'unavailable' });
});
test('replace, delete/recreate and sidecar loss preserve a source change gap within the same observer', () => {
  for (const kind of ['replace', 'recreate', 'sidecar']) {
    const { a, b } = paths(); seed(a); const observer = new DevelopmentNativeObserver(a), before = sample(observer);
    if (kind === 'replace') { seed(b, 20); renameSync(b, a); }
    if (kind === 'recreate') { rmSync(a); expect(observer.inspect()).toEqual({ state: 'unavailable' }); seed(a, 20); }
    if (kind === 'sidecar') rmSync(a + '.crewstation-usage.sqlite');
    const after = sample(observer); expect(after.store.state).toBe('observed'); expect(after.store).not.toEqual(before.store); expect(observer.changed()).toBe(true); expect(observer.issues()).toContain('native-source-changed');
  }
});
test('hard links and symbolic path aliases do not silently reuse an existing observer identity', () => {
  const { a, b, root } = paths(); seed(a); const first = sample(new DevelopmentNativeObserver(a));
  linkSync(a, b); const hard = sample(new DevelopmentNativeObserver(b)); expect(hard.store).not.toEqual(first.store);
  const alias = join(root, 'alias.db'); symlinkSync(a, alias); const symbolic = sample(new DevelopmentNativeObserver(alias)); expect(symbolic.store).not.toEqual(first.store);
});
test('metadata change during a read makes the observation unavailable and rolls back the binding', () => {
  const { a, b } = paths(); seed(a); seed(b, 20); const observer = new DevelopmentNativeObserver(a);
  const result = observer.read(() => { renameSync(b, a); return 10; });
  expect(result).toEqual({ store: { state: 'unavailable' } }); expect(observer.changed()).toBe(true); expect(observer.issues()).toContain('native-source-changed');
  expect(sample(observer).value).toBe(20); expect(observer.issues()).toContain('native-source-changed');
});
test('corrupt or symlinked sidecars fail without deleting or rebuilding their original bytes', () => {
  const { a, b } = paths(); seed(a); const sidecar = a + '.crewstation-usage.sqlite'; writeFileSync(sidecar, 'not an observer database');
  expect(sample(new DevelopmentNativeObserver(a)).store).toEqual({ state: 'unavailable' }); expect(readFileSync(sidecar, 'utf8')).toBe('not an observer database');
  rmSync(sidecar); writeFileSync(b, 'untouched'); symlinkSync(b, sidecar);
  expect(sample(new DevelopmentNativeObserver(a)).store).toEqual({ state: 'unavailable' }); expect(readFileSync(b, 'utf8')).toBe('untouched');
});
test('sidecar lock contention is an explicit gap and does not alter model data or retain a reader', () => {
  const { a } = paths(); seed(a); const observer = new DevelopmentNativeObserver(a); sample(observer);
  const sidecar = new Database(a + '.crewstation-usage.sqlite'); sidecar.exec('BEGIN IMMEDIATE');
  expect(sample(observer).store).toEqual({ state: 'unavailable' }); expect(observer.issues()).toContain('native-source-sidecar-unavailable');
  sidecar.exec('ROLLBACK'); sidecar.close(); expect(sample(observer).value).toBe(10);
});

test('a first read which loses its file records a permanent source gap rather than reverting to startup pending', () => {
  const { a } = paths(); seed(a); const observer = new DevelopmentNativeObserver(a);
  expect(observer.read(() => { rmSync(a); return 10; })).toEqual({ store: { state: 'unavailable' } });
  expect(observer.changed()).toBe(true); expect(observer.issues()).toContain('native-source-changed');
  seed(a, 15); expect(sample(observer).value).toBe(15); expect(observer.issues()).toContain('native-source-changed');
});

test('a dangling sidecar symlink remains unavailable and never creates its target file', () => {
  const { a, b } = paths(); seed(a); symlinkSync(b, a + '.crewstation-usage.sqlite');
  const observer = new DevelopmentNativeObserver(a);
  expect(sample(observer).store).toEqual({ state: 'unavailable' }); expect(observer.issues()).toContain('native-source-sidecar-unavailable');
  expect(existsSync(b)).toBe(false);
});
