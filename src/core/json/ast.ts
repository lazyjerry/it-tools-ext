// 帶位置的 JSON 解析器。不用 JSON.parse：它會讓大整數失真、沒有節點位置、錯誤訊息格式隨 V8 版本變動。

export type JsonNode =
  | { type: 'object'; start: number; entries: JsonEntry[] }
  | { type: 'array'; start: number; items: JsonNode[] }
  | { type: 'string'; start: number; value: string }
  | { type: 'number'; start: number; raw: string }
  | { type: 'boolean'; start: number; value: boolean }
  | { type: 'null'; start: number };

export interface JsonEntry {
  key: string;
  keyStart: number;
  value: JsonNode;
}

export class JsonSyntaxError extends Error {
  constructor(
    message: string,
    readonly offset: number,
    readonly line: number,
    readonly column: number,
  ) {
    super(`第 ${line} 行第 ${column} 欄：${message}`);
  }
}

export interface ParseOptions {
  /** 容忍 // 與 /* *\/ 註解、陣列與物件的尾逗號（JSONC）。 */
  lenient?: boolean;
}

export function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

const NUMBER_RE = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

class Parser {
  private pos = 0;

  constructor(
    private readonly text: string,
    private readonly lenient: boolean,
  ) {
    if (text.charCodeAt(0) === 0xfeff) {
      this.pos = 1;
    }
  }

  parseDocument(): JsonNode {
    const node = this.parseValue();
    this.skipTrivia();
    if (this.pos < this.text.length) {
      this.fail('值結束後還有多餘內容');
    }
    return node;
  }

  fail(message: string, offset = this.pos): never {
    const { line, column } = offsetToLineColumn(this.text, offset);
    throw new JsonSyntaxError(message, offset, line, column);
  }

  private describe(): string {
    if (this.pos >= this.text.length) {
      return '檔案結尾';
    }
    return `「${this.text[this.pos]}」`;
  }

  private skipTrivia(): void {
    const text = this.text;
    while (this.pos < text.length) {
      const c = text[this.pos];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
        this.pos += 1;
      } else if (c === '/' && this.lenient && text[this.pos + 1] === '/') {
        const end = text.indexOf('\n', this.pos);
        this.pos = end === -1 ? text.length : end + 1;
      } else if (c === '/' && this.lenient && text[this.pos + 1] === '*') {
        const end = text.indexOf('*/', this.pos + 2);
        if (end === -1) {
          this.fail('區塊註解沒有結尾 */');
        }
        this.pos = end + 2;
      } else {
        return;
      }
    }
  }

  private parseValue(): JsonNode {
    this.skipTrivia();
    const start = this.pos;
    const c = this.text[this.pos];
    switch (c) {
      case '{':
        return this.parseObject();
      case '[':
        return this.parseArray();
      case '"':
        return { type: 'string', start, value: this.parseString() };
      case 't':
      case 'f':
      case 'n':
        return this.parseKeyword(start);
      default:
        if (c === '-' || (c >= '0' && c <= '9')) {
          NUMBER_RE.lastIndex = this.pos;
          const match = NUMBER_RE.exec(this.text);
          if (!match) {
            this.fail('數字格式錯誤');
          }
          this.pos += match[0].length;
          return { type: 'number', start, raw: match[0] };
        }
        this.fail(`預期一個值，但遇到${this.describe()}`);
    }
  }

  private parseKeyword(start: number): JsonNode {
    for (const [word, node] of [
      ['true', { type: 'boolean', start, value: true }],
      ['false', { type: 'boolean', start, value: false }],
      ['null', { type: 'null', start }],
    ] as const) {
      if (this.text.startsWith(word, this.pos)) {
        this.pos += word.length;
        return node;
      }
    }
    this.fail(`預期一個值，但遇到${this.describe()}`);
  }

  private parseString(): string {
    const text = this.text;
    this.pos += 1;
    let out = '';
    let chunkStart = this.pos;
    while (this.pos < text.length) {
      const code = text.charCodeAt(this.pos);
      if (code === 0x22) {
        out += text.slice(chunkStart, this.pos);
        this.pos += 1;
        return out;
      }
      if (code === 0x5c) {
        out += text.slice(chunkStart, this.pos);
        out += this.parseEscape();
        chunkStart = this.pos;
        continue;
      }
      if (code < 0x20) {
        this.fail('字串內不可有未跳脫的控制字元（換行要寫成 \\n）');
      }
      this.pos += 1;
    }
    this.fail('字串沒有結尾的雙引號');
  }

  private parseEscape(): string {
    const c = this.text[this.pos + 1];
    this.pos += 2;
    switch (c) {
      case '"':
      case '\\':
      case '/':
        return c;
      case 'b':
        return '\b';
      case 'f':
        return '\f';
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case 'u': {
        const hex = this.text.slice(this.pos, this.pos + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          this.fail('\\u 後面要接 4 位十六進位數字', this.pos - 2);
        }
        this.pos += 4;
        return String.fromCharCode(parseInt(hex, 16));
      }
      default:
        this.fail(`不合法的跳脫字元 \\${c ?? ''}`, this.pos - 2);
    }
  }

  private parseObject(): JsonNode {
    const start = this.pos;
    this.pos += 1;
    const entries: JsonEntry[] = [];
    this.skipTrivia();
    if (this.text[this.pos] === '}') {
      this.pos += 1;
      return { type: 'object', start, entries };
    }
    for (;;) {
      this.skipTrivia();
      if (this.text[this.pos] !== '"') {
        this.fail(`物件的 key 必須是雙引號字串，但遇到${this.describe()}`);
      }
      const keyStart = this.pos;
      const key = this.parseString();
      this.skipTrivia();
      if (this.text[this.pos] !== ':') {
        this.fail(`key 後面預期「:」，但遇到${this.describe()}`);
      }
      this.pos += 1;
      entries.push({ key, keyStart, value: this.parseValue() });
      this.skipTrivia();
      const c = this.text[this.pos];
      if (c === '}') {
        this.pos += 1;
        return { type: 'object', start, entries };
      }
      if (c !== ',') {
        this.fail(`物件成員之間預期「,」或「}」，但遇到${this.describe()}`);
      }
      this.pos += 1;
      this.skipTrivia();
      if (this.text[this.pos] === '}') {
        if (!this.lenient) {
          this.fail('物件最後一個成員後面不可有逗號');
        }
        this.pos += 1;
        return { type: 'object', start, entries };
      }
    }
  }

  private parseArray(): JsonNode {
    const start = this.pos;
    this.pos += 1;
    const items: JsonNode[] = [];
    this.skipTrivia();
    if (this.text[this.pos] === ']') {
      this.pos += 1;
      return { type: 'array', start, items };
    }
    for (;;) {
      items.push(this.parseValue());
      this.skipTrivia();
      const c = this.text[this.pos];
      if (c === ']') {
        this.pos += 1;
        return { type: 'array', start, items };
      }
      if (c !== ',') {
        this.fail(`陣列元素之間預期「,」或「]」，但遇到${this.describe()}`);
      }
      this.pos += 1;
      this.skipTrivia();
      if (this.text[this.pos] === ']') {
        if (!this.lenient) {
          this.fail('陣列最後一個元素後面不可有逗號');
        }
        this.pos += 1;
        return { type: 'array', start, items };
      }
    }
  }
}

export function parseJson(text: string, options: ParseOptions = {}): JsonNode {
  return new Parser(text, options.lenient ?? false).parseDocument();
}

/**
 * 寬鬆解析整份文件：先當 JSONC；失敗且每個非空行都是獨立 JSON 時，當 JSON Lines 包成陣列。
 * JSON Lines 的節點位置是以整份文字計算的絕對位置。
 */
export function parseJsonDocument(text: string): { node: JsonNode; mode: 'json' | 'jsonl' } {
  try {
    return { node: parseJson(text, { lenient: true }), mode: 'json' };
  } catch (error) {
    const lines = text.split('\n');
    if (lines.filter((l) => l.trim() !== '').length < 2) {
      throw error;
    }
    const items: JsonNode[] = [];
    let offset = 0;
    try {
      for (const line of lines) {
        if (line.trim() !== '') {
          items.push(shiftOffsets(parseJson(line, { lenient: true }), offset));
        }
        offset += line.length + 1;
      }
    } catch {
      throw error;
    }
    return { node: { type: 'array', start: 0, items }, mode: 'jsonl' };
  }
}

function shiftOffsets(node: JsonNode, delta: number): JsonNode {
  switch (node.type) {
    case 'object':
      return {
        ...node,
        start: node.start + delta,
        entries: node.entries.map((e) => ({ ...e, keyStart: e.keyStart + delta, value: shiftOffsets(e.value, delta) })),
      };
    case 'array':
      return { ...node, start: node.start + delta, items: node.items.map((i) => shiftOffsets(i, delta)) };
    default:
      return { ...node, start: node.start + delta };
  }
}

// ── 輸出 ──

export type Indent = '2' | '4' | 'tab';

export function indentUnit(indent: Indent): string {
  return indent === 'tab' ? '\t' : ' '.repeat(Number(indent));
}

export interface StringifyOptions {
  /** 空字串代表壓縮成一行。 */
  indent: string;
  sortKeys?: boolean;
}

export function stringifyNode(node: JsonNode, options: StringifyOptions, depth = 0): string {
  const { indent } = options;
  const pad = indent ? '\n' + indent.repeat(depth + 1) : '';
  const close = indent ? '\n' + indent.repeat(depth) : '';
  const sep = indent ? ': ' : ':';
  switch (node.type) {
    case 'object': {
      if (node.entries.length === 0) {
        return '{}';
      }
      const entries = options.sortKeys ? [...node.entries].sort((a, b) => compareKeys(a.key, b.key)) : node.entries;
      const body = entries.map((e) => `${pad}${JSON.stringify(e.key)}${sep}${stringifyNode(e.value, options, depth + 1)}`);
      return `{${body.join(',')}${close}}`;
    }
    case 'array': {
      if (node.items.length === 0) {
        return '[]';
      }
      const body = node.items.map((item) => `${pad}${stringifyNode(item, options, depth + 1)}`);
      return `[${body.join(',')}${close}]`;
    }
    case 'string':
      return JSON.stringify(node.value);
    case 'number':
      return node.raw;
    case 'boolean':
      return String(node.value);
    case 'null':
      return 'null';
  }
}

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 轉成一般 JS 值；數字會經過 Number()，大整數可能失真，只給不在意精度的地方用。 */
export function toValue(node: JsonNode): unknown {
  switch (node.type) {
    case 'object':
      return Object.fromEntries(node.entries.map((e) => [e.key, toValue(e.value)]));
    case 'array':
      return node.items.map(toValue);
    case 'string':
    case 'boolean':
      return node.value;
    case 'number':
      return Number(node.raw);
    case 'null':
      return null;
  }
}

/** 把一般 JS 值（例如其他格式解析出來的結果）包成 AST，位置一律為 0。 */
export function fromValue(value: unknown): JsonNode {
  if (value === null || value === undefined) {
    return { type: 'null', start: 0 };
  }
  if (typeof value === 'boolean') {
    return { type: 'boolean', start: 0, value };
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return { type: 'number', start: 0, raw: String(value) };
  }
  if (typeof value === 'string') {
    return { type: 'string', start: 0, value };
  }
  if (Array.isArray(value)) {
    return { type: 'array', start: 0, items: value.map(fromValue) };
  }
  return {
    type: 'object',
    start: 0,
    entries: Object.entries(value as Record<string, unknown>).map(([key, v]) => ({ key, keyStart: 0, value: fromValue(v) })),
  };
}
