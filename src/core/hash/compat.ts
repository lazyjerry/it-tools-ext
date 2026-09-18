// Hash 對照表：每列附相容性狀態與可複製的 PHP／Java 等價程式碼。
import { formatBytes } from './bytes';
import type { InputMode, OutputFormat } from './bytes';
import { adler32, crc32b, crc32bValue, crc32Bzip2Php, crc32c } from './checksum';
import { availableDigests, digest, hmac, PHP_HASH_ALGOS } from './digest';
import type { DigestDef } from './digest';
import { javaBigIntegerHex, javaStringHashCode, javaToHexStringNoPad, toSigned32 } from './langHash';

export type RowStatus = 'ok' | 'warn' | 'info';

export interface HashRow {
  id: string;
  group: 'digest' | 'checksum' | 'variant';
  label: string;
  value: string;
  status: RowStatus;
  note?: string;
  php?: string;
  java?: string;
}

export interface HashTable {
  rows: HashRow[];
  /** PHP hash_algos() 有、本工具（此環境）算不出來的演算法。 */
  unsupportedPhp: string[];
  inputBytes: number;
}

export interface HashOptions {
  inputMode: InputMode;
  format: OutputFormat;
  /** 原始輸入文字；text 模式下 Java String.hashCode() 需要它（以 UTF-16 計算，不是位元組）。 */
  text?: string;
}

const PHP_ONLY_HEX_FN: Record<string, string> = { md5: 'md5', sha1: 'sha1' };

function javaBytesExpr(mode: InputMode): string {
  return mode === 'text' ? 's.getBytes(StandardCharsets.UTF_8)' : 'bytes';
}

function phpFormat(rawExpr: string, hexExpr: string, format: OutputFormat): string {
  switch (format) {
    case 'hex':
      return hexExpr;
    case 'HEX':
      return `strtoupper(${hexExpr})`;
    case 'base64':
      return `base64_encode(${rawExpr})`;
    case 'base64url':
      return `rtrim(strtr(base64_encode(${rawExpr}), '+/', '-_'), '=')`;
  }
}

function javaFormat(bytesExpr: string, format: OutputFormat): string {
  switch (format) {
    case 'hex':
      return `HexFormat.of().formatHex(${bytesExpr})`;
    case 'HEX':
      return `HexFormat.of().withUpperCase().formatHex(${bytesExpr})`;
    case 'base64':
      return `Base64.getEncoder().encodeToString(${bytesExpr})`;
    case 'base64url':
      return `Base64.getUrlEncoder().withoutPadding().encodeToString(${bytesExpr})`;
  }
}

function digestRow(def: DigestDef, data: Uint8Array, options: HashOptions): HashRow {
  const value = formatBytes(digest(def, data), options.format);
  const row: HashRow = { id: def.id, group: 'digest', label: def.id, value, status: 'ok' };
  if (def.php) {
    const hexFn = PHP_ONLY_HEX_FN[def.php];
    const hexExpr = hexFn ? `${hexFn}($s)` : `hash('${def.php}', $s)`;
    row.php = phpFormat(`hash('${def.php}', $s, true)`, hexExpr, options.format);
  } else {
    row.status = 'info';
    row.note = 'PHP hash() 沒有這個演算法';
  }
  if (def.java) {
    row.java = javaFormat(`MessageDigest.getInstance("${def.java}").digest(${javaBytesExpr(options.inputMode)})`, options.format);
  } else {
    row.note = [row.note, 'JDK 沒有內建，需 BouncyCastle 等第三方 provider'].filter(Boolean).join('；');
  }
  if (def.id.startsWith('sha3-')) {
    row.note = 'NIST SHA-3（padding 0x06）。以太坊等稱的 keccak256 是 padding 0x01 的原始 Keccak，結果不同';
    row.status = 'info';
  }
  return row;
}

function checksumRows(data: Uint8Array, options: HashOptions): HashRow[] {
  const f = options.format;
  const bytes = javaBytesExpr(options.inputMode);
  const javaChecksum = (cls: string) =>
    `${cls} c = new ${cls}(); c.update(${bytes}); ${javaFormat('ByteBuffer.allocate(4).putInt((int) c.getValue()).array()', f)}`;
  const unsigned = crc32bValue(data);
  const signed = toSigned32(unsigned);

  const rows: HashRow[] = [
    {
      id: 'crc32b',
      group: 'checksum',
      label: 'crc32b',
      value: formatBytes(crc32b(data), f),
      status: 'ok',
      note: '標準 CRC-32（zlib）= PHP crc32() = hash(\'crc32b\') = Java java.util.zip.CRC32',
      php: phpFormat(`hash('crc32b', $s, true)`, `hash('crc32b', $s)`, f),
      java: javaChecksum('CRC32'),
    },
    {
      id: 'crc32',
      group: 'checksum',
      label: "crc32（PHP hash('crc32')）",
      value: formatBytes(crc32Bzip2Php(data), f),
      status: 'warn',
      note: "同名不同值：PHP hash('crc32') 是 CRC-32/BZIP2 並以小端序輸出，與 crc32()／hash('crc32b')／Java CRC32 都不同。JDK 沒有對應實作",
      php: phpFormat(`hash('crc32', $s, true)`, `hash('crc32', $s)`, f),
    },
    {
      id: 'crc32c',
      group: 'checksum',
      label: 'crc32c',
      value: formatBytes(crc32c(data), f),
      status: 'ok',
      note: 'Castagnoli 多項式；Java 9+ 才有 java.util.zip.CRC32C',
      php: phpFormat(`hash('crc32c', $s, true)`, `hash('crc32c', $s)`, f),
      java: javaChecksum('CRC32C'),
    },
    {
      id: 'adler32',
      group: 'checksum',
      label: 'adler32',
      value: formatBytes(adler32(data), f),
      status: 'ok',
      php: phpFormat(`hash('adler32', $s, true)`, `hash('adler32', $s)`, f),
      java: javaChecksum('Adler32'),
    },
    {
      id: 'crc32-decimal',
      group: 'checksum',
      label: 'crc32() 十進位',
      value: String(unsigned),
      status: signed === unsigned ? 'ok' : 'warn',
      note:
        signed === unsigned
          ? '64 位元 PHP crc32() 與 Java CRC32.getValue() 相同'
          : `32 位元 PHP 的 crc32() 會回傳負數 ${signed}，要用 sprintf('%u', crc32($s)) 取無號值；Java CRC32.getValue() 回 long 無號值`,
      php: `sprintf('%u', crc32($s))`,
      java: `CRC32 c = new CRC32(); c.update(${bytes}); c.getValue()`,
    },
  ];
  return rows;
}

function javaVariantRows(data: Uint8Array, options: HashOptions): HashRow[] {
  const md5 = availableDigests().find((d) => d.id === 'md5');
  if (!md5) {
    return [];
  }
  const raw = digest(md5, data);
  const standard = formatBytes(raw, 'hex');
  const bytes = javaBytesExpr(options.inputMode);
  const noPad = javaToHexStringNoPad(raw);
  const bigInt = javaBigIntegerHex(raw);
  const rows: HashRow[] = [
    {
      id: 'md5-java-nopad',
      group: 'variant',
      label: 'md5（Java toHexString 未補零）',
      value: noPad,
      status: noPad === standard ? 'info' : 'warn',
      note:
        noPad === standard
          ? '這次輸入剛好沒有 < 0x10 的位元組所以相同；換個輸入就會少字元，與 PHP md5() 對不上'
          : `比標準值少 ${standard.length - noPad.length} 個字元：位元組 < 0x10 時 Integer.toHexString 只輸出一位。改用 HexFormat 或 String.format("%02x")`,
      java: `StringBuilder sb = new StringBuilder(); for (byte b : MessageDigest.getInstance("MD5").digest(${bytes})) sb.append(Integer.toHexString(b & 0xff)); // ← 錯誤寫法`,
    },
    {
      id: 'md5-java-biginteger',
      group: 'variant',
      label: 'md5（Java BigInteger.toString(16)）',
      value: bigInt,
      status: bigInt === standard ? 'info' : 'warn',
      note:
        bigInt === standard
          ? '這次輸入的摘要首位不是 0 所以相同；首位為 0 時會少一位'
          : '首位 0 被吃掉：BigInteger 當數值轉字串。要補回用 String.format("%032x", new BigInteger(1, d))',
      java: `new BigInteger(1, MessageDigest.getInstance("MD5").digest(${bytes})).toString(16) // ← 錯誤寫法`,
    },
  ];
  if (options.inputMode === 'text' && options.text !== undefined) {
    rows.push({
      id: 'java-hashcode',
      group: 'variant',
      label: 'Java String.hashCode()',
      value: String(javaStringHashCode(options.text)),
      status: 'info',
      note: '以 UTF-16 code unit 計算、回傳 32 位元有號整數，不是加密雜湊；PHP 沒有內建',
      php: 'function javaHashCode(string $s): int { $h = 0; foreach (mb_str_split($s) as $c) { foreach (unpack(\'n*\', mb_convert_encoding($c, \'UTF-16BE\', \'UTF-8\')) as $u) { $h = (31 * $h + $u) & 0xFFFFFFFF; } } return $h > 0x7FFFFFFF ? $h - 0x100000000 : $h; }',
      java: 's.hashCode()',
    });
  }
  return rows;
}

export function buildHashTable(data: Uint8Array, options: HashOptions): HashTable {
  const digests = availableDigests();
  const rows = [
    ...digests.map((def) => digestRow(def, data, options)),
    ...checksumRows(data, options),
    ...javaVariantRows(data, options),
  ];
  const supported = new Set([...digests.map((d) => d.php).filter(Boolean), 'crc32', 'crc32b', 'crc32c', 'adler32']);
  return {
    rows,
    unsupportedPhp: PHP_HASH_ALGOS.filter((algo) => !supported.has(algo)),
    inputBytes: data.length,
  };
}

export function buildHmacTable(data: Uint8Array, key: Uint8Array, options: HashOptions): HashRow[] {
  const bytes = javaBytesExpr(options.inputMode);
  return availableDigests()
    .filter((def) => def.php !== null || def.java !== null)
    .map((def) => {
      // Java 的 HMAC 名稱：SHA-256 → HmacSHA256，但 SHA3-256 → HmacSHA3-256（保留連字號）
      const javaMac = def.java ? `Hmac${def.java.startsWith('SHA3') ? def.java : def.java.replace('-', '')}` : null;
      const row: HashRow = {
        id: `hmac-${def.id}`,
        group: 'digest',
        label: `hmac-${def.id}`,
        value: formatBytes(hmac(def, key, data), options.format),
        status: 'ok',
      };
      if (def.php) {
        row.php = phpFormat(`hash_hmac('${def.php}', $s, $key, true)`, `hash_hmac('${def.php}', $s, $key)`, options.format);
      }
      if (javaMac) {
        row.java = `Mac mac = Mac.getInstance("${javaMac}"); mac.init(new SecretKeySpec(key, "${javaMac}")); ${javaFormat(`mac.doFinal(${bytes})`, options.format)}`;
      }
      return row;
    });
}

const STATUS_MARK: Record<RowStatus, string> = { ok: ' ', warn: '⚠', info: 'ℹ' };

/** 命令版輸出：純文字對照表，開在新編輯器。 */
export function formatHashReport(table: HashTable, title: string): string {
  const width = Math.max(...table.rows.map((r) => r.label.length)) + 2;
  const lines = [`# ${title}`, `# 輸入位元組數：${table.inputBytes}`, ''];
  for (const row of table.rows) {
    lines.push(`${STATUS_MARK[row.status]} ${row.label.padEnd(width)}${row.value}`);
    if (row.note) {
      lines.push(`    ${row.note}`);
    }
    if (row.php) {
      lines.push(`    PHP : ${row.php}`);
    }
    if (row.java) {
      lines.push(`    Java: ${row.java}`);
    }
  }
  lines.push('', `# PHP hash_algos() 有、本工具未支援：${table.unsupportedPhp.join(', ')}`);
  return lines.join('\n') + '\n';
}
