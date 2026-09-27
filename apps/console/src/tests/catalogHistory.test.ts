import './domSetup';
import { expect, test } from 'bun:test';
import { catalogHistory } from '../shared/lib/catalogHistory';

test('cursor history is scoped by identity and filter, and unknown deep links return to page one', () => {
  sessionStorage.clear();
  catalogHistory('projects', 'owner', ['demo']).remember('page-two');
  expect(catalogHistory('projects', 'owner', ['demo'], 'page-two').previous).toBe('');
  catalogHistory('projects', 'owner', ['demo'], 'page-two').remember('page-three');
  expect(catalogHistory('projects', 'owner', ['demo'], 'page-three').previous).toBe('page-two');
  for (const history of [catalogHistory('projects', 'tester', ['demo'], 'page-three'), catalogHistory('projects', 'owner', ['other'], 'page-three'), catalogHistory('images', 'owner', ['demo'], 'page-three'), catalogHistory('projects', 'owner', ['demo'], 'toString')]) expect(history.previous).toBeUndefined();
  catalogHistory('projects', 'owner', ['demo']).clear();
  expect(catalogHistory('projects', 'owner', ['demo'], 'page-two').previous).toBeUndefined();
});

test('history tolerates corrupted storage and keeps at most 100 page links', () => {
  const key = 'cs-catalog:projects:owner:[]';
  sessionStorage.setItem(key, '{broken');
  expect(catalogHistory('projects', 'owner', [], 'page').previous).toBeUndefined();
  for (let i = 0; i < 105; i++) catalogHistory('projects', 'owner', [], String(i)).remember(String(i + 1));
  expect(Object.keys(JSON.parse(sessionStorage.getItem(key)!))).toHaveLength(100);
  expect(catalogHistory('projects', 'owner', [], '105').previous).toBe('104');
});
