import * as assert from 'node:assert/strict';

import { checkShift } from '../../src/core/timecalc/shiftCheck';
import { SHIFT_CHECK_EXAMPLES } from '../../src/webview/tabs/shiftCheckExamples';

// 範例 label 開頭承諾了結果，核心規則改了而範例沒跟上時這裡會紅
type Outcome = { match: boolean | null; warnings: boolean } | 'error';

const EXPECTED: Record<string, Outcome> = {
  basic: { match: true, warnings: false },
  mismatch: { match: false, warnings: false },
  'api-response': { match: true, warnings: false },
  fragment: { match: true, warnings: false },
  overnight: { match: true, warnings: false },
  multi: { match: true, warnings: false },
  'split-hm': { match: true, warnings: false },
  minutes: { match: true, warnings: false },
  'object-hm': { match: true, warnings: false },
  datetime: { match: true, warnings: false },
  // 缺總時間時核心會附一則「只列出計算結果」的警告
  'no-total': { match: null, warnings: true },
  'bad-breaks': { match: true, warnings: true },
  'duplicate-keys': { match: true, warnings: true },
  'string-total': { match: true, warnings: true },
  'invalid-json': 'error',
  'no-periods': 'error',
};

suite('工時核對範例', () => {
  test('每個範例都有預期結果，id 不重複', () => {
    const ids = SHIFT_CHECK_EXAMPLES.map((e) => e.id);
    assert.deepEqual([...new Set(ids)], ids);
    assert.deepEqual(ids.sort(), Object.keys(EXPECTED).sort());
  });

  for (const example of SHIFT_CHECK_EXAMPLES) {
    test(`${example.id}：${example.label}`, () => {
      const expected = EXPECTED[example.id];
      if (expected === 'error') {
        assert.throws(() => checkShift(example.text));
        return;
      }
      const result = checkShift(example.text);
      assert.equal(result.match, expected.match);
      assert.equal(result.warnings.length > 0, expected.warnings, result.warnings.join('\n'));
    });
  }

  test('label 開頭與結果一致', () => {
    for (const example of SHIFT_CHECK_EXAMPLES) {
      const expected = EXPECTED[example.id];
      const prefix = example.label.split('：')[0];
      const want = expected === 'error' ? '錯誤' : expected.match === null ? '無總時間' : expected.warnings ? '警告' : expected.match ? '一致' : '不一致';
      assert.equal(prefix, want, example.id);
    }
  });
});
