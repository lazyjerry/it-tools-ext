import * as assert from 'node:assert/strict';

import { parseBcrypt } from '../../src/core/hash/bcrypt';
import { decodeInput, formatBytes } from '../../src/core/hash/bytes';
import { adler32, crc32b, crc32Bzip2Php, crc32c } from '../../src/core/hash/checksum';
import { buildHashTable, buildHmacTable } from '../../src/core/hash/compat';
import { javaBigIntegerHex, javaStringHashCode, javaToHexStringNoPad } from '../../src/core/hash/langHash';

// 黃金值由 PHP 8.4.23 `hash($algo, $s)` 實跑產生；scripts/verify-php.sh 會對更多輸入重跑比對。
const PHP_GOLDEN: Record<string, Record<string, string>> = {
  hello: {
    md5: '5d41402abc4b2a76b9719d911017c592',
    sha1: 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d',
    sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    'sha512/256': 'e30d87cfa2a75db545eac4d61baf970366a8357c7f72fa95b52d0accb698f13a',
    'sha3-256': '3338be694f50c5f338814986cdf0686453a888b84f424d792af4b9202398f392',
    ripemd160: '108f07b8382412612c048d07d13f814118445acd',
    crc32: '3d653119',
    crc32b: '3610a686',
    crc32c: '9a71bb4c',
    adler32: '062c0215',
  },
  '測試中文': {
    md5: 'aef454d6ddc41a943392ec5bc6a87140',
    sha256: '72a693df97892d5e2a6678e1aba5c6a9e96fc960ec152f7666d7c2cd337c29b8',
    crc32: '3cec4ee1',
    crc32b: '710d606a',
    crc32c: '5dbeb926',
    adler32: '3b7708ce',
  },
  '': {
    md5: 'd41d8cd98f00b204e9800998ecf8427e',
    crc32: '00000000',
    crc32b: '00000000',
    adler32: '00000001',
  },
};

function utf8(text: string): Uint8Array {
  return decodeInput(text, 'text');
}

function valueOf(text: string, id: string): string {
  const table = buildHashTable(utf8(text), { inputMode: 'text', format: 'hex', text });
  const row = table.rows.find((r) => r.id === id);
  assert.ok(row, `找不到 ${id} 列`);
  return row.value;
}

suite('hash 與 PHP hash() 相容', () => {
  for (const [input, expected] of Object.entries(PHP_GOLDEN)) {
    for (const [algo, value] of Object.entries(expected)) {
      test(`${JSON.stringify(input)} 的 ${algo} 與 PHP 相同`, () => {
        assert.equal(valueOf(input, algo), value);
      });
    }
  }

  test("PHP hash('crc32') 與 crc32b 同名不同值，且被標成警告", () => {
    const table = buildHashTable(utf8('hello'), { inputMode: 'text', format: 'hex' });
    const bzip2 = table.rows.find((r) => r.id === 'crc32');
    assert.equal(bzip2?.status, 'warn');
    assert.notEqual(bzip2?.value, table.rows.find((r) => r.id === 'crc32b')?.value);
  });

  test('crc32() 十進位與 PHP 64 位元版相同', () => {
    assert.equal(valueOf('hello', 'crc32-decimal'), '907060870');
  });

  test('HMAC-SHA256 與 PHP hash_hmac 相同', () => {
    const rows = buildHmacTable(utf8('hello'), utf8('key'), { inputMode: 'text', format: 'hex' });
    assert.equal(
      rows.find((r) => r.id === 'hmac-sha256')?.value,
      '9307b3b915efb5171ff14d8cb55fbcc798c6c0ef1456d66ded1a6aa723a58b7b',
    );
  });

  test('Java HMAC 名稱：SHA3 保留連字號', () => {
    const rows = buildHmacTable(utf8('a'), utf8('k'), { inputMode: 'text', format: 'hex' });
    assert.match(rows.find((r) => r.id === 'hmac-sha256')?.java ?? '', /"HmacSHA256"/);
    assert.match(rows.find((r) => r.id === 'hmac-sha3-256')?.java ?? '', /"HmacSHA3-256"/);
  });

  test('PHP 有但本工具算不出來的演算法會被列出', () => {
    const table = buildHashTable(utf8('a'), { inputMode: 'text', format: 'hex' });
    assert.ok(table.unsupportedPhp.includes('tiger192,3'));
    assert.ok(!table.unsupportedPhp.includes('crc32'));
    assert.ok(!table.unsupportedPhp.includes('md5'));
  });
});

suite('校驗和直接呼叫', () => {
  const hex = (bytes: Uint8Array) => formatBytes(bytes, 'hex');
  test('四種 32 位元校驗和', () => {
    const data = utf8('The quick brown fox jumps over the lazy dog');
    assert.equal(hex(crc32b(data)), '414fa339');
    assert.equal(hex(crc32Bzip2Php(data)), '61ee9d45');
    assert.equal(hex(crc32c(data)), '22620404');
    assert.equal(hex(adler32(data)), '5bdc0fda');
  });
});

suite('Java 常見錯誤寫法的變體', () => {
  test('toHexString 未補零：空字串的 md5 含 00／04／09 三個位元組，少 3 個字元', () => {
    // d4 1d 8c d9 8f 00 b2 04 e9 80 09 98 ec f8 42 7e → 00→"0"、04→"4"、09→"9"
    const md5 = decodeInput('d41d8cd98f00b204e9800998ecf8427e', 'hex');
    assert.equal(javaToHexStringNoPad(md5), 'd41d8cd98f0b24e980998ecf8427e');
    assert.equal(valueOf('', 'md5-java-nopad'), 'd41d8cd98f0b24e980998ecf8427e');
  });

  test('BigInteger.toString(16)：首位 0 被吃掉', () => {
    // md5("x15") = 0e39f3f6373d84e769136923b2a7cef5
    assert.equal(javaBigIntegerHex(decodeInput('0e39f3f6373d84e769136923b2a7cef5', 'hex')), 'e39f3f6373d84e769136923b2a7cef5');
    assert.equal(valueOf('x15', 'md5-java-biginteger'), 'e39f3f6373d84e769136923b2a7cef5');
  });

  test('摘要沒有小位元組時變體與標準值相同，狀態為 info 而非 warn', () => {
    const table = buildHashTable(utf8('hello'), { inputMode: 'text', format: 'hex', text: 'hello' });
    assert.equal(table.rows.find((r) => r.id === 'md5-java-nopad')?.status, 'info');
  });

  test('String.hashCode() 已知值與溢位回繞', () => {
    assert.equal(javaStringHashCode('hello'), 99162322);
    assert.equal(javaStringHashCode(''), 0);
    // "polygenelubricants".hashCode() == Integer.MIN_VALUE 是 Java 社群常引用的溢位案例
    assert.equal(javaStringHashCode('polygenelubricants'), -2147483648);
  });
});

suite('輸入解碼與輸出格式', () => {
  test('hex 輸入容忍空白、冒號與 0x 前綴', () => {
    assert.deepEqual(Array.from(decodeInput('0x68 65:6c-6c 6f', 'hex')), Array.from(utf8('hello')));
  });

  test('非法 hex 直接報錯', () => {
    assert.throws(() => decodeInput('abc', 'hex'));
    assert.throws(() => decodeInput('zz', 'hex'));
  });

  test('base64 與 base64url 都能解', () => {
    assert.deepEqual(Array.from(decodeInput('aGVsbG8=', 'base64')), Array.from(utf8('hello')));
    assert.deepEqual(Array.from(decodeInput('-_8', 'base64')), [0xfb, 0xff]);
  });

  test('四種輸出格式', () => {
    const bytes = decodeInput('5d41402abc4b2a76b9719d911017c592', 'hex');
    assert.equal(formatBytes(bytes, 'HEX'), '5D41402ABC4B2A76B9719D911017C592');
    assert.equal(formatBytes(bytes, 'base64'), 'XUFAKrxLKna5cZ2REBfFkg==');
    assert.equal(formatBytes(bytes, 'base64url'), 'XUFAKrxLKna5cZ2REBfFkg');
  });
});

suite('bcrypt 結構解析', () => {
  const sample = '$2y$10$abcdefghijklmnopqrstuuO5Vu1ByJ2UHG8Wv1dP1Hl0t6iL5hW5u';

  test('拆出版本、cost、salt、hash', () => {
    const info = parseBcrypt(sample);
    assert.equal(info.version, '$2y$');
    assert.equal(info.cost, 10);
    assert.equal(info.iterations, 1024);
    assert.equal(info.salt.length, 22);
    assert.equal(info.hash.length, 31);
  });

  test('$2y$ 附上 Java 相容性說明', () => {
    assert.match(parseBcrypt(sample).notes[0], /\$2a\$/);
  });

  test('長度不對直接報錯', () => {
    assert.throws(() => parseBcrypt('$2y$10$short'));
  });
});
