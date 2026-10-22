import * as assert from 'node:assert/strict';

import { UiStateStore } from '../../src/host/uiState';
import type { MementoLike } from '../../src/host/uiState';
import { NAV_WIDTH_MAX, NAV_WIDTH_MIN, normalizeNavWidth, normalizeRecent, normalizeUiState, pushRecent, RECENT_LIMIT } from '../../src/shared/uiState';

function fakeMemento(initial: Record<string, unknown> = {}): MementoLike & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    get: <T>(key: string) => data[key] as T | undefined,
    update: async (key, value) => {
      data[key] = value;
    },
  };
}

suite('面板偏好：最近使用', () => {
  test('去掉不認得的 id 與重複項，最多五筆', () => {
    assert.deepEqual(normalizeRecent(['json', 'nope', 'json', 'hash', 42, 'diff', 'jwt', 'tools', 'timecalc']), ['json', 'hash', 'diff', 'jwt', 'tools']);
    assert.equal(RECENT_LIMIT, 5);
    assert.deepEqual(normalizeRecent('json'), []);
  });

  test('推到最前面，已存在的移位不重複', () => {
    assert.deepEqual(pushRecent(['hash', 'json', 'diff'], 'json'), ['json', 'hash', 'diff']);
    assert.deepEqual(pushRecent(['a1', 'a2', 'a3', 'a4', 'a5'].map((_, i) => (['hash', 'json', 'diff', 'jwt', 'tools'] as const)[i]), 'timecalc'), ['timecalc', 'hash', 'json', 'diff', 'jwt']);
  });
});

suite('面板偏好：選單寬度', () => {
  test('夾在範圍內並取整，非數字為 null', () => {
    assert.equal(normalizeNavWidth(10), NAV_WIDTH_MIN);
    assert.equal(normalizeNavWidth(9999), NAV_WIDTH_MAX);
    assert.equal(normalizeNavWidth(150.6), 151);
    assert.equal(normalizeNavWidth('150'), null);
    assert.equal(normalizeNavWidth(Number.NaN), null);
    assert.equal(normalizeNavWidth(null), null);
  });
});

suite('面板偏好：儲存', () => {
  test('空的或壞掉的 globalState 讀出預設值', () => {
    assert.deepEqual(new UiStateStore(fakeMemento()).get(), { recent: [], navWidth: null });
    assert.deepEqual(new UiStateStore(fakeMemento({ ui: 'garbage' })).get(), { recent: [], navWidth: null });
    assert.deepEqual(normalizeUiState({ recent: ['hash', 'x'], navWidth: 200 }), { recent: ['hash'], navWidth: 200 });
  });

  test('patch 只改帶進來的欄位', async () => {
    const memento = fakeMemento();
    const store = new UiStateStore(memento);
    await store.patch({ recent: ['json'] });
    await store.patch({ navWidth: 180 });
    assert.deepEqual(store.get(), { recent: ['json'], navWidth: 180 });
    await store.patch({ navWidth: null });
    assert.deepEqual(memento.data.ui, { recent: ['json'], navWidth: null });
  });
});
