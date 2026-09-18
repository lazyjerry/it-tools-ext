import * as assert from 'node:assert/strict';

import { detectDialect, parseLiteral } from '../../src/core/convert/fromLiteral';
import { convertJson } from '../../src/core/convert/toLang';
import { parseJson, stringifyNode } from '../../src/core/json/ast';

const json = (text: string) => parseJson(text);
const compact = (text: string, dialect?: 'php' | 'python' | 'js') => stringifyNode(parseLiteral(text, dialect), { indent: '' });

suite('JSON → 語言 literal', () => {
  const doc = json('{"name":"O\'Neil","n":12345678901234567890,"ok":true,"none":null,"list":[1,2.5],"empty":{}}');

  test('PHP 短陣列：單引號跳脫、大整數原樣', () => {
    const out = convertJson(doc, 'php-short', { indent: '  ' });
    assert.match(out, /^\$data = \[/m);
    assert.match(out, /空物件 \{\} 在 PHP 陣列裡與空陣列無法區分/);
    assert.match(out, /'name' => 'O\\'Neil'/);
    assert.match(out, /'n' => 12345678901234567890/);
    assert.match(out, /'empty' => \[\]/);
  });

  test('PHP (object) 模式：空物件是 stdClass', () => {
    assert.match(convertJson(doc, 'php-object', { indent: '  ' }), /'empty' => new \\stdClass\(\)/);
  });

  test('Python 用 True／None', () => {
    const out = convertJson(doc, 'python', { indent: '  ' });
    assert.match(out, /"ok": True/);
    assert.match(out, /"none": None/);
  });

  test('JS 超過安全整數範圍時加警告', () => {
    assert.match(convertJson(doc, 'js', { indent: '  ' }), /MAX_SAFE_INTEGER/);
    assert.doesNotMatch(convertJson(json('{"a":1}'), 'js', { indent: '  ' }), /MAX_SAFE_INTEGER/);
  });

  test('JS 合法識別字的 key 不加引號', () => {
    const out = convertJson(json('{"a":1,"b-c":2}'), 'js', { indent: '  ' });
    assert.match(out, /\n {2}a: 1,/);
    assert.match(out, /'b-c': 2/);
  });

  test('Java：超過 int 範圍加 L、超過 long 用 BigInteger、含 null 加警告', () => {
    const out = convertJson(json('{"a":3000000000,"b":12345678901234567890,"c":null}'), 'java-map', { indent: '  ' });
    assert.match(out, /3000000000L/);
    assert.match(out, /new BigInteger\("12345678901234567890"\)/);
    assert.match(out, /NullPointerException/);
  });

  test('Java 字串的控制字元用八進位，避免 \\u000a 在編譯前就斷行', () => {
    const out = convertJson(json('["a\\u0001b"]'), 'java-map', { indent: '  ' });
    assert.match(out, /"a\\001b"/);
  });

  test('Swift 的 unicode 跳脫是 \\u{...}', () => {
    assert.match(convertJson(json('["\\u0001"]'), 'swift-dict', { indent: '  ' }), /"\\u\{1\}"/);
  });

  test('Objective-C 字面值', () => {
    const out = convertJson(json('{"a":true,"b":[1],"c":null}'), 'objc', { indent: '  ' });
    assert.match(out, /@"a": @YES/);
    assert.match(out, /@"b": @\[/);
    assert.match(out, /\[NSNull null\]/);
  });
});

suite('JSON → 型別定義', () => {
  const doc = json('{"user_id":1,"items":[{"name":"a","price":1},{"name":"b","price":1.5,"note":null}],"meta":{}}');

  test('Go struct：縮寫全大寫、陣列元素單數化、缺席欄位 omitempty', () => {
    const out = convertJson(doc, 'go-struct', { indent: '  ' });
    assert.match(out, /UserID int64 `json:"user_id"`/);
    assert.match(out, /Items \[\]Item `json:"items"`/);
    assert.match(out, /Price float64 `json:"price"`/);
    assert.match(out, /Note any `json:"note,omitempty"`/);
  });

  test('Java POJO：camelCase 欄位保留原 key', () => {
    const out = convertJson(doc, 'java-pojo', { indent: '    ' });
    assert.match(out, /@JsonProperty\("user_id"\)\n {4}public Integer userId;/);
    assert.match(out, /public List<Item> items;/);
    assert.match(out, /public static class Item \{/);
  });

  test('Swift Codable：key 不同時產生 CodingKeys、缺席欄位為 optional', () => {
    const out = convertJson(doc, 'swift-codable', { indent: '    ' });
    assert.match(out, /let userId: Int/);
    assert.match(out, /case userId = "user_id"/);
    assert.match(out, /let price: Double/);
    assert.match(out, /let note: String\?/);
  });
});

suite('語言 literal → JSON', () => {
  test('PHP 短陣列與 array()，=> 與尾逗號', () => {
    assert.equal(compact("<?php\nreturn ['a' => 1, 'b' => array(1, 2,), ];"), '{"a":1,"b":[1,2]}');
  });

  test('PHP 自動 key 接在最大整數 key 之後；連號才輸出陣列', () => {
    assert.equal(compact("[5 => 'a', 'b']", 'php'), '{"5":"a","6":"b"}');
    assert.equal(compact("[0 => 'a', 1 => 'b']", 'php'), '["a","b"]');
  });

  test('PHP 單引號只跳脫 \\\\ 與 \\\'，大小寫不敏感的 TRUE／NULL', () => {
    assert.equal(compact("['a\\nb', 'it\\'s', TRUE, NULL]", 'php'), '["a\\\\nb","it\'s",true,null]');
  });

  test('PHP (object) 轉型與 stdClass', () => {
    assert.equal(compact("$x = (object) ['a' => new stdClass()];"), '{"a":{}}');
  });

  test('Python dict、tuple、True／None、底線數字', () => {
    assert.equal(compact("data = {'a': (1, 2), 'b': None, 'c': True, 'd': 1_000}"), '{"a":[1,2],"b":null,"c":true,"d":1000}');
  });

  test('JS 裸 key、註解、undefined、十六進位', () => {
    assert.equal(compact('const x = { a: 1, /* c */ "b": undefined, c: 0xff, }; // end', 'js'), '{"a":1,"b":null,"c":255}');
  });

  test('變數與函式呼叫直接報錯', () => {
    assert.throws(() => parseLiteral("['a' => $b]", 'php'), /不支援變數/);
    assert.throws(() => parseLiteral('{ a: foo() }', 'js'), /不支援變數/);
    assert.throws(() => parseLiteral('{ ...a }', 'js'), /展開運算子/);
  });

  test('方言偵測', () => {
    assert.equal(detectDialect("['a' => 1]"), 'php');
    assert.equal(detectDialect("x = {'a': None}"), 'python');
    assert.equal(detectDialect('const x = {a: 1}'), 'js');
  });
});
