// 進位轉換、行處理、正則測試。
import { MAX_PATTERN_LENGTH, regexMatchAll } from '../json/isolatedRegex';
import type { IsolatedMatch } from '../json/isolatedRegex';

/** 自動辨識 0x／0o／0b 前綴，其餘當十進位；用 BigInt 所以位數不受限。 */
export function parseInteger(input: string, base?: number): bigint {
  const text = input.trim().replace(/[_\s]/g, '');
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  let value: bigint;
  if (base === undefined || base === 10) {
    if (/^0[xob]/i.test(body)) {
      value = BigInt(body.toLowerCase());
    } else if (/^\d+$/.test(body)) {
      value = BigInt(body);
    } else {
      throw new Error(`不是整數：${input}`);
    }
  } else {
    const digits = '0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, base);
    value = 0n;
    for (const ch of body.toLowerCase()) {
      const d = digits.indexOf(ch);
      if (d === -1) {
        throw new Error(`「${ch}」不是 ${base} 進位的數字`);
      }
      value = value * BigInt(base) + BigInt(d);
    }
  }
  return negative ? -value : value;
}

export function baseReport(input: string): string {
  const value = parseInteger(input);
  const rows: [string, string][] = [
    ['二進位', value.toString(2)],
    ['八進位', value.toString(8)],
    ['十進位', value.toString(10)],
    ['十六進位', value.toString(16)],
    ['三十六進位', value.toString(36)],
  ];
  const lines = ['# 進位轉換', ...rows.map(([label, v]) => `${label.padEnd(6, '\u3000')}${v}`)];
  if (value >= -(2n ** 31n) && value < 2n ** 32n) {
    lines.push('', `32 位元有號   ${BigInt.asIntN(32, value)}`, `32 位元無號   ${BigInt.asUintN(32, value)}`);
  }
  return lines.join('\n') + '\n';
}

export type LineOp = 'sort' | 'sortDesc' | 'unique' | 'trim' | 'removeEmpty' | 'reverse';

export function processLines(text: string, op: LineOp): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const collator = new Intl.Collator('zh-Hant', { numeric: true });
  switch (op) {
    case 'sort':
      return [...lines].sort(collator.compare).join(eol);
    case 'sortDesc':
      return [...lines].sort((a, b) => collator.compare(b, a)).join(eol);
    case 'unique':
      return [...new Set(lines)].join(eol);
    case 'trim':
      return lines.map((l) => l.trim()).join(eol);
    case 'removeEmpty':
      return lines.filter((l) => l.trim() !== '').join(eol);
    case 'reverse':
      return [...lines].reverse().join(eol);
  }
}

const PCRE_NOTES = [
  'JS 不支援 PCRE 的 \\A、\\z、\\Z，改用 ^／$（不加 m 旗標）',
  'JS 不支援佔有量詞（a++）與原子群組 (?>...)',
  'PCRE 具名群組可寫 (?P<name>...)，JS 只接受 (?<name>...)',
  'PHP preg_* 的 pattern 要加分隔符號（/.../i），這裡只填中間的內容與旗標',
  'JS 的 \\d、\\w 只比對 ASCII；PCRE 加 u 旗標後行為相同',
];

const REPORT_LIMIT = 500;

function reportFlags(flags: string): string {
  return flags.includes('g') ? flags : `${flags}g`;
}

function wrapSyntaxError(error: unknown): Error {
  return new Error(`正則語法錯誤：${error instanceof Error ? error.message : String(error)}`);
}

/** 同步版：正則在呼叫端執行緒上跑。extension host 內請用 regexReportIsolated。 */
export function regexReport(pattern: string, flags: string, text: string): string {
  let re: RegExp;
  try {
    re = new RegExp(pattern, reportFlags(flags));
  } catch (error) {
    throw wrapSyntaxError(error);
  }
  const all = [...text.matchAll(re)];
  const matches = all.slice(0, REPORT_LIMIT).map((m) => ({ index: m.index, values: [...m], groups: m.groups }));
  return formatRegexReport(pattern, flags, all.length, matches);
}

/** 與 regexReport 輸出相同，但匹配在 worker 裡跑、逾時中止，災難性回溯不會凍結 extension host。 */
export async function regexReportIsolated(pattern: string, flags: string, text: string, timeoutMs?: number): Promise<string> {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new Error(`正則最長 ${MAX_PATTERN_LENGTH} 個字元，目前 ${pattern.length} 個`);
  }
  try {
    new RegExp(pattern, reportFlags(flags));
  } catch (error) {
    throw wrapSyntaxError(error);
  }
  const { count, matches } = await regexMatchAll(pattern, reportFlags(flags), text, REPORT_LIMIT, timeoutMs);
  return formatRegexReport(pattern, flags, count, matches);
}

function formatRegexReport(pattern: string, flags: string, count: number, matches: IsolatedMatch[]): string {
  const lines = [`# 正則測試 /${pattern}/${flags}`, `共 ${count} 個匹配`, ''];
  matches.forEach((m, i) => {
    lines.push(`[${i}] 位置 ${m.index}：${JSON.stringify(m.values[0])}`);
    m.values.slice(1).forEach((g, gi) => lines.push(`     群組 ${gi + 1}：${g === undefined ? '（未參與）' : JSON.stringify(g)}`));
    for (const [name, value] of Object.entries(m.groups ?? {})) {
      lines.push(`     <${name}>：${value === undefined ? '（未參與）' : JSON.stringify(value)}`);
    }
  });
  if (count > REPORT_LIMIT) {
    lines.push(`…只列前 ${REPORT_LIMIT} 個`);
  }
  lines.push('', '## 與 PCRE（PHP preg_*）的已知差異', ...PCRE_NOTES.map((n) => `- ${n}`));
  return lines.join('\n') + '\n';
}
