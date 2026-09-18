// PHP array／Python dict／JS object literal → JSON。三者語法夠接近，共用一支寬鬆 parser。
// 只收資料 literal：遇到變數、函式呼叫、展開運算子等直接報錯，不猜。
import type { JsonEntry, JsonNode } from '../json/ast';

export type SourceDialect = 'php' | 'python' | 'js';

type Token =
  | { t: 'punct'; v: string; pos: number }
  | { t: 'str'; v: string; pos: number }
  | { t: 'num'; v: string; pos: number }
  | { t: 'ident'; v: string; pos: number };

export function detectDialect(source: string): SourceDialect {
  if (/=>|\barray\s*\(|^\s*<\?php|\$\w+\s*=/m.test(source)) {
    return 'php';
  }
  if (/\b(True|False|None)\b/.test(source) || /^\s*\w+\s*=\s*[{[(]/m.test(source) && !/\b(const|let|var)\b/.test(source)) {
    return 'python';
  }
  return 'js';
}

function tokenize(src: string, dialect: SourceDialect): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const fail = (message: string): never => {
    throw new Error(`位置 ${i}：${message}`);
  };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (src.startsWith('<?php', i)) {
      i += 5;
      continue;
    }
    if (src.startsWith('?>', i)) {
      i += 2;
      continue;
    }
    if (src.startsWith('//', i) || (c === '#' && dialect !== 'js')) {
      const end = src.indexOf('\n', i);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) {
        fail('區塊註解沒有結尾');
      }
      i = end + 2;
      continue;
    }
    if (src.startsWith('=>', i)) {
      tokens.push({ t: 'punct', v: '=>', pos: i });
      i += 2;
      continue;
    }
    if (src.startsWith('...', i)) {
      fail('不支援展開運算子 ...');
    }
    if ('{}[](),:;='.includes(c)) {
      tokens.push({ t: 'punct', v: c, pos: i });
      i += 1;
      continue;
    }
    // Python 字串前綴 r／u／b
    const prefix = /^([rRuUbB]{1,2})(['"])/.exec(src.slice(i, i + 3));
    if (dialect === 'python' && prefix) {
      const raw = /r/i.test(prefix[1]);
      i += prefix[1].length;
      const [value, next] = readString(src, i, raw ? 'raw' : 'full');
      tokens.push({ t: 'str', v: value, pos: i });
      i = next;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      if (c === '`' && dialect !== 'js') {
        fail('反引號字串只有 JS 支援');
      }
      const mode = dialect === 'php' && c === "'" ? 'php-single' : 'full';
      const [value, next] = readString(src, i, mode);
      if (c === '`' && value.includes('${')) {
        fail('樣板字串內含 ${} 插值，無法靜態轉成 JSON');
      }
      tokens.push({ t: 'str', v: value, pos: i });
      i = next;
      continue;
    }
    const num = /^[+-]?(?:0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][+-]?\d+)?)/.exec(src.slice(i));
    if (num && num[0] !== '' && /\d/.test(num[0])) {
      tokens.push({ t: 'num', v: num[0], pos: i });
      i += num[0].length;
      continue;
    }
    const ident = /^[$\\]?[A-Za-z_\\][\w\\]*/.exec(src.slice(i));
    if (ident) {
      tokens.push({ t: 'ident', v: ident[0], pos: i });
      i += ident[0].length;
      continue;
    }
    fail(`無法辨識的字元「${c}」`);
  }
  return tokens;
}

function readString(src: string, start: number, mode: 'full' | 'php-single' | 'raw'): [string, number] {
  const quote = src[start];
  let i = start + 1;
  let out = '';
  while (i < src.length) {
    const c = src[i];
    if (c === quote) {
      return [out, i + 1];
    }
    if (c === '\\' && i + 1 < src.length) {
      const n = src[i + 1];
      if (mode === 'raw') {
        out += c + n;
        i += 2;
        continue;
      }
      if (mode === 'php-single') {
        out += n === '\\' || n === "'" ? n : c + n;
        i += 2;
        continue;
      }
      i += 2;
      switch (n) {
        case 'n':
          out += '\n';
          break;
        case 't':
          out += '\t';
          break;
        case 'r':
          out += '\r';
          break;
        case '0':
          out += '\0';
          break;
        case 'b':
          out += '\b';
          break;
        case 'f':
          out += '\f';
          break;
        case 'v':
          out += '\v';
          break;
        case 'e':
          out += '\x1b';
          break;
        case 'x': {
          const hex = /^[0-9a-fA-F]{2}/.exec(src.slice(i));
          if (hex) {
            out += String.fromCharCode(parseInt(hex[0], 16));
            i += 2;
          } else {
            out += '\\x';
          }
          break;
        }
        case 'u': {
          const braced = /^\{([0-9a-fA-F]+)\}/.exec(src.slice(i));
          const plain = /^[0-9a-fA-F]{4}/.exec(src.slice(i));
          if (braced) {
            out += String.fromCodePoint(parseInt(braced[1], 16));
            i += braced[0].length;
          } else if (plain) {
            out += String.fromCharCode(parseInt(plain[0], 16));
            i += 4;
          } else {
            out += '\\u';
          }
          break;
        }
        case '\n':
          break;
        default:
          out += n;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  throw new Error(`位置 ${start}：字串沒有結尾的 ${quote}`);
}

function normalizeNumber(raw: string): string {
  let text = raw.replace(/_/g, '').replace(/^\+/, '');
  const negative = text.startsWith('-');
  if (negative) {
    text = text.slice(1);
  }
  let result: string;
  if (/^0[xob]/i.test(text)) {
    result = BigInt(text.toLowerCase()).toString();
  } else {
    if (/^\./.test(text)) {
      text = `0${text}`;
    }
    if (/\.$/.test(text)) {
      text = `${text}0`;
    }
    if (/^0\d/.test(text) && !text.includes('.')) {
      // PHP 的 0755 是八進位
      result = BigInt(`0o${text.slice(1)}`).toString();
    } else {
      result = text;
    }
  }
  return negative ? `-${result}` : result;
}

class LiteralParser {
  private i = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly dialect: SourceDialect,
  ) {}

  parseProgram(): JsonNode {
    // 跳過 `$data =`、`const data =`、`data =`、`return` 這類前綴
    const eq = this.tokens.findIndex((t) => t.t === 'punct' && t.v === '=');
    const firstValue = this.tokens.findIndex((t) => t.t === 'punct' && '{[('.includes(t.v));
    if (eq !== -1 && (firstValue === -1 || eq < firstValue)) {
      this.i = eq + 1;
    }
    if (this.peekIdent('return')) {
      this.i += 1;
    }
    const node = this.parseValue();
    while (this.peekPunct(';')) {
      this.i += 1;
    }
    if (this.i < this.tokens.length) {
      this.fail('值結束後還有多餘內容');
    }
    return node;
  }

  private fail(message: string): never {
    const token = this.tokens[this.i];
    throw new Error(token ? `位置 ${token.pos}（${token.v}）：${message}` : `結尾：${message}`);
  }

  private peekPunct(v: string): boolean {
    const t = this.tokens[this.i];
    return t?.t === 'punct' && t.v === v;
  }

  private peekIdent(v: string): boolean {
    const t = this.tokens[this.i];
    return t?.t === 'ident' && t.v.toLowerCase() === v;
  }

  private expect(v: string): void {
    if (!this.peekPunct(v)) {
      this.fail(`預期「${v}」`);
    }
    this.i += 1;
  }

  private parseValue(): JsonNode {
    const token = this.tokens[this.i];
    if (!token) {
      this.fail('預期一個值');
    }
    const start = token.pos;
    if (token.t === 'str') {
      this.i += 1;
      return { type: 'string', start, value: token.v };
    }
    if (token.t === 'num') {
      this.i += 1;
      return { type: 'number', start, raw: normalizeNumber(token.v) };
    }
    if (token.t === 'punct') {
      switch (token.v) {
        case '{':
          return this.parseBraceObject();
        case '[':
          return this.parseList(']');
        case '(':
          return this.parseParen();
      }
      this.fail('預期一個值');
    }
    return this.parseIdentValue(token.v, start);
  }

  private parseIdentValue(word: string, start: number): JsonNode {
    const lower = word.toLowerCase();
    const caseInsensitive = this.dialect === 'php';
    const is = (w: string) => (caseInsensitive ? lower === w.toLowerCase() : word === w);
    this.i += 1;
    if (is('true') || word === 'True') {
      return { type: 'boolean', start, value: true };
    }
    if (is('false') || word === 'False') {
      return { type: 'boolean', start, value: false };
    }
    if (is('null') || word === 'None' || word === 'undefined') {
      return { type: 'null', start };
    }
    if (lower === 'array' && this.peekPunct('(')) {
      return this.parseList(')', true);
    }
    if (lower === 'new' && this.tokens[this.i]?.t === 'ident' && /stdclass$/i.test(this.tokens[this.i].v)) {
      this.i += 1;
      if (this.peekPunct('(')) {
        this.i += 1;
        this.expect(')');
      }
      return { type: 'object', start, entries: [] };
    }
    this.i -= 1;
    this.fail('不支援變數、常數或函式呼叫，只能轉換純資料 literal');
  }

  private parseParen(): JsonNode {
    const start = this.tokens[this.i].pos;
    // PHP 的 (object) 轉型
    if (this.tokens[this.i + 1]?.t === 'ident' && this.tokens[this.i + 1].v.toLowerCase() === 'object' && this.tokens[this.i + 2]?.v === ')') {
      this.i += 3;
      const inner = this.parseValue();
      if (inner.type === 'array') {
        return { type: 'object', start, entries: inner.items.map((item, idx) => ({ key: String(idx), keyStart: item.start, value: item })) };
      }
      return inner;
    }
    if (this.dialect !== 'python') {
      this.fail('小括號只有 Python tuple 支援');
    }
    return this.parseList(')');
  }

  private parseBraceObject(): JsonNode {
    const start = this.tokens[this.i].pos;
    this.i += 1;
    const entries: JsonEntry[] = [];
    while (!this.peekPunct('}')) {
      const keyToken = this.tokens[this.i];
      if (!keyToken) {
        this.fail('物件沒有結尾的 }');
      }
      let key: string;
      if (keyToken.t === 'str') {
        key = keyToken.v;
      } else if (keyToken.t === 'num') {
        key = normalizeNumber(keyToken.v);
      } else if (keyToken.t === 'ident' && this.dialect === 'js') {
        key = keyToken.v;
      } else if (keyToken.t === 'ident' && ['True', 'False', 'None'].includes(keyToken.v)) {
        key = keyToken.v === 'None' ? 'null' : keyToken.v.toLowerCase();
      } else {
        this.fail('物件的 key 必須是字串或數字');
      }
      this.i += 1;
      this.expect(':');
      setEntry(entries, { key, keyStart: keyToken.pos, value: this.parseValue() });
      if (!this.peekPunct(',')) {
        break;
      }
      this.i += 1;
    }
    this.expect('}');
    return { type: 'object', start, entries };
  }

  /** `[...]`、`array(...)`、Python tuple。元素出現 `=>` 就走 PHP 陣列語意。 */
  private parseList(close: string, phpArray = false): JsonNode {
    const start = this.tokens[this.i].pos;
    this.i += 1;
    const items: { key: string | null; keyStart: number; value: JsonNode }[] = [];
    let keyed = false;
    while (!this.peekPunct(close)) {
      if (this.i >= this.tokens.length) {
        this.fail(`沒有結尾的 ${close}`);
      }
      const first = this.parseValue();
      if (this.peekPunct('=>')) {
        this.i += 1;
        keyed = true;
        if (first.type !== 'string' && first.type !== 'number' && first.type !== 'boolean' && first.type !== 'null') {
          this.fail('PHP 陣列的 key 必須是字串或整數');
        }
        items.push({ key: phpKey(first), keyStart: first.start, value: this.parseValue() });
      } else {
        items.push({ key: null, keyStart: first.start, value: first });
      }
      if (!this.peekPunct(',')) {
        break;
      }
      this.i += 1;
    }
    this.expect(close);
    if (!keyed && !phpArray) {
      return { type: 'array', start, items: items.map((item) => item.value) };
    }
    return phpArrayToNode(items, start);
  }
}

function phpKey(node: JsonNode): string {
  switch (node.type) {
    case 'string':
      // PHP 會把 "5" 這種十進位整數字串 key 轉成整數 5
      return node.value;
    case 'number':
      return node.raw.includes('.') ? String(Math.trunc(Number(node.raw))) : node.raw;
    case 'boolean':
      return node.value ? '1' : '0';
    default:
      return '';
  }
}

function setEntry(entries: JsonEntry[], entry: JsonEntry): void {
  const existing = entries.findIndex((e) => e.key === entry.key);
  if (existing === -1) {
    entries.push(entry);
  } else {
    entries[existing] = { ...entries[existing], value: entry.value };
  }
}

/** 照 PHP 語意：自動 key 接在最大整數 key 之後；key 恰為 0..n-1 依序時 json_encode 輸出陣列。 */
export function phpArrayToNode(items: { key: string | null; keyStart: number; value: JsonNode }[], start: number): JsonNode {
  const entries: JsonEntry[] = [];
  let nextIndex = 0;
  for (const item of items) {
    let key = item.key;
    if (key === null) {
      key = String(nextIndex);
    }
    if (/^(0|-?[1-9]\d*)$/.test(key)) {
      nextIndex = Math.max(nextIndex, Number(key) + 1);
    }
    setEntry(entries, { key, keyStart: item.keyStart, value: item.value });
  }
  if (entries.every((e, idx) => e.key === String(idx))) {
    return { type: 'array', start, items: entries.map((e) => e.value) };
  }
  return { type: 'object', start, entries };
}

export function parseLiteral(source: string, dialect: SourceDialect = detectDialect(source)): JsonNode {
  return new LiteralParser(tokenize(source, dialect), dialect).parseProgram();
}
