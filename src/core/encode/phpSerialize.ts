// PHP serialize()／unserialize() 與 JSON 互轉。字串長度是 UTF-8 位元組數，所以在 Buffer 上解析。
import { phpArrayToNode } from '../convert/fromLiteral';
import type { JsonEntry, JsonNode } from '../json/ast';

class Reader {
  pos = 0;

  constructor(private readonly buf: Buffer) {}

  fail(message: string): never {
    throw new Error(`位元組位置 ${this.pos}：${message}`);
  }

  expect(text: string): void {
    if (this.buf.toString('latin1', this.pos, this.pos + text.length) !== text) {
      this.fail(`預期「${text}」`);
    }
    this.pos += text.length;
  }

  readUntil(terminator: string): string {
    const end = this.buf.indexOf(terminator, this.pos, 'latin1');
    if (end === -1) {
      this.fail(`找不到結尾「${terminator}」`);
    }
    const text = this.buf.toString('latin1', this.pos, end);
    this.pos = end + terminator.length;
    return text;
  }

  readLength(terminator: string): number {
    const text = this.readUntil(terminator);
    if (!/^\d+$/.test(text)) {
      this.fail(`長度欄位不是整數：${text}`);
    }
    return Number(text);
  }

  readQuoted(length: number): string {
    this.expect('"');
    if (this.pos + length > this.buf.length) {
      this.fail('字串長度超過資料結尾（長度以 UTF-8 位元組計算，常見於編碼被轉過的資料）');
    }
    const text = this.buf.toString('utf8', this.pos, this.pos + length);
    this.pos += length;
    this.expect('"');
    return text;
  }

  peek(): string {
    return this.buf.toString('latin1', this.pos, this.pos + 1);
  }
}

/** 私有與保護屬性名稱帶 \0 前綴（\0Class\0name、\0*\0name），轉成可讀的名稱。 */
function propertyName(raw: string): string {
  const match = /^\0([^\0]+)\0(.*)$/s.exec(raw);
  return match ? match[2] : raw;
}

function readValue(r: Reader): JsonNode {
  const start = r.pos;
  const type = r.peek();
  r.pos += 1;
  switch (type) {
    case 'N':
      r.expect(';');
      return { type: 'null', start };
    case 'b': {
      r.expect(':');
      const v = r.readUntil(';');
      if (v !== '0' && v !== '1') {
        r.fail(`布林值只能是 0 或 1：${v}`);
      }
      return { type: 'boolean', start, value: v === '1' };
    }
    case 'i': {
      r.expect(':');
      const v = r.readUntil(';');
      if (!/^-?\d+$/.test(v)) {
        r.fail(`整數格式錯誤：${v}`);
      }
      return { type: 'number', start, raw: v };
    }
    case 'd': {
      r.expect(':');
      const v = r.readUntil(';');
      if (/^-?INF$|^NAN$/.test(v)) {
        return { type: 'string', start, value: v };
      }
      const n = Number(v);
      if (!Number.isFinite(n)) {
        r.fail(`浮點數格式錯誤：${v}`);
      }
      return { type: 'number', start, raw: String(n) };
    }
    case 's': {
      r.expect(':');
      const length = r.readLength(':');
      const value = r.readQuoted(length);
      r.expect(';');
      return { type: 'string', start, value };
    }
    case 'E': {
      r.expect(':');
      const length = r.readLength(':');
      const value = r.readQuoted(length);
      r.expect(';');
      return { type: 'string', start, value: value.replace(':', '::') };
    }
    case 'a': {
      r.expect(':');
      const count = r.readLength(':');
      r.expect('{');
      const items = readPairs(r, count).map(({ key, value }) => ({ key, keyStart: value.start, value }));
      r.expect('}');
      return phpArrayToNode(items, start);
    }
    case 'O': {
      r.expect(':');
      const nameLength = r.readLength(':');
      const className = r.readQuoted(nameLength);
      r.expect(':');
      const count = r.readLength(':');
      r.expect('{');
      const entries: JsonEntry[] = [{ key: '__class', keyStart: start, value: { type: 'string', start, value: className } }];
      for (const { key, value } of readPairs(r, count)) {
        entries.push({ key: propertyName(key), keyStart: value.start, value });
      }
      r.expect('}');
      return { type: 'object', start, entries };
    }
    case 'r':
    case 'R':
      r.pos -= 1;
      r.fail('含物件參照（r:／R:），轉成 JSON 會失去參照關係，不支援');
    // eslint-disable-next-line no-fallthrough
    case 'C':
      r.pos -= 1;
      r.fail('含 Serializable 介面的自訂格式（C:），內容由類別自行定義，無法通用解析');
    // eslint-disable-next-line no-fallthrough
    default:
      r.pos -= 1;
      r.fail(`未知的型別標記「${type}」`);
  }
}

function readPairs(r: Reader, count: number): { key: string; value: JsonNode }[] {
  const pairs: { key: string; value: JsonNode }[] = [];
  for (let i = 0; i < count; i += 1) {
    const keyNode = readValue(r);
    if (keyNode.type !== 'number' && keyNode.type !== 'string') {
      r.fail('陣列 key 只能是整數或字串');
    }
    pairs.push({ key: keyNode.type === 'number' ? keyNode.raw : keyNode.value, value: readValue(r) });
  }
  return pairs;
}

export function phpUnserialize(input: string): JsonNode {
  const reader = new Reader(Buffer.from(input.trim(), 'utf8'));
  const node = readValue(reader);
  if (reader.pos !== Buffer.byteLength(input.trim(), 'utf8')) {
    reader.fail('資料結尾後還有多餘內容');
  }
  return node;
}

const INT64_MIN = -9223372036854775808n;
const INT64_MAX = 9223372036854775807n;

function isPhpIntKey(key: string): boolean {
  if (!/^(0|-?[1-9]\d*)$/.test(key)) {
    return false;
  }
  const value = BigInt(key);
  return value >= INT64_MIN && value <= INT64_MAX;
}

/** 與 PHP serialize_precision = -1 相同：最短可往返表示法，指數寫成 1.0E+25。 */
function phpFloat(raw: string): string {
  const text = String(Number(raw));
  const exp = /^(-?[\d.]+)e([+-])(\d+)$/.exec(text);
  if (!exp) {
    return text;
  }
  const mantissa = exp[1].includes('.') ? exp[1] : `${exp[1]}.0`;
  return `${mantissa}E${exp[2]}${exp[3]}`;
}

function serializeString(value: string): string {
  return `s:${Buffer.byteLength(value, 'utf8')}:"${value}";`;
}

export function phpSerialize(node: JsonNode): string {
  switch (node.type) {
    case 'null':
      return 'N;';
    case 'boolean':
      return `b:${node.value ? 1 : 0};`;
    case 'number':
      return isPhpIntKey(node.raw) ? `i:${node.raw};` : `d:${phpFloat(node.raw)};`;
    case 'string':
      return serializeString(node.value);
    case 'array':
      return `a:${node.items.length}:{${node.items.map((item, i) => `i:${i};${phpSerialize(item)}`).join('')}}`;
    case 'object':
      return `a:${node.entries.length}:{${node.entries
        .map((e) => `${isPhpIntKey(e.key) ? `i:${e.key};` : serializeString(e.key)}${phpSerialize(e.value)}`)
        .join('')}}`;
  }
}
