import * as assert from 'node:assert/strict';

import { csvToJson, jsonToCsv, parseCsv } from '../../src/core/encode/csv';
import { decodeJwt } from '../../src/core/encode/jwt';
import { phpSerialize, phpUnserialize } from '../../src/core/encode/phpSerialize';
import {
  base64Decode,
  base64Encode,
  phpHtmlEntityDecode,
  phpHtmlentities,
  phpHtmlspecialchars,
  phpRawurlencode,
  phpUrldecode,
  phpUrlencode,
} from '../../src/core/encode/web';
import { parseJson, stringifyNode } from '../../src/core/json/ast';
import { createHmac } from 'node:crypto';

const NUL = String.fromCharCode(0);
const compact = (node: ReturnType<typeof parseJson>) => stringifyNode(node, { indent: '' });

// 黃金值由 PHP 8.4.23 實跑產生。
suite('URL 與 HTML 編碼與 PHP 相同', () => {
  const s = 'a b~c*d/中&"<x>\'é';

  test('urlencode：空白轉 +、~ 也編碼', () => {
    assert.equal(phpUrlencode(s), 'a+b%7Ec%2Ad%2F%E4%B8%AD%26%22%3Cx%3E%27%C3%A9');
  });

  test('rawurlencode：空白轉 %20、保留 ~', () => {
    assert.equal(phpRawurlencode(s), 'a%20b~c%2Ad%2F%E4%B8%AD%26%22%3Cx%3E%27%C3%A9');
  });

  test('urldecode 把 + 還原成空白', () => {
    assert.equal(phpUrldecode('a+b%7Ec%E4%B8%AD'), 'a b~c中');
  });

  test('htmlspecialchars 的單引號是 &#039;', () => {
    assert.equal(phpHtmlspecialchars(s), 'a b~c*d/中&amp;&quot;&lt;x&gt;&#039;é');
  });

  test('htmlentities 轉換 HTML 4.01 命名實體，中文不動', () => {
    assert.equal(phpHtmlentities('café © <b> ™ 中'), 'caf&eacute; &copy; &lt;b&gt; &trade; 中');
  });

  test('html_entity_decode：命名、十進位、十六進位，未知實體原樣保留', () => {
    assert.equal(phpHtmlEntityDecode('&lt;&eacute;&#39;&#x4E2D;&copy;&bogus;'), '<é\'中©&bogus;');
  });
});

suite('Base64', () => {
  test('標準與 URL-safe 往返', () => {
    assert.equal(base64Encode('中文?>'), '5Lit5paHPz4=');
    assert.equal(base64Encode('中文?>', true), '5Lit5paHPz4');
    assert.equal(base64Decode('5Lit5paHPz4'), '中文?>');
  });

  test('解出非 UTF-8 位元組時報錯而不是回傳亂碼', () => {
    assert.throws(() => base64Decode('/w=='), /不是合法 UTF-8/);
  });
});

suite('PHP serialize／unserialize', () => {
  const phpOutput =
    'a:7:{s:1:"a";i:1;s:1:"b";a:3:{i:0;d:1.5;i:1;b:1;i:2;N;}s:3:"中";s:6:"文字";i:5;s:1:"x";s:1:"f";d:1.0E+25;s:1:"g";d:0.1;s:1:"h";d:1;}';

  test('serialize 與 PHP 輸出逐字相同（字串長度是 UTF-8 位元組、數字 key、浮點數格式）', () => {
    const node = parseJson('{"a":1,"b":[1.5,true,null],"中":"文字","5":"x","f":1e25,"g":0.1,"h":1.0}');
    assert.equal(phpSerialize(node), phpOutput);
  });

  test('unserialize 還原成 JSON', () => {
    assert.equal(compact(phpUnserialize(phpOutput)), '{"a":1,"b":[1.5,true,null],"中":"文字","5":"x","f":1e+25,"g":0.1,"h":1}');
  });

  test('物件帶 __class，私有與保護屬性去掉 NUL 前綴', () => {
    const input = `O:1:"P":3:{s:6:"${NUL}P${NUL}sec";i:1;s:6:"${NUL}*${NUL}pro";i:2;s:3:"pub";i:3;}`;
    assert.equal(compact(phpUnserialize(input)), '{"__class":"P","sec":1,"pro":2,"pub":3}');
  });

  test('字串長度與位元組數不符時報錯（常見於資料被轉過編碼）', () => {
    assert.throws(() => phpUnserialize('s:2:"中";'), /預期/);
  });

  test('物件參照不支援', () => {
    assert.throws(() => phpUnserialize('a:2:{i:0;O:8:"stdClass":0:{}i:1;r:2;}'), /參照/);
  });
});

suite('JWT', () => {
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({ sub: '1', exp: 1_000, iat: 500 });
  const signature = createHmac('sha256', 'secret').update(`${header}.${payload}`).digest('base64url');
  const token = `${header}.${payload}.${signature}`;

  test('解出 header、payload 與時間欄位，判斷過期', () => {
    const info = decodeJwt(token, undefined, 2_000_000);
    assert.equal(compact(info.header), '{"alg":"HS256","typ":"JWT"}');
    assert.equal(info.expired, true);
    assert.equal(info.claims.find((c) => c.name === 'exp')?.iso, '1970-01-01T00:16:40.000Z');
    assert.equal(info.verified, null);
  });

  test('HS256 驗簽：對的密鑰通過、錯的失敗', () => {
    assert.equal(decodeJwt(token, 'secret').verified, true);
    assert.equal(decodeJwt(token, 'wrong').verified, false);
  });

  test('接受 Bearer 前綴，段數不對報錯', () => {
    assert.equal(decodeJwt(`Bearer ${token}`).signature, signature);
    assert.throws(() => decodeJwt('a.b'), /三段/);
  });

  test('正常 token 驗簽結果與 notes 不變', () => {
    const info = decodeJwt(token, 'secret', 2_000_000);
    assert.equal(info.verified, true);
    assert.deepEqual(info.notes, []);
    assert.equal(info.signature, signature);
    const hs512 = `${b64({ alg: 'HS512' })}.${payload}`;
    assert.equal(decodeJwt(`${hs512}.${createHmac('sha512', 'k').update(hs512).digest('base64url')}`, 'k').verified, true);
    // alg none 的空簽章仍可解碼
    assert.deepEqual(decodeJwt(`${b64({ alg: 'none' })}.${payload}.`).notes, ['alg 為 none：沒有簽章，任何人都能偽造，伺服器不應接受']);
  });

  test('非正規 base64url 的簽章不算驗證通過', () => {
    // HS256 簽章 43 字元，最後一字只用到高 4 bits；改低 2 bits 的字元 Buffer.from 解出相同位元組
    const last = signature.at(-1) as string;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const sibling = alphabet[alphabet.indexOf(last) ^ 1];
    const variants = [`${signature}!!`, `${signature}=`, `${signature.slice(0, 10)} ${signature.slice(10)}`, `${signature.slice(0, -1)}${sibling}`];
    for (const sig of variants) {
      assert.deepEqual(Buffer.from(sig, 'base64url'), Buffer.from(signature, 'base64url'), `前提：${sig} 解出相同位元組`);
      const info = decodeJwt(`${header}.${payload}.${sig}`, 'secret');
      assert.equal(info.verified, false, sig);
      assert.match(info.notes.join('\n'), /signature 不是正規的 base64url/);
      // 不給密鑰仍然可以解碼
      assert.equal(decodeJwt(`${header}.${payload}.${sig}`).verified, null);
    }
  });

  test('時間值超出 Date 範圍時顯示無效時間，不讓解碼失敗', () => {
    const huge = b64({ exp: 1e300, iat: 8.64e12 + 1, nbf: 1_000 });
    const info = decodeJwt(`${header}.${huge}.${signature}`, undefined, 2_000_000);
    assert.equal(info.claims.find((c) => c.name === 'exp')?.iso, '無效時間');
    assert.equal(info.claims.find((c) => c.name === 'iat')?.iso, '無效時間');
    assert.equal(info.claims.find((c) => c.name === 'nbf')?.iso, '1970-01-01T00:16:40.000Z');
    assert.equal(info.expired, false);
  });
});

suite('CSV', () => {
  test('引號內的逗號、換行與跳脫雙引號', () => {
    assert.deepEqual(parseCsv('a,b\n"x,1","line1\nline2 ""q"""\n'), [
      ['a', 'b'],
      ['x,1', 'line1\nline2 "q"'],
    ]);
  });

  test('自動偵測 Tab 分隔', () => {
    assert.equal(compact(csvToJson('a\tb\n1\t2')), '[{"a":"1","b":"2"}]');
  });

  test('JSON → CSV：欄位取聯集、需要時加引號', () => {
    assert.equal(jsonToCsv(parseJson('[{"a":1,"b":"x,y"},{"c":null}]')), 'a,b,c\n1,"x,y",\n,,\n');
  });

  test('巢狀值報錯', () => {
    assert.throws(() => jsonToCsv(parseJson('[{"a":{"b":1}}]')), /攤平/);
  });
});
