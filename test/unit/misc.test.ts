import * as assert from 'node:assert/strict';

import { diffLines, splitLines, unifiedDiff } from '../../src/core/diff/unified';
import { formatMode, humanSize, probeContent } from '../../src/core/fileprobe/probe';
import { parseTimestamp, ulid, uuidV7 } from '../../src/core/gen/generate';
import { validationSnippets } from '../../src/core/password/codegen';
import { checkPassword, DEFAULT_POLICY, generatePassword, laravelRule } from '../../src/core/password/policy';
import { convertCase, splitWords } from '../../src/core/text/case';
import { parseInteger, processLines } from '../../src/core/text/misc';
import { textStats } from '../../src/core/text/stats';

suite('Diff', () => {
  /** 從編輯腳本重建兩邊，確認沒有漏行或多行。 */
  function rebuild(a: string[], b: string[]) {
    const ops = diffLines(a, b);
    assert.deepEqual(ops.filter((o) => o.type !== '+').map((o) => o.line), a);
    assert.deepEqual(ops.filter((o) => o.type !== '-').map((o) => o.line), b);
    return ops;
  }

  /** LCS 長度的 DP 解，用來驗證 Myers 找到的是最短編輯。 */
  function lcsLength(a: string[], b: string[]): number {
    const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
    return dp[a.length][b.length];
  }

  test('邊界：空、全同、全異、只增、只刪', () => {
    rebuild([], []);
    rebuild(['a'], ['a']);
    rebuild(['a', 'b'], ['c', 'd']);
    rebuild([], ['a', 'b']);
    rebuild(['a', 'b'], []);
  });

  test('隨機輸入：可重建兩邊且編輯距離最短', () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let round = 0; round < 300; round += 1) {
      const gen = () => Array.from({ length: Math.floor(rand() * 12) }, () => 'abcd'[Math.floor(rand() * 4)]);
      const a = gen();
      const b = gen();
      const ops = rebuild(a, b);
      assert.equal(ops.filter((o) => o.type === ' ').length, lcsLength(a, b), `a=${a.join('')} b=${b.join('')}`);
    }
  });

  test('unified diff 的 hunk 標頭與內容', () => {
    const out = unifiedDiff('a\nb\nc\nd\n', 'a\nB\nc\nd\n', { context: 1 });
    assert.equal(out, '--- left\n+++ right\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n');
  });

  test('距離遠的兩處變更拆成兩個 hunk', () => {
    const left = Array.from({ length: 20 }, (_, i) => `L${i}`).join('\n');
    const right = left.replace('L1\n', 'X1\n').replace('L18', 'X18');
    const out = unifiedDiff(left, right, { context: 2 });
    assert.equal((out.match(/^@@/gm) ?? []).length, 2);
    assert.match(out, /@@ -1,4 \+1,4 @@/);
  });

  test('忽略空白與大小寫', () => {
    assert.match(unifiedDiff('a  b\nC', 'a b\nc', { ignoreWhitespace: true, ignoreCase: true }), /沒有差異/);
  });

  test('CRLF 與 LF 視為同一行結尾', () => {
    assert.deepEqual(splitLines('a\r\nb\n'), ['a', 'b']);
  });
});

suite('密碼', () => {
  test('逐條規則回報失敗原因', () => {
    const check = checkPassword('abc12', DEFAULT_POLICY);
    const failed = check.rules.filter((r) => !r.passed).map((r) => r.id);
    assert.deepEqual(failed, ['length', 'upper', 'symbol', 'sequential']);
  });

  test('鍵盤序列、重複字元、常見密碼', () => {
    const ids = (pw: string) => checkPassword(pw, DEFAULT_POLICY).rules.filter((r) => !r.passed).map((r) => r.id);
    assert.ok(ids('Qwer!9x7').includes('keyboard'));
    assert.ok(ids('Paaa!9x7').includes('repeated'));
    assert.ok(ids('password').includes('common'));
  });

  test('符號集以外的符號不算數，並說明原因', () => {
    const rule = checkPassword('Ab9x7~~Z', { ...DEFAULT_POLICY, symbolSet: '!@#' }).rules.find((r) => r.id === 'symbol');
    assert.equal(rule?.passed, false);
    assert.match(rule?.detail ?? '', /不在設定的符號集內/);
  });

  test('產生器跑 1000 次全部符合規則', () => {
    for (let i = 0; i < 1000; i += 1) {
      const pw = generatePassword(DEFAULT_POLICY, 12);
      assert.equal(pw.length, 12);
      assert.ok(checkPassword(pw, DEFAULT_POLICY).passed, pw);
    }
  });

  test('排除易混淆字元', () => {
    for (let i = 0; i < 200; i += 1) {
      assert.doesNotMatch(generatePassword(DEFAULT_POLICY, 16, true), /[0O1lI]/);
    }
  });

  test('Laravel 規則', () => {
    const out = laravelRule(DEFAULT_POLICY);
    assert.match(out, /Password::min\(8\)->mixedCase\(\)->numbers\(\)->symbols\(\)/);
    assert.match(out, /not_regex/);
  });

  test('Laravel 規則：只要求大寫或小寫時真的補上 regex', () => {
    assert.match(laravelRule({ ...DEFAULT_POLICY, requireLowercase: false }), /->letters\(\)->numbers\(\)->symbols\(\), 'regex:\/\[A-Z\]\/'/);
  });

  test('各語言驗證程式碼：八個目標、只輸出啟用的規則', () => {
    const byId = (policy: typeof DEFAULT_POLICY) => new Map(validationSnippets(policy).map((s) => [s.id, s.code]));
    const full = byId(DEFAULT_POLICY);
    assert.deepEqual([...full.keys()], ['laravel', 'ci3', 'ci4', 'java', 'go', 'python', 'kotlin', 'swift']);
    for (const code of full.values()) {
      assert.ok(code.includes('8'));
    }
    // Go 對沒用到的 import 直接編譯失敗
    const lengthOnly = byId({ ...DEFAULT_POLICY, requireUppercase: false, requireLowercase: false, requireDigit: false, requireSymbol: false, forbidSequential: false, forbidRepeated: true, forbidKeyboard: false });
    assert.doesNotMatch(lengthOnly.get('go') ?? '', /"strings"/);
    assert.doesNotMatch(lengthOnly.get('go') ?? '', /lower :=/);
    assert.doesNotMatch(lengthOnly.get('java') ?? '', /Locale/);
  });

  test('各語言驗證程式碼：符號集依語言跳脫', () => {
    const code = new Map(validationSnippets({ ...DEFAULT_POLICY, symbolSet: `'"\\$` }).map((s) => [s.id, s.code]));
    assert.ok(code.get('ci3')?.includes(`'\\'"\\\\$'`));
    assert.ok(code.get('java')?.includes(`"'\\"\\\\$"`));
    assert.ok(code.get('kotlin')?.includes(`"'\\"\\\\\\$"`));
  });
});

suite('檔案內容探測', () => {
  const bytes = (...values: number[]) => new Uint8Array(values);
  const utf8 = (text: string) => new Uint8Array(Buffer.from(text, 'utf8'));

  test('四種 BOM', () => {
    assert.equal(probeContent(bytes(0xef, 0xbb, 0xbf, 0x61)).bom?.kind, 'UTF-8');
    assert.equal(probeContent(bytes(0xff, 0xfe, 0x61, 0x00)).bom?.kind, 'UTF-16LE');
    assert.equal(probeContent(bytes(0xfe, 0xff, 0x00, 0x61)).bom?.kind, 'UTF-16BE');
    assert.equal(probeContent(bytes(0xff, 0xfe, 0x00, 0x00, 0x61, 0, 0, 0)).bom?.kind, 'UTF-32LE');
  });

  test('純 ASCII、合法 UTF-8、含 NUL', () => {
    assert.equal(probeContent(utf8('abc')).isAscii, true);
    const zh = probeContent(utf8('中文'));
    assert.equal(zh.validUtf8, true);
    assert.equal(zh.encodingCertain, true);
    assert.equal(probeContent(bytes(0x61, 0x00, 0x62)).hasNul, true);
  });

  test('Big5 位元組推測為 Big5 並標示為推測', () => {
    // 「中文」的 Big5 編碼
    const probe = probeContent(bytes(0xa4, 0xa4, 0xa4, 0xe5));
    assert.equal(probe.validUtf8, false);
    assert.equal(probe.encodingCertain, false);
    assert.match(probe.encoding, /Big5/);
  });

  test('行尾與縮排', () => {
    const probe = probeContent(utf8('a\r\n\tb\n  c'));
    assert.equal(probe.eol, '混合');
    assert.deepEqual(probe.eolCounts, { lf: 1, crlf: 1, cr: 0 });
    assert.equal(probe.indent, '混合');
    assert.equal(probe.endsWithNewline, false);
    assert.equal(probe.lines, 3);
  });

  test('最長行與結尾換行', () => {
    const probe = probeContent(utf8('ab\nabcd\n'));
    assert.deepEqual(probe.longestLine, { length: 4, line: 2 });
    assert.equal(probe.endsWithNewline, true);
    assert.equal(probe.lines, 2);
  });

  test('權限與大小格式', () => {
    assert.equal(formatMode(0o100644), 'rw-r--r--（644）');
    assert.equal(humanSize(1536), '1.50 KB（1,536 B）');
  });
});

suite('文字與產生器', () => {
  test('拆詞：駝峰、連續大寫、分隔符號', () => {
    assert.deepEqual(splitWords('parseHTTPServer_url-v2'), ['parse', 'HTTP', 'Server', 'url', 'v2']);
    assert.equal(convertCase('user_id\nfirstName', 'kebab'), 'user-id\nfirst-name');
  });

  test('進位：前綴辨識與大數', () => {
    assert.equal(parseInteger('0xff'), 255n);
    assert.equal(parseInteger('-0b101'), -5n);
    assert.equal(parseInteger('zz', 36), 1295n);
    assert.equal(parseInteger('123456789012345678901234567890').toString(16), '18ee90ff6c373e0ee4e3f0ad2');
  });

  test('行處理：數字自然排序、去重', () => {
    assert.equal(processLines('a10\na2\na1', 'sort'), 'a1\na2\na10');
    assert.equal(processLines('x\ny\nx', 'unique'), 'x\ny');
  });

  test('文字統計', () => {
    const stats = textStats('Hello hello 世界\n');
    assert.equal(stats.latinWords, 2);
    assert.equal(stats.cjkCharacters, 2);
    assert.deepEqual(stats.topWords[0], ['hello', 2]);
  });

  test('UUID v7 版本位元與時間前綴', () => {
    const id = uuidV7(0x0123456789ab);
    assert.match(id, /^01234567-89ab-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test('ULID 長度與時間前綴可排序', () => {
    assert.equal(ulid(0).slice(0, 10), '0000000000');
    assert.ok(ulid(1000) > ulid(999));
    assert.equal(ulid().length, 26);
  });

  test('時間戳依位數判斷單位', () => {
    assert.equal(parseTimestamp('1700000000').unit, '秒');
    assert.equal(parseTimestamp('1700000000000').unit, '毫秒');
    assert.equal(parseTimestamp('1700000000').date.toISOString(), '2023-11-14T22:13:20.000Z');
    assert.equal(parseTimestamp('2026-09-18 10:00:00Z').date.toISOString(), '2026-09-18T10:00:00.000Z');
    assert.throws(() => parseTimestamp('not a date'));
  });
});
