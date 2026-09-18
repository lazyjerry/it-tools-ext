import * as assert from 'node:assert/strict';

import { JsonSyntaxError, parseJson, parseJsonDocument, stringifyNode } from '../../src/core/json/ast';
import { jsonStats, queryPath, searchJson, unescapeJson } from '../../src/core/json/tools';

const pretty = (text: string, sortKeys = false) =>
  stringifyNode(parseJsonDocument(text).node, { indent: '  ', sortKeys });

suite('JSON 解析與輸出', () => {
  test('大整數與小數原樣保留，不經過 Number()', () => {
    assert.equal(stringifyNode(parseJson('{"id":12345678901234567890,"f":1.10}'), { indent: '' }), '{"id":12345678901234567890,"f":1.10}');
  });

  test('美化與遞迴排序 key', () => {
    assert.equal(pretty('{"b":1,"a":{"d":2,"c":[]}}', true), '{\n  "a": {\n    "c": [],\n    "d": 2\n  },\n  "b": 1\n}');
  });

  test('壓縮', () => {
    assert.equal(stringifyNode(parseJson('{ "a" : [ 1 , 2 ] }'), { indent: '' }), '{"a":[1,2]}');
  });

  test('寬鬆模式容忍註解與尾逗號，嚴格模式拒絕', () => {
    const jsonc = '{\n  // 註解\n  "a": 1, /* 區塊 */\n  "b": [1, 2,],\n}';
    assert.equal(stringifyNode(parseJson(jsonc, { lenient: true }), { indent: '' }), '{"a":1,"b":[1,2]}');
    assert.throws(() => parseJson(jsonc), JsonSyntaxError);
  });

  test('錯誤回報行與欄', () => {
    try {
      parseJson('{\n  "a": 1\n  "b": 2\n}');
      assert.fail('應該要丟錯');
    } catch (error) {
      assert.ok(error instanceof JsonSyntaxError);
      assert.equal(error.line, 3);
      assert.equal(error.column, 3);
    }
  });

  test('字串內未跳脫換行報錯', () => {
    assert.throws(() => parseJson('"a\nb"'), /控制字元/);
  });

  test('JSON Lines 包成陣列', () => {
    const result = parseJsonDocument('{"a":1}\n{"a":2}\n');
    assert.equal(result.mode, 'jsonl');
    assert.equal(stringifyNode(result.node, { indent: '' }), '[{"a":1},{"a":2}]');
  });

  test('BOM 開頭可解析', () => {
    assert.equal(parseJson('\uFEFF[1]').type, 'array');
  });
});

suite('JSON 搜尋', () => {
  const doc = '{"user":{"name":"Jerry","tags":["a","b"]},"list":[{"name":"x"},{"name":"y"}]}';
  const root = parseJson(doc);

  test('key 搜尋回傳路徑與 key 在原文的位置', () => {
    const hits = searchJson(root, 'name', { mode: 'key' });
    assert.deepEqual(hits.map((h) => h.path), ['$.user.name', '$.list[0].name', '$.list[1].name']);
    assert.equal(doc.slice(hits[0].offset, hits[0].offset + 6), '"name"');
  });

  test('值搜尋不分大小寫、正則', () => {
    assert.deepEqual(searchJson(root, 'jerry', { mode: 'value' }).map((h) => h.path), ['$.user.name']);
    assert.deepEqual(searchJson(root, '^[xy]$', { mode: 'value', regex: true }).map((h) => h.path), ['$.list[0].name', '$.list[1].name']);
  });

  test('路徑查詢：索引、萬用字元、遞迴下降、省略 $', () => {
    assert.deepEqual(queryPath(root, '$.user.tags[1]').map((h) => h.path), ['$.user.tags[1]']);
    assert.deepEqual(queryPath(root, 'list[*].name').map((h) => h.path), ['$.list[0].name', '$.list[1].name']);
    assert.equal(queryPath(root, '$..name').length, 3);
  });

  test('非識別字 key 用括號路徑', () => {
    const hits = searchJson(parseJson('{"a b":{"c":1}}'), 'c', { mode: 'key' });
    assert.equal(hits[0].path, '$["a b"].c');
    assert.equal(queryPath(parseJson('{"a b":{"c":1}}'), '$["a b"].c').length, 1);
  });

  test('路徑語法錯誤直接報錯', () => {
    assert.throws(() => queryPath(root, '$.a[b'), /路徑語法錯誤/);
  });
});

suite('JSON 統計', () => {
  test('節點、深度、型別、key 頻率', () => {
    const stats = jsonStats(parseJson('{"a":[1,{"a":null}],"b":"hello world"}'));
    assert.equal(stats.totalNodes, 6);
    assert.equal(stats.maxDepth, 3);
    assert.equal(stats.types.null, 1);
    assert.deepEqual(stats.topKeys[0], ['a', 2]);
    assert.equal(stats.strings.latinWords, 2);
  });

  test('CJK 字逐字計數', () => {
    const stats = jsonStats(parseJson('["排班 排班 test"]'));
    assert.equal(stats.strings.cjkCharacters, 4);
    assert.deepEqual(stats.strings.topWords.slice(0, 2), [['排', 2], ['班', 2]]);
  });
});

suite('轉義字串還原', () => {
  test('有外層引號', () => {
    assert.equal(stringifyNode(unescapeJson('"{\\"a\\":1}"'), { indent: '' }), '{"a":1}');
  });

  test('沒有外層引號', () => {
    assert.equal(stringifyNode(unescapeJson('{\\"a\\":[1,2]}'), { indent: '' }), '{"a":[1,2]}');
  });

  test('包兩層', () => {
    assert.equal(stringifyNode(unescapeJson(JSON.stringify(JSON.stringify({ a: 1 }))), { indent: '' }), '{"a":1}');
  });

  test('輸入本來就是 JSON 時原樣回傳', () => {
    assert.equal(stringifyNode(unescapeJson('{\n  "a": [1, 2]\n}'), { indent: '' }), '{"a":[1,2]}');
    assert.equal(stringifyNode(unescapeJson('{"a":1}'), { indent: '' }), '{"a":1}');
  });
});
