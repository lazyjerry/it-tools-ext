// JSON 搜尋、統計、轉義還原。全部建立在 ast.ts 的節點上，才拿得到每個命中的原始位置。
import { textStats } from '../text/stats';
import type { TextStats } from '../text/stats';
import { parseJson, parseJsonDocument, stringifyNode } from './ast';
import type { JsonNode } from './ast';

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function childPath(parent: string, key: string | number): string {
  if (typeof key === 'number') {
    return `${parent}[${key}]`;
  }
  return IDENT_RE.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

interface Visit {
  path: string;
  node: JsonNode;
  key?: string;
  keyStart?: number;
  depth: number;
}

function* walk(node: JsonNode, path = '$', depth = 0, key?: string, keyStart?: number): Generator<Visit> {
  yield { path, node, key, keyStart, depth };
  if (node.type === 'object') {
    for (const entry of node.entries) {
      yield* walk(entry.value, childPath(path, entry.key), depth + 1, entry.key, entry.keyStart);
    }
  } else if (node.type === 'array') {
    for (let i = 0; i < node.items.length; i += 1) {
      yield* walk(node.items[i], childPath(path, i), depth + 1);
    }
  }
}

export function preview(node: JsonNode, max = 80): string {
  const text = stringifyNode(node, { indent: '' });
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// ── 搜尋 ──

export type SearchMode = 'key' | 'value' | 'path';

export interface SearchOptions {
  mode: SearchMode;
  regex?: boolean;
  caseSensitive?: boolean;
}

export interface SearchHit {
  path: string;
  /** 命中位置在原文中的 offset：key 搜尋指向 key，其他指向值。 */
  offset: number;
  preview: string;
}

function makeMatcher(query: string, options: SearchOptions): (text: string) => boolean {
  if (options.regex) {
    const re = new RegExp(query, options.caseSensitive ? '' : 'i');
    return (text) => re.test(text);
  }
  if (options.caseSensitive) {
    return (text) => text.includes(query);
  }
  const lower = query.toLowerCase();
  return (text) => text.toLowerCase().includes(lower);
}

function scalarText(node: JsonNode): string | undefined {
  switch (node.type) {
    case 'string':
      return node.value;
    case 'number':
      return node.raw;
    case 'boolean':
      return String(node.value);
    case 'null':
      return 'null';
    default:
      return undefined;
  }
}

export function searchJson(root: JsonNode, query: string, options: SearchOptions): SearchHit[] {
  if (options.mode === 'path') {
    return queryPath(root, query).map(({ path, node }) => ({ path, offset: node.start, preview: preview(node) }));
  }
  const match = makeMatcher(query, options);
  const hits: SearchHit[] = [];
  for (const visit of walk(root)) {
    if (options.mode === 'key') {
      if (visit.key !== undefined && match(visit.key)) {
        hits.push({ path: visit.path, offset: visit.keyStart ?? visit.node.start, preview: preview(visit.node) });
      }
    } else {
      const text = scalarText(visit.node);
      if (text !== undefined && match(text)) {
        hits.push({ path: visit.path, offset: visit.node.start, preview: preview(visit.node) });
      }
    }
  }
  return hits;
}

type Segment = { kind: 'key'; key: string } | { kind: 'index'; index: number } | { kind: 'wildcard' } | { kind: 'deep'; key: string | null };

/** 支援 $.a.b[0]、a.b[*].c、$..name、$["含 空白"]；開頭的 $ 可省略。 */
export function parsePath(expression: string): Segment[] {
  const segments: Segment[] = [];
  let rest = expression.trim().replace(/^\$/, '');
  if (rest !== '' && !rest.startsWith('.') && !rest.startsWith('[')) {
    rest = '.' + rest;
  }
  const re = /^(?:\.\.([A-Za-z_$][\w$]*|\*)?|\.([A-Za-z_$][\w$-]*|\*)|\[(\d+)\]|\[\*\]|\[("(?:[^"\\]|\\.)*"|'[^']*')\])/;
  while (rest !== '') {
    const m = re.exec(rest);
    if (!m) {
      throw new Error(`路徑語法錯誤：無法解析「${rest}」`);
    }
    if (m[0].startsWith('..')) {
      segments.push({ kind: 'deep', key: m[1] && m[1] !== '*' ? m[1] : null });
    } else if (m[2] !== undefined) {
      segments.push(m[2] === '*' ? { kind: 'wildcard' } : { kind: 'key', key: m[2] });
    } else if (m[3] !== undefined) {
      segments.push({ kind: 'index', index: Number(m[3]) });
    } else if (m[4] !== undefined) {
      const quoted = m[4];
      segments.push({ kind: 'key', key: quoted.startsWith('"') ? (JSON.parse(quoted) as string) : quoted.slice(1, -1) });
    } else {
      segments.push({ kind: 'wildcard' });
    }
    rest = rest.slice(m[0].length);
  }
  return segments;
}

function children(path: string, node: JsonNode): { path: string; node: JsonNode; key?: string }[] {
  if (node.type === 'object') {
    return node.entries.map((e) => ({ path: childPath(path, e.key), node: e.value, key: e.key }));
  }
  if (node.type === 'array') {
    return node.items.map((item, i) => ({ path: childPath(path, i), node: item }));
  }
  return [];
}

export function queryPath(root: JsonNode, expression: string): { path: string; node: JsonNode }[] {
  let current: { path: string; node: JsonNode }[] = [{ path: '$', node: root }];
  for (const segment of parsePath(expression)) {
    const next: { path: string; node: JsonNode }[] = [];
    for (const item of current) {
      switch (segment.kind) {
        case 'key':
          next.push(...children(item.path, item.node).filter((c) => item.node.type === 'object' && c.key === segment.key));
          break;
        case 'index':
          if (item.node.type === 'array' && item.node.items[segment.index]) {
            next.push({ path: childPath(item.path, segment.index), node: item.node.items[segment.index] });
          }
          break;
        case 'wildcard':
          next.push(...children(item.path, item.node));
          break;
        case 'deep':
          for (const visit of walk(item.node, item.path)) {
            if (segment.key === null ? visit.depth > 0 : visit.key === segment.key) {
              next.push({ path: visit.path, node: visit.node });
            }
          }
          break;
      }
    }
    current = next;
  }
  return current;
}

// ── 統計 ──

export interface JsonStats {
  totalNodes: number;
  maxDepth: number;
  types: Record<JsonNode['type'], number>;
  topKeys: [string, number][];
  distinctKeys: number;
  arrays: { count: number; minLength: number; maxLength: number; avgLength: number };
  strings: TextStats;
}

export function jsonStats(root: JsonNode, topN = 20): JsonStats {
  const types: Record<JsonNode['type'], number> = { object: 0, array: 0, string: 0, number: 0, boolean: 0, null: 0 };
  const keys = new Map<string, number>();
  const arrayLengths: number[] = [];
  const stringValues: string[] = [];
  let totalNodes = 0;
  let maxDepth = 0;
  for (const visit of walk(root)) {
    totalNodes += 1;
    maxDepth = Math.max(maxDepth, visit.depth);
    types[visit.node.type] += 1;
    if (visit.key !== undefined) {
      keys.set(visit.key, (keys.get(visit.key) ?? 0) + 1);
    }
    if (visit.node.type === 'array') {
      arrayLengths.push(visit.node.items.length);
    }
    if (visit.node.type === 'string') {
      stringValues.push(visit.node.value);
    }
  }
  const topKeys = [...keys.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, topN);
  return {
    totalNodes,
    maxDepth,
    types,
    topKeys,
    distinctKeys: keys.size,
    arrays: {
      count: arrayLengths.length,
      minLength: arrayLengths.length ? Math.min(...arrayLengths) : 0,
      maxLength: arrayLengths.length ? Math.max(...arrayLengths) : 0,
      avgLength: arrayLengths.length ? arrayLengths.reduce((a, b) => a + b, 0) / arrayLengths.length : 0,
    },
    strings: textStats(stringValues.join('\n'), topN),
  };
}

export function formatJsonStats(stats: JsonStats): string {
  const s = stats.strings;
  const lines = [
    '# JSON 統計',
    '',
    '## 結構',
    `節點總數：${stats.totalNodes}`,
    `最大深度：${stats.maxDepth}`,
    `型別分佈：${Object.entries(stats.types).map(([k, v]) => `${k} ${v}`).join('、')}`,
    `相異 key 數：${stats.distinctKeys}`,
    `陣列：${stats.arrays.count} 個，長度 ${stats.arrays.minLength}–${stats.arrays.maxLength}，平均 ${stats.arrays.avgLength.toFixed(1)}`,
    '',
    '## key 出現次數',
    ...stats.topKeys.map(([k, n]) => `${String(n).padStart(6)}  ${k}`),
    '',
    '## 字串值的文字統計',
    `字元數：${s.characters}（UTF-8 ${s.bytes} 位元組）`,
    `單詞數：${s.words}（英數單詞 ${s.latinWords}、CJK 字 ${s.cjkCharacters}）`,
    '',
    '## 單詞頻率',
    ...s.topWords.map(([w, n]) => `${String(n).padStart(6)}  ${w}`),
  ];
  return lines.join('\n') + '\n';
}

// ── 轉義還原 ──

/** 把 "{\"a\":1}" 或 {\"a\":1} 這種被多包一層字串的 JSON 還原；可能包了好幾層，就一路解到不是字串為止。 */
export function unescapeJson(input: string): JsonNode {
  let text = input.trim();
  // 本來就是 JSON 的輸入不能包引號：裡面的 " 與換行會讓外層字串解析失敗
  const plain = tryParse(text);
  if (plain && plain.type !== 'string') {
    return plain;
  }
  if (!text.startsWith('"')) {
    text = `"${text}"`;
  }
  for (let round = 0; round < 5; round += 1) {
    const node = parseJson(text);
    if (node.type !== 'string') {
      return node;
    }
    text = node.value.trim();
    const inner = tryParse(text);
    if (inner && inner.type !== 'string') {
      return inner;
    }
  }
  throw new Error('解了 5 層仍然是字串，放棄');
}

function tryParse(text: string): JsonNode | undefined {
  try {
    return parseJsonDocument(text).node;
  } catch {
    return undefined;
  }
}
